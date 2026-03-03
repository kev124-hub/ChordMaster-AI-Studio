/**
 * gemini.ts — Firebase Functions client
 *
 * All Gemini API calls now happen server-side via Firebase Cloud Functions.
 * This module is a thin wrapper that calls the deployed HTTPS callables so
 * that the GEMINI_API_KEY is never shipped in the client bundle (fixes BUG 2).
 */

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

// ── Types (kept for the rest of the app) ──────────────────────────────────────

export interface ChordFingering {
  chord: string;
  strings: string[];
}

export interface SongAnalysis {
  title: string;
  artist: string;
  chords: string[];
  fingerings: ChordFingering[];
  lyrics?: string;
  strummingPattern?: string;
  key?: string;
  tempo?: string;
  tuning?: string;
  capo?: string;
  timeSignature?: string;
  duration?: number;
  keyChords?: {
    major: string[];
    minor: string[];
  };
  performanceNotes?: string;
}

// ── Firebase Functions callables ──────────────────────────────────────────────

const functions = app ? getFunctions(app, "us-central1") : null;

const analyzeTrackFn = functions
  ? httpsCallable<
      { url: string; jobId: string; knownDetails?: { title: string; artist: string } },
      SongAnalysis
    >(functions, "analyzeTrack")
  : null;

const identifySongFn = functions
  ? httpsCallable<{ url: string }, SongAnalysis>(functions, "identifySong")
  : null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a song URL via the backend pipeline:
 *   URL resolution → Modal.com (Demucs) → Gemini
 *
 * Progress is streamed to Firestore jobs/{jobId}; subscribe with onSnapshot
 * in the calling component rather than awaiting this call for UI updates.
 *
 * @param input   URL string or { type: 'url', value, mimeType? } for URL inputs.
 *                File inputs should go through the Storage upload path instead.
 * @param jobId   Firestore job document ID the caller is already listening to.
 * @param knownDetails  Optional pre-identified title/artist to guide transcription.
 */
export async function analyzeSong(
  input: { type: "url" | "file"; value: string; mimeType?: string } | string,
  knownDetails?: { title: string; artist: string },
  jobId?: string
): Promise<SongAnalysis> {
  if (!analyzeTrackFn) {
    throw new Error(
      "Firebase is not configured. Add your Firebase credentials to .env.local."
    );
  }

  const url =
    typeof input === "string"
      ? input
      : input.type === "url"
      ? input.value
      : null;

  if (!url) {
    throw new Error(
      "analyzeSong() only accepts URL inputs. Use the Storage upload path for files."
    );
  }

  const effectiveJobId = jobId ?? `${Date.now()}`;

  const result = await analyzeTrackFn({ url, jobId: effectiveJobId, knownDetails });
  return result.data;
}

/**
 * Identify a song's title and artist from a URL using Gemini + Google Search.
 * For file inputs, returns a default "Original Composition" placeholder.
 */
export async function identifySong(
  input:
    | { type: "url" | "file"; value: string; mimeType?: string }
    | ArrayBuffer
): Promise<SongAnalysis> {
  // Files are treated as original compositions — no identification step.
  if (input instanceof ArrayBuffer) {
    return { title: "Original Composition", artist: "Independent Artist", chords: [], fingerings: [] };
  }
  if (input.type === "file") {
    return { title: "Original Composition", artist: "Independent Artist", chords: [], fingerings: [] };
  }

  if (!identifySongFn) {
    throw new Error(
      "Firebase is not configured. Add your Firebase credentials to .env.local."
    );
  }

  try {
    const result = await identifySongFn({ url: input.value });
    return result.data;
  } catch (error: any) {
    console.error("identifySong error:", error);
    return { title: "Unknown", artist: "Unknown", chords: [], fingerings: [] };
  }
}
