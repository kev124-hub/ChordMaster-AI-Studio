import React, { useState, useEffect } from 'react';
import { 
  Search, Music, Trash2, Play, 
  Plus, Filter, Clock, Star, 
  ChevronRight, MoreVertical, FileText,
  Settings as SettingsIcon, Database, HardDrive,
  Type, Palette, Sliders, ArrowLeft, Check,
  Edit2, Save, X as CloseIcon, Share2, Cloud, CloudOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SongAnalysis } from '../services/gemini';
import { convertToChordPro } from '../utils/chordpro';
import { AppSettings } from '../App';
import { db } from '../services/firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc, updateDoc, setDoc, getDocs } from 'firebase/firestore';
import { User } from 'firebase/auth';

interface SavedSong {
  id: string;
  analysis: SongAnalysis;
  chordPro: string;
  savedAt: number;
  isFavorite?: boolean;
  userId?: string;
  isShared?: boolean;
}

interface LibraryViewProps {
  onPlay: (chordPro: string, title: string) => void;
  onBack: () => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  user: User | null;
}

const GlassCard = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white/40 backdrop-blur-2xl border border-white/20 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-8 shadow-2xl ${className}`}>
    {children}
  </div>
);

export const LibraryView: React.FC<LibraryViewProps> = ({ onPlay, onBack, settings, onUpdateSettings, user }) => {
  const [songs, setSongs] = useState<SavedSong[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites' | 'shared'>('all');
  const [subView, setSubView] = useState<'list' | 'settings' | 'edit'>('list');
  const [editingSong, setEditingSong] = useState<SavedSong | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Load local songs first
    const saved = localStorage.getItem('chordmaster_library');
    let localSongs: SavedSong[] = saved ? JSON.parse(saved) : [];
    setSongs(localSongs);

    if (user && db) {
      setIsSyncing(true);
      
      // 1. Initial sync: Upload local songs that don't have a userId or are not in Firestore
      const syncLocalToCloud = async () => {
        if (!db) return;
        const q = query(collection(db, 'songs'), where('userId', '==', user.uid));
        const snapshot = await getDocs(q);
        const cloudIds = new Set(snapshot.docs.map(doc => doc.id));
        
        for (const localSong of localSongs) {
          if (!cloudIds.has(localSong.id)) {
            try {
              const { id, ...songData } = localSong;
              await setDoc(doc(db, 'songs', id), {
                ...songData,
                userId: user.uid,
                savedAt: localSong.savedAt || Date.now()
              });
            } catch (err) {
              console.error("Error syncing local song to cloud:", err);
            }
          }
        }
      };

      syncLocalToCloud();

      // 2. Real-time listener for cloud changes
      const q = query(collection(db, 'songs'), where('userId', '==', user.uid));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const firestoreSongs = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
        })) as SavedSong[];

        setSongs(firestoreSongs);
        localStorage.setItem('chordmaster_library', JSON.stringify(firestoreSongs));
        setIsSyncing(false);
      });

      return () => unsubscribe();
    }
  }, [user]);

  const deleteSong = async (id: string) => {
    if (confirm('Are you sure you want to delete this song?')) {
      if (user && db) {
        try {
          await deleteDoc(doc(db, 'songs', id));
        } catch (err) {
          console.error("Error deleting from Firestore:", err);
        }
      } else {
        const updated = songs.filter(s => s.id !== id);
        setSongs(updated);
        localStorage.setItem('chordmaster_library', JSON.stringify(updated));
      }
    }
  };

  const toggleFavorite = async (id: string) => {
    const song = songs.find(s => s.id === id);
    if (!song) return;

    if (user && db) {
      try {
        await updateDoc(doc(db, 'songs', id), {
          isFavorite: !song.isFavorite
        });
      } catch (err) {
        console.error("Error updating Firestore:", err);
      }
    } else {
      const updated = songs.map(s => s.id === id ? { ...s, isFavorite: !s.isFavorite } : s);
      setSongs(updated);
      localStorage.setItem('chordmaster_library', JSON.stringify(updated));
    }
  };

  const shareSong = async (song: SavedSong) => {
    if (!user || !db) {
      alert(db ? 'Please sign in to share songs.' : 'Cloud services are not configured.');
      return;
    }

    try {
      const shareUrl = `${window.location.origin}/share/${song.id}`;
      await updateDoc(doc(db, 'songs', song.id), {
        isShared: true
      });
      await navigator.clipboard.writeText(shareUrl);
      alert('Share link copied to clipboard!');
    } catch (err) {
      console.error("Error sharing song:", err);
    }
  };

  const handleEdit = (song: SavedSong) => {
    setEditingSong(song);
    setSubView('edit');
  };

  const saveEdit = async (updatedSong: SavedSong) => {
    // Sync metadata back to chordPro text tags
    let newChordPro = updatedSong.chordPro;
    const tags = [
      { key: 'title', value: updatedSong.analysis.title },
      { key: 'subtitle', value: updatedSong.analysis.artist },
      { key: 'key', value: updatedSong.analysis.key },
      { key: 'tempo', value: updatedSong.analysis.tempo },
      { key: 'capo', value: updatedSong.analysis.capo },
      { key: 'tuning', value: updatedSong.analysis.tuning },
      { key: 'duration', value: updatedSong.analysis.duration?.toString() },
      { key: 'time', value: updatedSong.analysis.timeSignature },
      { key: 'performance-notes', value: updatedSong.analysis.performanceNotes }
    ];

    tags.forEach(({ key, value }) => {
      if (!value) return;
      const regex = new RegExp(`\\{${key}:.*?\\}`, 'i');
      if (regex.test(newChordPro)) {
        newChordPro = newChordPro.replace(regex, `{${key}: ${value}}`);
      } else {
        // Add to top if not exists
        newChordPro = `{${key}: ${value}}\n` + newChordPro;
      }
    });

    const finalSong = { ...updatedSong, chordPro: newChordPro };
    
    if (user && db) {
      try {
        const { id, ...songData } = finalSong;
        await setDoc(doc(db, 'songs', id), songData);
      } catch (err) {
        console.error("Error updating Firestore:", err);
      }
    } else {
      const updated = songs.map(s => s.id === finalSong.id ? finalSong : s);
      setSongs(updated);
      localStorage.setItem('chordmaster_library', JSON.stringify(updated));
    }
    
    setSubView('list');
    setEditingSong(null);
  };

  const clearCache = () => {
    if (confirm('Are you sure you want to clear all saved songs?')) {
      setSongs([]);
      localStorage.removeItem('chordmaster_library');
    }
  };

  const filteredSongs = songs.filter(s => {
    const matchesSearch = s.analysis.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          s.analysis.artist.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'favorites' && s.isFavorite) || (filter === 'shared' && s.isShared);
    return matchesSearch && matchesFilter;
  });

  if (subView === 'edit' && editingSong) {
    return (
      <div className="min-h-screen pb-32">
        <div className="max-w-4xl mx-auto px-6 pt-12 space-y-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button 
                onClick={() => setSubView('list')}
                className="p-3 bg-white/20 hover:bg-white/30 rounded-2xl transition-all border border-white/30"
              >
                <ArrowLeft size={24} className="text-zinc-900" />
              </button>
              <h1 className="text-4xl font-black tracking-tight text-zinc-900">Edit Song</h1>
            </div>
            <button 
              onClick={() => saveEdit(editingSong)}
              className="flex items-center gap-3 bg-[#D96611] hover:bg-[#FF8C37] text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-2xl shadow-[#D96611]/20"
            >
              <Save size={16} />
              Save Changes
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <GlassCard className="space-y-6">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#D96611]">Metadata</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Title</label>
                  <input 
                    type="text"
                    value={editingSong.analysis.title}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, title: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Artist</label>
                  <input 
                    type="text"
                    value={editingSong.analysis.artist}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, artist: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Key</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.key}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, key: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tempo</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.tempo}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, tempo: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Capo</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.capo}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, capo: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tuning</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.tuning}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, tuning: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Strumming Pattern</label>
                  <input 
                    type="text"
                    value={editingSong.analysis.strummingPattern}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, strummingPattern: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Performance Notes</label>
                  <textarea 
                    value={editingSong.analysis.performanceNotes}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, performanceNotes: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all h-24 resize-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Song Duration (seconds)</label>
                  <input 
                    type="number"
                    value={editingSong.analysis.duration || 180}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, duration: parseInt(e.target.value) } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                  />
                  <p className="text-[10px] text-zinc-500 italic">Used for autoscroll speed calculation</p>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-6">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#D96611]">Lyrics & Chords (ChordPro)</h2>
              <textarea 
                value={editingSong.chordPro}
                onChange={(e) => setEditingSong({ ...editingSong, chordPro: e.target.value })}
                className="w-full h-[500px] bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all resize-none"
              />
            </GlassCard>
          </div>
        </div>
      </div>
    );
  }

  if (subView === 'settings') {
    return (
      <div className="min-h-screen pb-32">
        <div className="max-w-2xl mx-auto px-6 pt-12 space-y-12">
          {/* Settings Header */}
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setSubView('list')}
              className="p-3 bg-white/20 hover:bg-white/30 rounded-2xl transition-all border border-white/30"
            >
              <ArrowLeft size={24} className="text-zinc-900" />
            </button>
            <h1 className="text-4xl font-black tracking-tight text-zinc-900">Settings</h1>
          </div>

          <div className="space-y-8">
            {/* Display Settings */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-[#D96611]">
                <Type size={20} />
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em]">Display Settings</h2>
              </div>
              
              <GlassCard className="space-y-8">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Font Family</label>
                  <select 
                    value={settings.display.fontFamily}
                    onChange={(e) => onUpdateSettings({ ...settings, display: { ...settings.display, fontFamily: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all appearance-none"
                  >
                    <option value="Spline Sans (Modern)">Spline Sans (Modern)</option>
                    <option value="Inter">Inter (Sans)</option>
                    <option value="JetBrains Mono">JetBrains Mono (Tech)</option>
                    <option value="Georgia">Georgia (Serif)</option>
                  </select>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Base Font Size</label>
                    <span className="text-[10px] font-black text-[#D96611] bg-[#D96611]/10 px-2 py-1 rounded">{settings.display.baseFontSize}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="12" 
                    max="24" 
                    value={settings.display.baseFontSize}
                    onChange={(e) => onUpdateSettings({ ...settings, display: { ...settings.display, baseFontSize: parseInt(e.target.value) } })}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#D96611]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Chord Color</label>
                    <div className="flex items-center gap-3 bg-black/5 border border-black/10 rounded-2xl p-3">
                      <input 
                        type="color" 
                        value={settings.display.chordColor}
                        onChange={(e) => onUpdateSettings({ ...settings, display: { ...settings.display, chordColor: e.target.value } })}
                        className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-600 uppercase">{settings.display.chordColor}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Lyric Color</label>
                    <div className="flex items-center gap-3 bg-black/5 border border-black/10 rounded-2xl p-3">
                      <input 
                        type="color" 
                        value={settings.display.lyricColor}
                        onChange={(e) => onUpdateSettings({ ...settings, display: { ...settings.display, lyricColor: e.target.value } })}
                        className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-600 uppercase">{settings.display.lyricColor}</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </section>

            {/* Scroll Settings */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-blue-400">
                <Sliders size={20} />
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em]">Scroll Settings</h2>
              </div>
              
              <GlassCard className="space-y-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Default Scroll Speed</label>
                    <span className="text-[10px] font-black text-blue-400 bg-blue-400/10 px-2 py-1 rounded">{settings.scroll.defaultSpeed}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="3" 
                    step="0.1"
                    value={settings.scroll.defaultSpeed}
                    onChange={(e) => onUpdateSettings({ ...settings, scroll: { ...settings.scroll, defaultSpeed: parseFloat(e.target.value) } })}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Countdown Before Start</label>
                    <span className="text-[10px] font-black text-blue-400 bg-blue-400/10 px-2 py-1 rounded">{settings.scroll.countdown}s</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 3, 5, 10].map(val => (
                      <button 
                        key={val}
                        onClick={() => onUpdateSettings({ ...settings, scroll: { ...settings.scroll, countdown: val } })}
                        className={`py-3 rounded-xl text-[10px] font-black transition-all border ${
                          settings.scroll.countdown === val 
                            ? 'bg-blue-500 border-blue-500 text-white' 
                            : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'
                        }`}
                      >
                        {val === 0 ? 'Off' : `${val}s`}
                      </button>
                    ))}
                  </div>
                </div>
              </GlassCard>
            </section>

            {/* Storage Settings */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-emerald-400">
                <Database size={20} />
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em]">Storage</h2>
              </div>
              
              <GlassCard className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-sm font-black text-zinc-900">Offline Cache</h3>
                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{songs.length} songs available offline</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-zinc-600">{(songs.length * 0.3).toFixed(1)} MB</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">iCloud Folder Location</label>
                  <div className="flex items-center gap-3 bg-black/5 border border-black/10 rounded-2xl p-4">
                    <HardDrive size={18} className="text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-700">/iCloud Drive/{settings.storage.iCloudPath}</span>
                  </div>
                </div>

                <button 
                  onClick={clearCache}
                  className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border border-red-500/20 flex items-center justify-center gap-3"
                >
                  <Trash2 size={16} />
                  Clear Offline Cache
                </button>
              </GlassCard>
            </section>

            {/* Viewer Options */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-purple-400">
                <Sliders size={20} />
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em]">Viewer Options</h2>
              </div>
              
              <GlassCard className="grid grid-cols-1 gap-4">
                {[
                  { key: 'showGraphicChords', label: 'Display Graphic Chords' },
                  { key: 'showPerformanceNotes', label: 'Display Performance Notes' },
                  { key: 'showStrummingPattern', label: 'Display Strumming Pattern' },
                  { key: 'showTuningNotes', label: 'Display Tuning Notes' },
                  { key: 'showTimingTempo', label: 'Display Timing & Tempo' }
                ].map(opt => (
                  <label key={opt.key} className="flex items-center justify-between p-4 bg-black/5 rounded-2xl border border-black/10 cursor-pointer hover:bg-black/10 transition-all">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">{opt.label}</span>
                    <input 
                      type="checkbox" 
                      checked={(settings.viewer as any)[opt.key]}
                      onChange={(e) => onUpdateSettings({ ...settings, viewer: { ...settings.viewer, [opt.key]: e.target.checked } })}
                      className="w-5 h-5 rounded border-black/10 bg-black/5 text-purple-500 focus:ring-0"
                    />
                  </label>
                ))}
              </GlassCard>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32">
      <div className="max-w-5xl mx-auto px-6 pt-12 space-y-12">
        {/* Header Section */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-zinc-900">Library</h1>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#8C400B]">{songs.length} Transcriptions</span>
              <div className="w-1 h-1 rounded-full bg-zinc-400" />
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">
                {user ? (
                  <span className="flex items-center gap-2 text-emerald-600">
                    <Cloud size={14} />
                    Cloud Synced
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-zinc-400">
                    <CloudOff size={14} />
                    Local Only
                  </span>
                )}
              </div>
              <div className="w-1 h-1 rounded-full bg-zinc-400" />
              <button 
                onClick={() => setSubView('settings')}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                <SettingsIcon size={14} />
                Settings
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-[#D96611] transition-colors" size={18} />
              <input 
                type="text"
                placeholder="Search your collection..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-black/10 border border-black/10 rounded-[2rem] py-4 pl-14 pr-6 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 focus:bg-black/20 transition-all placeholder:text-zinc-600 text-zinc-900"
              />
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 bg-black/5 p-2 rounded-[2rem] border border-black/10 w-fit">
          <button 
            onClick={() => setFilter('all')}
            className={`px-10 py-3 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'all' ? 'bg-[#D96611] text-white shadow-xl shadow-[#D96611]/20' : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5'
            }`}
          >
            All Songs
          </button>
          <button 
            onClick={() => setFilter('favorites')}
            className={`px-10 py-3 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'favorites' ? 'bg-[#D96611] text-white shadow-xl shadow-[#D96611]/20' : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5'
            }`}
          >
            Favorites
          </button>
          <button 
            onClick={() => setFilter('shared')}
            className={`px-10 py-3 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'shared' ? 'bg-[#D96611] text-white shadow-xl shadow-[#D96611]/20' : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5'
            }`}
          >
            Shared
          </button>
        </div>

        {/* Song Grid */}
        <div className="grid grid-cols-1 gap-8">
          <AnimatePresence mode="popLayout">
            {filteredSongs.length > 0 ? (
              filteredSongs.map((song) => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  key={song.id}
                  className="group relative"
                >
                  <GlassCard className="hover:border-[#D96611]/30 transition-all duration-500 group-hover:translate-y-[-4px] bg-white/40 border-white/20">
                    <div className="flex justify-between items-start mb-4 md:mb-8">
                      <div className="space-y-1 md:space-y-2 flex-1 min-w-0 pr-4">
                        <div className="flex flex-wrap items-center gap-2 md:gap-3">
                          <span className="px-1.5 py-0.5 bg-black/5 text-zinc-600 rounded text-[7px] md:text-[8px] font-black uppercase tracking-widest">
                            {song.analysis.key || 'N/A'}
                          </span>
                          <span className="px-1.5 py-0.5 bg-black/5 text-zinc-600 rounded text-[7px] md:text-[8px] font-black uppercase tracking-widest">
                            {song.analysis.tempo || 'N/A'}
                          </span>
                          <span className="px-1.5 py-0.5 bg-black/5 text-zinc-600 rounded text-[7px] md:text-[8px] font-black uppercase tracking-widest">
                            {song.analysis.strummingPattern || 'N/A'}
                          </span>
                        </div>
                        <h3 className="text-xl md:text-3xl font-black tracking-tight text-zinc-900 group-hover:text-[#D96611] transition-colors leading-tight truncate">
                          {song.analysis.title}
                        </h3>
                        <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] md:tracking-[0.3em] text-zinc-600 truncate">
                          {song.analysis.artist}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 md:gap-2 shrink-0">
                        <button 
                          onClick={() => toggleFavorite(song.id)}
                          className={`p-2 md:p-3 rounded-xl md:rounded-2xl transition-all border ${song.isFavorite ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500' : 'bg-white/5 border-white/10 text-zinc-600 hover:text-white hover:bg-white/10'}`}
                        >
                          <Star size={16} className="md:w-[18px] md:h-[18px]" fill={song.isFavorite ? 'currentColor' : 'none'} />
                        </button>
                        <button 
                          onClick={() => shareSong(song)}
                          className={`p-2 md:p-3 rounded-xl md:rounded-2xl transition-all border ${song.isShared ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-white/5 border-white/10 text-zinc-600 hover:text-white hover:bg-white/10'}`}
                        >
                          <Share2 size={16} className="md:w-[18px] md:h-[18px]" />
                        </button>
                        <button 
                          onClick={() => handleEdit(song)}
                          className="p-2 md:p-3 bg-white/5 border border-white/10 text-zinc-600 hover:text-[#D96611] hover:bg-[#D96611]/10 hover:border-[#D96611]/20 rounded-xl md:rounded-2xl transition-all"
                        >
                          <Edit2 size={16} className="md:w-[18px] md:h-[18px]" />
                        </button>
                        <button 
                          onClick={() => deleteSong(song.id)}
                          className="p-2 md:p-3 bg-white/5 border border-white/10 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/20 rounded-xl md:rounded-2xl transition-all"
                        >
                          <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 md:pt-6 border-t border-black/5">
                      <div className="flex items-center gap-2 md:gap-3 text-zinc-600">
                        <Clock size={12} className="md:w-3.5 md:h-3.5" />
                        <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest">
                          {new Date(song.savedAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <button 
                        onClick={() => onPlay(song.chordPro, song.analysis.title)}
                        className="flex items-center gap-2 md:gap-4 bg-black/5 hover:bg-[#D96611] text-zinc-900 hover:text-white px-4 py-2.5 md:px-10 md:py-4 rounded-xl md:rounded-2xl text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] md:tracking-[0.3em] transition-all border border-black/10 hover:border-transparent shadow-xl active:scale-95"
                      >
                        <Play size={12} className="md:w-3.5 md:h-3.5" fill="currentColor" />
                        Perform
                      </button>
                    </div>
                  </GlassCard>
                </motion.div>
              ))
            ) : (
              <div className="col-span-full py-40 flex flex-col items-center justify-center space-y-8 bg-black/5 rounded-[3rem] border border-dashed border-black/10">
                <div className="w-24 h-24 bg-black/5 rounded-full flex items-center justify-center border border-black/10">
                  <Music size={40} className="text-zinc-700" />
                </div>
                <div className="text-center space-y-3">
                  <h3 className="text-2xl font-black text-zinc-900">Your library is empty</h3>
                  <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest max-w-xs mx-auto">
                    Start transcribing to build your collection
                  </p>
                </div>
                <button 
                  onClick={onBack}
                  className="flex items-center gap-3 bg-[#D96611] hover:bg-[#FF8C37] text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-2xl shadow-[#D96611]/20"
                >
                  <Plus size={16} />
                  New Transcription
                </button>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
