import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';

interface Props {
  error: string;
  onRetry: () => void;
  onClose: () => void;
}

export const CriticalErrorModal: React.FC<Props> = ({ error, onRetry, onClose }) => (
  <Modal
    isOpen
    onClose={onClose}
    closeOnBackdrop={false}
    closeOnEscape={false}
    overlayClassName="bg-[var(--secondary)]/90 backdrop-blur-md"
    panelClassName="bg-[var(--card-bg)] max-w-md w-full rounded-[32px] p-8 shadow-2xl text-center"
    panelAnimationClassName=""
  >
    <div className="absolute top-0 left-0 w-full h-2 bg-rose-500" />
    <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6 text-rose-500 animate-pulse">
      <AlertTriangle size={40} />
    </div>
    <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Interruption IA</h3>
    <p className="text-[var(--text-secondary)] text-sm mb-6 leading-relaxed">
      Le moteur IA n&apos;a pas pu terminer.<br />
      <span className="font-bold text-rose-500 mt-2 block">{error}</span>
    </p>
    <div className="flex gap-3">
      <button onClick={onClose} className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-sm uppercase tracking-wider">
        Abandonner
      </button>
      <button
        onClick={onRetry}
        className="flex-1 py-4 bg-[var(--secondary)] text-white rounded-xl font-bold shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-2"
      >
        <RefreshCw size={18} /> Réessayer
      </button>
    </div>
  </Modal>
);

