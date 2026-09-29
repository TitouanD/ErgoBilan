/**
 * ReportViewerOverlay — read-only, full-page view of a finalized assessment
 * (scores grouped by test + report sections), opened from the patient file.
 *
 * Section content is rendered through TipTap in read-only mode (schema-
 * sanitized) — never with dangerouslySetInnerHTML, since reports can contain
 * values typed by families in the portal.
 */

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { PatientAssessment } from '../../types';
import { useCatalog } from '../../contexts/CatalogContext';
import { getAssessmentTests } from '../../utils/assessment';
import { sectionToHtml } from '../../utils/reportContent';
import { isReportSectionVisible } from '../../utils/reportData';
import { resolveScores } from '../../utils/resolvedScore';
import { TipTapEditor } from '../assessment/shared/TipTapEditor';

interface Props {
  assessment: PatientAssessment;
  patientName: string;
  onClose: () => void;
}

export const ReportViewerOverlay: React.FC<Props> = ({ assessment, patientName, onClose }) => {
  const { index } = useCatalog();

  const scoreGroups = useMemo(
    () => resolveScores(getAssessmentTests(assessment, index), index).filter((test) => test.subtests.length > 0),
    [assessment, index],
  );

  const sections = (assessment.report?.sections ?? []).filter(isReportSectionVisible);

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto animate-in fade-in duration-200 bg-[var(--card-bg)]">
      <div className="sticky top-0 z-10 border-b border-[var(--border-color)] px-6 py-4 flex items-center justify-between shadow-sm bg-[var(--card-bg)]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            {assessment.kind === 'reevaluation' ? 'Réévaluation' : 'Bilan initial'} ·{' '}
            {new Date(assessment.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <h2 className="font-serif text-xl font-bold text-[var(--text-heading)] mt-0.5">
            {assessment.report?.patientName ?? patientName}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors"
        >
          <X size={14} /> Fermer
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        {scoreGroups.length > 0 && (
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-4">Scores</h3>
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden divide-y divide-[var(--border-color)]">
              {scoreGroups.map((group) => (
                <div key={group.testId}>
                  <div className="px-5 py-3 bg-[var(--hover-bg)]">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">{group.testName}</p>
                  </div>
                  {group.subtests.map((row) => (
                    <div key={row.key} className="flex items-center justify-between px-5 py-2.5 even:bg-[var(--hover-bg)]/40">
                      <span className="text-sm text-[var(--text-main)]">{row.label}</span>
                      <span className="font-mono text-xs font-bold text-[var(--text-secondary)] bg-[var(--hover-bg)] px-2 py-0.5 rounded-md">
                        {row.display()}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {sections.length > 0 && (
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-4">Rapport</h3>
            <div className="space-y-6">
              {sections.map((section) => (
                <div key={section.id} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
                  <div className="border-l-4 border-[var(--primary)] px-5 py-4 bg-[var(--hover-bg)]">
                    <h4 className="font-semibold text-base text-[var(--text-heading)]">{section.title}</h4>
                  </div>
                  <div className="px-5 py-4 text-sm">
                    {section.content ? (
                      <TipTapEditor content={sectionToHtml(section)} onChange={() => {}} readOnly />
                    ) : (
                      <p className="text-[var(--text-secondary)] italic">Section vide</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {scoreGroups.length === 0 && sections.length === 0 && (
          <div className="text-center py-16 text-[var(--text-secondary)] italic text-sm">Aucun contenu enregistré pour ce bilan.</div>
        )}
      </div>
    </div>
  );
};
