/**
 * SpellCheckHint — tells the practitioner where the text can be edited and that the
 * browser underlines spelling mistakes there (#134). The browser only checks a text
 * being edited, so a read-only section shows no underline.
 */

import React from 'react';
import { SpellCheck } from 'lucide-react';

export const SpellCheckHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="no-print mt-3 flex items-start gap-2 text-xs text-[var(--text-secondary)]">
    <SpellCheck size={14} className="shrink-0 mt-px text-[#E07A5F]" />
    <span>{children}</span>
  </p>
);
