import React, { useState } from 'react';
import { Plus, Trash2, X, Loader2 } from 'lucide-react';
import { AdminService } from '../../../services/admin';
import { useToast } from '../../../contexts/ToastContext';
import { Logger } from '../../../utils/logger';

interface SubtestDraft {
  key: string;          // local unique key for React
  name: string;
  abbreviation: string;
  score_type: string;
}

interface Props {
  onClose: () => void;
  /** Called after creation — reload the catalogue so the new test is selectable right away. */
  onCreated?: () => void;
}

/** Custom tests are filed under the "Autre" category (official_categories.id). */
const CUSTOM_TEST_CATEGORY_ID = 'autre';
/** Unknown scale by default: a wrong parametric scale would produce wrong z-scores. */
const DEFAULT_SCORE_TYPE = 'none';

const SCORE_TYPES = [
  { value: 'none',       label: 'Sans score standardisé', tooltip: 'Score brut uniquement (temps, nombre, erreurs…). Choisir si incertain.' },
  { value: 'standard',   label: 'Note Standard',          tooltip: 'Quotient intellectuel ou équivalent — moy. 100, σ=15. Ex : WISC-V, MABC-2 DQ.' },
  { value: 'scaled',     label: 'Note Scalée',            tooltip: 'Par sous-test — moy. 10, σ=3. Ex : NEPSY-2, TEA-Ch, WISC-V Index.' },
  { value: 't-score',    label: 'Score T',                tooltip: 'Moyenne 50, σ=10. Ex : BRIEF-2, Vineland-3, Profil Sensoriel.' },
  { value: 'percentile', label: 'Percentile',             tooltip: 'Rang centile de 1 à 99. Ex : M-ABC norme britannique.' },
  { value: 'sten',       label: 'Sten',                   tooltip: 'Échelle 1–10, moy. 5,5. Peu fréquent.' },
  { value: 'stanine',    label: 'Stanine',                tooltip: 'Échelle 1–9, moy. 5. Peu fréquent.' },
];

const makeKey = () => Math.random().toString(36).slice(2);

export const CustomTestEditor: React.FC<Props> = ({ onClose, onCreated }) => {
  const toast = useToast();

  const [testName, setTestName] = useState('');
  const [testAbbr, setTestAbbr] = useState('');
  const [subtests, setSubtests] = useState<SubtestDraft[]>([
    { key: makeKey(), name: '', abbreviation: '', score_type: DEFAULT_SCORE_TYPE },
  ]);
  const [loading, setLoading] = useState(false);

  const addSubtest = () =>
    setSubtests(prev => [...prev, { key: makeKey(), name: '', abbreviation: '', score_type: DEFAULT_SCORE_TYPE }]);

  const removeSubtest = (key: string) =>
    setSubtests(prev => prev.filter(s => s.key !== key));

  const updateSubtest = (key: string, patch: Partial<Omit<SubtestDraft, 'key'>>) =>
    setSubtests(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s));

  const canSubmit =
    testName.trim().length > 0 &&
    subtests.length > 0 &&
    subtests.every(s => s.name.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await AdminService.saveCustomTest({
        test: {
          name: testName.trim(),
          abbreviation: testAbbr.trim() || undefined,
          category_id: CUSTOM_TEST_CATEGORY_ID,
        },
        subtests: subtests.map((s, i) => ({
          name: s.name.trim(),
          abbreviation: s.abbreviation.trim() || undefined,
          score_type: s.score_type,
          order_index: i,
        })),
      });
      toast.success(`Test « ${testName.trim()} » créé avec succès !`);
      onCreated?.();
      onClose();
    } catch (e) {
      Logger.error('DB', 'Custom test creation failed', e, { subtestCount: subtests.length });
      toast.error('Impossible de créer le test. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-[var(--card-bg)] border border-[var(--border-color)] shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--border-color)]">
          <h2 className="font-bold text-lg text-[var(--text-heading)]">Créer un test personnalisé</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Test identity */}
          <div className="space-y-3">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Nom du test *</span>
              <input
                value={testName}
                onChange={e => setTestName(e.target.value)}
                placeholder="ex : Batterie maison de coordination"
                className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] transition-colors"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Abréviation</span>
              <input
                value={testAbbr}
                onChange={e => setTestAbbr(e.target.value)}
                placeholder="ex : BMC"
                maxLength={12}
                className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] transition-colors"
              />
            </label>
          </div>

          {/* Subtests */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Sous-tests *
              </span>
              <button
                type="button"
                onClick={addSubtest}
                className="flex items-center gap-1 text-xs font-bold text-[var(--primary)] hover:underline"
              >
                <Plus size={13} /> Ajouter
              </button>
            </div>

            <div className="space-y-2">
              {subtests.map((st, idx) => (
                <div key={st.key} className="flex items-center gap-2 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--hover-bg)]">
                  <span className="text-[10px] font-bold text-[var(--text-secondary)] w-5 shrink-0">{idx + 1}.</span>
                  <input
                    value={st.name}
                    onChange={e => updateSubtest(st.key, { name: e.target.value })}
                    placeholder="Nom de l'épreuve *"
                    className="flex-1 min-w-0 text-sm bg-transparent outline-none text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] border-b border-transparent focus:border-[var(--primary)] transition-colors py-0.5"
                  />
                  <select
                    value={st.score_type}
                    onChange={e => updateSubtest(st.key, { score_type: e.target.value })}
                    className="shrink-0 text-xs bg-[var(--input-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-[var(--text-heading)] outline-none focus:border-[var(--primary)]"
                  >
                    {SCORE_TYPES.map(t => (
                      <option key={t.value} value={t.value} title={t.tooltip}>{t.label}</option>
                    ))}
                  </select>
                  {subtests.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubtest(st.key)}
                      className="shrink-0 p-1 rounded text-rose-400 hover:text-rose-600 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-[var(--text-secondary)]">
            Ce test sera visible uniquement dans votre organisation. Vous pourrez l'utiliser immédiatement dans vos bilans.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-color)]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)]">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Création…' : 'Créer le test'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomTestEditor;
