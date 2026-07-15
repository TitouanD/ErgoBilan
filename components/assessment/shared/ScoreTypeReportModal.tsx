import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { SubtestDef } from '../../../data/testCatalog';
import { useToast } from '../../../contexts/ToastContext';

// ─── ScoreTypeReportModal: practitioner flags a wrong score_type ─────────────
export const ScoreTypeReportModal: React.FC<{
  subtest: SubtestDef | null;
  enteredNS?: number | null;
  enteredET?: number | null;
  enteredPct?: number | null;
  onClose: () => void;
}> = ({ subtest, enteredNS, enteredET, enteredPct, onClose }) => {
  const toast = useToast();
  const [suggestedType, setSuggestedType] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  if (!subtest) return null;

  const SCORE_TYPES = ['scaled', 'standard', 't-score', 'sten', 'stanine', 'percentile', 'none'];

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { AdminService } = await import('../../../services/admin');
      await AdminService.submitScoreTypeReport({
        subtest_id: subtest.id,
        current_score_type: String(subtest.scoreType || 'standard'),
        suggested_score_type: suggestedType || undefined,
        entered_ns: enteredNS ?? null,
        entered_et: enteredET ?? null,
        entered_pct: enteredPct ?? null,
        note: note.trim() || undefined,
      });
      toast.success('Signalement envoyé. Merci !');
      onClose();
    } catch (e) {
      toast.error('Erreur lors de l\'envoi du signalement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--card-bg)] border border-[var(--border-color)] shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <h3 className="font-bold text-sm text-[var(--text-heading)]">Signaler un score type incorrect</h3>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          <span className="font-semibold text-[var(--text-main)]">{subtest.name}</span><br/>
          Type actuel : <code className="text-[10px] bg-[var(--hover-bg)] px-1 rounded">{String(subtest.scoreType || 'standard')}</code>
        </p>
        <div className="mb-3">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Type suggéré (optionnel)</label>
          <select
            value={suggestedType}
            onChange={e => setSuggestedType(e.target.value)}
            className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-heading)] outline-none focus:border-[var(--primary)]"
          >
            <option value="">— choisir —</option>
            {SCORE_TYPES.filter(t => t !== String(subtest.scoreType || 'standard')).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Note (optionnel)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Ex : le manuel donne une échelle en note T…"
            className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)]">Annuler</button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Envoi…' : 'Signaler'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScoreTypeReportModal;
