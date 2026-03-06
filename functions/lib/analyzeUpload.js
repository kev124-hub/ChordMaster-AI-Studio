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
exports.analyzeUpload = void 0;
const admin = __importStar(require("firebase-admin"));
const storage_1 = require("firebase-functions/v2/storage");
const params_1 = require("firebase-functions/params");
const genai_1 = require("@google/genai");
const axios_1 = __importDefault(require("axios"));
// Re-use the same secrets already declared in analyzeTrack.ts — Firebase
// Functions deduplicates secrets by name, so we declare them locally here too.
const geminiKey = (0, params_1.defineSecret)("GEMINI_API_KEY");
const MODEL = "gemini-2.5-pro";
// ── Helpers (mirrors of analyzeTrack.ts — kept local to avoid circular deps) ─
/** Strip non-ASCII characters that appear outside JSON string values.
 *  Gemini thinking tokens (e.g. Cyrillic) occasionally leak into the
 *  structural parts of the response and break JSON.parse. */
function stripNonAsciiOutsideStrings(s) {
    let result = "";
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        const code = c.charCodeAt(0);
        if (escape) {
            result += c;
            escape = false;
            continue;
        }
        if (c === "\\") {
            result += c;
            escape = true;
            continue;
        }
        if (c === '"') {
            inString = !inString;
            result += c;
            continue;
        }
        if (!inString && code > 127)
            continue; // skip non-ASCII outside strings
        if (inString && code < 32) {
            // Escape literal control characters — JSON requires these to be escaped
            if (code === 10) {
                result += "\\n";
                continue;
            }
            if (code === 13) {
                result += "\\r";
                continue;
            }
            if (code === 9) {
                result += "\\t";
                continue;
            }
            continue; // drop other control chars (SOH, STX, etc.)
        }
        result += c;
    }
    return result;
}
function cleanJsonResponse(text) {
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
async function callModal(audioUrl) {
    const modalEndpoint = process.env.MODAL_ENDPOINT;
    if (!modalEndpoint) {
        throw new Error("MODAL_ENDPOINT environment variable is not set. Deploy the Modal service first.");
    }
    let resp;
    try {
        resp = await axios_1.default.post(modalEndpoint, { url: audioUrl }, {
            headers: { "Content-Type": "application/json" },
            timeout: 270_000, // 4.5 min — must be less than the 300 s Firebase function timeout
        });
    }
    catch (err) {
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail ?? err?.message ?? String(err);
        console.error(`callModal error [status=${status ?? "no-response"}]:`, detail);
        throw new Error(status
            ? `Audio processing service error (${status}). The Modal service may be offline — redeploy it and try again.`
            : "Audio processing service is unreachable. The Modal service may be offline — redeploy it and try again.");
    }
    const stemB64 = resp.data.stem_b64;
    if (!stemB64)
        throw new Error("Modal.com returned no stem data.");
    return stemB64;
}
async function callGeminiWithStem(stemB64, apiKey, knownDetails) {
    const genAI = new genai_1.GoogleGenAI({ apiKey });
    const contextNote = knownDetails?.title && knownDetails?.artist
        ? `\n\nCONTEXT: This has been identified as "${knownDetails.title}" by "${knownDetails.artist}". Transcribe chords/lyrics EXACTLY as performed in the audio.`
        : "";
    const prompt = `CRITICAL AUDIO TRANSCRIPTION TASK:
You are provided with a guitar-stem audio file (isolated by Demucs). Listen and transcribe.

TRANSCRIPTION PROTOCOL:
1. Listen to the entire audio.
2. Transcribe the lyrics word-for-word as sung. Transcribe phonetically if needed.
3. Identify chords played on the acoustic guitar.
4. Align chords above the lyrics.
5. If the audio is silent or noise, state that in performanceNotes.
${contextNote}

REQUIRED JSON STRUCTURE:
{
  "title": "${knownDetails?.title || "Original Composition"}",
  "artist": "${knownDetails?.artist || "Independent Artist"}",
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

STRICT RULES:
1. This is the ONLY source for lyrics and chords.
2. Do not use Google Search for this audio file — it is a unique, unreleased recording.
3. Transcribe what is actually heard, not what you expect.`;
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
            tools: [],
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
        },
    });
    const text = result.text || "{}";
    const parsed = JSON.parse(cleanJsonResponse(text));
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
// ── analyzeUpload ─────────────────────────────────────────────────────────────
/**
 * Fires when a file is written to uploads/{userId}/{jobId}_{filename}.
 *
 * The client encodes `jobId` as the prefix of the filename so that this
 * trigger can write progress back to the correct Firestore document.
 * Custom metadata fields `manualTitle` and `manualArtist` (optional) can
 * be set by the client on the upload task.
 */
exports.analyzeUpload = (0, storage_1.onObjectFinalized)({
    // No bucket specified → Firebase uses the project's default Storage bucket,
    // which matches whatever VITE_FIREBASE_STORAGE_BUCKET the client uploads to.
    secrets: [geminiKey],
    memory: "1GiB",
    timeoutSeconds: 300,
    region: "us-central1",
}, async (event) => {
    const filePath = event.data.name ?? "";
    const contentType = event.data.contentType ?? "";
    const bucket = event.data.bucket;
    console.log(`analyzeUpload triggered: bucket=${bucket} path=${filePath} type=${contentType}`);
    // Only process files under uploads/
    if (!filePath.startsWith("uploads/"))
        return;
    // Path format: uploads/{userId}/{jobId}_{originalFilename}
    const segments = filePath.split("/");
    if (segments.length < 3)
        return;
    const userId = segments[1];
    const fileSegment = segments.slice(2).join("/");
    const firstUnderscore = fileSegment.indexOf("_");
    if (firstUnderscore === -1)
        return;
    const secondUnderscore = fileSegment.indexOf("_", firstUnderscore + 1);
    if (secondUnderscore === -1)
        return;
    const jobId = fileSegment.substring(0, secondUnderscore);
    // Read optional known details from custom metadata
    const metadata = event.data.metadata ?? {};
    const knownDetails = metadata.manualTitle && metadata.manualArtist
        ? { title: metadata.manualTitle, artist: metadata.manualArtist }
        : undefined;
    const db = admin.firestore();
    const jobRef = db.collection("jobs").doc(jobId);
    try {
        // Create / update job doc
        await jobRef.set({
            stage: "isolating",
            pct: 10,
            userId,
            filePath,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Generate a signed URL so Modal.com can download the file
        const storageFile = admin
            .storage()
            .bucket(bucket)
            .file(filePath);
        const [signedUrl] = await storageFile.getSignedUrl({
            action: "read",
            expires: Date.now() + 20 * 60 * 1000, // 20 minutes
        });
        // Call Modal.com for audio isolation
        const stemB64 = await callModal(signedUrl);
        await jobRef.update({ stage: "analyzing", pct: 70 });
        // Call Gemini with the guitar stem
        const analysis = await callGeminiWithStem(stemB64, geminiKey.value(), knownDetails);
        // Write final result
        await jobRef.update({ stage: "complete", pct: 100, result: analysis });
    }
    catch (err) {
        const message = err?.message || "Analysis failed.";
        await jobRef.update({ stage: "error", error: message }).catch(() => { });
        console.error("analyzeUpload error:", err);
    }
    finally {
        // Clean up the temp file from Storage
        try {
            await admin.storage().bucket(bucket).file(filePath).delete();
        }
        catch {
            // Non-fatal — file may already be gone
        }
    }
});
//# sourceMappingURL=analyzeUpload.js.map