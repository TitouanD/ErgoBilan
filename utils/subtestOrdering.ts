/**
 * subtestOrdering.ts — how subtests are labelled, grouped and sorted in every
 * score table (initial, re-evaluation, historical) and in the test picker.
 */

import type { ScoreType, SubtestDef } from '../data/testCatalog';

export const SCALE_LABELS: Record<string, string> = {
  scaled:    'NS (m=10, \u03c3=3)',
  standard:  'QI (m=100, \u03c3=15)',
  't-score': 'T (m=50, \u03c3=10)',
  sten:      'Sten (m=5.5, \u03c3=2)',
  stanine:   'Stanine (m=5, \u03c3=2)',
  percentile: 'Rang percentile',
  none:      '\u00c9chelle non renseign\u00e9e',
};

export const getScaleLabel = (scoreType?: ScoreType): string | null => {
  if (!scoreType) return null;
  return SCALE_LABELS[scoreType] || null;
};

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const parseSubtestOrderFromName = (name: string): number | undefined => {
  const value = String(name || '').trim();
  if (!value) return undefined;

  const labeledMatch = value.match(/(?:^|\b)(?:subtest|sous[-\s]?test)\s*(\d{1,3})\b/i);
  if (labeledMatch) {
    const n = Number(labeledMatch[1]);
    if (Number.isFinite(n)) return n;
  }

  const leadingNumber = value.match(/^(\d{1,3})[).\-\s]/);
  if (leadingNumber) {
    const n = Number(leadingNumber[1]);
    if (Number.isFinite(n)) return n;
  }

  return undefined;
};

export const inferGroupLabelFromName = (name: string): string | undefined => {
  const value = String(name || '').trim();
  if (!value) return undefined;
  const dashSplit = value.split('—').map((part) => part.trim()).filter(Boolean);
  if (dashSplit.length >= 2) return dashSplit[0];
  const colonSplit = value.split(':').map((part) => part.trim()).filter(Boolean);
  if (colonSplit.length >= 2) return colonSplit[0];
  return undefined;
};

export const toGroupKey = (label: string): string => (
  label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default'
);

export const getDisplayGroupLabel = (subtest: SubtestDef): string | undefined => (
  subtest.inputConfig?.groupHeaderLabel || inferGroupLabelFromName(subtest.name)
);

export const getDisplayGroupKey = (subtest: SubtestDef): string | undefined => {
  const configured = subtest.inputConfig?.groupKey;
  if (configured && configured.trim()) return configured;
  const inferredLabel = getDisplayGroupLabel(subtest);
  return inferredLabel ? toGroupKey(inferredLabel) : undefined;
};

export const getDisplayGroupOrder = (subtest: SubtestDef): number => {
  if (Number.isFinite(subtest.displayGroupOrder)) return Number(subtest.displayGroupOrder);
  const configured = subtest.inputConfig?.groupOrder;
  if (Number.isFinite(configured)) return Number(configured);
  return 900;
};

export const getDisplayOrderIndex = (subtest: SubtestDef): number => {
  if (Number.isFinite(subtest.displayOrder)) return Number(subtest.displayOrder);
  const configured = subtest.inputConfig?.orderIndex;
  if (Number.isFinite(configured)) return Number(configured);
  const inferred = parseSubtestOrderFromName(subtest.name);
  return Number.isFinite(inferred) ? Number(inferred) : 999;
};

export const compareSubtestsForDisplay = (a: SubtestDef, b: SubtestDef): number => {
  const goA = getDisplayGroupOrder(a);
  const goB = getDisplayGroupOrder(b);
  if (goA !== goB) return goA - goB;

  const glA = getDisplayGroupLabel(a) ?? '\uffff';
  const glB = getDisplayGroupLabel(b) ?? '\uffff';
  const glCmp = glA.localeCompare(glB, 'fr', { sensitivity: 'base' });
  if (glCmp !== 0) return glCmp;

  const gkA = getDisplayGroupKey(a) ?? '\uffff';
  const gkB = getDisplayGroupKey(b) ?? '\uffff';
  if (gkA < gkB) return -1;
  if (gkA > gkB) return 1;

  const oiA = getDisplayOrderIndex(a);
  const oiB = getDisplayOrderIndex(b);
  if (oiA !== oiB) return oiA - oiB;

  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
};
