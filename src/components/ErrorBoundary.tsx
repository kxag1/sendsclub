import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected rendering error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SendsClub UI ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070709] text-zinc-100 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-[#111216] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="font-display font-bold text-lg text-white">SendsClub Display Recovery</h1>
                <p className="text-xs text-zinc-400">A rendering error interrupted this view.</p>
              </div>
            </div>
            <p className="text-xs font-mono text-zinc-300 bg-[#070709] border border-white/[0.08] rounded-xl p-3 break-words">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#C8FF00] text-black font-semibold text-sm inline-flex items-center justify-center gap-2"
            >
              <RotateCw className="w-4 h-4" />
              <span>Reload SendsClub</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
