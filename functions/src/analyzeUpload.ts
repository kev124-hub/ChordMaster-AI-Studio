import * as admin from "firebase-admin";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { defineSecret, defineString } from "firebase-functions/params";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import axios from "axios";

// Re-use the same secrets already declared in analyzeTrack.ts — Firebase
// Functions deduplicates secrets by name, so we declare them locally here too.
const geminiKey = defineSecret("GEMINI_API_KEY");
const storageBucket = defineString("STORAGE_BUCKET");

const MODEL = "gemini-2.5-pro";

// ── Helpers (mirrors of analyzeTrack.ts — kept local to avoid circular deps) ─

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

async function callModal(audioUrl: string): Promise<string> {
  const modalEndpoint = process.env.MODAL_ENDPOINT;
  if (!modalEndpoint) {
    throw new Error(
      "MODAL_ENDPOINT environment variable is not set. Deploy the Modal service first."
    );
  }
  const resp = await axios.post(
    modalEndpoint,
    { url: audioUrl },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 180000, // 3 min for Demucs
    }
  );
  const stemB64: string = resp.data.stem_b64;
  if (!stemB64) throw new Error("Modal.com returned no stem data.");
  return stemB64;
}

async function callGeminiWithStem(
  stemB64: string,
  apiKey: string,
  knownDetails?: { title: string; artist: string }
): Promise<any> {
  const genAI = new GoogleGenAI({ apiKey });

  const contextNote =
    knownDetails?.title && knownDetails?.artist
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
      systemInstruction:
        "You are a specialised audio-to-chord transcription engine. Your only input is the provided guitar-stem audio. Transcribe what is actually heard.",
      tools: [],
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
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

// ── analyzeUpload ─────────────────────────────────────────────────────────────

/**
 * Fires when a file is written to uploads/{userId}/{jobId}_{filename}.
 *
 * The client encodes `jobId` as the prefix of the filename so that this
 * trigger can write progress back to the correct Firestore document.
 * Custom metadata fields `manualTitle` and `manualArtist` (optional) can
 * be set by the client on the upload task.
 */
export const analyzeUpload = onObjectFinalized(
  {
    bucket: storageBucket,
    secrets: [geminiKey],
    memory: "1GiB",
    timeoutSeconds: 300,
    region: "us-central1",
  },
  async (event) => {
    const filePath: string = event.data.name ?? "";
    const contentType: string = event.data.contentType ?? "";
    const bucket = event.data.bucket;

    // Only process files under uploads/
    if (!filePath.startsWith("uploads/")) return;

    // Path format: uploads/{userId}/{jobId}_{originalFilename}
    const segments = filePath.split("/");
    if (segments.length < 3) return;

    const userId = segments[1];
    const fileSegment = segments.slice(2).join("/");
    const firstUnderscore = fileSegment.indexOf("_");
    if (firstUnderscore === -1) return;
    const secondUnderscore = fileSegment.indexOf("_", firstUnderscore + 1);
    if (secondUnderscore === -1) return;

    const jobId = fileSegment.substring(0, secondUnderscore);

    // Read optional known details from custom metadata
    const metadata = event.data.metadata ?? {};
    const knownDetails =
      metadata.manualTitle && metadata.manualArtist
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
      const analysis = await callGeminiWithStem(
        stemB64,
        geminiKey.value(),
        knownDetails
      );

      // Write final result
      await jobRef.update({ stage: "complete", pct: 100, result: analysis });
    } catch (err: any) {
      const message = err?.message || "Analysis failed.";
      await jobRef.update({ stage: "error", error: message }).catch(() => {});
      console.error("analyzeUpload error:", err);
    } finally {
      // Clean up the temp file from Storage
      try {
        await admin.storage().bucket(bucket).file(filePath).delete();
      } catch {
        // Non-fatal — file may already be gone
      }
    }
  }
);
