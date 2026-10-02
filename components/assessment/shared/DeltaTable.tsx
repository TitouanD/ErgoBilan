/**
 * DeltaTable — previous vs re-evaluation scores with the trend of each subtest.
 * The trend is computed in z units (see utils/reevaluationHelpers.ts).
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { STABILITY_THRESHOLD_Z, type DeltaEntry, type Trend } from '../../../utils/reevaluationHelpers';
import { formatMetricValue } from '../../../utils/resolvedScore';

const TREND_STYLE: Record<Trend, { className: string; icon: React.ReactNode }> = {
  improved: { className: 'text-emerald-600 font-bold', icon: <TrendingUp size={12} className="text-emerald-500" /> },
  stable: { className: 'text-amber-500', icon: <Minus size={12} className="text-amber-400" /> },
  declined: { className: 'text-rose-600 font-bold', icon: <TrendingDown size={12} className="text-rose-500" /> },
};

const formatValue = (value: number | null, metric: DeltaEntry['metric']): string =>
  value === null ? '—' : formatMetricValue(value, metric);

const DeltaCell: React.FC<{ entry: DeltaEntry; textSize: string }> = ({ entry, textSize }) => {
  if (!entry.measured) return <span className={`${textSize} italic text-[var(--text-disabled)]`}>non mesuré</span>;
  if (entry.newValue === null)
    return (
      <span className={`${textSize} italic text-[var(--text-disabled)]`} title="Saisi dans une autre métrique, échelle inconnue">
        non comparable
      </span>
    );
  if (entry.delta === null) return <span className={`${textSize} text-[var(--text-disabled)]`}>—</span>;
  const style = entry.trend ? TREND_STYLE[entry.trend] : { className: 'text-[var(--text-secondary)]', icon: null };
  return (
    <span
      className={`${textSize} font-mono flex items-center justify-center gap-1 ${style.className}`}
      title={entry.zDelta !== null ? formatMetricValue(entry.zDelta, 'ET') : 'Échelle inconnue : tendance non calculable'}
    >
      {style.icon}
      {formatMetricValue(entry.delta, entry.metric, true)}
    </span>
  );
};

export const DeltaTable: React.FC<{ entries: DeltaEntry[]; compact?: boolean }> = ({ entries, compact = false }) => {
  const px = compact ? 'px-2' : 'px-4';
  const py = compact ? 'py-1.5' : 'py-2.5';
  const textSize = compact ? 'text-[10px]' : 'text-xs';
  const th = `${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`;

  if (entries.length === 0) {
    return <p className="p-4 text-center text-sm text-[var(--text-secondary)]">Aucun score comparable.</p>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
            <th className={`text-left ${px} ${th}`}>Test</th>
            <th className={`text-left ${px} ${th}`}>Sous-test</th>
            <th className={`text-center px-3 ${th}`}>Avant</th>
            <th className={`text-center px-3 ${th}`}>Après</th>
            <th className={`text-center px-3 ${th}`}>Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {entries.map((entry) => (
            <tr key={`${entry.testId}:${entry.subtestId}`} className="hover:bg-[var(--hover-bg)]">
              <td className={`${px} ${py} ${textSize} text-[var(--text-secondary)] max-w-[90px] truncate`} title={entry.testName}>
                {entry.testName}
              </td>
              <td className={`${px} ${py} ${textSize} text-[var(--text-heading)] max-w-[140px] truncate`} title={entry.subtestName}>
                {entry.subtestName}
              </td>
              <td className={`px-3 ${py} text-center ${textSize} font-mono text-[var(--text-secondary)]`}>
                {formatValue(entry.prevValue, entry.metric)}
              </td>
              <td className={`px-3 ${py} text-center ${textSize} font-mono font-bold text-[var(--text-heading)]`}>
                {formatValue(entry.newValue, entry.metric)}
              </td>
              <td className={`px-3 ${py} text-center`}>
                <DeltaCell entry={entry} textSize={textSize} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`${px} py-2 border-t border-[var(--border-color)] flex flex-wrap gap-x-4 gap-y-1 text-[9px]`}>
        <span className="flex items-center gap-1 text-emerald-600">
          <TrendingUp size={10} /> Amélioration (&gt; +{STABILITY_THRESHOLD_Z} ET)
        </span>
        <span className="flex items-center gap-1 text-amber-500">
          <Minus size={10} /> Stable
        </span>
        <span className="flex items-center gap-1 text-rose-500">
          <TrendingDown size={10} /> Régression (&lt; -{STABILITY_THRESHOLD_Z} ET)
        </span>
      </div>
    </div>
  );
};
