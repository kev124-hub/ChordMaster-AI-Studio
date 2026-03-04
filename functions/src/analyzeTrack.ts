import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import axios from "axios";
import { resolveSpotifyUrl } from "./spotifyLookup";
import { resolveAppleUrl } from "./appleLookup";

// ── Secrets ───────────────────────────────────────────────────────────────────
export const geminiKey = defineSecret("GEMINI_API_KEY");
export const spotifyClientId = defineSecret("SPOTIFY_CLIENT_ID");
export const spotifyClientSecret = defineSecret("SPOTIFY_CLIENT_SECRET");
export const youtubeDataApiKey = defineSecret("YOUTUBE_DATA_API_KEY");

const MODEL = "gemini-2.5-pro-preview";

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanJsonResponse(text: string): string {
  let cleaned = text.replace(/```json|```/gi, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
    }
  }
  return cleaned;
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
 * Call Modal.com to download audio from a URL, run noisereduce + Demucs,
 * and return the guitar-stem WAV as base64.
 */
async function callModal(audioUrl: string): Promise<string> {
  const modalEndpoint = process.env.MODAL_ENDPOINT;
  if (!modalEndpoint) {
    throw new HttpsError(
      "failed-precondition",
      "MODAL_ENDPOINT environment variable is not set. Deploy the Modal service and set MODAL_ENDPOINT."
    );
  }

  const resp = await axios.post(
    modalEndpoint,
    { url: audioUrl },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 180000, // 3 minutes for Demucs
    }
  );

  const stemB64: string = resp.data.stem_b64;
  if (!stemB64) {
    throw new HttpsError(
      "internal",
      "Modal.com returned no stem data."
    );
  }
  return stemB64;
}

/** Call Gemini with a guitar-stem WAV (base64) and return parsed SongAnalysis */
async function callGeminiWithStem(
  stemB64: string,
  apiKey: string,
  knownDetails?: { title: string; artist: string }
): Promise<any> {
  const genAI = new GoogleGenAI({ apiKey });

  const frontendInstructions = `
STRICT TRANSCRIPTION RULES:
1. Listen to the provided audio. It is the ONLY source for chords.
2. Transcribe the lyrics word-for-word. Do not summarise.
3. Identify chords played on the acoustic guitar.
4. If the audio is silent or just noise, state that in performanceNotes.
5. Never use external lyrics for uploaded audio files.`;

  let contextNote = "";
  if (knownDetails?.title && knownDetails?.artist) {
    contextNote = `\n\nCRITICAL CONTEXT: This has been identified as "${knownDetails.title}" by "${knownDetails.artist}".
Perform a direct musical analysis of the provided guitar-stem audio.
Transcribe chords and lyrics EXACTLY as performed. Use Google Search only to verify lyrics text.
DO NOT copy a generic chord chart from the web — your analysis must reflect the actual guitar track.`;
  }

  const prompt = `CRITICAL AUDIO TRANSCRIPTION TASK:
You are provided with a guitar-stem audio file (isolated by Demucs). Listen and transcribe.

TRANSCRIPTION PROTOCOL:
1. Listen to the entire audio.
2. Transcribe the lyrics word-for-word as sung.
3. Identify the chords played on the acoustic guitar.
4. Align chords above the lyrics.
5. If the audio is silent or just noise, state that in performanceNotes and return empty lyrics.
${contextNote}

REQUIRED JSON STRUCTURE:
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
  "performanceNotes": "Detailed analysis of the audio performance."
}

${frontendInstructions}`;

  const result = await genAI.models.generateContent({
    model: MODEL,
    contents: [
      {
        parts: [
          { inlineData: { mimeType: "audio/wav", data: stemB64 } },
          { text: prompt },
        ],
      },
    ],
    config: {
      systemInstruction:
        "You are a specialised audio-to-chord transcription engine. Your only input is the provided guitar-stem audio. Transcribe what is actually heard.",
      tools: knownDetails ? [{ googleSearch: {} }] : [],
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });

  const text = result.text || "{}";
  const parsed = JSON.parse(cleanJsonResponse(text));

  // Sanitise
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

      // ── Call Modal.com for audio isolation ───────────────────────────────
      await jobRef.update({ stage: "isolating", pct: 20 });
      const stemB64 = await callModal(youtubeUrl);

      // ── Call Gemini with guitar stem ─────────────────────────────────────
      await jobRef.update({ stage: "analyzing", pct: 70 });
      const analysis = await callGeminiWithStem(
        stemB64,
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
    timeoutSeconds: 60,
    region: "us-central1",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to identify tracks.");
    }

    const { url } = request.data as { url: string };
    if (!url) throw new HttpsError("invalid-argument", "url is required.");

    const genAI = new GoogleGenAI({ apiKey: geminiKey.value() });

    const result = await genAI.models.generateContent({
      model: MODEL,
      contents: [
        {
          parts: [
            {
              text: `Identify the song at this URL: ${url}.
Use Google Search and URL Context to find the track title and artist.
Return ONLY a JSON object: {"title": "", "artist": "", "chords": [], "fingerings": []}.
If you cannot identify the song, return {"title": "Unknown", "artist": "Unknown", "chords": [], "fingerings": []}.`,
            },
          ],
        },
      ],
      config: {
        tools: [{ googleSearch: {} }, { urlContext: {} }],
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = result.text || "{}";
    try {
      return JSON.parse(cleanJsonResponse(text));
    } catch {
      return { title: "Unknown", artist: "Unknown", chords: [], fingerings: [] };
    }
  }
);
