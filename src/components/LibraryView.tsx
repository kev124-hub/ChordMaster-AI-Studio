import React, { useState, useEffect } from 'react';
import { 
  Search, Music, Trash2, Play, 
  Plus, Filter, Clock, Star, 
  ChevronRight, MoreVertical, FileText,
  Settings as SettingsIcon, Database, HardDrive,
  Type, Palette, Sliders, ArrowLeft, Check,
  Edit2, Save, X as CloseIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SongAnalysis } from '../services/gemini';
import { convertToChordPro } from '../utils/chordpro';
import { AppSettings } from '../App';

interface SavedSong {
  id: string;
  analysis: SongAnalysis;
  chordPro: string;
  savedAt: number;
  isFavorite?: boolean;
}

interface LibraryViewProps {
  onPlay: (chordPro: string, title: string) => void;
  onBack: () => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

const GlassCard = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white/40 backdrop-blur-2xl border border-white/20 rounded-[2.5rem] p-8 shadow-2xl ${className}`}>
    {children}
  </div>
);

export const LibraryView: React.FC<LibraryViewProps> = ({ onPlay, onBack, settings, onUpdateSettings }) => {
  const [songs, setSongs] = useState<SavedSong[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [subView, setSubView] = useState<'list' | 'settings' | 'edit'>('list');
  const [editingSong, setEditingSong] = useState<SavedSong | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('chordmaster_library');
    if (saved) {
      setSongs(JSON.parse(saved));
    }
  }, []);

  const deleteSong = (id: string) => {
    if (confirm('Are you sure you want to delete this song?')) {
      const updated = songs.filter(s => s.id !== id);
      setSongs(updated);
      localStorage.setItem('chordmaster_library', JSON.stringify(updated));
    }
  };

  const toggleFavorite = (id: string) => {
    const updated = songs.map(s => s.id === id ? { ...s, isFavorite: !s.isFavorite } : s);
    setSongs(updated);
    localStorage.setItem('chordmaster_library', JSON.stringify(updated));
  };

  const handleEdit = (song: SavedSong) => {
    setEditingSong(song);
    setSubView('edit');
  };

  const saveEdit = (updatedSong: SavedSong) => {
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
      { key: 'time', value: updatedSong.analysis.timeSignature }
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
    const updated = songs.map(s => s.id === finalSong.id ? finalSong : s);
    setSongs(updated);
    localStorage.setItem('chordmaster_library', JSON.stringify(updated));
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
    const matchesFilter = filter === 'all' || s.isFavorite;
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
              className="flex items-center gap-3 bg-[#F27D26] hover:bg-[#FF8C37] text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-2xl shadow-[#F27D26]/20"
            >
              <Save size={16} />
              Save Changes
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <GlassCard className="space-y-6">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Metadata</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Title</label>
                  <input 
                    type="text"
                    value={editingSong.analysis.title}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, title: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Artist</label>
                  <input 
                    type="text"
                    value={editingSong.analysis.artist}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, artist: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Key</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.key}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, key: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tempo</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.tempo}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, tempo: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
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
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tuning</label>
                    <input 
                      type="text"
                      value={editingSong.analysis.tuning}
                      onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, tuning: e.target.value } })}
                      className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Strumming Pattern</label>
                  <input 
                    type="text"
                    value={editingSong.analysis.strummingPattern}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, strummingPattern: e.target.value } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Song Duration (seconds)</label>
                  <input 
                    type="number"
                    value={editingSong.analysis.duration || 180}
                    onChange={(e) => setEditingSong({ ...editingSong, analysis: { ...editingSong.analysis, duration: parseInt(e.target.value) } })}
                    className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all"
                  />
                  <p className="text-[10px] text-zinc-500 italic">Used for autoscroll speed calculation</p>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-6">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Lyrics & Chords (ChordPro)</h2>
              <textarea 
                value={editingSong.chordPro}
                onChange={(e) => setEditingSong({ ...editingSong, chordPro: e.target.value })}
                className="w-full h-[500px] bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-zinc-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 transition-all resize-none"
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
              <div className="flex items-center gap-3 text-[#F27D26]">
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
                    <span className="text-[10px] font-black text-[#F27D26] bg-[#F27D26]/10 px-2 py-1 rounded">{settings.display.baseFontSize}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="12" 
                    max="24" 
                    value={settings.display.baseFontSize}
                    onChange={(e) => onUpdateSettings({ ...settings, display: { ...settings.display, baseFontSize: parseInt(e.target.value) } })}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F27D26]"
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
            <h1 className="text-6xl font-black tracking-tighter text-zinc-900">Library</h1>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#F27D26]">{songs.length} Transcriptions</span>
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
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-[#F27D26] transition-colors" size={18} />
              <input 
                type="text"
                placeholder="Search your collection..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-black/10 border border-black/10 rounded-[2rem] py-4 pl-14 pr-6 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-[#F27D26]/30 focus:bg-black/20 transition-all placeholder:text-zinc-600 text-zinc-900"
              />
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 bg-black/5 p-2 rounded-[2rem] border border-black/10 w-fit">
          <button 
            onClick={() => setFilter('all')}
            className={`px-10 py-3 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'all' ? 'bg-[#F27D26] text-white shadow-xl shadow-[#F27D26]/20' : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5'
            }`}
          >
            All Songs
          </button>
          <button 
            onClick={() => setFilter('favorites')}
            className={`px-10 py-3 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'favorites' ? 'bg-[#F27D26] text-white shadow-xl shadow-[#F27D26]/20' : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5'
            }`}
          >
            Favorites
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
                  <GlassCard className="hover:border-[#F27D26]/30 transition-all duration-500 group-hover:translate-y-[-4px] bg-white/40 border-white/20">
                    <div className="flex justify-between items-start mb-10">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="px-2 py-0.5 bg-black/5 text-zinc-600 rounded text-[8px] font-black uppercase tracking-widest">
                            {song.analysis.key || 'N/A'}
                          </span>
                          <span className="px-2 py-0.5 bg-black/5 text-zinc-600 rounded text-[8px] font-black uppercase tracking-widest">
                            {song.analysis.tempo || 'N/A'}
                          </span>
                          <span className="px-2 py-0.5 bg-black/5 text-zinc-600 rounded text-[8px] font-black uppercase tracking-widest">
                            {song.analysis.strummingPattern || 'N/A'}
                          </span>
                        </div>
                        <h3 className="text-3xl font-black tracking-tight text-zinc-900 group-hover:text-[#F27D26] transition-colors leading-tight">
                          {song.analysis.title}
                        </h3>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">
                          {song.analysis.artist}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button 
                          onClick={() => toggleFavorite(song.id)}
                          className={`p-3 rounded-2xl transition-all border ${song.isFavorite ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500' : 'bg-white/5 border-white/10 text-zinc-600 hover:text-white hover:bg-white/10'}`}
                        >
                          <Star size={18} fill={song.isFavorite ? 'currentColor' : 'none'} />
                        </button>
                        <button 
                          onClick={() => handleEdit(song)}
                          className="p-3 bg-white/5 border border-white/10 text-zinc-600 hover:text-[#F27D26] hover:bg-[#F27D26]/10 hover:border-[#F27D26]/20 rounded-2xl transition-all"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => deleteSong(song.id)}
                          className="p-3 bg-white/5 border border-white/10 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/20 rounded-2xl transition-all"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-8 border-t border-black/5">
                      <div className="flex items-center gap-3 text-zinc-600">
                        <Clock size={14} />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          {new Date(song.savedAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <button 
                        onClick={() => onPlay(song.chordPro, song.analysis.title)}
                        className="flex items-center gap-4 bg-black/5 hover:bg-[#F27D26] text-zinc-900 hover:text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all border border-black/10 hover:border-transparent shadow-xl active:scale-95"
                      >
                        <Play size={14} fill="currentColor" />
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
                  className="flex items-center gap-3 bg-[#F27D26] hover:bg-[#FF8C37] text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-2xl shadow-[#F27D26]/20"
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
