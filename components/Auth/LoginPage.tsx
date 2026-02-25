import React, { useState } from 'react';
import { Zap, Lock, X, AlertCircle, Loader2, CheckCircle, Globe } from 'lucide-react';
import { auth } from '../../services/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, User } from 'firebase/auth';

interface LoginPageProps {
    user: User | null;
    onEnterStudio: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ user, onEnterStudio }) => {
    const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isAuthLoading, setIsAuthLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [resetSent, setResetSent] = useState(false);

    const handleAuthSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError(null);
        setIsAuthLoading(true);

        try {
            if (authMode === 'signin') {
                await signInWithEmailAndPassword(auth!, email, password);
                onEnterStudio();
            } else if (authMode === 'signup') {
                await createUserWithEmailAndPassword(auth!, email, password);
                onEnterStudio();
            } else if (authMode === 'forgot') {
                await sendPasswordResetEmail(auth!, email);
                setResetSent(true);
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
            onEnterStudio();
        } catch (err: any) {
            console.error("Google Auth Error", err);
            setAuthError(err.message || "Failed to sign in with Google.");
        } finally {
            setIsAuthLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#05010a] text-white font-sans selection:bg-aether-500 selection:text-white flex items-center justify-center p-6 relative overflow-hidden">
            {/* Dynamic Background */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-aether-600/20 rounded-full blur-[120px] pointer-events-none animate-pulse" />
            <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-aether-accent/5 rounded-full blur-[120px] pointer-events-none" />

            <div className="max-w-md w-full relative z-10">
                <div className="text-center mb-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-aether-500 to-aether-accent rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(45,212,191,0.3)] mx-auto mb-6 transform hover:scale-105 transition-transform">
                        <Zap className="text-white fill-current" size={32} />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Aether<span className="font-light text-aether-accent">Studio</span></h1>
                    <p className="text-gray-400 text-sm">Professional AI Streaming, simplified.</p>
                </div>

                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
                    {!resetSent ? (
                        <div className="space-y-6">
                            <div className="text-center mb-2">
                                <h2 className="text-xl font-bold">
                                    {authMode === 'signin' ? 'Welcome Back' : authMode === 'signup' ? 'Get Started' : 'Reset Password'}
                                </h2>
                            </div>

                            {authError && (
                                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                    <span>{authError}</span>
                                </div>
                            )}

                            {/* Google Sign In */}
                            {(authMode === 'signin' || authMode === 'signup') && (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleGoogleSignIn}
                                        disabled={isAuthLoading}
                                        className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-100 transition-all flex items-center justify-center gap-3 shadow-lg active:scale-[0.98]"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
                                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                        </svg>
                                        Continue with Google
                                    </button>

                                    <div className="relative py-2">
                                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                                        <div className="relative flex justify-center text-[10px] uppercase tracking-widest"><span className="bg-[#0f0518] px-3 text-gray-500 font-bold">Or with email</span></div>
                                    </div>
                                </>
                            )}

                            <form onSubmit={handleAuthSubmit} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">Email Address</label>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="name@example.com"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3.5 text-white focus:border-aether-500/50 focus:bg-white/10 transition-all outline-none"
                                    />
                                </div>

                                {authMode !== 'forgot' && (
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center ml-1">
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Password</label>
                                            {authMode === 'signin' && (
                                                <button type="button" onClick={() => setAuthMode('forgot')} className="text-[10px] font-bold text-aether-accent hover:underline uppercase tracking-wider">Forgot?</button>
                                            )}
                                        </div>
                                        <input
                                            type="password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3.5 text-white focus:border-aether-500/50 focus:bg-white/10 transition-all outline-none"
                                        />
                                    </div>
                                )}

                                <button
                                    disabled={isAuthLoading}
                                    className="w-full bg-gradient-to-r from-aether-500 to-aether-accent text-white font-bold py-4 rounded-xl hover:brightness-110 transition-all flex items-center justify-center gap-2 shadow-lg shadow-aether-accent/20 active:scale-[0.98]"
                                >
                                    {isAuthLoading && <Loader2 className="animate-spin" size={18} />}
                                    <span className="tracking-wide">
                                        {authMode === 'signin' ? 'Sign In' : authMode === 'signup' ? 'Create Account' : 'Send Reset Link'}
                                    </span>
                                </button>

                                <div className="text-center pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                                        className="text-xs text-gray-400 hover:text-white transition-colors"
                                    >
                                        {authMode === 'signin' ? "Don't have an account? " : "Already have an account? "}
                                        <span className="text-aether-accent font-bold">{authMode === 'signin' ? 'Sign Up' : 'Sign In'}</span>
                                    </button>
                                </div>
                            </form>
                        </div>
                    ) : (
                        <div className="text-center py-4 animate-in fade-in zoom-in-95">
                            <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/20">
                                <CheckCircle size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Check your email</h3>
                            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
                                We've sent a password reset link to <br /><span className="text-white font-medium">{email}</span>
                            </p>
                            <button
                                onClick={() => { setResetSent(false); setAuthMode('signin'); }}
                                className="w-full py-3.5 border border-white/10 rounded-xl text-sm font-bold hover:bg-white/5 transition-all"
                            >
                                Back to Sign In
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="mt-8 flex items-center justify-center gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                    <a href="https://tiwaton.tech" target="_blank" rel="noopener noreferrer" className="hover:text-aether-accent transition-colors">Tiwaton Tech</a>
                    <span className="w-1 h-1 rounded-full bg-white/10" />
                    <div className="flex items-center gap-1.5">
                        <Globe size={10} />
                        <span>Secure Cloud Core</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
