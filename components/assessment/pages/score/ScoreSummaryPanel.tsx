/**
 * ScoreSummaryPanel — mean z-score per test, shown next to the score tables.
 */

import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';
import type { TestData } from '../../../../types';
import { useCatalog } from '../../../../contexts/CatalogContext';
import { formatMetricValue, resolveScores } from '../../../../utils/resolvedScore';
import { zoneFromZ } from '../../../../utils/scoring';
import { Z_AXIS, zToFraction } from '../../../../utils/reportData';
import { zoneGradient, zoneTextClass } from '../../shared/zoneStyles';

const ZONE_GRADIENT = zoneGradient();

export const ScoreSummaryPanel: React.FC<{ tests: TestData }> = ({ tests }) => {
  const { index } = useCatalog();

  const rows = useMemo(
    () =>
      resolveScores(tests, index).map((test) => ({
        testId: test.testId,
        name: test.testName,
        avg: test.meanZ,
        subtestCount: Object.keys(tests[test.testId] ?? {}).length,
      })),
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
                  <span className={zoneTextClass(zone)}>{formatMetricValue(avg, 'ET')}</span>
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
