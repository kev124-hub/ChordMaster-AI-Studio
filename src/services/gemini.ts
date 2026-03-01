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
  // Remove markdown code blocks
  let cleaned = text.replace(/```json|```/gi, "").trim();
  
  // If it still doesn't look like JSON, try to find the first '{' and last '}'
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
    }
  }
  
  return cleaned;
}

/**
 * Combined analyzeSong logic: Your prompt + Frontend instructions
 */
export async function analyzeSong(input: { type: 'url' | 'file', value: string, mimeType?: string } | string, knownDetails?: { title: string, artist: string }): Promise<SongAnalysis> {
  const model = "gemini-3-flash-preview";
  
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
    prompt = `INSTRUCTION: You are a music transcription engine. Output ONLY raw JSON.
FORMAT: {"title": "", "artist": "", "chords": [], "fingerings": []}
CONTENT: ${input}`;
    contents = [{ parts: [{ text: prompt }] }];
  } else {
    const content = input.type === 'url' ? `Analyze this song from the URL: ${input.value}` : 'Analyze the attached audio file';
    prompt = `INSTRUCTION: You are a professional musicologist and transcription engine. 
Output ONLY a valid JSON object. Do not include any conversational text.
If you cannot access a URL, use Google Search to find the song's chords and lyrics based on the URL metadata.

REQUIRED JSON STRUCTURE:
{
  "title": "Song Title",
  "artist": "Artist Name",
  "chords": ["Chord1", "Chord2"],
  "fingerings": [{"chord": "C", "strings": ["x", "3", "2", "0", "1", "0"]}],
  "lyrics": "Lyrics with chords...",
  "strummingPattern": "D D U U D U",
  "key": "C Major",
  "tempo": "120 BPM",
  "tuning": "Standard",
  "capo": "No capo",
  "timeSignature": "4/4",
  "duration": 180,
  "keyChords": {
    "major": ["I", "IV", "V"],
    "minor": ["ii", "iii", "vi"]
  }
}

${frontendInstructions}
CONTENT: ${content}`;
    
    if (input.type === 'url') {
      contents = [{ parts: [{ text: prompt }] }];
    } else {
      contents = [{
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
      }];
    }
  }

  const hasTools = typeof input !== 'string' && input.type === 'url';
  
  // Retry logic for 503 errors
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const result = await genAI.models.generateContent({
        model,
        contents: contents,
        config: {
          tools: hasTools ? [{ googleSearch: {} }] : undefined,
          responseMimeType: "application/json",
        },
      });
      
      const text = result.text || "{}";
      return JSON.parse(cleanJsonResponse(text));
    } catch (error: any) {
      attempts++;
      const isServiceBusy = error?.message?.includes("503") || error?.message?.includes("high demand");
      
      if (isServiceBusy && attempts < maxAttempts) {
        console.log(`Gemini busy (503), retrying attempt ${attempts}...`);
        await new Promise(resolve => setTimeout(resolve, attempts * 2000)); // Wait 2s, then 4s
        continue;
      }

      console.error("Gemini Analysis Error:", error);
      if (isServiceBusy) {
        throw new Error("The AI service is currently very busy. Please wait a moment and try again.");
      }
      if (error instanceof Error && error.message.includes("not valid JSON")) {
        throw new Error("The AI returned an invalid response. Please try again or use a different song.");
      }
      throw error;
    }
  }
  throw new Error("Failed to connect to the AI service after multiple attempts.");
}

/**
 * Combined identifySong logic: Your prompt + Frontend compatibility
 */
export async function identifySong(input: { type: 'url' | 'file', value: string, mimeType?: string } | ArrayBuffer): Promise<SongAnalysis> {
  const model = "gemini-3-flash-preview";
  
  let contents: any;
  if (input instanceof ArrayBuffer) {
    const uint8Array = new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Data = btoa(binary);
    contents = [{
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
    }];
  } else if (input.type === 'url') {
    contents = [{ parts: [{ text: `Identify this song from the URL. Use Google Search if needed. Return ONLY a JSON object: {"title": "", "artist": "", "chords": [], "fingerings": []}. URL: ${input.value}` }] }];
  } else {
    contents = [{
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
    }];
  }

  const hasTools = typeof input !== 'string' && (input as any).type === 'url';
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const result = await genAI.models.generateContent({
        model,
        contents: contents,
        config: {
          tools: hasTools ? [{ googleSearch: {} }] : undefined,
          responseMimeType: "application/json",
        },
      });
      
      const responseText = result.text || "{}";
      return JSON.parse(cleanJsonResponse(responseText));
    } catch (error: any) {
      attempts++;
      const isServiceBusy = error?.message?.includes("503") || error?.message?.includes("high demand");
      
      if (isServiceBusy && attempts < maxAttempts) {
        console.log(`Gemini busy (503), retrying attempt ${attempts}...`);
        await new Promise(resolve => setTimeout(resolve, attempts * 2000));
        continue;
      }
      
      console.error("Gemini Identification Error:", error);
      return { title: "Unknown", artist: "Unknown", chords: [], fingerings: [] };
    }
  }
  return { title: "Unknown", artist: "Unknown", chords: [], fingerings: [] };
}

export { genAI };
