/**
 * SuspectTermsReview — words of the free text that may still identify someone
 * (utils/suspectTerms.ts), shown in the generation confirmation. Each word is
 * masked by default; unchecking it sends it as is. Both choices are kept on
 * the patient file, so a word is only asked about once.
 */

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SuspectTermDecisions } from '../../utils/suspectTerms';

/** Choices state of one confirmation: every word starts masked, again when the list changes. */
export const useSuspectTermChoices = (terms: string[]) => {
  const key = terms.join('\u0000');
  const [choices, setChoices] = useState<{ key: string; unmasked: ReadonlySet<string> }>({ key, unmasked: new Set() });
  if (choices.key !== key) setChoices({ key, unmasked: new Set() });
  const unmasked = choices.key === key ? choices.unmasked : new Set<string>();
  const toggle = (term: string) =>
    setChoices((prev) => {
      const next = new Set(prev.unmasked);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return { key: prev.key, unmasked: next };
    });
  const decisions: SuspectTermDecisions = {
    masked: terms.filter((t) => !unmasked.has(t)),
    allowed: terms.filter((t) => unmasked.has(t)),
  };
  return { isMasked: (term: string) => !unmasked.has(term), toggle, decisions };
};

interface Props {
  terms: string[];
  isMasked: (term: string) => boolean;
  onToggle: (term: string) => void;
}

export const SuspectTermsReview: React.FC<Props> = ({ terms, isMasked, onToggle }) => {
  if (terms.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-950/40">
      <div className="mb-2 flex gap-2">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="text-xs leading-relaxed text-[var(--text-main)]">
          <strong>Noms possibles dans vos notes.</strong> Les mots cochés sont masqués avant l'envoi et remis dans le rapport. Décochez ceux
          qui ne désignent personne.
        </p>
      </div>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
        {terms.map((term) => (
          <label
            key={term}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1 text-xs text-[var(--text-main)]"
          >
            <input type="checkbox" checked={isMasked(term)} onChange={() => onToggle(term)} className="accent-[#E07A5F]" />
            {term}
          </label>
        ))}
      </div>
    </div>
  );
};
