/**
 * ScoreSummaryPanel — mean z-score per test, shown next to the score tables.
 */

import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';
import type { TestData } from '../../../../types';
import { useCatalog } from '../../../../contexts/CatalogContext';
import { getScaleType, getTestName } from '../../../../utils/catalogIndex';
import { formatZ, getZFromScore, zoneFromZ } from '../../../../utils/scoring';
import { Z_AXIS, zToFraction } from '../../../../utils/reportData';

const ZONE_TEXT = { deficit: 'text-rose-600', fragile: 'text-amber-600', normal: 'text-emerald-600' } as const;

// Background bands matching the interpretation zones (≤ -2, -2..-1, > -1) on the Z_AXIS range.
const deficitEnd = zToFraction(-2) * 100;
const fragileEnd = zToFraction(-1) * 100;
const ZONE_GRADIENT = `linear-gradient(to right, #f87171 0%, #f87171 ${deficitEnd}%, #fbbf24 ${deficitEnd}%, #fbbf24 ${fragileEnd}%, #34d399 ${fragileEnd}%, #34d399 100%)`;

export const ScoreSummaryPanel: React.FC<{ tests: TestData }> = ({ tests }) => {
  const { index } = useCatalog();

  const rows = useMemo(
    () =>
      Object.entries(tests).map(([testId, subtests]) => {
        const zScores = Object.entries(subtests)
          .map(([subId, score]) => getZFromScore(score, getScaleType(index, testId, subId)))
          .filter((z): z is number => z !== null);
        const avg = zScores.length > 0 ? zScores.reduce((a, b) => a + b, 0) / zScores.length : null;
        return { testId, name: getTestName(index, testId), avg, subtestCount: Object.keys(subtests).length };
      }),
    [tests, index],
  );

  return (
    <div className="sticky top-24 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-sm space-y-3">
      <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
        <Activity size={14} />
        Résumé par test
      </h4>
      <div className="space-y-2">
        {rows.map(({ testId, name, avg, subtestCount }) => {
          const zone = zoneFromZ(avg);
          return (
            <div key={testId}>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="truncate font-medium text-[var(--text-secondary)] max-w-[160px]">{name}</span>
                {avg !== null && zone ? (
                  <span className={`font-bold ${ZONE_TEXT[zone]}`}>{formatZ(avg)} ET</span>
                ) : (
                  <span className="font-bold text-[var(--text-disabled)]">--</span>
                )}
              </div>
              {avg !== null ? (
                <div
                  className="relative h-2 rounded-full"
                  style={{ background: ZONE_GRADIENT }}
                  title={`Échelle de ${Z_AXIS.min} à +${Z_AXIS.max} ET`}
                >
                  <span
                    className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[var(--secondary)] shadow"
                    style={{ left: `${zToFraction(avg) * 100}%` }}
                  />
                </div>
              ) : (
                <div className="h-2 rounded-full bg-[var(--progress-bg)]" />
              )}
              <div className="mt-1 text-[10px] text-[var(--text-secondary)]">{subtestCount} épreuve(s)</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
