import React, { useState, useEffect, useRef } from 'react';
import { Music, Youtube, FileAudio, Download, Loader2, Play, Trash2, Guitar, Info, FileJson, Save, Check, Library, X, FileText, ChevronRight, WifiOff, Cloud, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { analyzeSong, identifySong, SongAnalysis, ChordFingering } from './services/gemini';
import { generateSongPDF } from './utils/pdf';
import { SongPlayer } from './components/SongPlayer';
import { LibraryView } from './components/LibraryView';
import { convertToChordPro, downloadChordPro } from './utils/chordpro';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { db, auth } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Auth, UserProfile } from './components/Auth';

export interface AppSettings {
  display: {
    fontFamily: string;
    baseFontSize: number;
    chordColor: string;
    lyricColor: string;
  };
  scroll: {
    defaultSpeed: number;
    countdown: number; // 0, 3, 5, 10
  };
  storage: {
    iCloudPath: string;
  };
  viewer: {
    showGraphicChords: boolean;
    showPerformanceNotes: boolean;
    showStrummingPattern: boolean;
    showTuningNotes: boolean;
    showTimingTempo: boolean;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  display: {
    fontFamily: 'Spline Sans (Modern)',
    baseFontSize: 16,
    chordColor: '#D96611',
    lyricColor: '#F8F8F8',
  },
  scroll: {
    defaultSpeed: 1.0,
    countdown: 5,
  },
  storage: {
    iCloudPath: 'ChordMaster AI',
  },
  viewer: {
    showGraphicChords: true,
    showPerformanceNotes: true,
    showStrummingPattern: true,
    showTuningNotes: true,
    showTimingTempo: true,
  }
};

const GlassCard = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-white/60 backdrop-blur-3xl border border-white/40 rounded-[2.5rem] p-8 md:p-12 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.15)] ${className}`}
  >
    {children}
  </motion.div>
);

const ChordDiagram = ({ fingering }: { fingering: ChordFingering }) => {
  // strings: E A D G B E
  // 0 for open, x for muted, 1-5 for frets
  const strings = fingering.strings || [];
  
  if (!strings || !Array.isArray(strings)) return null;

  return (
    <div className="flex flex-col items-center p-4 bg-white/20 backdrop-blur-md rounded-2xl border border-white/20 shadow-xl w-32 group hover:border-[#D96611]/30 transition-all">
      <span className="text-xs font-black mb-3 text-zinc-700 group-hover:text-zinc-900 transition-colors uppercase tracking-widest">{fingering.chord}</span>
      <svg width="80" height="100" viewBox="0 0 80 100" className="overflow-visible">
        {/* Nut */}
        <line x1="10" y1="20" x2="70" y2="20" stroke="black" strokeWidth="3" strokeOpacity="0.5" />
        
        {/* Frets */}
        {[1, 2, 3, 4, 5].map((f) => (
          <line key={f} x1="10" y1={20 + f * 16} x2="70" y2={20 + f * 16} stroke="black" strokeWidth="1" strokeOpacity="0.1" />
        ))}
        
        {/* Strings */}
        {[0, 1, 2, 3, 4, 5].map((s) => (
          <line key={s} x1={10 + s * 12} y1="20" x2={10 + s * 12} y2="100" stroke="black" strokeWidth="1" strokeOpacity="0.2" />
        ))}

        {/* Markers */}
        {strings.map((val, sIndex) => {
          if (sIndex > 5) return null; // Only 6 strings
          const x = 10 + sIndex * 12;
          const lowerVal = val?.toString().toLowerCase() || 'x';
          if (lowerVal === 'x') {
            return <text key={sIndex} x={x} y="15" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#EF4444">X</text>;
          }
          if (lowerVal === '0') {
            return <circle key={sIndex} cx={x} cy="12" r="3" fill="none" stroke="black" strokeWidth="1" strokeOpacity="0.5" />;
          }
          const fret = parseInt(val);
          if (!isNaN(fret) && fret > 0) {
            return (
              <g key={sIndex}>
                <circle cx={x} cy={20 + (fret - 0.5) * 16} r="5" fill="#D96611" className="animate-pulse" />
                <circle cx={x} cy={20 + (fret - 0.5) * 16} r="3" fill="white" />
              </g>
            );
          }
          return null;
        })}
      </svg>
    </div>
  );
};

const MissingInfoModal = ({ 
  isOpen, 
  onClose, 
  onSave, 
  initialData 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onSave: (data: Partial<SongAnalysis>) => void,
  initialData: Partial<SongAnalysis>
}) => {
  const [data, setData] = useState(initialData);

  useEffect(() => {
    if (isOpen) {
      setData(initialData);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="bg-zinc-900 border border-white/10 rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl space-y-8"
      >
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-black text-white tracking-tight">Complete Song Info</h2>
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-1">Missing Metadata Detected</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X size={24} className="text-zinc-500" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Key</label>
            <input 
              type="text" 
              value={data.key || ''} 
              onChange={(e) => setData({ ...data, key: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
              placeholder="e.g. G Major"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Tempo (BPM)</label>
            <input 
              type="text" 
              value={data.tempo || ''} 
              onChange={(e) => setData({ ...data, tempo: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
              placeholder="e.g. 120"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Strumming Pattern</label>
            <input 
              type="text" 
              value={data.strummingPattern || ''} 
              onChange={(e) => setData({ ...data, strummingPattern: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
              placeholder="e.g. D D U U D U"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Approx. Duration (seconds)</label>
            <input 
              type="number" 
              value={data.duration || ''} 
              onChange={(e) => setData({ ...data, duration: parseInt(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
              placeholder="e.g. 180"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Performance Notes</label>
            <textarea 
              value={data.performanceNotes || ''} 
              onChange={(e) => setData({ ...data, performanceNotes: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all h-24 resize-none"
              placeholder="e.g. Play with a light touch, focus on the bass notes..."
            />
          </div>
        </div>

        <button 
          onClick={() => onSave(data)}
          className="w-full bg-[#D96611] hover:bg-[#FF8C37] text-white py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-[#D96611]/20 transition-all active:scale-95"
        >
          Save & Continue
        </button>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pendingSong, setPendingSong] = useState<any>(null);
  const [result, setResult] = useState<SongAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');
  const [progress, setProgress] = useState(0);
  const [lyricsFontSize, setLyricsFontSize] = useState(16);
  const [includeDiagramsInPDF, setIncludeDiagramsInPDF] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [view, setView] = useState<'transcribe' | 'library'>('transcribe');
  const [playingSong, setPlayingSong] = useState<{ text: string, title: string } | null>(null);
  const loadSharedSong = async (id: string) => {
    if (!db) {
      setError("Cloud services are not configured.");
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    try {
      const songDoc = await getDoc(doc(db, 'songs', id));
      if (songDoc.exists()) {
        const data = songDoc.data();
        if (data.isShared) {
          setPlayingSong({ text: data.chordPro, title: data.analysis.title });
          // Clear URL to show the song
          window.history.replaceState({}, '', '/');
        } else {
          setError("This song is not shared publicly.");
        }
      } else {
        setError("Shared song not found.");
      }
    } catch (err) {
      console.error("Error loading shared song:", err);
      setError("Failed to load shared song.");
    } finally {
      setIsAnalyzing(false);
    }
  };
  const [showMissingInfo, setShowMissingInfo] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('chordmaster_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const updateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('chordmaster_settings', JSON.stringify(newSettings));
  };

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    // Handle shared songs
    const path = window.location.pathname;
    if (path.startsWith('/share/')) {
      const songId = path.split('/share/')[1];
      if (songId) {
        loadSharedSong(songId);
      }
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressInterval = useRef<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const allowedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/mp4',
        'video/mp4', 'video/mpeg', 'video/quicktime'
      ];
      if (allowedTypes.includes(selectedFile.type)) {
        setFile(selectedFile);
        setUrl('');
        setError(null);
      } else {
        setError('Please upload a valid audio (MP3/M4A) or video (MP4/MOV) file.');
      }
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    const details = pendingSong; // Capture details before clearing
    setPendingSong(null);
    setProgress(0);
    setIsSaved(false);
    
    // Start progress simulation
    const totalSeconds = 90; // More conservative estimate to avoid hanging at 99%
    let currentProgress = 0;
    progressInterval.current = setInterval(() => {
      // Linear progress up to 80%, then slows down significantly
      let increment = (100 / totalSeconds) / 10;
      if (currentProgress > 80) {
        increment *= 0.2; // Slow down to 20% speed after 80%
      }
      
      currentProgress += increment;
      if (currentProgress < 99.9) {
        setProgress(currentProgress);
      }
    }, 100);

    try {
      let analysis: SongAnalysis;
      if (file) {
        const base64 = await fileToBase64(file);
        analysis = await analyzeSong(
          { type: 'file', value: base64, mimeType: file.type },
          manualTitle && manualArtist ? { title: manualTitle, artist: manualArtist } : undefined
        );
        // Override with manual inputs if provided
        if (manualTitle) analysis.title = manualTitle;
        if (manualArtist) analysis.artist = manualArtist;
      } else {
        analysis = await analyzeSong({ type: 'url', value: url }, details || undefined);
      }
      setResult(analysis);
      setProgress(100);

      // Check for missing info
      if (!analysis.key || !analysis.tempo || !analysis.strummingPattern || 
          analysis.key.toLowerCase().includes('unknown') || 
          analysis.tempo.toLowerCase().includes('unknown')) {
        setShowMissingInfo(true);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsAnalyzing(false);
      if (progressInterval.current) clearInterval(progressInterval.current);
    }
  };

  const handleStart = async () => {
    if (!url && !file) {
      setError('Please provide a Music URL (YouTube/Spotify/Apple) or an MP3/M4A/MP4/MOV/PDF file.');
      return;
    }

    // If it's a file, skip identification and go straight to analysis
    if (file) {
      runAnalysis();
      return;
    }

    setIsIdentifying(true);
    setError(null);
    setResult(null);
    setPendingSong(null);
    setProgress(0);

    // Start progress simulation for identification
    const totalSeconds = 30; // Identification should be faster
    let currentProgress = 0;
    const idInterval = setInterval(() => {
      let increment = (100 / totalSeconds) / 10;
      if (currentProgress > 80) {
        increment *= 0.1; // Slow down significantly after 80%
      }
      currentProgress += increment;
      if (currentProgress < 99) {
        setProgress(currentProgress);
      }
    }, 100);

    try {
      const identification = await identifySong({ type: 'url', value: url });
      clearInterval(idInterval);
      setProgress(100);
      setPendingSong(identification);
    } catch (err: any) {
      clearInterval(idInterval);
      setError(err.message || 'Could not identify the song.');
    } finally {
      setIsIdentifying(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingSong) return;
    runAnalysis();
  };

  const reset = () => {
    setUrl('');
    setFile(null);
    setResult(null);
    setError(null);
    setPendingSong(null);
    setManualTitle('');
    setManualArtist('');
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveToLibrary = async () => {
    if (!result) return;
    const chordPro = convertToChordPro(result);
    
    const newSongData = {
      analysis: result,
      chordPro,
      savedAt: Date.now(),
      userId: user?.uid || null,
    };

    if (user) {
      try {
        await addDoc(collection(db, 'songs'), newSongData);
        setIsSaved(true);
      } catch (err) {
        console.error("Error saving to Firestore:", err);
        setError("Failed to sync with cloud. Song saved locally.");
        // Fallback to local
        saveLocally(newSongData);
      }
    } else {
      saveLocally(newSongData);
    }
  };

  const saveLocally = (songData: any) => {
    const saved = localStorage.getItem('chordmaster_library');
    const library = saved ? JSON.parse(saved) : [];
    const newSong = {
      ...songData,
      id: Date.now().toString(),
    };
    library.push(newSong);
    try {
      localStorage.setItem('chordmaster_library', JSON.stringify(library));
      setIsSaved(true);
    } catch (e) {
      if ((e as DOMException).name === 'QuotaExceededError') {
        setError('Local storage full. Sign in to save songs to the cloud.');
      } else {
        throw e;
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#929ca3] font-sans text-zinc-900 selection:bg-[#D96611]/30 overflow-x-hidden">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/10 blur-[120px] rounded-full" />
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-12 relative z-10">
        {isOffline && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-2xl z-[100]"
          >
            <WifiOff size={14} />
            Offline Mode — Library Available
          </motion.div>
        )}
        {/* Header - Only show if not in library or playing */}
        {view === 'transcribe' && !result && (
          <header className="flex items-center justify-between mb-20">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-xl border border-white/30 rounded-2xl flex items-center justify-center text-white shadow-2xl rotate-3">
                <Guitar size={36} className="text-[#D96611]" />
              </div>
              <div>
                <h1 className="text-4xl font-black tracking-tighter text-zinc-900">CHORDMASTER <span className="text-[#D96611]">AI</span></h1>
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.4em] mt-1">Precision Transcription Engine</p>
              </div>
            </div>
            <div className="flex items-center gap-4 md:gap-8">
              <button 
                onClick={() => setView('library')}
                className="flex items-center gap-3 px-6 py-3 bg-white/20 hover:bg-white/30 text-zinc-900 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/30 shadow-xl"
              >
                <Library size={16} className="text-[#D96611]" />
                Library
              </button>
              
              {user ? (
                <UserProfile user={user} />
              ) : (
                <button 
                  onClick={() => setIsAuthOpen(true)}
                  className="flex items-center gap-3 px-6 py-3 bg-[#D96611] hover:bg-[#FF8C37] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-[#D96611]/20"
                >
                  <Cloud size={16} />
                  Sign In
                </button>
              )}
            </div>
          </header>
        )}

        <Auth isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />

        <main className="space-y-12">
          {view === 'library' ? (
            <LibraryView 
              onPlay={(text, title) => setPlayingSong({ text, title })}
              onBack={() => setView('transcribe')}
              settings={settings}
              onUpdateSettings={updateSettings}
              user={user}
            />
          ) : (
            <>
              {/* Input Section */}
              {!result && !pendingSong && !isAnalyzing && (
                <div className="max-w-4xl mx-auto w-full">
                  <GlassCard className="w-full">
                    <div className="flex flex-col gap-12">
                      {/* Music Service Input */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 flex items-center gap-3">
                            <Music size={18} className="text-[#D96611]" /> Music URL
                          </label>
                          <Info size={14} className="text-zinc-600 cursor-help" />
                        </div>
                        <div className="relative group">
                          <input
                            type="text"
                            placeholder="Paste YouTube or Spotify link..."
                            value={url}
                            onChange={(e) => { setUrl(e.target.value); setFile(null); }}
                            className="w-full bg-white/40 border-2 border-white/60 rounded-2xl px-8 py-6 text-base text-zinc-900 focus:outline-none focus:ring-4 focus:ring-[#D96611]/20 focus:border-[#D96611]/40 transition-all placeholder:text-zinc-500 shadow-sm"
                          />
                          <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-40 group-hover:opacity-100 transition-opacity">
                            <Youtube size={24} className="text-zinc-600" />
                          </div>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest ml-1">Supports YouTube, Spotify, and Apple Music</p>
                      </div>

                      <div className="relative py-4">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-black/5"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-white/20 backdrop-blur-md px-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.5em]">OR</span>
                        </div>
                      </div>

                      {/* File Input */}
                      <div className="space-y-6">
                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 flex items-center gap-3">
                          <FileAudio size={18} className="text-teal-600" /> Local Upload
                        </label>
                        <div 
                          onClick={() => fileInputRef.current?.click()}
                          className={`border-2 border-dashed rounded-3xl p-8 flex items-center justify-center cursor-pointer transition-all min-h-[100px] ${file ? 'border-[#D96611] bg-[#D96611]/5' : 'border-white/60 hover:border-[#D96611]/40 bg-white/40 shadow-sm'}`}
                        >
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="audio/*,video/*,application/pdf"
                            className="hidden"
                          />
                          <div className="flex items-center gap-6 w-full px-4">
                            {file ? (
                              <>
                                {file.type === 'application/pdf' ? <FileText size={28} className="text-red-500 shrink-0" /> : <FileAudio size={28} className="text-[#D96611] shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-black text-zinc-900 truncate">{file.name}</p>
                                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setFile(null); setManualTitle(''); setManualArtist(''); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="p-2 hover:bg-black/5 rounded-full transition-colors shrink-0">
                                  <Trash2 size={18} className="text-zinc-500" />
                                </button>
                              </>
                            ) : (
                              <div className="flex flex-col items-center gap-3 w-full py-4">
                                <Download size={32} className="text-zinc-400" />
                                <span className="text-xs font-black text-zinc-500 uppercase tracking-widest">Drop Audio, Video, or PDF here</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {file && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="grid grid-cols-2 gap-6 pt-4"
                          >
                            <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 ml-1">Song Title</label>
                              <input
                                type="text"
                                placeholder="e.g. Let It Be"
                                value={manualTitle}
                                onChange={(e) => setManualTitle(e.target.value)}
                                className="w-full bg-white/40 border-2 border-white/60 rounded-2xl px-6 py-4 text-sm text-zinc-900 focus:outline-none focus:ring-4 focus:ring-[#D96611]/20 transition-all"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 ml-1">Artist</label>
                              <input
                                type="text"
                                placeholder="e.g. The Beatles"
                                value={manualArtist}
                                onChange={(e) => setManualArtist(e.target.value)}
                                className="w-full bg-white/40 border-2 border-white/60 rounded-2xl px-6 py-4 text-sm text-zinc-900 focus:outline-none focus:ring-4 focus:ring-[#D96611]/20 transition-all"
                              />
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>

                    <div className="mt-16 pt-12 border-t border-black/5 flex flex-col md:flex-row items-center justify-between gap-8">
                      <div className="flex items-center gap-6">
                        <div className="p-4 bg-teal-500/10 rounded-2xl">
                          <Play size={32} className="text-teal-600" />
                        </div>
                        <div>
                          <p className="text-base font-black text-zinc-900">Ready to Process</p>
                          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em]">
                            {file ? 'Live Performance Filtering Active' : 'Step 1: Identify & Extract'}
                          </p>
                        </div>
                      </div>
                      
                      <button
                        onClick={handleStart}
                        disabled={isIdentifying || isAnalyzing || (!url && !file)}
                        className="group flex items-center gap-4 bg-[#D96611] hover:bg-[#FF8C37] disabled:bg-zinc-800 disabled:text-zinc-600 px-12 py-6 rounded-2xl text-xs font-black uppercase tracking-[0.3em] text-white transition-all shadow-[0_20px_40px_-12px_rgba(217,102,17,0.4)] active:scale-95"
                      >
                        {isIdentifying ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} fill="white" />}
                        {isIdentifying ? 'Identifying...' : file ? 'Start Analysis' : 'Identify Track'}
                        <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </button>
                    </div>
                  </GlassCard>
                </div>
              )}

              {/* Identification Pending */}
              {pendingSong && !isAnalyzing && (
                <GlassCard>
                  <div className="flex flex-col md:flex-row items-center justify-between gap-12">
                    <div className="flex items-center gap-8">
                      <div className="w-24 h-24 bg-[#D96611]/10 rounded-3xl flex items-center justify-center text-[#D96611] shadow-inner">
                        <Music size={48} />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-[#D96611] uppercase tracking-[0.4em] mb-2">Track Identified</p>
                        <h2 className="text-4xl font-black text-zinc-900 tracking-tight">{pendingSong.title}</h2>
                        <p className="text-lg font-bold text-zinc-600">{pendingSong.artist}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setPendingSong(null)}
                        className="px-8 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/10"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirm}
                        className="flex items-center gap-4 bg-[#D96611] hover:bg-[#FF8C37] px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] text-white transition-all shadow-2xl shadow-[#D96611]/20 active:scale-95"
                      >
                        Start Transcription
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* Analysis/Identification Progress */}
              {(isAnalyzing || isIdentifying) && (
                <GlassCard>
                  <div className="max-w-2xl mx-auto py-12 space-y-12">
                    <div className="text-center space-y-4">
                      <div className="inline-flex p-6 bg-[#D96611]/10 rounded-full animate-pulse mb-4">
                        <Loader2 size={48} className="text-[#D96611] animate-spin" />
                      </div>
                      <h2 className="text-4xl font-black text-zinc-900 tracking-tight">
                        {isIdentifying ? 'Identifying Track' : 'Transcribing Audio'}
                      </h2>
                      <p className="text-zinc-600 font-bold uppercase tracking-[0.2em] text-xs">
                        {isIdentifying 
                          ? 'AI is searching for song metadata...' 
                          : 'AI is mapping harmonic structure & lyrics'}
                      </p>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="h-4 bg-black/5 rounded-full overflow-hidden border border-black/10 p-1">
                        <motion.div 
                          className="h-full bg-gradient-to-r from-[#D96611] to-orange-400 rounded-full shadow-[0_0_20px_rgba(249,115,22,0.4)]"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        <span>{isIdentifying ? 'Searching...' : 'Processing...'}</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                    </div>

                    {isAnalyzing && (
                      <div className="grid grid-cols-4 gap-4">
                        {['Noise Cancellation', 'Isolating Tracks', 'Detecting Chords', 'Syncing Lyrics'].map((step, i) => (
                          <div key={step} className={`p-4 rounded-2xl border transition-all duration-500 ${progress > (i + 1) * 20 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-white/5 border-white/10 text-zinc-600'}`}>
                            <div className="flex flex-col items-center gap-2 text-center">
                              {progress > (i + 1) * 20 ? <Check size={14} /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest">{step}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {isIdentifying && progress > 50 && (
                      <div className="text-center pt-4">
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-4">Taking longer than expected?</p>
                        <button 
                          onClick={() => {
                            setIsIdentifying(false);
                            setPendingSong({ title: '', artist: '', chords: [], fingerings: [] });
                          }}
                          className="text-[#D96611] text-[10px] font-black uppercase tracking-widest hover:underline"
                        >
                          Enter Details Manually
                        </button>
                      </div>
                    )}
                  </div>
                </GlassCard>
              )}

              {/* Error Message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-3xl text-sm flex items-center gap-6 shadow-2xl"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center shrink-0">
                      <Info size={24} />
                    </div>
                    <div>
                      <p className="font-black uppercase tracking-widest text-[10px] mb-1">Analysis Error</p>
                      <p className="font-medium opacity-80">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="ml-auto p-2 hover:bg-white/5 rounded-full transition-colors">
                      <X size={18} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Results Section */}
              <AnimatePresence>
                {result && (
                  <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    <GlassCard>
                      <div className="flex flex-col lg:flex-row items-start justify-between gap-12">
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <span className="px-3 py-1 bg-[#D96611]/10 text-[#D96611] rounded-lg text-[10px] font-black uppercase tracking-widest">Transcription Complete</span>
                            <span className="px-3 py-1 bg-black/5 text-zinc-600 rounded-lg text-[10px] font-black uppercase tracking-widest">{result.key}</span>
                          </div>
                          <h2 className="text-5xl font-black text-zinc-900 tracking-tight">{result.title}</h2>
                          <p className="text-xl font-bold text-zinc-600">{result.artist}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-4">
                          <button
                            onClick={reset}
                            className="flex items-center gap-3 bg-black/5 hover:bg-black/10 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 text-zinc-900"
                          >
                            <Trash2 size={18} />
                            New Analysis
                          </button>
                          <button
                            onClick={() => generateSongPDF(result, { includeDiagrams: includeDiagramsInPDF })}
                            className="flex items-center gap-3 bg-teal-600 hover:bg-teal-500 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all shadow-xl shadow-teal-500/20"
                          >
                            <Download size={18} />
                            PDF
                          </button>
                          <button
                            onClick={() => downloadChordPro(result)}
                            className="flex items-center gap-3 bg-black/5 hover:bg-black/10 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 text-zinc-900"
                          >
                            <FileJson size={18} />
                            ChordPro
                          </button>
                          <button
                            onClick={saveToLibrary}
                            disabled={isSaved}
                            className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                              isSaved 
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' 
                                : 'bg-[#D96611] hover:bg-[#FF8C37] border-transparent text-white shadow-xl shadow-[#D96611]/20'
                            }`}
                          >
                            {isSaved ? <Check size={18} /> : <Save size={18} />}
                            {isSaved ? 'Saved' : 'Save to Library'}
                          </button>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-3 gap-8 mt-16">
                        <div className="p-8 bg-black/5 rounded-[2rem] border border-black/5 shadow-inner">
                          <p className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4">Strumming Pattern</p>
                          <p className="text-2xl font-black text-zinc-900 tracking-tight">{result.strummingPattern}</p>
                        </div>
                        <div className="p-8 bg-black/5 rounded-[2rem] border border-black/5 shadow-inner">
                          <p className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4">Key & Tempo</p>
                          <p className="text-2xl font-black text-zinc-900 tracking-tight">{result.key} @ {result.tempo}</p>
                        </div>
                        <div className="p-8 bg-black/5 rounded-[2rem] border border-black/5 shadow-inner">
                          <p className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-4">Capo Position</p>
                          <p className="text-2xl font-black text-zinc-900 tracking-tight">{result.capo}</p>
                        </div>
                      </div>
                    </GlassCard>

                    <div className="grid lg:grid-cols-12 gap-8">
                      {/* Lyrics & Chords */}
                      <GlassCard className="lg:col-span-8">
                        <div className="flex items-center justify-between mb-12">
                          <h3 className="text-2xl font-black text-zinc-900 tracking-tight">Lyrics & Chords</h3>
                          <div className="flex items-center gap-4">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Size</span>
                            <input 
                              type="range" 
                              min="10" 
                              max="24" 
                              value={lyricsFontSize} 
                              onChange={(e) => setLyricsFontSize(parseInt(e.target.value))}
                              className="w-24 h-1 bg-black/10 rounded-full appearance-none cursor-pointer accent-[#D96611]"
                            />
                          </div>
                        </div>
                        <div 
                          className="font-mono whitespace-pre leading-[2.5] overflow-x-auto text-zinc-800"
                          style={{ fontSize: `${lyricsFontSize}px` }}
                        >
                          {result.lyrics.split('\n').map((line, i) => {
                            // Improved chord line detection: Starts with a chord, contains mostly chords/spaces/brackets
                            const chordRegex = /^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M|[0-9])?(\/[A-G][#b]?)?(\s+[A-G][#b]?(m|maj|min|dim|aug|sus|add|M|[0-9])?(\/[A-G][#b]?)?|[\s\[\]])*$/i;
                            const isChordLine = chordRegex.test(line.trim()) && line.trim().length > 0 && /[A-G]/.test(line);
                            
                            return (
                              <div key={i} className={isChordLine ? "font-black text-[#D96611] mb-[-1.5em]" : ""}>
                                {line || ' '}
                              </div>
                            );
                          })}
                        </div>
                      </GlassCard>

                      {/* Chord Diagrams */}
                      <div className="lg:col-span-4 space-y-8">
                        <GlassCard>
                          <h3 className="text-2xl font-black text-zinc-900 tracking-tight mb-8">Chord Voicings</h3>
                          <div className="grid grid-cols-2 gap-4">
                            {result.fingerings.map((f, i) => (
                              <ChordDiagram key={i} fingering={f} />
                            ))}
                          </div>
                        </GlassCard>

                        {result.performanceNotes && (
                          <GlassCard>
                            <h3 className="text-2xl font-black text-zinc-900 tracking-tight mb-6">Performance Notes</h3>
                            <div className="p-6 bg-black/5 rounded-2xl border border-black/5">
                              <p className="text-sm font-medium text-zinc-700 leading-relaxed italic">
                                "{result.performanceNotes}"
                              </p>
                            </div>
                          </GlassCard>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </main>

        <MissingInfoModal 
          isOpen={showMissingInfo}
          onClose={() => setShowMissingInfo(false)}
          initialData={result || {}}
          onSave={(data) => {
            if (result) {
              setResult({ ...result, ...data });
            }
            setShowMissingInfo(false);
          }}
        />

        {playingSong && (
          <SongPlayer 
            chordProText={playingSong.text}
            initialTitle={playingSong.title}
            onClose={() => setPlayingSong(null)}
            settings={settings}
          />
        )}

        {/* Bottom Navigation */}
        <AnimatePresence>
          {!playingSong && (
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex items-center gap-2 shadow-2xl z-40"
            >
              <button 
                onClick={() => setView('transcribe')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                  view === 'transcribe' ? 'bg-[#D96611] text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <FileAudio size={16} />
                Transcribe
              </button>
              <button 
                onClick={() => setView('library')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                  view === 'library' ? 'bg-[#D96611] text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Music size={16} />
                Library
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="mt-20 text-center text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-400 pb-12">
          &copy; {new Date().getFullYear()} ChordMaster AI &bull; Intelligence in Every Note
        </footer>
      </div>
    </div>
  );
}
