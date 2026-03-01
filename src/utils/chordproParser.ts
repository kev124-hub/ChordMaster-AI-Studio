export interface ChordProLine {
  type: 'lyric' | 'directive' | 'comment' | 'empty';
  content: string;
  chords?: { chord: string; index: number }[];
}

export interface ChordProSong {
  title?: string;
  artist?: string;
  key?: string;
  tempo?: string;
  capo?: string;
  duration?: number; // in seconds
  timeSignature?: string;
  tuning?: string;
  strumming?: string;
  performanceNotes?: string;
  fingerings?: { chord: string; strings: string[] }[];
  lines: ChordProLine[];
}

export function parseChordPro(text: string): ChordProSong {
  const song: ChordProSong = { lines: [], fingerings: [] };
  const rawLines = text.split('\n');

  rawLines.forEach(line => {
    const trimmed = line.trim();
    
    // Directives: {title: ...}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const directive = trimmed.slice(1, -1);
      const [key, ...valueParts] = directive.split(':');
      const value = valueParts.join(':').trim();
      
      const k = key.toLowerCase().trim();
      if (k === 'title' || k === 't') song.title = value;
      else if (k === 'subtitle' || k === 'st' || k === 'artist') song.artist = value;
      else if (k === 'key' || k === 'k') song.key = value;
      else if (k === 'tempo') song.tempo = value;
      else if (k === 'capo') song.capo = value;
      else if (k === 'tuning') song.tuning = value;
      else if (k === 'time' || k === 'timesignature') song.timeSignature = value;
      else if (k === 'strumming') song.strumming = value;
      else if (k === 'performance-notes' || k === 'notes') song.performanceNotes = value;
      else if (k === 'duration') {
        // Handle mm:ss or seconds
        if (value.includes(':')) {
          const [m, s] = value.split(':').map(Number);
          song.duration = m * 60 + s;
        } else {
          song.duration = Number(value);
        }
      } else if (k === 'define') {
        // {define: G base-fret 1 frets 3 2 0 0 0 3}
        const parts = value.split(/\s+/);
        const chordName = parts[0];
        const fretsIndex = parts.indexOf('frets');
        if (fretsIndex !== -1) {
          const strings = parts.slice(fretsIndex + 1);
          song.fingerings?.push({ chord: chordName, strings });
        }
      } else if (k === 'comment' || k === 'c') {
        // Check for special comments like "Strumming: ..."
        if (value.toLowerCase().startsWith('strumming:')) {
          song.strumming = value.split(':')[1].trim();
        } else if (value.toLowerCase().startsWith('tuning:')) {
          song.tuning = value.split(':')[1].trim();
        }
      }
      
      song.lines.push({ type: 'directive', content: trimmed });
      return;
    }

    if (trimmed === '') {
      song.lines.push({ type: 'empty', content: '' });
      return;
    }

    // Check for comments or headers
    if (trimmed.startsWith('#')) {
      song.lines.push({ type: 'comment', content: trimmed.slice(1).trim() });
      return;
    }

    // Lyric line with chords: [C]Lyrics [G]here
    const chords: { chord: string; index: number }[] = [];
    let cleanLine = '';
    let offset = 0;
    
    const chordRegex = /\[(.*?)\]/g;
    let match;
    let lastIndex = 0;

    while ((match = chordRegex.exec(line)) !== null) {
      cleanLine += line.slice(lastIndex, match.index);
      chords.push({
        chord: match[1],
        index: cleanLine.length
      });
      lastIndex = chordRegex.lastIndex;
    }
    cleanLine += line.slice(lastIndex);

    song.lines.push({
      type: 'lyric',
      content: cleanLine,
      chords: chords.length > 0 ? chords : undefined
    });
  });

  return song;
}
