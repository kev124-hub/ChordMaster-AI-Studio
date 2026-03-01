import { GoogleGenAI, Type } from "@google/genai";

// Using your API key logic
const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey: apiKey || "" });

export interface ChordFingering {
  chord: string;
  strings: string[];
}

export interface SongAnalysis {
  title: string;
  artist: string;
  chords: string[];
  fingerings: ChordFingering[];
  // Frontend requirements for the webapp to run successfully
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
}

function cleanJsonResponse(text: string) {
  return text.replace(/```json|```/gi, "").trim();
}

/**
 * Combined analyzeSong logic: Your prompt + Frontend instructions
 */
export async function analyzeSong(input: { type: 'url' | 'file', value: string, mimeType?: string } | string, knownDetails?: { title: string, artist: string }): Promise<SongAnalysis> {
  const model = "gemini-flash-lite-latest";
  
  const frontendInstructions = `
    Provide a high-precision harmonic analysis in the following format:
    1. Full lyrics with chords placed EXACTLY above the lyrics on separate lines (monospace alignment).
    2. Detect complex chords accurately (e.g., maj7, m9, sus4, add9, diminished, augmented).
    3. Capture rapid chord changes within measures.
    4. Provide guitar fingerings for all unique chords. Ensure 'strings' array has 6 elements (E A D G B E).
    5. Detailed strumming patterns (e.g., D D U U D U).
    6. Musical key, tempo (BPM), and tuning.
    7. List the diatonic chords for the identified key (Major: I, IV, V; Minor: ii, iii, vi).
    8. Specify capo position (e.g., "Capo 2nd fret" or "No capo").
    9. Approximate song duration in seconds.
  `;

  let prompt: string;
  let contents: any;

  if (typeof input === 'string') {
    // Support for user's GitHub signature
    prompt = `INSTRUCTION: You are a music transcription engine. Output ONLY raw JSON.\nFORMAT: {"title": "", "artist": "", "chords": [], "fingerings": []}\nCONTENT: ${input}`;
    contents = prompt;
  } else {
    // Support for current App.tsx signature
    const content = input.type === 'url' ? input.value : 'Attached audio file';
    prompt = `INSTRUCTION: You are a music transcription engine. Output ONLY raw JSON.\nFORMAT: {"title": "", "artist": "", "chords": [], "fingerings": [], "lyrics": "", "strummingPattern": "", "key": "", "tempo": "", "tuning": "", "capo": ""}\n${frontendInstructions}\nCONTENT: ${content}`;
    
    if (input.type === 'url') {
      contents = prompt;
    } else {
      contents = {
        parts: [
          {
            inlineData: {
              mimeType: input.mimeType || "audio/mp3",
              data: input.value,
            },
          },
          {
            text: prompt,
          },
        ]
      };
    }
  }

  const hasTools = (input as any).type === 'url';
  const result = await genAI.models.generateContent({
    model,
    contents: contents,
    config: {
      tools: hasTools ? [{ googleSearch: {} }] : undefined,
      responseMimeType: hasTools ? undefined : "application/json",
    },
  });
  
  return JSON.parse(cleanJsonResponse(result.text || "{}"));
}

/**
 * Combined identifySong logic: Your prompt + Frontend compatibility
 */
export async function identifySong(input: { type: 'url' | 'file', value: string, mimeType?: string } | ArrayBuffer): Promise<SongAnalysis> {
  const model = "gemini-flash-lite-latest";
  
  let contents: any;
  if (input instanceof ArrayBuffer) {
    // Support for user's GitHub signature
    const uint8Array = new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Data = btoa(binary);
    contents = {
      parts: [
        {
          inlineData: {
            mimeType: "audio/mp3",
            data: base64Data,
          },
        },
        {
          text: "Identify this song. Return ONLY a JSON object: {\"title\": \"\", \"artist\": \"\", \"chords\": [], \"fingerings\": []}. If you are unsure, return an empty object.",
        },
      ]
    };
  } else if (input.type === 'url') {
    // Support for current App.tsx signature (URL)
    contents = `Identify this song. Return ONLY a JSON object: {"title": "", "artist": "", "chords": [], "fingerings": []}. URL: ${input.value}`;
  } else {
    // Support for current App.tsx signature (File)
    contents = {
      parts: [
        {
          inlineData: {
            mimeType: input.mimeType || "audio/mp3",
            data: input.value,
          },
        },
        {
          text: "Identify this song. Return ONLY a JSON object: {\"title\": \"\", \"artist\": \"\", \"chords\": [], \"fingerings\": []}. If you are unsure, return an empty object.",
        },
      ]
    };
  }

  const hasTools = (input as any).type === 'url';
  const result = await genAI.models.generateContent({
    model,
    contents: contents,
    config: {
      tools: hasTools ? [{ googleSearch: {} }] : undefined,
      responseMimeType: hasTools ? undefined : "application/json",
    },
  });
  
  const responseText = result.text || "{}";
  return JSON.parse(cleanJsonResponse(responseText));
}

export { genAI };
