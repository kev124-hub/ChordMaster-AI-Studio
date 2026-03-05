import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import { resolveSpotifyUrl } from "./spotifyLookup";
import { resolveAppleUrl } from "./appleLookup";

// ── Secrets ───────────────────────────────────────────────────────────────────
export const geminiKey = defineSecret("GEMINI_API_KEY");
export const spotifyClientId = defineSecret("SPOTIFY_CLIENT_ID");
export const spotifyClientSecret = defineSecret("SPOTIFY_CLIENT_SECRET");
export const youtubeDataApiKey = defineSecret("YOUTUBE_DATA_API_KEY");

const MODEL = "gemini-2.5-pro";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip non-ASCII characters that appear outside JSON string values.
 *  Gemini thinking tokens (e.g. Cyrillic) occasionally leak into the
 *  structural parts of the response and break JSON.parse. */
function stripNonAsciiOutsideStrings(s: string): string {
  let result = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { result += c; escape = false; continue; }
    if (c === "\\") { result += c; escape = true; continue; }
    if (c === '"') { inString = !inString; result += c; continue; }
    if (!inString && c.charCodeAt(0) > 127) continue; // skip non-ASCII outside strings
    result += c;
  }
  return result;
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.replace(/```json|```/gi, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
    }
  }
  return stripNonAsciiOutsideStrings(cleaned);
}

/** Detect and normalise platform from URL */
function detectPlatform(
  url: string
): "youtube" | "spotify" | "apple" | "other" {
  if (url.includes("youtube.com") || url.includes("youtu.be"))
    return "youtube";
  if (url.includes("spotify.com")) return "spotify";
  if (url.includes("music.apple.com")) return "apple";
  return "other";
}

/**
 * Search YouTube Data API v3 for a track by ISRC or query string.
 * Returns the first video URL, or null if none found.
 */
async function searchYoutube(
  query: string,
  apiKey: string
): Promise<string | null> {
  const resp = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        key: apiKey,
        q: query,
        type: "video",
        videoCategoryId: "10", // Music
        maxResults: 1,
        part: "id",
      },
      timeout: 10000,
    }
  );
  const items: any[] = resp.data.items || [];
  if (items.length === 0) return null;
  return `https://www.youtube.com/watch?v=${items[0].id.videoId}`;
}

/**
 * Call Gemini with a YouTube URL using native video analysis (no yt-dlp needed).
 * Gemini processes YouTube URLs directly from Google's infrastructure,
 * avoiding cloud IP blocks that affect yt-dlp downloads.
 */
async function callGeminiWithYoutubeUrl(
  youtubeUrl: string,
  apiKey: string,
  knownDetails?: { title: string; artist: string }
): Promise<any> {
  const genAI = new GoogleGenAI({ apiKey });

  const contextNote =
    knownDetails?.title && knownDetails?.artist
      ? `\n\nCONTEXT: This has been identified as "${knownDetails.title}" by "${knownDetails.artist}". Transcribe chords and lyrics EXACTLY as performed in the video.`
      : "";

  const prompt = `You are a professional guitar transcription expert. Listen carefully to this YouTube video and transcribe the guitar chords and lyrics.
${contextNote}

TRANSCRIPTION PROTOCOL:
1. Listen to the entire audio.
2. Transcribe the lyrics word-for-word as sung.
3. Identify ALL chords played on guitar throughout the song.
4. Align chord names above the corresponding lyric syllables.
5. Note any capo, tuning, or picking patterns.

Return ONLY a valid JSON object with this exact structure:
{
  "title": "${knownDetails?.title || "Song Title"}",
  "artist": "${knownDetails?.artist || "Artist Name"}",
  "chords": [],
  "fingerings": [{"chord": "C", "strings": ["x", "3", "2", "0", "1", "0"]}],
  "lyrics": "Lyrics with chords aligned above them...",
  "strummingPattern": "",
  "key": "",
  "tempo": "",
  "tuning": "Standard",
  "capo": "No capo",
  "timeSignature": "4/4",
  "duration": 0,
  "keyChords": {"major": [], "minor": []},
  "performanceNotes": "Detailed analysis of the performance."
}`;

  const result = await genAI.models.generateContent({
    model: MODEL,
    contents: [
      {
        parts: [
          { fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" } },
          { text: prompt },
        ],
      },
    ],
    config: {
      systemInstruction:
        "You are a professional guitar transcription expert. Analyse the provided YouTube video and return accurate chord and lyric transcriptions.",
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });

  const text = result.text || "{}";
  const parsed = JSON.parse(cleanJsonResponse(text));

  if (!Array.isArray(parsed.fingerings)) parsed.fingerings = [];
  parsed.fingerings = parsed.fingerings.map((f: any) => ({
    chord: f.chord || "Unknown",
    strings: Array.isArray(f.strings) ? f.strings : ["x", "x", "x", "x", "x", "x"],
  }));
  if (!Array.isArray(parsed.chords)) parsed.chords = [];
  if (typeof parsed.lyrics !== "string") parsed.lyrics = "No lyrics transcribed.";

  return parsed;
}

// ── analyzeTrack ──────────────────────────────────────────────────────────────

export const analyzeTrack = onCall(
  {
    secrets: [geminiKey, spotifyClientId, spotifyClientSecret, youtubeDataApiKey],
    memory: "1GiB",
    timeoutSeconds: 300,
    region: "us-central1",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to analyse tracks.");
    }

    const { url, jobId, knownDetails } = request.data as {
      url: string;
      jobId: string;
      knownDetails?: { title: string; artist: string };
    };

    if (!url || !jobId) {
      throw new HttpsError("invalid-argument", "url and jobId are required.");
    }

    const db = admin.firestore();
    const jobRef = db.collection("jobs").doc(jobId);

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheHash = Buffer.from(url).toString("base64url").slice(0, 40);
    const cacheRef = db.collection("analysis_cache").doc(cacheHash);
    const cached = await cacheRef.get();
    if (cached.exists) {
      await jobRef.set({
        stage: "complete",
        pct: 100,
        result: cached.data()!.result,
        userId: request.auth.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { jobId, result: cached.data()!.result };
    }

    // ── Create job doc ───────────────────────────────────────────────────────
    await jobRef.set({
      stage: "resolving",
      pct: 5,
      userId: request.auth.uid,
      url,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      // ── Resolve platform → YouTube URL ───────────────────────────────────
      const platform = detectPlatform(url);
      let youtubeUrl = url;

      if (platform === "spotify") {
        await jobRef.update({ stage: "resolving", pct: 10 });
        const isrc = await resolveSpotifyUrl(
          url,
          spotifyClientId.value(),
          spotifyClientSecret.value()
        );
        const ytUrl = await searchYoutube(
          isrc ? `isrc:${isrc}` : url,
          youtubeDataApiKey.value()
        );
        if (!ytUrl) {
          throw new HttpsError(
            "not-found",
            "Could not find a YouTube video for this Spotify track."
          );
        }
        youtubeUrl = ytUrl;
      } else if (platform === "apple") {
        await jobRef.update({ stage: "resolving", pct: 10 });
        const query = await resolveAppleUrl(url);
        const ytUrl = await searchYoutube(query, youtubeDataApiKey.value());
        if (!ytUrl) {
          throw new HttpsError(
            "not-found",
            "Could not find a YouTube video for this Apple Music track."
          );
        }
        youtubeUrl = ytUrl;
      }

      // ── Call Gemini with YouTube URL (native video analysis) ────────────
      // Uses Gemini's built-in YouTube support — no yt-dlp, no cloud IP blocks.
      await jobRef.update({ stage: "analyzing", pct: 40 });
      const analysis = await callGeminiWithYoutubeUrl(
        youtubeUrl,
        geminiKey.value(),
        knownDetails
      );

      // ── Write result ─────────────────────────────────────────────────────
      await jobRef.update({ stage: "complete", pct: 100, result: analysis });

      // Cache the result
      await cacheRef.set({
        result: analysis,
        url,
        cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { jobId, result: analysis };
    } catch (err: any) {
      const message =
        err instanceof HttpsError
          ? err.message
          : err?.message || "Analysis failed.";
      await jobRef.update({ stage: "error", error: message }).catch(() => {});
      throw err instanceof HttpsError
        ? err
        : new HttpsError("internal", message);
    }
  }
);

// ── identifySong ──────────────────────────────────────────────────────────────

export const identifySong = onCall(
  {
    secrets: [geminiKey],
    memory: "512MiB",
    timeoutSeconds: 120,
    region: "us-central1",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to identify tracks.");
    }

    const { url } = request.data as { url: string };
    if (!url) throw new HttpsError("invalid-argument", "url is required.");

    const genAI = new GoogleGenAI({ apiKey: geminiKey.value() });

    console.log(`identifySong called for url: ${url}`);

    try {
      const result = await genAI.models.generateContent({
        model: MODEL,
        contents: [
          {
            parts: [
              {
                text: `Identify the song at this URL: ${url}.
Use Google Search to find the track title and artist name.
Return ONLY a JSON object: {"title": "", "artist": "", "chords": [], "fingerings": []}.
If you cannot identify the song, return {"title": "Unknown", "artist": "Unknown", "chords": [], "fingerings": []}.`,
              },
            ],
          },
        ],
        config: {
          // googleSearch only — urlContext is excluded because Spotify and Apple
          // Music URLs require authentication and return login redirects,
          // causing urlContext to fail or stall. googleSearch works for all platforms.
          tools: [{ googleSearch: {} }],
        },
      });

      console.log(`identifySong raw response: ${result.text?.slice(0, 200)}`);

      const text = result.text || "{}";
      try {
        return JSON.parse(cleanJsonResponse(text));
      } catch {
        return { title: "Unknown", artist: "Unknown", chords: [], fingerings: [] };
      }
    } catch (err: any) {
      const detail = err?.message || String(err);
      console.error(`identifySong Gemini error [model=${MODEL}]:`, detail);
      throw new HttpsError("internal", `Song identification failed: ${detail}`);
    }
  }
);
