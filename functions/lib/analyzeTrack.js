"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.identifySong = exports.analyzeTrack = exports.youtubeDataApiKey = exports.spotifyClientSecret = exports.spotifyClientId = exports.geminiKey = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const genai_1 = require("@google/genai");
const axios_1 = __importDefault(require("axios"));
const spotifyLookup_1 = require("./spotifyLookup");
const appleLookup_1 = require("./appleLookup");
// ── Secrets ───────────────────────────────────────────────────────────────────
exports.geminiKey = (0, params_1.defineSecret)("GEMINI_API_KEY");
exports.spotifyClientId = (0, params_1.defineSecret)("SPOTIFY_CLIENT_ID");
exports.spotifyClientSecret = (0, params_1.defineSecret)("SPOTIFY_CLIENT_SECRET");
exports.youtubeDataApiKey = (0, params_1.defineSecret)("YOUTUBE_DATA_API_KEY");
const MODEL = "gemini-2.5-pro-preview-05-06";
// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanJsonResponse(text) {
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
function detectPlatform(url) {
    if (url.includes("youtube.com") || url.includes("youtu.be"))
        return "youtube";
    if (url.includes("spotify.com"))
        return "spotify";
    if (url.includes("music.apple.com"))
        return "apple";
    return "other";
}
/**
 * Search YouTube Data API v3 for a track by ISRC or query string.
 * Returns the first video URL, or null if none found.
 */
async function searchYoutube(query, apiKey) {
    const resp = await axios_1.default.get("https://www.googleapis.com/youtube/v3/search", {
        params: {
            key: apiKey,
            q: query,
            type: "video",
            videoCategoryId: "10", // Music
            maxResults: 1,
            part: "id",
        },
        timeout: 10000,
    });
    const items = resp.data.items || [];
    if (items.length === 0)
        return null;
    return `https://www.youtube.com/watch?v=${items[0].id.videoId}`;
}
/**
 * Call Modal.com to download audio from a URL, run noisereduce + Demucs,
 * and return the guitar-stem WAV as base64.
 */
async function callModal(audioUrl) {
    const modalEndpoint = process.env.MODAL_ENDPOINT;
    if (!modalEndpoint) {
        throw new https_1.HttpsError("failed-precondition", "MODAL_ENDPOINT environment variable is not set. Deploy the Modal service and set MODAL_ENDPOINT.");
    }
    const resp = await axios_1.default.post(modalEndpoint, { url: audioUrl }, {
        headers: { "Content-Type": "application/json" },
        timeout: 180000, // 3 minutes for Demucs
    });
    const stemB64 = resp.data.stem_b64;
    if (!stemB64) {
        throw new https_1.HttpsError("internal", "Modal.com returned no stem data.");
    }
    return stemB64;
}
/** Call Gemini with a guitar-stem WAV (base64) and return parsed SongAnalysis */
async function callGeminiWithStem(stemB64, apiKey, knownDetails) {
    const genAI = new genai_1.GoogleGenAI({ apiKey });
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
            systemInstruction: "You are a specialised audio-to-chord transcription engine. Your only input is the provided guitar-stem audio. Transcribe what is actually heard.",
            tools: knownDetails ? [{ googleSearch: {} }] : [],
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingLevel: genai_1.ThinkingLevel.HIGH },
        },
    });
    const text = result.text || "{}";
    const parsed = JSON.parse(cleanJsonResponse(text));
    // Sanitise
    if (!Array.isArray(parsed.fingerings))
        parsed.fingerings = [];
    parsed.fingerings = parsed.fingerings.map((f) => ({
        chord: f.chord || "Unknown",
        strings: Array.isArray(f.strings) ? f.strings : ["x", "x", "x", "x", "x", "x"],
    }));
    if (!Array.isArray(parsed.chords))
        parsed.chords = [];
    if (typeof parsed.lyrics !== "string")
        parsed.lyrics = "No lyrics transcribed.";
    return parsed;
}
// ── analyzeTrack ──────────────────────────────────────────────────────────────
exports.analyzeTrack = (0, https_1.onCall)({
    secrets: [exports.geminiKey, exports.spotifyClientId, exports.spotifyClientSecret, exports.youtubeDataApiKey],
    memory: "1GiB",
    timeoutSeconds: 300,
    region: "us-central1",
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Sign in to analyse tracks.");
    }
    const { url, jobId, knownDetails } = request.data;
    if (!url || !jobId) {
        throw new https_1.HttpsError("invalid-argument", "url and jobId are required.");
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
            result: cached.data().result,
            userId: request.auth.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { jobId, result: cached.data().result };
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
            const isrc = await (0, spotifyLookup_1.resolveSpotifyUrl)(url, exports.spotifyClientId.value(), exports.spotifyClientSecret.value());
            const ytUrl = await searchYoutube(isrc ? `isrc:${isrc}` : url, exports.youtubeDataApiKey.value());
            if (!ytUrl) {
                throw new https_1.HttpsError("not-found", "Could not find a YouTube video for this Spotify track.");
            }
            youtubeUrl = ytUrl;
        }
        else if (platform === "apple") {
            await jobRef.update({ stage: "resolving", pct: 10 });
            const query = await (0, appleLookup_1.resolveAppleUrl)(url);
            const ytUrl = await searchYoutube(query, exports.youtubeDataApiKey.value());
            if (!ytUrl) {
                throw new https_1.HttpsError("not-found", "Could not find a YouTube video for this Apple Music track.");
            }
            youtubeUrl = ytUrl;
        }
        // ── Call Modal.com for audio isolation ───────────────────────────────
        await jobRef.update({ stage: "isolating", pct: 20 });
        const stemB64 = await callModal(youtubeUrl);
        // ── Call Gemini with guitar stem ─────────────────────────────────────
        await jobRef.update({ stage: "analyzing", pct: 70 });
        const analysis = await callGeminiWithStem(stemB64, exports.geminiKey.value(), knownDetails);
        // ── Write result ─────────────────────────────────────────────────────
        await jobRef.update({ stage: "complete", pct: 100, result: analysis });
        // Cache the result
        await cacheRef.set({
            result: analysis,
            url,
            cachedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { jobId, result: analysis };
    }
    catch (err) {
        const message = err instanceof https_1.HttpsError
            ? err.message
            : err?.message || "Analysis failed.";
        await jobRef.update({ stage: "error", error: message }).catch(() => { });
        throw err instanceof https_1.HttpsError
            ? err
            : new https_1.HttpsError("internal", message);
    }
});
// ── identifySong ──────────────────────────────────────────────────────────────
exports.identifySong = (0, https_1.onCall)({
    secrets: [exports.geminiKey],
    memory: "512MiB",
    timeoutSeconds: 60,
    region: "us-central1",
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Sign in to identify tracks.");
    }
    const { url } = request.data;
    if (!url)
        throw new https_1.HttpsError("invalid-argument", "url is required.");
    const genAI = new genai_1.GoogleGenAI({ apiKey: exports.geminiKey.value() });
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
            thinkingConfig: { thinkingLevel: genai_1.ThinkingLevel.LOW },
        },
    });
    const text = result.text || "{}";
    try {
        return JSON.parse(cleanJsonResponse(text));
    }
    catch {
        return { title: "Unknown", artist: "Unknown", chords: [], fingerings: [] };
    }
});
//# sourceMappingURL=analyzeTrack.js.map