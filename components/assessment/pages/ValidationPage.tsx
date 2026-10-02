/**
 * ValidationPage — "Relecture": the practitioner reviews, edits (TipTap) and
 * validates each generated section before the export step.
 */

import React, { useCallback, useState } from 'react';
import { Check, CheckCheck, Download, Edit2, FileCheck } from 'lucide-react';
import type { ReportSection } from '../../../types';
import { ConfirmModal } from '../../shared/ConfirmModal';
import { TipTapEditor } from '../shared/TipTapEditor';
import { sectionToHtml } from '../../../utils/reportContent';
import { isReportSectionVisible } from '../../../utils/reportData';

interface Props {
  sections: ReportSection[];
  /** Validate a section, optionally with edited HTML content. */
  onValidateSection: (id: string, html?: string) => void;
  onNext: () => void;
  onBack: () => void;
}

const SectionCard: React.FC<{
  section: ReportSection;
  onValidate: (id: string, html?: string) => void;
  onDirtyChange: (sectionId: string, isDirty: boolean) => void;
}> = ({ section, onValidate, onDirtyChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editHtml, setEditHtml] = useState('');
  const html = sectionToHtml(section);
  const isValidated = section.status === 'validated';

  const startEdit = () => {
    setEditHtml(html);
    setIsEditing(true);
    onDirtyChange(section.id, true);
  };
  const stopEdit = () => {
    setIsEditing(false);
    onDirtyChange(section.id, false);
  };

  return (
    <div
      className={`group rounded-2xl border transition-all duration-300 p-8 mb-6 ${isValidated ? 'bg-[var(--card-bg)] border-emerald-200 shadow-sm' : 'bg-[var(--card-bg)] border-[var(--border-color)] shadow-lg shadow-rose-100/50 dark:shadow-black/20'}`}
    >
      <div className="flex justify-between items-center mb-6 border-b-2 border-[var(--border-color)] pb-2">
        <h3 className="text-lg font-bold text-[var(--text-heading)] uppercase tracking-wide">{section.title}</h3>
        {isValidated ? (
          <div className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Check size={14} /> Validé
          </div>
        ) : (
          <div className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 rounded-full text-xs font-bold uppercase tracking-wider">
            À relire
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-4">
          <TipTapEditor content={editHtml} onChange={setEditHtml} isPerformance />
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={stopEdit}
              className="px-5 py-2 text-[var(--text-secondary)] font-bold text-xs uppercase tracking-wider hover:text-[var(--text-heading)] transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={() => {
                onValidate(section.id, editHtml);
                stopEdit();
              }}
              className="px-6 py-3 bg-stone-900 dark:bg-[var(--card-bg-raised)] text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors shadow-md flex items-center gap-2"
            >
              <Check size={16} /> Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="prose prose-sm prose-stone dark:prose-invert max-w-none">
            <TipTapEditor content={html} onChange={() => {}} readOnly />
          </div>
          <div className="flex justify-end gap-3 pt-6 border-t border-[var(--border-color)]">
            <button
              onClick={startEdit}
              className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-heading)] px-4 py-2 rounded-lg hover:bg-[var(--hover-bg)] transition-all font-bold text-xs uppercase tracking-wider"
            >
              <Edit2 size={14} /> Modifier
            </button>
            {!isValidated && (
              <button
                onClick={() => onValidate(section.id)}
                className="flex items-center gap-2 bg-stone-900 dark:bg-emerald-700 text-white px-6 py-2.5 rounded-lg hover:bg-emerald-600 transition-all font-bold text-xs uppercase tracking-wider shadow-md"
              >
                <Check size={16} /> Valider
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const ValidationPage: React.FC<Props> = ({ sections, onValidateSection, onNext, onBack }) => {
  const displayedSections = sections.filter(isReportSectionVisible);
  const validatedCount = displayedSections.filter((s) => s.status === 'validated').length;
  const pendingCount = displayedSections.length - validatedCount;
  const allValidated = pendingCount === 0 && displayedSections.length > 0;
  const [dirtySections, setDirtySections] = useState<Set<string>>(new Set());
  const [dirtyWarning, setDirtyWarning] = useState<'back' | 'next' | null>(null);
  const [showValidateAllConfirm, setShowValidateAllConfirm] = useState(false);
  const [showUnvalidatedWarning, setShowUnvalidatedWarning] = useState(false);

  const handleDirtyChange = useCallback((sectionId: string, isDirty: boolean) => {
    setDirtySections((prev) => {
      const next = new Set(prev);
      if (isDirty) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);

  const navigate = (direction: 'back' | 'next') => (direction === 'back' ? onBack() : onNext());

  const handleNavigate = (direction: 'back' | 'next') => {
    if (dirtySections.size > 0) return setDirtyWarning(direction);
    if (direction === 'next' && pendingCount > 0) return setShowUnvalidatedWarning(true);
    navigate(direction);
  };

  return (
    <div className="max-w-4xl mx-auto pb-10 animate-in fade-in duration-500">
      <div className="mb-8 border-b border-[var(--border-color)] pb-6 flex justify-between items-end gap-4 relative z-10">
        <div className="space-y-1">
          <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Relecture</h2>
          <p className="text-[var(--text-secondary)] font-medium mt-2">Vérifiez et ajustez le contenu avant la mise en page.</p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              allValidated
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40'
                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-700/40'
            }`}
          >
            {validatedCount}/{displayedSections.length} validé(s)
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => setShowValidateAllConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
            >
              <CheckCheck size={14} />
              Tout valider
            </button>
          )}
          <FileCheck size={24} className={allValidated ? 'text-emerald-500' : 'text-stone-300'} />
        </div>
      </div>

      <div className="space-y-4">
        {displayedSections.length === 0 ? (
          <div className="text-center py-20 text-stone-400 dark:text-[var(--text-disabled)] italic">Aucune section à relire.</div>
        ) : (
          displayedSections.map((section) => (
            <SectionCard key={section.id} section={section} onValidate={onValidateSection} onDirtyChange={handleDirtyChange} />
          ))
        )}
      </div>

      <div className="mt-10 flex items-center justify-between gap-4">
        <button
          onClick={() => handleNavigate('back')}
          className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] font-bold text-sm uppercase tracking-widest px-2 transition-colors"
        >
          Retour
        </button>
        <button
          onClick={() => handleNavigate('next')}
          disabled={displayedSections.length === 0}
          className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all disabled:opacity-40 disabled:grayscale bg-[#3D405B] hover:bg-[#E07A5F]"
        >
          <Download size={18} />
          <span className="uppercase tracking-wider">Visualiser le document</span>
        </button>
      </div>

      <ConfirmModal
        isOpen={!!dirtyWarning}
        title="Modifications non enregistrées"
        message={`${dirtySections.size} section(s) en cours d'édition. Les modifications non enregistrées seront perdues.\n\nContinuer ?`}
        confirmLabel="Continuer sans sauvegarder"
        cancelLabel="Rester"
        variant="warning"
        onConfirm={() => {
          const direction = dirtyWarning;
          setDirtyWarning(null);
          if (direction) navigate(direction);
        }}
        onCancel={() => setDirtyWarning(null)}
      />
      <ConfirmModal
        isOpen={showValidateAllConfirm}
        title="Tout valider d'un coup ?"
        message={`${pendingCount} section(s) seront validées sans relecture individuelle. Vous pourrez toujours les modifier ensuite.`}
        confirmLabel={`Valider ${pendingCount} section(s)`}
        cancelLabel="Annuler"
        variant="info"
        onConfirm={() => {
          displayedSections.filter((s) => s.status !== 'validated').forEach((s) => onValidateSection(s.id));
          setShowValidateAllConfirm(false);
        }}
        onCancel={() => setShowValidateAllConfirm(false)}
      />
      <ConfirmModal
        isOpen={showUnvalidatedWarning}
        title="Sections non validées"
        message={`${pendingCount} section(s) n'ont pas été validées. Vous pouvez continuer, mais pensez à relire le contenu généré par l'IA.`}
        confirmLabel="Continuer quand même"
        cancelLabel="Rester"
        variant="warning"
        onConfirm={() => {
          setShowUnvalidatedWarning(false);
          onNext();
        }}
        onCancel={() => setShowUnvalidatedWarning(false)}
      />
    </div>
  );
};
