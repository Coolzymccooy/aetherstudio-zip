import React, { useState, useEffect } from 'react';
import { Zap, Circle, ArrowRight, Smartphone, Monitor, Mic, Shield, Play, Menu, X, CheckCircle, Lock, Layers, Radio, ChevronLeft, Loader2, AlertCircle, Terminal, Cpu, PlayCircle, Camera, Download } from 'lucide-react';
import { auth } from '../../services/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, User, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

interface LandingPageProps {
  user: User | null;
  onEnterStudio: () => void;
  onOpenMobileMode: () => void;
}

const DEFAULT_DESKTOP_DOWNLOAD_URL = 'https://github.com/Coolzymccooy/aetherstudio-zip/releases/latest';

const normalizeDesktopDownloadUrl = (value: string) =>
  value.replace(
    'github.com/Coolzymccoy/aetherstudio-zip',
    'github.com/Coolzymccooy/aetherstudio-zip'
  );

export const LandingPage: React.FC<LandingPageProps> = ({ user, onEnterStudio, onOpenMobileMode }) => {
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'waitlist' | 'forgot' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  // FIX: Track if we just performed a login action to auto-redirect once user state propagates
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const rawDesktopDownloadUrl = ((import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) || '').trim();
  const desktopDownloadUrl = normalizeDesktopDownloadUrl(rawDesktopDownloadUrl || DEFAULT_DESKTOP_DOWNLOAD_URL);

  useEffect(() => {
    // Only enter studio if we have a user AND we just finished the login flow
    if (user && justLoggedIn) {
      onEnterStudio();
      setJustLoggedIn(false);
    }
  }, [user, justLoggedIn, onEnterStudio]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthLoading(true);

    try {
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
        setAuthMode(null);
        setJustLoggedIn(true); // Flag to trigger redirect in useEffect
      } else if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
        setAuthMode(null);
        setJustLoggedIn(true); // Flag to trigger redirect in useEffect
      } else if (authMode === 'forgot') {
        await sendPasswordResetEmail(auth, email);
        setResetSent(true);
      } else if (authMode === 'waitlist') {
        // Mock waitlist
        setTimeout(() => {
          alert("You've been added to the waiting list!");
          setAuthMode(null);
        }, 1000);
      }
    } catch (err: any) {
      console.error("Auth Error", err);
      let msg = err.message || "An error occurred.";

      if (err.code === 'auth/invalid-credential') msg = "Invalid email or password.";
      if (err.code === 'auth/email-already-in-use') msg = "Email already in use.";
      if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters.";

      setAuthError(msg);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsAuthLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth!, provider);
      setAuthMode(null);
      setJustLoggedIn(true);
    } catch (err: any) {
      console.error("Google Auth Error", err);
      setAuthError(err.message || "Failed to sign in with Google.");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleMainAction = () => {
    if (user) {
      onEnterStudio();
    } else {
      setAuthMode('signup');
    }
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const closeAuthModal = () => {
    setAuthMode(null);
    setResetSent(false);
    setEmail('');
    setPassword('');
    setAuthError(null);
  };

  const getModalTitle = () => {
    switch (authMode) {
      case 'signin': return 'Welcome Back';
      case 'signup': return 'Create Account';
      case 'waitlist': return 'Join Waitlist';
      case 'forgot': return 'Reset Password';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-[#05010a] text-white font-sans selection:bg-aether-500 selection:text-white overflow-x-hidden">

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-[#05010a]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <div className="w-8 h-8 bg-gradient-to-br from-aether-500 to-aether-accent rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(45,212,191,0.45)] group-hover:shadow-[0_0_25px_rgba(45,212,191,0.7)] transition-all">
              <Zap className="text-white fill-current" size={18} />
            </div>
            <span className="text-xl font-bold tracking-tight">Aether<span className="font-light text-aether-accent">Studio</span></span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
            <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">Features</button>
            <button onClick={() => scrollToSection('how-it-works')} className="hover:text-white transition-colors">How it Works</button>

            {!user ? (
              <>
                {desktopDownloadUrl && (
                  <a
                    href={desktopDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white transition-colors"
                  >
                    Download App
                  </a>
                )}
                <button onClick={() => setAuthMode('signin')} className="hover:text-white transition-colors">Sign In</button>
                <button
                  onClick={() => setAuthMode('signup')}
                  className="bg-white text-black px-5 py-2 rounded-full hover:bg-gray-200 transition-colors font-bold"
                >
                  Get Started
                </button>
              </>
            ) : (
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500 truncate max-w-[150px]">{user.email || 'Dev User'}</span>
                <button
                  onClick={onEnterStudio}
                  className="bg-gradient-to-r from-aether-500 to-aether-accent text-white px-5 py-2 rounded-full hover:opacity-90 transition-opacity font-bold flex items-center gap-2 shadow-lg shadow-aether-accent/20"
                >
                  <Zap size={16} fill="currentColor" /> Enter Studio
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-aether-600/30 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-aether-accent/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono tracking-widest text-gray-400 mb-6 uppercase">
            <Cpu size={12} className="text-aether-accent" /> Tiwaton Tech
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
            The Streaming Studio <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-aether-400 via-white to-aether-accent animate-gradient">From The Future.</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-6 leading-relaxed">
            A full broadcast studio in your browser: multi-cam switching, phone cameras,
            live graphics, and AI-assisted production. Ship fast, go live confidently.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
            {[
              { label: "Broadcast", value: "YouTube + Twitch RTMP", desc: "Go live with relay-based streaming." },
              { label: "Multi-Cam", value: "Local + Phone Inputs", desc: "Add multiple cameras instantly." },
              { label: "Scenes", value: "Presets + Transitions", desc: "Switch layouts with one click." },
              { label: "AI Studio", value: "Backgrounds + Assistant", desc: "Generate visuals and ideas." },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
                <div className="text-[10px] uppercase tracking-widest text-gray-400">{item.label}</div>
                <div className="text-base font-semibold text-white mt-1">{item.value}</div>
                <div className="text-xs text-gray-400 mt-1">{item.desc}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row items-center justify-center gap-4">
            <button
              onClick={onOpenMobileMode}
              className="md:hidden w-full max-w-xs px-8 py-4 rounded-full bg-white text-black font-bold text-lg hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center justify-center gap-2 mb-2 animate-in slide-in-from-bottom-4 fade-in duration-700"
            >
              <Smartphone size={24} className="text-aether-accent" /> Use Phone as Camera
            </button>

            <button
              onClick={handleMainAction}
              className="px-8 py-4 rounded-full bg-gradient-to-r from-aether-500 to-aether-accent text-white font-bold text-lg hover:scale-105 transition-transform shadow-[0_0_30px_rgba(45,212,191,0.3)] flex items-center gap-2"
            >
              {user ? 'Return to Studio' : 'Start Streaming Now'} <ArrowRight size={20} />
            </button>
            <button
              onClick={() => setAuthMode('waitlist')}
              className="px-8 py-4 rounded-full border border-white/10 bg-white/5 text-white font-medium text-lg hover:bg-white/10 transition-colors backdrop-blur-sm"
            >
              Join Waiting List
            </button>
            {desktopDownloadUrl && (
              <a
                href={desktopDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 rounded-full border border-aether-500/40 bg-aether-500/10 text-aether-accent font-medium text-lg hover:bg-aether-500/20 transition-colors backdrop-blur-sm flex items-center gap-2"
              >
                <Download size={18} /> Download Desktop App
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-[#0a0212] relative border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Why Aether Studio?</h2>
            <p className="text-gray-400">Everything you need to broadcast like a pro, simplified.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white/5 p-8 rounded-2xl border border-white/10 hover:border-aether-500/50 transition-colors">
              <div className="w-12 h-12 bg-aether-900 rounded-lg flex items-center justify-center mb-4 text-aether-400">
                <Smartphone size={24} />
              </div>
              <h3 className="text-xl font-bold mb-2">Wireless Mobile Cam</h3>
              <p className="text-gray-400 text-sm">Turn your phone into a roaming camera with clean pairing and stable connection.</p>
            </div>
            <div className="bg-white/5 p-8 rounded-2xl border border-white/10 hover:border-aether-500/50 transition-colors">
              <div className="w-12 h-12 bg-aether-900 rounded-lg flex items-center justify-center mb-4 text-aether-accent">
                <Layers size={24} />
              </div>
              <h3 className="text-xl font-bold mb-2">Browser Compositor</h3>
              <p className="text-gray-400 text-sm">Layer text, images, and screens like OBS, but directly in Chrome.</p>
            </div>
            <div className="bg-white/5 p-8 rounded-2xl border border-white/10 hover:border-aether-500/50 transition-colors">
              <div className="w-12 h-12 bg-aether-900 rounded-lg flex items-center justify-center mb-4 text-blue-400">
                <Shield size={24} />
              </div>
              <h3 className="text-xl font-bold mb-2">AI-Powered Audio</h3>
              <p className="text-gray-400 text-sm">Noise suppression and clean output for pro-grade voice clarity.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="py-24 bg-[#05010a] border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Built for Real Production</h2>
            <p className="text-gray-400">Aether Studio handles multi-input, live graphics, and seamless delivery.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[
              { title: "Multi-Camera Inputs", desc: "Add local webcams, capture cards, and multiple phones at once." },
              { title: "Instant Live Switching", desc: "Cut between cameras with transitions and scene presets." },
              { title: "Live Overlays", desc: "Lower thirds, pinned messages, and ticker graphics." },
              { title: "Stream Health", desc: "Relay checks, FFmpeg checks, and live bitrate monitoring." },
              { title: "AI Studio Tools", desc: "Generate backgrounds and get quick production suggestions." },
              { title: "Desktop App", desc: "Install native Windows app with built-in relay and local Peer server." },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mini Demo Flow */}
      <section id="flow" className="py-20 bg-[#0a0212] border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-4">Launch in 3 Steps</h2>
            <p className="text-gray-400">A simple flow that gets you from setup to live in minutes.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Add Cameras",
                desc: "Connect local webcams and phones. Assign your main shot.",
                icon: <Camera size={22} />,
              },
              {
                step: "02",
                title: "Design the Scene",
                desc: "Apply overlays, lower thirds, and choose a layout preset.",
                icon: <Layers size={22} />,
              },
              {
                step: "03",
                title: "Go Live",
                desc: "Send your feed to YouTube or Twitch with health monitoring.",
                icon: <Radio size={22} />,
              },
            ].map((item) => (
              <div key={item.step} className="rounded-2xl border border-white/10 bg-white/5 p-6 relative overflow-hidden">
                <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-aether-accent/10 blur-2xl" />
                <div className="flex items-center gap-3 mb-4 text-aether-400">
                  <div className="w-10 h-10 rounded-xl bg-aether-900 border border-white/10 flex items-center justify-center text-aether-400">
                    {item.icon}
                  </div>
                  <span className="text-xs font-mono tracking-widest text-gray-500">{item.step}</span>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section id="how-it-works" className="py-24 bg-[#05010a] border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-center gap-12 relative">
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-1 bg-gradient-to-r from-aether-900 via-aether-500 to-aether-900 -z-10" />

            {[
              { step: "01", title: "Open Studio", desc: "Log in on your desktop." },
              { step: "02", title: "Scan QR", desc: "Connect your phone." },
              { step: "03", title: "Go Live", desc: "Broadcast to the world." }
            ].map((item, i) => (
              <div key={i} className="bg-[#05010a] p-6 text-center w-64 border border-white/10 rounded-xl">
                <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-800 mb-2">{item.step}</div>
                <h3 className="font-bold text-lg mb-1">{item.title}</h3>
                <p className="text-gray-400 text-xs">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Auth Modal */}
      {authMode && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#0f0518] border border-white/10 rounded-2xl w-[400px] p-8 shadow-2xl relative">
            <button onClick={closeAuthModal} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X size={20} /></button>

            <div className="mb-6 text-center">
              <div className="w-12 h-12 bg-gradient-to-br from-aether-500 to-aether-accent rounded-lg flex items-center justify-center shadow-lg mx-auto mb-4">
                {authMode === 'waitlist' || authMode === 'forgot' ? <Lock className="text-white" /> : <Zap className="text-white fill-current" />}
              </div>
              <h2 className="text-2xl font-bold">{getModalTitle()}</h2>
            </div>

            {!resetSent ? (
              <div className="space-y-4">
                {authError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded flex items-start gap-2">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}

                {/* Google Sign In Button */}
                {(authMode === 'signin' || authMode === 'signup') && (
                  <>
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isAuthLoading}
                      className="w-full bg-white text-black font-bold py-3 rounded-lg hover:bg-gray-100 transition-all flex items-center justify-center gap-3"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Continue with Google
                    </button>

                    <div className="relative my-6">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                      <div className="relative flex justify-center text-xs uppercase"><span className="bg-[#0f0518] px-2 text-gray-500 font-bold">Or with email</span></div>
                    </div>
                  </>
                )}

                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-aether-500 outline-none"
                    />
                  </div>

                  {authMode !== 'waitlist' && authMode !== 'forgot' && (
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase">Password</label>
                        {authMode === 'signin' && (
                          <button type="button" onClick={() => setAuthMode('forgot')} className="text-xs text-aether-accent hover:underline">Forgot?</button>
                        )}
                      </div>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-aether-500 outline-none"
                      />
                    </div>
                  )}

                  <button disabled={isAuthLoading} className="w-full bg-gradient-to-r from-aether-500 to-aether-accent text-white font-bold py-3 rounded-lg hover:brightness-110 transition-all flex items-center justify-center gap-2">
                    {isAuthLoading && <Loader2 className="animate-spin" size={16} />}
                    {authMode === 'signin' ? 'Sign In' : authMode === 'signup' ? 'Create Account' : authMode === 'forgot' ? 'Send Reset Link' : 'Join List'}
                  </button>

                  {(authMode === 'signin' || authMode === 'signup') && (
                    <p className="text-center text-xs text-gray-500 mt-4">
                      {authMode === 'signin' ? "Don't have an account?" : "Already have an account?"}{' '}
                      <button
                        type="button"
                        onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                        className="text-aether-accent hover:underline"
                      >
                        {authMode === 'signin' ? 'Sign Up' : 'Sign In'}
                      </button>
                    </p>
                  )}
                </form>
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
                  <CheckCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Check your email</h3>
                <p className="text-gray-400 text-sm mb-6">We've sent a password reset link to {email}</p>
                <button onClick={() => { setResetSent(false); setAuthMode('signin'); }} className="text-aether-accent hover:underline text-sm font-bold">Back to Sign In</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

