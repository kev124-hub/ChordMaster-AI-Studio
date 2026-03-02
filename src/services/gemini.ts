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
  const isFile = typeof input !== 'string' && input.type === 'file';
  const model = "gemini-3.1-pro-preview";
  
  const frontendInstructions = `
    STRICT TRANSCRIPTION RULES:
    1. Listen to the provided audio part. It is the ONLY source for lyrics and chords.
    2. Transcribe the lyrics word-for-word. Do not summarize.
    3. Identify the chords played on the acoustic guitar.
    4. If the audio is silent or noise, say so in performanceNotes.
    5. Never use external lyrics for uploaded files.
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
    
    if (isFile) {
      content += `\n\nCRITICAL: This is a BRAND NEW, UNRELEASED ORIGINAL COMPOSITION. 
      There is NO information about this song online. 
      You MUST transcribe the lyrics, chords, and all musical details SOLELY from the provided audio content. 
      DO NOT use Google Search to find matches. 
      Transcribe the lyrics phonetically if necessary, ensuring they match the performance exactly.`;
    } else if (knownDetails?.title && knownDetails?.artist) {
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

    prompt = `CRITICAL AUDIO TRANSCRIPTION TASK:
You are provided with an audio file. You MUST listen to the audio and transcribe the lyrics and acoustic guitar chords.
This is a unique, unreleased recording. DO NOT search for it online. DO NOT use external knowledge.

TRANSCRIPTION PROTOCOL:
1. Listen to the entire audio duration.
2. Transcribe the lyrics word-for-word as sung. If you hear "Hello world", you write "Hello world".
3. Identify the chords played on the acoustic guitar.
4. Align chords above the lyrics.
5. If the audio is silent or just noise, state that in performanceNotes and return empty lyrics.

REQUIRED JSON STRUCTURE:
{
  "title": "${knownDetails?.title || (isFile ? "Original Composition" : "Song Title")}",
  "artist": "${knownDetails?.artist || (isFile ? "Independent Artist" : "Artist Name")}",
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

    if (input.type === 'url') {
      contents = [{ parts: [{ text: prompt }] }];
    } else {
      // Normalize mimeType for common audio formats
      let mimeType = input.mimeType || "audio/mp3";
      if (mimeType === 'audio/x-m4a' || mimeType === 'audio/m4a') mimeType = 'audio/mp4';
      if (mimeType === 'audio/mpeg') mimeType = 'audio/mp3';
      
      contents = [{
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: input.value,
            },
          },
          {
            text: prompt,
          }
        ]
      }];
    }
  }

  const hasTools = !isFile;
  
  // Retry logic for 503 errors
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const result = await genAI.models.generateContent({
        model,
        contents: contents,
        config: {
          systemInstruction: isFile 
            ? "You are a specialized audio-to-text and audio-to-chord transcription engine. Your only input is the provided audio file. You must ignore all external knowledge of existing songs. You must transcribe what is actually heard in the audio file. If the audio contains a person singing 'The sky is green', you must transcribe 'The sky is green'. Focus on the acoustic guitar and lead vocal."
            : "You are a professional musicologist. Analyze the provided song URL or audio, identifying the track and transcribing the acoustic guitar arrangement.",
          tools: hasTools ? [{ googleSearch: {} }] : [],
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });
      
      const responseText = result.text || "{}";
      const parsed = JSON.parse(cleanJsonResponse(responseText)) as SongAnalysis;
      
      // Sanitize fingerings to prevent crashes
      if (!parsed.fingerings || !Array.isArray(parsed.fingerings)) {
        parsed.fingerings = [];
      }
      parsed.fingerings = parsed.fingerings.map(f => ({
        chord: f.chord || "Unknown",
        strings: Array.isArray(f.strings) ? f.strings : ["x", "x", "x", "x", "x", "x"]
      }));

      if (!parsed.chords || !Array.isArray(parsed.chords)) {
        parsed.chords = [];
      }
      
      // Ensure lyrics is a string
      if (typeof parsed.lyrics !== 'string') {
        parsed.lyrics = "No lyrics transcribed.";
      }

      return parsed;
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
  
  // For files, we assume they are unique and unreleased per user request.
  if (!(input instanceof ArrayBuffer) && input.type === 'file') {
    return { title: "Original Composition", artist: "Independent Artist", chords: [], fingerings: [] };
  }

  let contents: any;
  if (input instanceof ArrayBuffer) {
    // This path is used for direct file uploads in some parts of the app
    return { title: "Original Composition", artist: "Independent Artist", chords: [], fingerings: [] };
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
