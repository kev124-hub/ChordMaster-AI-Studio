import { jsPDF } from "jspdf";
import { SongAnalysis, ChordFingering } from "../services/gemini";

function drawChordDiagram(doc: jsPDF, fingering: ChordFingering, x: number, y: number) {
  const size = 22; // Reduced from 30
  const fretHeight = 3; // Reduced from 4
  const stringWidth = 3; // Reduced from 4

  doc.setFontSize(8); // Reduced from 10
  doc.setFont("helvetica", "bold");
  doc.text(fingering.chord, x + size / 2, y - 1, { align: "center" });

  // Nut
  doc.setLineWidth(0.8);
  doc.line(x, y, x + 5 * stringWidth, y);

  // Frets
  doc.setLineWidth(0.1);
  for (let i = 1; i <= 5; i++) {
    doc.line(x, y + i * fretHeight, x + 5 * stringWidth, y + i * fretHeight);
  }

  // Strings
  for (let i = 0; i < 6; i++) {
    doc.line(x + i * stringWidth, y, x + i * stringWidth, y + 5 * fretHeight);
  }

  const strings = fingering?.strings || [];
  if (!Array.isArray(strings)) return;

  // Markers
  strings.forEach((val, sIndex) => {
    if (sIndex > 5) return;
    const sx = x + sIndex * stringWidth;
    const lowerVal = val?.toString().toLowerCase() || 'x';
    if (lowerVal === 'x') {
      doc.setTextColor(255, 0, 0);
      doc.setFontSize(5);
      doc.text("X", sx, y - 0.5, { align: "center" });
      doc.setTextColor(0, 0, 0);
    } else if (lowerVal === '0') {
      doc.circle(sx, y - 0.8, 0.4, "S");
    } else {
      const fret = parseInt(val);
      if (!isNaN(fret) && fret > 0) {
        doc.setFillColor(242, 125, 38);
        doc.circle(sx, y + (fret - 0.5) * fretHeight, 0.8, "FD");
      }
    }
  });
}

export function generateSongPDF(analysis: SongAnalysis, options: { includeDiagrams: boolean } = { includeDiagrams: true }) {
  const doc = new jsPDF();
  const margin = 15; // Reduced margin
  let y = 15;

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(analysis.title, margin, y);
  y += 8;

  // Artist
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`by ${analysis.artist}`, margin, y);
  y += 10;

  // Metadata - Compact Row
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  const keyChordsText = analysis.keyChords 
    ? `  |  Maj: ${analysis.keyChords.major.join(', ')}  |  Min: ${analysis.keyChords.minor.join(', ')}`
    : '';
  const metaText = `Key: ${analysis.key || 'N/A'}${keyChordsText}  |  Tempo: ${analysis.tempo || 'N/A'}  |  Tuning: ${analysis.tuning || 'Standard'}  |  Capo: ${analysis.capo || 'None'}`;
  doc.text(metaText, margin, y);
  y += 5;
  
  // Wrap strumming pattern text
  const isStandardTuning = !analysis.tuning || analysis.tuning.toLowerCase().startsWith('standard');
  const tuningNote = !isStandardTuning ? ` | Tuning: ${analysis.tuning}` : '';
  const strummingText = `Strumming: ${analysis.strummingPattern}${tuningNote}`;
  const wrappedStrumming = doc.splitTextToSize(strummingText, 180);
  wrappedStrumming.forEach((line: string) => {
    doc.text(line, margin, y);
    y += 4;
  });
  y += 6;

  // Chord Diagrams - Optional and Compact
  if (options.includeDiagrams && analysis.fingerings.length > 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Chord Diagrams:", margin, y);
    y += 8;

    let dx = margin;
    const diagramSize = 25;
    analysis.fingerings.forEach((f) => {
      if (dx + 30 > 195) {
        dx = margin;
        y += 30;
      }
      // Check for page overflow
      if (y > 270) {
        doc.addPage();
        y = 15;
      }
      drawChordDiagram(doc, f, dx, y);
      dx += 30;
    });
    y += 35;
  }

  // Lyrics & Chords - Single Column with Smart Condensation
  if (y > 250) {
    doc.addPage();
    y = 15;
  }

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Lyrics & Chords:", margin, y);
  y += 6;

  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  const rawLines = analysis.lyrics.split('\n');
  
  const fullWidth = 180;
  const bottomMargin = 10.16; // 0.4 inches in mm
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxY = pageHeight - bottomMargin;

  // Pre-process lines to condense short consecutive lines
  const processedLines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (line === '') {
      processedLines.push('');
      continue;
    }
    
    // Smart Condensation: If this line and the next are very short, combine them
    // This applies to headers, short lyric fragments, etc.
    const isShort = line.length < 25;
    const isChordLine = !/[a-z]/.test(line) && /[A-Z]/.test(line);
    
    if (isShort && !isChordLine && i + 1 < rawLines.length) {
      const nextLine = rawLines[i+1].trim();
      const isNextShort = nextLine.length < 25;
      const isNextChord = !/[a-z]/.test(nextLine) && /[A-Z]/.test(nextLine);
      
      if (isNextShort && !isNextChord && (line.length + nextLine.length < 45)) {
        processedLines.push(`${line}    |    ${nextLine}`);
        i++; // Skip next
        continue;
      }
    }
    processedLines.push(rawLines[i]);
  }

  processedLines.forEach(line => {
    if (y > maxY) {
      doc.addPage();
      y = 15;
    }
    
    const isChordLine = /^[A-G][#b]?[mMajMinDimAugSusAdd0-9+]*(\s+[A-G][#b]?[mMajMinDimAugSusAdd0-9+]*)*$/.test(line.trim());
    const isHeader = line.trim().startsWith('[') || (line.trim().length < 20 && !isChordLine && line.trim() !== '');

    if (isChordLine) {
      doc.setFont("courier", "bold");
      doc.setTextColor(242, 125, 38); // Orange for chords
    } else if (isHeader) {
      doc.setFont("courier", "bold");
      doc.setTextColor(100, 100, 100); // Grey for headers
    } else {
      doc.setFont("courier", "normal");
      doc.setTextColor(0, 0, 0);
    }
    
    // Handle wrapping
    const wrappedLines = doc.splitTextToSize(line, fullWidth);
    wrappedLines.forEach((wLine: string) => {
      if (y > maxY) {
        doc.addPage();
        y = 15;
      }
      doc.text(wLine, margin, y);
      y += 4.8; // Tighter than original 5, but comfortable for single column
    });
  });

  // Footer with Page Numbers
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(128, 128, 128); // 50% Gray
    const pageText = `Page ${i} of ${pageCount}`;
    // Place footer in the right corner, within the bottom margin
    doc.text(pageText, pageWidth - margin, pageHeight - 5, { align: "right" });
  }

  doc.save(`${analysis.title.replace(/\s+/g, '_')}_Chords.pdf`);
}
