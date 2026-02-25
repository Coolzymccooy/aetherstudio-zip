import React, { useState, useEffect, useMemo } from 'react';
import { MobileStudio } from './components/Mobile/MobileStudio';
import { LandingPage } from './components/Landing/LandingPage';
import { StudioCore } from './components/Studio/StudioCore';
import { LoginPage } from './components/Auth/LoginPage';
import { auth, hasFirebaseConfig } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Loader2, AlertCircle } from 'lucide-react';

export default function App() {
  const isDesktopRuntime = useMemo(() => typeof window !== 'undefined' && !!(window as any).aetherDesktop, []);

  // Initialize view based on environment: Desktop goes straight to Studio/Login. Web goes to Landing.
  const [view, setView] = useState<'landing' | 'studio' | 'mobile'>(() => {
    if (isDesktopRuntime) return 'studio';
    return 'landing';
  });

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [rehydrated, setRehydrated] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (!body) return;

    // Performance: Only modify classes if they actually need to change
    const isStudioLike = view !== 'landing';
    if (isStudioLike) {
      body.classList.add('overflow-hidden', 'overscroll-none');
      body.classList.remove('overflow-x-hidden');
    } else {
      body.classList.remove('overflow-hidden', 'overscroll-none');
      body.classList.add('overflow-x-hidden');
    }
  }, [view]);

  // 1. Handle URL Parameters & Deep Linking immediately
  useEffect(() => {
    const handleDeepLinks = () => {
      const search = window.location.search;
      if (!search) {
        setRehydrated(true);
        return;
      }

      const params = new URLSearchParams(search);
      const isCompanion = params.get('mode') === 'companion';
      const isAudience = params.get('mode') === 'audience';
      const roomId = params.get('room');
      const signalUrl = params.get('signal');

      if (isCompanion || isAudience) {
        if (roomId) localStorage.setItem('aether_target_room', roomId);
        if (signalUrl) localStorage.setItem('aether_signal_url', signalUrl);
        localStorage.setItem('aether_mode', isAudience ? 'audience' : 'companion');
        localStorage.setItem('aether_last_view', 'mobile');
        setView('mobile');
      }
      setRehydrated(true);
    };

    handleDeepLinks();
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      setLoading(false);
      return;
    }

    // Performance: One listener for the entire app lifecycle
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (currentUser) {
        const savedMode = localStorage.getItem('aether_mode');
        if (savedMode === 'companion' || savedMode === 'audience') {
          setView('mobile');
        } else {
          // If we were on landing, move to studio after login
          if (view === 'landing') {
            setView('studio');
            localStorage.setItem('aether_last_view', 'studio');
          }
        }
      }
    });

    return () => unsubscribe();
  }, [view]); // Dependencies kept minimal

  if (loading || !rehydrated) {
    return (
      <div className="min-h-screen bg-[#0f0518] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-aether-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <Loader2 className="animate-spin text-white" />
          </div>
          <p className="text-xs text-gray-400 font-mono tracking-widest uppercase">Initializing Core...</p>
        </div>
      </div>
    );
  }

  // Handle Missing Config
  if (!hasFirebaseConfig && !isDesktopRuntime) {
    return (
      <div className="min-h-screen bg-[#0f0518] text-white flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-red-500/5 border border-red-500/20 rounded-3xl p-8 shadow-2xl">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Missing Configuration</h1>
          <p className="text-gray-400 text-sm mb-6">Firebase environment variables are required for web deployments.</p>
        </div>
      </div>
    );
  }

  // View Routing
  if (view === 'mobile') {
    return <MobileStudio user={user} />;
  }

  if (view === 'studio') {
    // If on desktop AND no user, show the minimal LoginPage instead of LandingPage
    if (!user) {
      if (isDesktopRuntime) {
        return <LoginPage user={user} onEnterStudio={() => setView('studio')} />;
      }
      // Redirect web users back to landing if they somehow hit 'studio' view without auth
      setView('landing');
      return null;
    }

    return (
      <StudioCore
        user={user}
        onBack={() => {
          auth.signOut(); // Proper sign out
          setView('landing');
          localStorage.removeItem('aether_last_view');
        }}
      />
    );
  }

  // Web Landing Page
  return (
    <LandingPage
      user={user}
      onEnterStudio={() => setView('studio')}
      onOpenMobileMode={() => setView('mobile')}
    />
  );
}
