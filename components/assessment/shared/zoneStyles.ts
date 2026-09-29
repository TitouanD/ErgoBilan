/**
 * zoneStyles.ts — how screens color an interpretation zone. The zone itself
 * comes from the resolved score (utils/resolvedScore.ts); report colors come
 * from `ZONE_META`.
 */

import { type ScoreZone, ZONE_META } from '../../../utils/scoring';
import { zToFraction } from '../../../utils/reportData';

/** Color of a zone, grey when there is none. */
export const zoneColor = (zone: ScoreZone | null | undefined): string => (zone ? ZONE_META[zone].color : '#94a3b8');

/** Tailwind text class for a score colored by its zone. */
export const zoneTextClass = (zone: ScoreZone | null | undefined): string => {
  if (zone === 'deficit') return 'text-rose-600 font-bold';
  if (zone === 'fragile') return 'text-amber-600 font-bold';
  if (zone === 'normal') return 'text-emerald-600 font-bold';
  return 'text-[var(--text-secondary)]';
};

/** Tailwind row background for a score table row. */
export const zoneRowClass = (zone: ScoreZone | null | undefined): string => {
  if (zone === 'deficit') return 'bg-rose-50/30 dark:bg-rose-900/10';
  if (zone === 'fragile') return 'bg-amber-50/30 dark:bg-amber-900/10';
  if (zone === 'normal') return 'bg-emerald-50/20 dark:bg-emerald-900/5';
  return '';
};

/** Horizontal gradient of the three zones along the z axis of the bar chart. */
export const zoneGradient = (): string => {
  const deficitEnd = zToFraction(-2) * 100;
  const fragileEnd = zToFraction(-1) * 100;
  const { deficit, fragile, normal } = ZONE_META;
  return `linear-gradient(to right, ${deficit.color} 0%, ${deficit.color} ${deficitEnd}%, ${fragile.color} ${deficitEnd}%, ${fragile.color} ${fragileEnd}%, ${normal.color} ${fragileEnd}%, ${normal.color} 100%)`;
};
