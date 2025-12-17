import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  // Explicitly declare props to satisfy TypeScript checks
  declare props: Props;

  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0f0518] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-aether-900 border border-red-500/30 rounded-2xl p-8 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="text-red-500" size={32} />
            </div>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-gray-400 text-sm mb-6">
              The studio encountered an unexpected error.
            </p>
            <div className="bg-black/30 p-4 rounded-lg mb-6 text-left overflow-auto max-h-32">
                <code className="text-xs text-red-300 font-mono break-all">
                    {this.state.error?.message || "Unknown error"}
                </code>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="bg-aether-600 hover:bg-aether-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 w-full transition-colors"
            >
              <RefreshCw size={18} /> Reload Studio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}