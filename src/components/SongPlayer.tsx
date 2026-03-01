import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, RotateCcw, Settings, X, 
  Type, Palette, Clock, ChevronLeft, 
  Maximize2, Minimize2, Save, Trash2,
  ChevronRight, ChevronDown, ChevronUp,
  Guitar, Music, Timer, Activity, Info
} from 'lucide-react';
import { parseChordPro, ChordProSong } from '../utils/chordproParser';
import { AppSettings } from '../App';

interface SongPlayerProps {
  chordProText: string;
  onClose: () => void;
  onSave?: (text: string) => void;
  initialTitle?: string;
  settings: AppSettings;
}

const ChordDiagram = ({ fingering, theme }: { fingering: any, theme: string }) => {
  const strings = fingering.strings;
  const isDark = theme === 'dark';
  const strokeColor = isDark ? 'white' : 'black';
  
  return (
    <div className={`flex flex-col items-center p-2 rounded-xl border w-20 shrink-0 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
      <span className={`text-[8px] font-black mb-1 uppercase tracking-widest ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>{fingering.chord}</span>
      <svg width="40" height="50" viewBox="0 0 80 100" className="overflow-visible">
        <line x1="10" y1="20" x2="70" y2="20" stroke={strokeColor} strokeWidth="3" strokeOpacity="0.5" />
        {[1, 2, 3, 4, 5].map((f) => (
          <line key={f} x1="10" y1={20 + f * 16} x2="70" y2={20 + f * 16} stroke={strokeColor} strokeWidth="1" strokeOpacity="0.1" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((s) => (
          <line key={s} x1={10 + s * 12} y1="20" x2={10 + s * 12} y2="100" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.2" />
        ))}
        {strings.map((val: any, sIndex: number) => {
          const x = 10 + sIndex * 12;
          const lowerVal = val.toString().toLowerCase();
          if (lowerVal === 'x') return <text key={sIndex} x={x} y="15" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#EF4444">X</text>;
          if (lowerVal === '0') return <circle key={sIndex} cx={x} cy="12" r="3" fill="none" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.5" />;
          const fret = parseInt(val);
          if (!isNaN(fret) && fret > 0) return <circle key={sIndex} cx={x} cy={20 + (fret - 0.5) * 16} r="5" fill="#F27D26" />;
          return null;
        })}
      </svg>
    </div>
  );
};

export const SongPlayer: React.FC<SongPlayerProps> = ({ 
  chordProText, 
  onClose, 
  onSave,
  initialTitle,
  settings
}) => {
  const [song, setSong] = useState<ChordProSong | null>(null);
  const [fontSize, setFontSize] = useState(settings.display.baseFontSize);
  const [chordColor, setChordColor] = useState(settings.display.chordColor);
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('dark');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(180);
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const userScrollTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const parsed = parseChordPro(chordProText);
    setSong(parsed);
    
    // Auto-calculate length
    if (parsed.duration) {
      setDuration(parsed.duration);
    } else {
      // Heuristic: count measures (lines with |)
      const measureLines = chordProText.split('\n').filter(l => l.includes('|'));
      const measureCount = measureLines.reduce((acc, line) => acc + (line.match(/\|/g)?.length || 0), 0);
      
      if (measureCount > 0) {
        const tempo = parseInt(parsed.tempo || '120');
        const timeSig = parsed.timeSignature || '4/4';
        const beatsPerMeasure = parseInt(timeSig.split('/')[0]) || 4;
        const calculatedDuration = Math.round((measureCount * beatsPerMeasure) / (tempo / 60));
        setDuration(calculatedDuration > 30 ? calculatedDuration : 180);
      }
    }
  }, [chordProText]);

  useEffect(() => {
    if (isPlaying && countdown === 0 && !isUserScrolling) {
      const startTime = Date.now() - (progress * duration * 1000);
      
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const newProgress = Math.min(elapsed / duration, 1);
        setProgress(newProgress);
        
        if (newProgress >= 1) {
          setIsPlaying(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }

        if (scrollRef.current) {
          const scrollHeight = scrollRef.current.scrollHeight - scrollRef.current.clientHeight;
          scrollRef.current.scrollTop = scrollHeight * newProgress;
        }
      }, 50);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, duration, countdown, isUserScrolling]);

  const handlePlayPause = () => {
    if (!isPlaying && settings.scroll.countdown > 0 && progress === 0) {
      setCountdown(settings.scroll.countdown);
      const cdInterval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(cdInterval);
            setIsPlaying(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleScroll = () => {
    if (isPlaying) {
      setIsUserScrolling(true);
      if (userScrollTimeout.current) clearTimeout(userScrollTimeout.current);
      userScrollTimeout.current = setTimeout(() => {
        setIsUserScrolling(false);
      }, 3000); // Resume after 3 seconds of no manual scroll
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    setProgress(0);
    setCountdown(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const themes = {
    light: 'bg-white text-zinc-900',
    dark: 'bg-[#1E293B] text-zinc-100',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]'
  };

  const formatStrumming = (strum: string) => {
    return strum.replace(/D/g, '↓').replace(/U/g, '↑');
  };

  if (!song) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${themes[theme]} transition-colors duration-300`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h2 className="text-lg font-black tracking-tight truncate max-w-[200px] md:max-w-md">
              {song.title || initialTitle || 'Untitled Song'}
            </h2>
            <p className="text-[10px] font-black opacity-60 uppercase tracking-[0.3em]">
              {song.artist || 'Unknown Artist'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-3 rounded-2xl transition-all border ${showSettings ? 'bg-[#F27D26] border-[#F27D26] text-white shadow-xl shadow-[#F27D26]/20' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
          >
            <Settings size={20} />
          </button>
          <button onClick={onClose} className="p-3 bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl transition-all">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Perform Header (Scrolling Window Above) */}
      <div className="bg-black/40 border-b border-white/5 px-6 py-3 overflow-x-auto no-scrollbar">
        <div className="max-w-6xl mx-auto flex items-center gap-10">
          {settings.viewer.showTimingTempo && (
            <div className="flex items-center gap-6 shrink-0">
              <div className="space-y-0.5">
                <p className="text-[7px] font-black uppercase tracking-widest text-zinc-500">Tempo</p>
                <div className="flex items-center gap-1.5">
                  <Activity size={12} className="text-[#F27D26]" />
                  <span className="text-xs font-black">
                    {song.tempo?.replace(/\s*BPM\s*/gi, '') || '120'} BPM
                  </span>
                </div>
              </div>
              <div className="space-y-0.5">
                <p className="text-[7px] font-black uppercase tracking-widest text-zinc-500">Time</p>
                <div className="flex items-center gap-1.5">
                  <Timer size={12} className="text-blue-400" />
                  <span className="text-xs font-black">{song.timeSignature || '4/4'}</span>
                </div>
              </div>
            </div>
          )}

          {settings.viewer.showTuningNotes && (
            <div className="space-y-0.5 shrink-0">
              <p className="text-[7px] font-black uppercase tracking-widest text-zinc-500">Tuning & Capo</p>
              <div className="flex items-center gap-1.5">
                <Guitar size={12} className="text-emerald-400" />
                <span className="text-xs font-black">
                  {song.tuning || 'Standard'} 
                  {song.capo && !['no capo', 'none', '0', ''].includes(song.capo.toLowerCase().trim()) ? ` (Capo ${song.capo})` : ''}
                </span>
              </div>
            </div>
          )}

          {settings.viewer.showStrummingPattern && (
            <div className="space-y-0.5 shrink-0">
              <p className="text-[7px] font-black uppercase tracking-widest text-zinc-500">Strumming</p>
              <div className="flex items-center gap-1.5">
                <Music size={12} className="text-purple-400" />
                <span className="text-xs font-black tracking-widest bg-purple-500/10 px-2 py-0.5 rounded">
                  {formatStrumming(song.strumming || 'D D U U D U')}
                </span>
              </div>
            </div>
          )}

          {/* Performance Notes Section */}
          {settings.viewer.showPerformanceNotes && (
            <div className="space-y-1 shrink-0 max-w-xs">
              <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Performance Notes</p>
              <div className="flex items-center gap-2">
                <Info size={14} className="text-amber-400" />
                <span className="text-[10px] font-bold text-zinc-300 line-clamp-2 italic">
                  {song.lines.find(l => l.type === 'comment')?.content || 'No specific notes'}
                </span>
              </div>
            </div>
          )}

          {settings.viewer.showGraphicChords && song.fingerings && (
            <div className="flex items-center gap-3 shrink-0 ml-auto pr-4">
              {song.fingerings.map((f, i) => (
                <ChordDiagram key={i} fingering={f} theme={theme} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div 
        ref={scrollRef}
        onWheel={handleScroll}
        onTouchMove={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-12 md:px-24 lg:px-48 scroll-smooth relative"
        style={{ fontSize: `${fontSize}px`, fontFamily: settings.display.fontFamily }}
      >
        <AnimatePresence>
          {countdown > 0 && (
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 2, opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
            >
              <span className="text-[12rem] font-black text-[#F27D26] drop-shadow-2xl">{countdown}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-4xl mx-auto space-y-6 font-mono">
          {song.lines.map((line, idx) => {
            if (line.type === 'empty') return <div key={idx} className="h-4" />;
            if (line.type === 'directive') return null;
            if (line.type === 'comment' && settings.viewer.showPerformanceNotes) {
              return (
                <div key={idx} className="py-3 px-6 bg-white/5 border-l-4 border-[#F27D26] rounded-r-2xl italic opacity-80 text-sm">
                  {line.content}
                </div>
              );
            }

            return (
              <div key={idx} className="relative group">
                {line.chords && (
                  <div className="flex h-6 mb-1">
                    {line.chords.map((c, cIdx) => (
                      <span 
                        key={cIdx} 
                        className="absolute font-black"
                        style={{ 
                          left: `${c.index}ch`, 
                          color: chordColor,
                          textShadow: theme === 'dark' ? '0 0 10px rgba(0,0,0,0.5)' : 'none'
                        }}
                      >
                        {c.chord}
                      </span>
                    ))}
                  </div>
                )}
                <div className="whitespace-pre leading-relaxed" style={{ color: theme === 'dark' ? settings.display.lyricColor : 'inherit' }}>
                  {line.content || ' '}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-32 right-4 md:right-8 w-80 bg-zinc-900 border border-white/10 rounded-[2rem] p-8 shadow-2xl z-50 text-white"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Quick Settings</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-8">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-4 block">Font Size</label>
                <div className="flex items-center gap-4">
                  <button onClick={() => setFontSize(Math.max(12, fontSize - 2))} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 border border-white/10">
                    <Type size={16} className="scale-75" />
                  </button>
                  <span className="flex-1 text-center font-black">{fontSize}px</span>
                  <button onClick={() => setFontSize(Math.min(32, fontSize + 2))} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 border border-white/10">
                    <Type size={16} className="scale-125" />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-4 block">Theme</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['light', 'dark', 'sepia'] as const).map(t => (
                    <button 
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${
                        theme === t ? 'bg-[#F27D26] border-[#F27D26]' : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls Footer */}
      <div className="p-3 bg-black/80 backdrop-blur-2xl border-t border-white/10">
        <div className="max-w-5xl mx-auto flex flex-col gap-3">
          <div className="flex items-center gap-4">
            {/* Progress Bar */}
            <div className="flex-1 relative h-1.5 bg-white/10 rounded-full overflow-hidden group cursor-pointer"
                 onClick={(e) => {
                   const rect = e.currentTarget.getBoundingClientRect();
                   const x = e.clientX - rect.left;
                   const newProgress = x / rect.width;
                   setProgress(newProgress);
                   if (scrollRef.current) {
                     const scrollHeight = scrollRef.current.scrollHeight - scrollRef.current.clientHeight;
                     scrollRef.current.scrollTop = scrollHeight * newProgress;
                   }
                 }}>
              <div 
                className="absolute inset-y-0 left-0 bg-[#F27D26] transition-all duration-100"
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            {/* Duration Adjuster */}
            <div className="flex items-center gap-4 bg-white/5 border border-white/10 px-4 py-2 rounded-xl">
              <Clock size={16} className="text-zinc-500" />
              <input 
                type="range" 
                min="30" 
                max="600" 
                step="10"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-24 accent-[#F27D26]"
              />
              <span className="text-xs font-black tabular-nums w-12">
                {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={handleReset}
                className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all text-zinc-400 hover:text-white"
              >
                <RotateCcw size={18} />
              </button>
              <button 
                onClick={handlePlayPause}
                className="w-14 h-14 bg-[#F27D26] hover:bg-[#FF8C37] rounded-full flex items-center justify-center shadow-2xl shadow-[#F27D26]/30 transition-all active:scale-95"
              >
                {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" className="ml-1" />}
              </button>
              {isUserScrolling && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                >
                  <Info size={14} />
                  Scroll Overridden
                </motion.div>
              )}
            </div>

            <div className="text-right space-y-1">
              <p className="text-4xl font-black tabular-nums tracking-tighter">
                {Math.floor((progress * duration) / 60)}:{(Math.floor(progress * duration) % 60).toString().padStart(2, '0')}
              </p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Remaining: {Math.floor((duration - (progress * duration)) / 60)}:{(Math.floor(duration - (progress * duration)) % 60).toString().padStart(2, '0')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
