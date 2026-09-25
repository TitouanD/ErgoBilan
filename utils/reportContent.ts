/**
 * reportContent.ts — conversions of report section content.
 *
 * AI output is Markdown-ish plain text (`contentFormat` 'plain' / missing);
 * once a section has been edited in TipTap it is stored as HTML
 * (`contentFormat: 'html'`). Every screen (validation, preview, PDF, viewer)
 * converts through `sectionToHtml` so the rendering is identical everywhere.
 */

import type { ReportSection } from '../types';
import { decodeResidualEntities, sanitizeReportText } from './textSanitizer';

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** `**bold**` → `<strong>`, on already-escaped text. */
const inlineMarkdown = (escaped: string): string => escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/**
 * Convert the Markdown subset produced by the AI (## / ### headings, - / * bullets,
 * **bold**, one paragraph per line) to HTML. Text is escaped first.
 */
export const markdownToHtml = (markdown: string): string => {
  const lines = sanitizeReportText(markdown)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };

  for (const line of lines) {
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li>${inlineMarkdown(escapeHtml(bullet[1]))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith('### ')) out.push(`<h3>${inlineMarkdown(escapeHtml(line.slice(4)))}</h3>`);
    else if (line.startsWith('## ')) out.push(`<h2>${inlineMarkdown(escapeHtml(line.slice(3)))}</h2>`);
    else out.push(`<p>${inlineMarkdown(escapeHtml(line))}</p>`);
  }
  closeList();
  return out.join('');
};

/** HTML to show/edit for a section, whatever its stored format. */
export const sectionToHtml = (section: Pick<ReportSection, 'content' | 'contentFormat'>): string =>
  section.contentFormat === 'html' ? decodeResidualEntities(section.content || '') : markdownToHtml(section.content || '');

/** Plain text of an HTML fragment (for AI context and change detection). */
export const htmlToPlainText = (html: string): string =>
  html
    .replace(/<\/(p|h2|h3|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();

/** One `<p>` per non-empty line of a plain-text textarea. */
export const plainTextToHtml = (text: string): string =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('');

/** Plain text of any section (used to detect practitioner edits for the style feedback loop). */
export const sectionToPlainText = (section: Pick<ReportSection, 'content' | 'contentFormat'>): string =>
  htmlToPlainText(sectionToHtml(section));
