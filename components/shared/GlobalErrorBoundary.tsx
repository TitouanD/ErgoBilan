import React, { type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, MessageSquareText } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { isFeedbackAvailable } from '../../services/sentryService';
import { FeedbackModal } from './FeedbackModal';
import { isChunkLoadError, reloadForNewVersion } from '../../utils/newVersionReload';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showFeedback: boolean;
  /** A chunk of the previous build is missing after a deployment: the page is reloading (#124). */
  reloading: boolean;
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  declare props: Readonly<Props>;

  state: State = {
    hasError: false,
    error: null,
    showFeedback: false,
    reloading: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, reloading: isChunkLoadError(error) };
  }

  // Sentry capture happens once, in the React root `onCaughtError` hook (index.tsx), with the component stack.
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // New version deployed: reload once instead of showing the error screen (already reloaded a moment ago: show it).
    if (this.state.reloading && !reloadForNewVersion()) this.setState({ reloading: false });
    Logger.warn('SYSTEM', 'Uncaught error in component tree (error screen shown)', {
      message: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    // Tentative de reset soft
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError && this.state.reloading) {
      return (
        <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center gap-4 p-6 text-center">
          <RefreshCw size={32} className="animate-spin text-[var(--primary)]" />
          <p className="text-[var(--text-secondary)] text-sm font-bold">Nouvelle version de l'application, rechargement…</p>
        </div>
      );
    }
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[var(--card-bg)] rounded-[32px] shadow-2xl p-8 text-center border border-[var(--border-color)] relative overflow-hidden">
            {/* Décoration d'arrière-plan */}
            <div className="absolute top-0 left-0 w-full h-2 bg-rose-500"></div>
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-rose-50 rounded-full blur-3xl"></div>

            <div className="relative z-10">
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6 text-rose-500 shadow-sm">
                <AlertTriangle size={40} strokeWidth={2} />
              </div>

              <h1 className="font-serif text-2xl font-bold text-[var(--text-heading)] mb-2">Une erreur est survenue</h1>

              <p className="text-[var(--text-secondary)] text-sm mb-6 leading-relaxed">
                L'application a rencontré un problème inattendu. Nous avons sécurisé les données locales par précaution.
              </p>

              {this.state.error && (
                <div className="bg-[var(--card-bg-raised)] p-3 rounded-xl border border-[var(--border-color)] text-xs font-mono text-[var(--text-main)] mb-8 text-left overflow-auto max-h-32">
                  {this.state.error.toString()}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button
                  onClick={this.handleReload}
                  className="w-full py-4 bg-[var(--secondary)] text-white rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} /> Recharger l'application
                </button>

                <button
                  onClick={this.handleGoHome}
                  className="w-full py-3 text-[var(--text-secondary)] font-bold hover:text-[var(--text-main)] transition-colors flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
                >
                  <Home size={16} /> Retour à l'accueil
                </button>

                {isFeedbackAvailable() && (
                  <button
                    onClick={() => this.setState({ showFeedback: true })}
                    className="w-full py-2 text-[var(--text-secondary)] hover:text-[var(--text-main)] transition-colors flex items-center justify-center gap-2 text-sm font-semibold"
                  >
                    <MessageSquareText size={16} /> Décrire ce que je faisais
                  </button>
                )}
              </div>
              <FeedbackModal
                isOpen={this.state.showFeedback}
                onClose={() => this.setState({ showFeedback: false })}
                source="error_screen"
              />
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
