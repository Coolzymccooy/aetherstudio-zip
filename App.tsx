import React, { useState, useEffect } from 'react';
import { MobileStudio } from './components/Mobile/MobileStudio';
import { LandingPage } from './components/Landing/LandingPage';
import { StudioCore } from './components/Studio/StudioCore';
import { auth, hasFirebaseConfig } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [view, setView] = useState<'landing' | 'studio' | 'mobile'>('landing');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [rehydrated, setRehydrated] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (!body) return;
    if (view === 'landing') {
      body.classList.remove('overflow-hidden');
      body.classList.remove('overscroll-none');
      body.classList.add('overflow-x-hidden');
    } else {
      body.classList.add('overflow-hidden');
      body.classList.add('overscroll-none');
      body.classList.remove('overflow-x-hidden');
    }
  }, [view]);

  // 1. Handle URL Parameters & Deep Linking immediately
  useEffect(() => {
    const handleDeepLinks = () => {
      const href = window.location.href;
      const search = window.location.search;
      const params = new URLSearchParams(search);
      
      const isCompanion = href.includes('mode=companion') || params.get('mode') === 'companion';
      const roomId = params.get('room');
      const signalUrl = params.get('signal');

      if (isCompanion) {
        // SAVE INTENT: Even if we redirect to login, remember the user wants to be in this room.
        if (roomId) localStorage.setItem('aether_target_room', roomId);
        if (signalUrl) localStorage.setItem('aether_signal_url', signalUrl);
        localStorage.setItem('aether_mode', 'companion');
        localStorage.setItem('aether_last_view', 'mobile');
        
        setView('mobile');
      }
    };

    handleDeepLinks();
    setRehydrated(true);
  }, []);

  // 2. Handle Authentication State
  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // If we already have a mock user, don't overwrite with null unless explicit logout
      if (!currentUser && user?.isAnonymous === false && user?.email === 'dev@local.test') {
          // Keep mock user
      } else {
          setUser(currentUser);
      }
      setLoading(false);

      // 3. Post-Login Redirection Logic
      if (currentUser) {
        const savedMode = localStorage.getItem('aether_mode');
        
        if (savedMode === 'companion') {
            setView('mobile');
            localStorage.setItem('aether_last_view', 'mobile');
        } else if (view === 'landing') {
            const last = localStorage.getItem('aether_last_view');
            if (last === 'studio') {
              setView('studio');
            }
        }
      } else {
        const last = localStorage.getItem('aether_last_view');
        const devBypass = localStorage.getItem('aether_dev_bypass') === 'true';
        if (rehydrated && last === 'studio' && devBypass) {
          handleDevBypass();
        }
      }
    });

    return () => unsubscribe();
  }, [rehydrated, view]);

  // Dev Bypass Handler
  const handleDevBypass = () => {
      const mockUser = {
          uid: 'dev-123',
          email: 'dev@local.test',
          displayName: 'Dev User',
          emailVerified: true,
          isAnonymous: false,
          metadata: {},
          providerData: [],
          refreshToken: '',
          tenantId: null,
          delete: async () => {},
          getIdToken: async () => 'mock-token',
          getIdTokenResult: async () => ({
              token: 'mock',
              signInProvider: 'custom',
              claims: {},
              authTime: Date.now(),
              issuedAtTime: Date.now(),
              expirationTime: Date.now() + 3600000,
          }),
          reload: async () => {},
          toJSON: () => ({}),
          phoneNumber: null,
          photoURL: null,
          providerId: 'custom'
      } as unknown as User;
      
      setUser(mockUser);
      setView('studio');
      localStorage.setItem('aether_last_view', 'studio');
      localStorage.setItem('aether_dev_bypass', 'true');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0518] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
           <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-aether-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
              <Loader2 className="animate-spin" />
           </div>
           <p className="text-sm text-gray-400 font-mono">Initializing Aether Secure Core...</p>
        </div>
      </div>
    );
  }

  if (!hasFirebaseConfig) {
    return (
      <div className="min-h-screen bg-[#0f0518] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-aether-900 border border-red-500/30 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="animate-spin text-red-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Missing Firebase Config</h1>
          <p className="text-gray-400 text-sm mb-6">
            The app needs Firebase environment variables in production.
          </p>
          <div className="bg-black/30 p-4 rounded-lg text-left text-xs text-gray-300 space-y-1 font-mono">
            <div>VITE_FIREBASE_API_KEY</div>
            <div>VITE_FIREBASE_AUTH_DOMAIN</div>
            <div>VITE_FIREBASE_PROJECT_ID</div>
            <div>VITE_FIREBASE_STORAGE_BUCKET</div>
            <div>VITE_FIREBASE_MESSAGING_SENDER_ID</div>
            <div>VITE_FIREBASE_APP_ID</div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'mobile') {
    return <MobileStudio user={user} />;
  }

  if (view === 'studio') {
    // Enforce Auth for Studio (optional, but good for analytics)
    if (!user) {
       // If somehow here without user, fallback to landing to sign in
       setView('landing');
       return null;
    }
    return <StudioCore user={user} onBack={() => { setUser(null); setView('landing'); localStorage.removeItem('aether_last_view'); }} />;
  }

  return (
    <LandingPage 
      user={user}
      onEnterStudio={() => { setView('studio'); localStorage.setItem('aether_last_view', 'studio'); }}
      onOpenMobileMode={() => { setView('mobile'); localStorage.setItem('aether_last_view', 'mobile'); }}
      onDevBypass={handleDevBypass}
    />
  );
}
