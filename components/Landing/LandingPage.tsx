import React, { useState, useEffect } from 'react';
import { Zap, Circle, ArrowRight, Smartphone, Monitor, Mic, Shield, Play, Menu, X, CheckCircle, Lock, Layers, Radio, ChevronLeft, Loader2, AlertCircle, Terminal, Cpu, PlayCircle } from 'lucide-react';
import { auth } from '../../services/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, User, signInAnonymously } from 'firebase/auth';

interface LandingPageProps {
  user: User | null;
  onEnterStudio: () => void;
  onOpenMobileMode: () => void;
  // Function to allow dev bypass in parent
  onDevBypass?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ user, onEnterStudio, onOpenMobileMode, onDevBypass }) => {
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'waitlist' | 'forgot' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  
  // FIX: Track if we just performed a login action to auto-redirect once user state propagates
  const [justLoggedIn, setJustLoggedIn] = useState(false);

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

  const handleDevBypass = () => {
      if (onDevBypass) onDevBypass();
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
      switch(authMode) {
          case 'signin': return 'Welcome Back';
          case 'signup': return 'Create Account';
          case 'waitlist': return 'Join Waitlist';
          case 'forgot': return 'Reset Password';
          default: return '';
      }
  };

  return (
    <div className="min-h-screen bg-[#05010a] text-white font-sans selection:bg-fuchsia-500 selection:text-white overflow-x-hidden">
      
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-[#05010a]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group" 
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <div className="w-8 h-8 bg-gradient-to-br from-aether-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(217,70,239,0.5)] group-hover:shadow-[0_0_25px_rgba(217,70,239,0.8)] transition-all">
               <Zap className="text-white fill-current" size={18} />
            </div>
            <span className="text-xl font-bold tracking-tight">Aether<span className="font-light text-fuchsia-400">Studio</span></span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
            <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">Features</button>
            <button onClick={() => scrollToSection('how-it-works')} className="hover:text-white transition-colors">How it Works</button>
            
            {!user ? (
                <>
                    {onDevBypass && (
                        <button 
                            onClick={handleDevBypass}
                            className="text-fuchsia-400 hover:text-fuchsia-300 transition-colors flex items-center gap-1 text-xs uppercase font-bold tracking-wider"
                        >
                            <PlayCircle size={14} /> Quick Start
                        </button>
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
                        className="bg-gradient-to-r from-aether-500 to-fuchsia-500 text-white px-5 py-2 rounded-full hover:opacity-90 transition-opacity font-bold flex items-center gap-2 shadow-lg shadow-fuchsia-500/20"
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
        <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-fuchsia-600/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono tracking-widest text-gray-400 mb-6 uppercase">
              <Cpu size={12} className="text-fuchsia-500" /> Tech by Tiwaton
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
            The Streaming Studio <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-aether-400 via-white to-fuchsia-300 animate-gradient">From The Future.</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Combine the power of OBS, the convenience of Camo, and the intelligence of AI. 
            No expensive hardware required. Just your browser and your creativity.
          </p>
          
          <div className="flex flex-col md:flex-row items-center justify-center gap-4">
            <button 
                onClick={onOpenMobileMode}
                className="md:hidden w-full max-w-xs px-8 py-4 rounded-full bg-white text-black font-bold text-lg hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center justify-center gap-2 mb-2 animate-in slide-in-from-bottom-4 fade-in duration-700"
            >
                <Smartphone size={24} className="text-fuchsia-600" /> Use Phone as Camera
            </button>

            <button 
                onClick={handleMainAction}
                className="px-8 py-4 rounded-full bg-gradient-to-r from-aether-600 to-fuchsia-600 text-white font-bold text-lg hover:scale-105 transition-transform shadow-[0_0_30px_rgba(217,70,239,0.3)] flex items-center gap-2"
            >
                {user ? 'Return to Studio' : 'Start Streaming Now'} <ArrowRight size={20} />
            </button>
            <button 
                onClick={() => setAuthMode('waitlist')}
                className="px-8 py-4 rounded-full border border-white/10 bg-white/5 text-white font-medium text-lg hover:bg-white/10 transition-colors backdrop-blur-sm"
            >
                Join Waiting List
            </button>
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
                     <p className="text-gray-400 text-sm">Turn your phone into a 4K webcam with zero latency. No cables, no drivers.</p>
                 </div>
                 <div className="bg-white/5 p-8 rounded-2xl border border-white/10 hover:border-aether-500/50 transition-colors">
                     <div className="w-12 h-12 bg-aether-900 rounded-lg flex items-center justify-center mb-4 text-fuchsia-400">
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
                     <p className="text-gray-400 text-sm">Tech by Tiwaton algorithms remove background noise instantly.</p>
                 </div>
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

      {/* Footer */}
      <footer className="py-12 border-t border-white/5 text-center text-gray-500 text-sm bg-[#0a0212]">
        <div className="flex justify-center gap-6 mb-4 md:hidden">
             <button onClick={onOpenMobileMode} className="text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                 <Smartphone size={16} /> Companion App
             </button>
        </div>
        <p className="mb-2">&copy; 2024 Aether Studio. All rights reserved.</p>
        <p className="text-xs font-mono opacity-50 uppercase tracking-widest">Engineered by Tiwaton Technologies</p>
      </footer>

      {/* Auth Modal */}
      {authMode && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
           <div className="bg-[#0f0518] border border-white/10 rounded-2xl w-[400px] p-8 shadow-2xl relative">
              <button onClick={closeAuthModal} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X size={20} /></button>
              
              <div className="mb-6 text-center">
                 <div className="w-12 h-12 bg-gradient-to-br from-aether-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-lg mx-auto mb-4">
                    {authMode === 'waitlist' || authMode === 'forgot' ? <Lock className="text-white" /> : <Zap className="text-white fill-current" />}
                 </div>
                 <h2 className="text-2xl font-bold">{getModalTitle()}</h2>
              </div>

              {!resetSent ? (
                <form onSubmit={handleAuthSubmit} className="space-y-4">
                    {authError && (
                        <div className="flex flex-col gap-2">
                          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded flex items-start gap-2">
                              <AlertCircle size={14} className="mt-0.5 shrink-0" /> 
                              <span>{authError}</span>
                          </div>
                          {onDevBypass && (
                            <button 
                                type="button"
                                onClick={handleDevBypass}
                                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs py-2 rounded border border-gray-700 flex items-center justify-center gap-2"
                            >
                                <Terminal size={12} /> Dev: Skip Auth
                            </button>
                          )}
                        </div>
                    )}
                    
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email Address</label>
                        <input 
                            type="email" 
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-fuchsia-500 outline-none"
                        />
                    </div>
                    
                    {authMode !== 'waitlist' && authMode !== 'forgot' && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
                            <input 
                                type="password" 
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-fuchsia-500 outline-none"
                            />
                        </div>
                    )}

                    <button disabled={isAuthLoading} className="w-full bg-gradient-to-r from-aether-600 to-fuchsia-600 text-white font-bold py-3 rounded-lg hover:brightness-110 transition-all flex items-center justify-center gap-2">
                        {isAuthLoading && <Loader2 className="animate-spin" size={16} />}
                        {authMode === 'signin' ? 'Sign In' : authMode === 'signup' ? 'Create Account' : authMode === 'forgot' ? 'Send Reset Link' : 'Join List'}
                    </button>
                </form>
              ) : (
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
                        <CheckCircle size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Check your email</h3>
                </div>
              )}
           </div>
        </div>
      )}

    </div>
  );
};