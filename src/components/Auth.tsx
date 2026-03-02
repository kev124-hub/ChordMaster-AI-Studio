import React, { useState } from 'react';
import { auth, googleProvider } from '../services/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  updateProfile,
  signInWithPopup
} from 'firebase/auth';
import { X, Mail, Lock, User, Loader2, LogOut, Cloud, Chrome } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AuthProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Auth: React.FC<AuthProps> = ({ isOpen, onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSocialLogin = async (provider: any) => {
    setLoading(true);
    setError(null);
    try {
      if (!auth) {
        setError("Authentication service is not configured.");
        return;
      }
      await signInWithPopup(auth, provider);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!auth) {
        setError("Authentication service is not configured. Please add your Firebase keys in the Secrets panel.");
        return;
      }
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: username });
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-xl"
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md bg-white/80 backdrop-blur-2xl border border-white/40 rounded-[3rem] p-10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] overflow-y-auto max-h-[90vh]"
          >
            <button 
              onClick={onClose}
              className="absolute top-8 right-8 p-2 hover:bg-black/5 rounded-full transition-colors"
            >
              <X size={20} className="text-zinc-500" />
            </button>

            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#D96611]/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-[#D96611]/20">
                <Cloud size={32} className="text-[#D96611]" />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-zinc-900">
                {isLogin ? 'Welcome Back' : 'Create Account'}
              </h2>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-2">
                Sync your library across all devices
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 mb-8">
              <button 
                onClick={() => handleSocialLogin(googleProvider)}
                className="flex items-center justify-center gap-4 p-4 bg-white border border-black/5 rounded-2xl hover:bg-zinc-50 transition-all shadow-sm group"
              >
                <Chrome size={20} className="text-zinc-600 group-hover:text-[#4285F4]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-zinc-900">Sign in with Google</span>
              </button>
            </div>

            <div className="relative mb-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-black/5"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white/20 backdrop-blur-md px-4 text-[8px] font-black text-zinc-400 uppercase tracking-[0.5em]">OR</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {!isLogin && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-4">Username</label>
                  <div className="relative">
                    <User className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input 
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Your name"
                      className="w-full bg-black/5 border border-black/10 rounded-2xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-4">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                  <input 
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-black/5 border border-black/10 rounded-2xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-4">Password</label>
                <div className="relative">
                  <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                  <input 
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-black/5 border border-black/10 rounded-2xl py-4 pl-14 pr-6 text-sm focus:outline-none focus:ring-2 focus:ring-[#D96611]/30 transition-all"
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs font-bold text-red-500 bg-red-500/10 p-4 rounded-2xl border border-red-500/20">
                  {error}
                </p>
              )}

              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-[#D96611] hover:bg-[#FF8C37] text-white py-5 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all shadow-2xl shadow-[#D96611]/20 flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : (isLogin ? 'Sign In' : 'Create Account')}
              </button>
            </form>

            <div className="mt-8 text-center">
              <button 
                onClick={() => setIsLogin(!isLogin)}
                className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-[#D96611] transition-colors"
              >
                {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export const UserProfile: React.FC<{ user: any }> = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-4 bg-white/40 backdrop-blur-xl border border-white/20 p-2 pl-4 rounded-full hover:bg-white/60 transition-all group"
      >
        <div className="text-right hidden md:block">
          <p className="text-[10px] font-black text-zinc-900 leading-none">{user.displayName || 'User'}</p>
          <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Cloud Synced</p>
        </div>
        <div className="w-10 h-10 bg-[#D96611] rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg group-hover:scale-105 transition-transform">
          {(user.displayName || user.email || 'U')[0].toUpperCase()}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-4 w-64 bg-white/80 backdrop-blur-2xl border border-white/40 rounded-3xl p-4 shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-4 border-b border-black/5 mb-2">
                <p className="text-xs font-black text-zinc-900 truncate">{user.email}</p>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Free Account</p>
              </div>
              
              <button 
                onClick={() => {
                  auth.signOut();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 p-4 hover:bg-red-500/10 text-red-500 rounded-2xl transition-all text-[10px] font-black uppercase tracking-widest"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
