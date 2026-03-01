import { SongAnalysis } from "../services/gemini";

export function convertToChordPro(analysis: SongAnalysis): string {
  const lines: string[] = [];

  // Directives
  lines.push(`{title: ${analysis.title}}`);
  lines.push(`{subtitle: ${analysis.artist}}`);
  if (analysis.key) lines.push(`{key: ${analysis.key}}`);
  if (analysis.tempo) lines.push(`{tempo: ${analysis.tempo}}`);
  if (analysis.capo) lines.push(`{capo: ${analysis.capo}}`);
  if (analysis.tuning) lines.push(`{tuning: ${analysis.tuning}}`);
  if (analysis.timeSignature) lines.push(`{time: ${analysis.timeSignature}}`);
  if (analysis.duration) lines.push(`{duration: ${analysis.duration}}`);
  if (analysis.performanceNotes) lines.push(`{performance-notes: ${analysis.performanceNotes}}`);

  lines.push("");
  lines.push(`{comment: Strumming: ${analysis.strummingPattern}}`);
  
  // Add tuning to performance notes if non-standard
  const isStandardTuning = !analysis.tuning || analysis.tuning.toLowerCase().startsWith('standard');
  if (!isStandardTuning) {
    lines.push(`{comment: Tuning: ${analysis.tuning}}`);
  }
  
  lines.push("");

  // Chord Definitions (Optional but helpful)
  analysis.fingerings.forEach(f => {
    // ChordPro define format: {define: Name base-fret F fingerings...}
    // Our fingerings are strings like ["x", "0", "2", "2", "1", "0"]
    const strings = f.strings.map(s => s.toLowerCase() === 'x' ? 'x' : s).join(' ');
    lines.push(`{define: ${f.chord} base-fret 1 frets ${strings}}`);
  });

  lines.push("");

  // Process Lyrics and Chords
  const rawLines = analysis.lyrics.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const currentLine = rawLines[i];
    const nextLine = rawLines[i + 1];

    // Detect if current line is a chord line
    const isChordLine = /^[A-G][#b]?[mMajMinDimAugSusAdd0-9+]*(\s+[A-G][#b]?[mMajMinDimAugSusAdd0-9+]*)*$/.test(currentLine.trim());
    
    // Detect if it's a section header like [Chorus] or Verse 1
    const isHeader = currentLine.trim().startsWith('[') || (currentLine.trim().length < 20 && !isChordLine && currentLine.trim() !== '');

    if (isHeader) {
      // ChordPro uses {soc} / {eoc} for chorus, but simple comments or bold text works too
      if (currentLine.toLowerCase().includes('chorus')) {
        lines.push(`{comment: ${currentLine.trim()}}`);
      } else {
        lines.push(`{comment: ${currentLine.trim()}}`);
      }
      continue;
    }

    if (isChordLine) {
      if (nextLine !== undefined && nextLine.trim() !== '' && !(!/[a-z]/.test(nextLine) && /[A-Z]/.test(nextLine))) {
        // Merge chords into the next lyric line
        let lyricLine = nextLine;
        const chords: { chord: string, pos: number }[] = [];
        const chordRegex = /[A-G][#b]?[mMajMinDimAugSusAdd0-9+]*/g;
        let match;
        while ((match = chordRegex.exec(currentLine)) !== null) {
          chords.push({ chord: match[0], pos: match.index });
        }

        // Sort descending to insert from back to front
        chords.sort((a, b) => b.pos - a.pos);

        for (const { chord, pos } of chords) {
          if (pos > lyricLine.length) {
            lyricLine = lyricLine.padEnd(pos, ' ');
          }
          lyricLine = lyricLine.slice(0, pos) + `[${chord}]` + lyricLine.slice(pos);
        }
        lines.push(lyricLine);
        i++; // Skip next line
      } else {
        // Chord line with no lyrics following (e.g. Intro)
        const chordRegex = /[A-G][#b]?[mMajMinDimAugSusAdd0-9+]*/g;
        // Only wrap in brackets if not already bracketed
        const lineWithBrackets = currentLine.replace(chordRegex, (match, offset, fullString) => {
          const hasOpening = fullString[offset - 1] === '[';
          const hasClosing = fullString[offset + match.length] === ']';
          return (hasOpening && hasClosing) ? match : `[${match}]`;
        });
        lines.push(lineWithBrackets);
      }
    } else if (currentLine.trim() !== '') {
      // Just lyrics
      lines.push(currentLine);
    } else {
      // Empty line
      lines.push("");
    }
  }

  return lines.join('\n');
}

export function downloadChordPro(analysis: SongAnalysis) {
  const content = convertToChordPro(analysis);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${analysis.title.replace(/\s+/g, '_')}.cho`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
