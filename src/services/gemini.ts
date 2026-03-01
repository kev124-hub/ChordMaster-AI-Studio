import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

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
  performanceNotes?: string;
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
  const model = "gemini-3.1-pro-preview";
  
  const frontendInstructions = `
    Provide a high-precision harmonic analysis focusing EXCLUSIVELY on the acoustic guitar rhythm track:
    1. Full lyrics with chords placed EXACTLY above the lyrics on separate lines (monospace alignment).
    2. DO NOT use brackets around chords (e.g., use "G" instead of "[G]").
    3. Chords must be on their own lines, perfectly aligned with the lyrics below them using spaces.
    4. Detect complex chords accurately as played on the acoustic guitar (e.g., maj7, m9, sus4, add9, diminished, augmented).
    5. Capture rapid chord changes within measures.
    6. Provide guitar fingerings for all unique chords. Ensure 'strings' array has 6 elements (E A D G B E).
    7. Detailed strumming patterns specifically for the acoustic rhythm track (e.g., D D U U D U).
    8. Musical key, tempo (BPM), and tuning relative to the acoustic guitar.
    9. List the diatonic chords for the identified key.
    10. Specify capo position used by the acoustic guitar (e.g., "Capo 2nd fret" or "No capo").
    11. Approximate song duration in seconds.
    12. Detailed performance notes including rhythmic guides, feel, and specific chord-beat indications for the acoustic guitar.
  `;

  let prompt: string;
  let contents: any;

  if (typeof input === 'string') {
    prompt = `INSTRUCTION: You are a music transcription engine. Output ONLY raw JSON.
FORMAT: {"title": "", "artist": "", "chords": [], "fingerings": []}
CONTENT: ${input}`;
    contents = [{ parts: [{ text: prompt }] }];
  } else {
    let content = input.type === 'url' ? `Analyze this song from the URL: ${input.value}` : 'Analyze the attached audio file';
    
    if (knownDetails?.title && knownDetails?.artist) {
      content += `\n\nCRITICAL CONTEXT: This song has been identified as "${knownDetails.title}" by "${knownDetails.artist}". 
      You MUST perform a direct musical analysis of the provided audio/URL, focusing SOLELY on the acoustic guitar rhythm track. 
      Transcribe the chords and lyrics EXACTLY as they are performed in THIS SPECIFIC VERSION by the acoustic guitar. 
      Use Google Search ONLY to verify the correct lyrics text or to find the official song metadata. 
      DO NOT simply copy a generic chord chart from the web; your analysis must reflect the specific arrangement, tempo, and key of the provided media's acoustic guitar track. 
      If the acoustic guitar is in a different key than the "official" version, transcribe the key of the guitar.`;
    } else {
      content += `\n\nPerform a direct musical analysis of the provided audio/URL, focusing SOLELY on the acoustic guitar rhythm track. 
      Identify the song and transcribe the chords and lyrics EXACTLY as performed in this version by the acoustic guitar. 
      Use Google Search to help identify the track and verify lyrics, but the chord transcription must be based on your analysis of the acoustic guitar's audio content.`;
    }

    prompt = `INSTRUCTION: You are a world-class musicologist and transcription expert specializing in acoustic guitar. 
Your task is to perform a deep harmonic and lyrical analysis of the provided audio or URL content, focusing SOLELY on the acoustic guitar rhythm track. 
Output ONLY a valid JSON object. Do not include any conversational text.

TRANSCRIPTION RULES:
1. Listen to the audio content (or URL content) and transcribe the chords EXACTLY as played on the acoustic guitar rhythm track. Ignore other instruments.
2. Match the acoustic guitar chords to the lyrics as performed in this specific recording.
3. Use Google Search to verify the song's identity and to get the base lyrics text, but override any generic web charts with your own analysis of the SPECIFIC acoustic guitar performance (e.g., if they play a G/B instead of a G, or if the key is transposed).
4. Ensure the chords are placed with character-perfect accuracy above the lyrics in the "lyrics" field.
5. Pay close attention to the actual frequencies and rhythmic patterns of the acoustic guitar to determine the key, tempo, and capo position.

REQUIRED JSON STRUCTURE:
{
  "title": "${knownDetails?.title || "Song Title"}",
  "artist": "${knownDetails?.artist || "Artist Name"}",
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
  },
  "performanceNotes": "Describe the specific feel and rhythmic nuances of THIS performance. Mention if this version differs from standard versions."
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

  const hasTools = true; // Always enable tools for better accuracy
  
  // Retry logic for 503 errors
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const result = await genAI.models.generateContent({
        model,
        contents: contents,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
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
  const model = "gemini-3.1-pro-preview";
  
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
          text: "Analyze this specific audio recording. Identify the song title and artist. Use Google Search to verify the metadata, but ensure your identification matches the actual audio content provided. Return ONLY a JSON object: {\"title\": \"\", \"artist\": \"\", \"chords\": [], \"fingerings\": []}. If you are unsure, return an empty object.",
        },
      ]
    }];
  } else if (input.type === 'url') {
    contents = [{ 
      parts: [{ 
        text: `Identify the song at this URL: ${input.value}. 
        Use Google Search and URL Context to find the track title and artist. 
        Return ONLY a JSON object: {"title": "", "artist": "", "chords": [], "fingerings": []}. 
        If you cannot identify the song, return an empty object with "Unknown" values.` 
      }] 
    }];
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
          text: "Analyze this specific audio recording. Identify the song title and artist. Use Google Search to verify the metadata, but ensure your identification matches the actual audio content provided. Return ONLY a JSON object: {\"title\": \"\", \"artist\": \"\", \"chords\": [], \"fingerings\": []}. If you are unsure, return an empty object.",
        },
      ]
    }];
  }

  const hasTools = true; // Always enable tools for better accuracy
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const result = await genAI.models.generateContent({
        model,
        contents: contents,
        config: {
          tools: [{ googleSearch: {} }, { urlContext: {} }],
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
