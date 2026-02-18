import React from 'react';
import { X, Rocket, ArrowRight } from 'lucide-react';

interface Props {
  action: string;
  onClose: () => void;
  onConvert: () => void;
}

export const DemoConversionModal: React.FC<Props> = ({ action, onClose, onConvert }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
    <div className="bg-[var(--card-bg)] max-w-md w-full rounded-[32px] p-8 shadow-2xl text-center relative">
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors">
        <X size={20} />
      </button>
      <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
        <Rocket size={40} />
      </div>
      <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Convaincu(e) ?</h3>
      <p className="text-[var(--text-secondary)] text-sm mb-6 leading-relaxed">
        La fonctionnalité <strong>{action}</strong> nécessite un compte sécurisé.
      </p>
      <div className="space-y-3">
        <button
          onClick={onConvert}
          className="w-full py-4 bg-[#E07A5F] text-white rounded-xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center justify-center gap-2"
        >
          Créer mon compte gratuit <ArrowRight size={18} />
        </button>
        <button onClick={onClose} className="w-full py-3 text-[var(--text-secondary)] font-bold hover:text-[var(--text-main)] transition-colors text-xs uppercase tracking-wider">
          Continuer à explorer
        </button>
      </div>
    </div>
  </div>
);
