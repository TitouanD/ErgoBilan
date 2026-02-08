import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Logger } from '../../utils/logger';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Logger.error('SYSTEM', 'Uncaught Error in Component Tree', { error, componentStack: errorInfo.componentStack });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    // Tentative de reset soft
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-[32px] shadow-2xl p-8 text-center border border-stone-100 relative overflow-hidden">
            {/* Décoration d'arrière-plan */}
            <div className="absolute top-0 left-0 w-full h-2 bg-rose-500"></div>
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-rose-50 rounded-full blur-3xl"></div>
            
            <div className="relative z-10">
                <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6 text-rose-500 shadow-sm">
                    <AlertTriangle size={40} strokeWidth={2} />
                </div>
                
                <h1 className="font-serif text-2xl font-bold text-[#3D405B] mb-2">
                    Une erreur est survenue
                </h1>
                
                <p className="text-stone-500 text-sm mb-6 leading-relaxed">
                    L'application a rencontré un problème inattendu. Nous avons sécurisé les données locales par précaution.
                </p>

                {this.state.error && (
                    <div className="bg-stone-50 p-3 rounded-xl border border-stone-200 text-xs font-mono text-stone-600 mb-8 text-left overflow-auto max-h-32">
                        {this.state.error.toString()}
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    <button 
                        onClick={this.handleReload}
                        className="w-full py-4 bg-[#3D405B] text-white rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-2"
                    >
                        <RefreshCw size={18} /> Recharger l'application
                    </button>
                    
                    <button 
                        onClick={this.handleGoHome}
                        className="w-full py-3 text-stone-400 font-bold hover:text-[#3D405B] transition-colors flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
                    >
                        <Home size={16} /> Retour à l'accueil
                    </button>
                </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}