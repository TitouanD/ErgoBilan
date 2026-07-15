import React, { useState, useCallback } from 'react';
import type { ReportSection, Patient } from '../../types';
import { Check, Edit2, Download, FileCheck, CheckCheck } from 'lucide-react';
import { StepNavFooter } from './shared/StepNavFooter';
import { sanitizeReportText, decodeResidualEntities } from '../../utils/textSanitizer';
import { ConfirmModal } from '../shared/ConfirmModal';
import { TipTapEditor } from './TipTapEditor';

interface Props {
  sections: ReportSection[];
  patient: Patient;
  onValidateSection: (id: string, newContent?: string, contentFormat?: 'html' | 'markdown') => void;
  onNext: () => void;
  onBack: () => void;
}

/** Convert markdown string → HTML for TipTap (used when content hasn't been edited in TipTap yet) */
const markdownToHtml = (md: string): string => {
    const safe = sanitizeReportText(md);
    if (!safe) return '';
    const paras = safe.split('\n').filter(l => l.trim());
    return paras.map(p => {
        if (p.startsWith('## ')) return `<h2>${p.slice(3).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</h2>`;
        if (p.startsWith('### ')) return `<h3>${p.slice(4).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</h3>`;
        if (/^[*-]\s/.test(p)) return `<li>${p.replace(/^[*-]\s+/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`;
        return `<p>${p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`;
    }).join('');
};

const SectionCard: React.FC<{
    section: ReportSection;
    onValidate: (id: string, content?: string, contentFormat?: 'html' | 'markdown') => void;
    onDirtyChange?: (sectionId: string, isDirty: boolean) => void;
}> = ({ section, onValidate, onDirtyChange }) => {
    const [isEditing, setIsEditing] = useState(false);
    // Local HTML state for the TipTap editor — initialized from section content (markdown or html)
    const [editHtml, setEditHtml] = useState('');
    const initialHtml = section.contentFormat === 'html'
        ? decodeResidualEntities(section.content)
        : markdownToHtml(section.content);

    const handleStartEdit = () => {
        setEditHtml(section.contentFormat === 'html'
            ? decodeResidualEntities(section.content)
            : markdownToHtml(section.content));
        setIsEditing(true);
        onDirtyChange?.(section.id, true);
    };

    const handleSave = () => {
        onValidate(section.id, editHtml, 'html');
        setIsEditing(false);
        onDirtyChange?.(section.id, false);
    };

    const handleCancel = () => {
        setIsEditing(false);
        onDirtyChange?.(section.id, false);
    };

    const isValidated = section.status === 'validated';

    return (
        <div className={`group rounded-2xl border transition-all duration-300 p-8 mb-6 ${isValidated ? 'bg-[var(--card-bg)] border-emerald-200 shadow-sm' : 'bg-[var(--card-bg)] border-[var(--border-color)] shadow-lg shadow-rose-100/50 dark:shadow-black/20'}`}>
            {/* Header */}
            <div className="flex justify-between items-center mb-6 border-b-2 border-[var(--border-color)] pb-2">
                <h3 className="text-lg font-bold text-[var(--text-heading)] uppercase tracking-wide">
                    {section.title}
                </h3>
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
                    <TipTapEditor
                        content={editHtml}
                        onChange={setEditHtml}
                        isPerformance={true}
                    />
                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={handleCancel} className="px-5 py-2 text-[var(--text-secondary)] font-bold text-xs uppercase tracking-wider hover:text-[var(--text-heading)] transition-colors">Annuler</button>
                        <button onClick={handleSave} className="px-6 py-3 bg-stone-900 dark:bg-[var(--card-bg-raised)] text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors shadow-md flex items-center gap-2">
                            <Check size={16} /> Enregistrer
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="prose prose-sm prose-stone dark:prose-invert max-w-none">
                        <TipTapEditor
                            content={initialHtml}
                            onChange={() => {}}
                            readOnly
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-6 border-t border-[var(--border-color)]">
                        <button
                            onClick={handleStartEdit}
                            className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-heading)] px-4 py-2 rounded-lg hover:bg-[var(--hover-bg)] transition-all font-bold text-xs uppercase tracking-wider"
                        >
                            <Edit2 size={14} /> Modifier
                        </button>
                        {!isValidated && (
                            <button
                                onClick={() => onValidate(section.id, editHtml || undefined, editHtml ? 'html' : undefined)}
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

export const Step4Validation: React.FC<Props> = ({ sections, patient, onValidateSection, onNext, onBack }) => {
    const displayedSections = sections.filter((section) => section.id !== 'objectifs');
    const validatedCount = displayedSections.filter(s => s.status === 'validated').length;
    const allValidated = validatedCount === displayedSections.length && displayedSections.length > 0;
    const pendingCount = displayedSections.length - validatedCount;
    const [dirtySections, setDirtySections] = useState<Set<string>>(new Set());
    const [showDirtyWarning, setShowDirtyWarning] = useState<'back' | 'next' | null>(null);
    const [showValidateAllConfirm, setShowValidateAllConfirm] = useState(false);
    const [showUnvalidatedWarning, setShowUnvalidatedWarning] = useState(false);

    const handleDirtyChange = useCallback((sectionId: string, isDirty: boolean) => {
        setDirtySections(prev => {
            const next = new Set(prev);
            if (isDirty) next.add(sectionId);
            else next.delete(sectionId);
            return next;
        });
    }, []);

    const handleNavigate = useCallback((direction: 'back' | 'next') => {
        if (dirtySections.size > 0) {
            setShowDirtyWarning(direction);
            return;
        }
        // C2: warn if advancing with unvalidated sections
        if (direction === 'next' && pendingCount > 0) {
            setShowUnvalidatedWarning(true);
            return;
        }
        if (direction === 'back') onBack();
        else onNext();
    }, [dirtySections, pendingCount, onBack, onNext]);

    const confirmDirtyNavigation = useCallback(() => {
        const direction = showDirtyWarning;
        setShowDirtyWarning(null);
        if (direction === 'back') onBack();
        else onNext();
    }, [showDirtyWarning, onBack, onNext]);

  const confirmValidateAll = () => {
        displayedSections.forEach(s => {
      if (s.status !== 'validated') {
        onValidateSection(s.id, s.content, s.contentFormat as any);
      }
    });
    setShowValidateAllConfirm(false);
  };

  return (
        <div className="max-w-4xl mx-auto pb-10 animate-in fade-in duration-500">
      
            <div className="mb-8 border-b border-[var(--border-color)] pb-6 flex justify-between items-end gap-4 relative z-10">
        <div className="space-y-1">
                        <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Relecture</h2>
                        <p className="text-[var(--text-secondary)] font-medium mt-2">Vérifiez et ajustez le contenu généré par l'IA.</p>
        </div>
        <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              allValidated
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40'
                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-700/40'
            }`}>
                            {validatedCount}/{displayedSections.length} validé(s)
            </div>
                        {pendingCount > 0 && displayedSections.length > 0 && (
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
            <div className="text-center py-20 text-stone-400 dark:text-[var(--text-disabled)] italic">
                Génération en attente...
            </div>
        ) : (
            displayedSections.map(section => (
                <SectionCard key={section.id} section={section} onValidate={onValidateSection} onDirtyChange={handleDirtyChange} />
            ))
        )}
      </div>

      <StepNavFooter onBack={() => handleNavigate('back')}>
          <button 
              onClick={() => handleNavigate('next')}
              disabled={displayedSections.length === 0}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all disabled:opacity-40 disabled:grayscale bg-[#3D405B] hover:bg-[#E07A5F]"
          >
              <Download size={18} />
              <span className="uppercase tracking-wider">Visualiser le document</span>
          </button>
      </StepNavFooter>

      {/* Unsaved changes warning (A2) */}
      <ConfirmModal
          isOpen={!!showDirtyWarning}
          title="Modifications non enregistrées"
          message={`${dirtySections.size} section(s) en cours d'édition. Les modifications non enregistrées seront perdues.\n\nContinuer ?`}
          confirmLabel="Continuer sans sauvegarder"
          cancelLabel="Rester"
          variant="warning"
          onConfirm={confirmDirtyNavigation}
          onCancel={() => setShowDirtyWarning(null)}
      />

      {/* Validate-all confirmation (C1) */}
      <ConfirmModal
          isOpen={showValidateAllConfirm}
          title="Tout valider d'un coup ?"
          message={`${pendingCount} section(s) seront validées sans relecture individuelle. Vous pourrez toujours les modifier ensuite.`}
          confirmLabel={`Valider ${pendingCount} section(s)`}
          cancelLabel="Annuler"
          variant="info"
          onConfirm={confirmValidateAll}
          onCancel={() => setShowValidateAllConfirm(false)}
      />

      {/* Unvalidated sections warning (C2) */}
      <ConfirmModal
          isOpen={showUnvalidatedWarning}
          title="Sections non validées"
          message={`${pendingCount} section(s) n'ont pas été validées. Vous pouvez continuer, mais pensez à relire le contenu généré par l'IA.`}
          confirmLabel="Continuer quand même"
          cancelLabel="Rester"
          variant="warning"
          onConfirm={() => { setShowUnvalidatedWarning(false); onNext(); }}
          onCancel={() => setShowUnvalidatedWarning(false)}
      />
    </div>
  );
};
