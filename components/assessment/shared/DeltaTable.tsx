/**
 * DeltaTable — shared comparison table for reevaluation flow.
 * Shows previous vs new NS scores with delta indicators.
 * Used by: reevaluation/Step2Evolution, reevaluation/Step3Synthesis (compact mode)
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DeltaEntry } from '../../../utils/reevaluationHelpers';
import { deltaClass } from '../../../utils/reevaluationHelpers';

interface Props {
    /** Grouped by test: { testName: DeltaEntry[] } */
    deltasByTest: Record<string, DeltaEntry[]>;
    /** Compact mode for sidebars — smaller padding, smaller font */
    compact?: boolean;
}

const deltaIcon = (delta: number | null) => {
    if (delta === null) return <Minus size={12} className="text-[var(--text-disabled)]" />;
    if (delta > 0.5) return <TrendingUp size={12} className="text-emerald-500" />;
    if (delta < -0.5) return <TrendingDown size={12} className="text-rose-500" />;
    return <Minus size={12} className="text-amber-400" />;
};

export const DeltaTable: React.FC<Props> = ({ deltasByTest, compact = false }) => {
    const px = compact ? 'px-3' : 'px-4';
    const py = compact ? 'py-1.5' : 'py-2';
    const textSize = compact ? 'text-[10px]' : 'text-xs';

    if (Object.keys(deltasByTest).length === 0) {
        return (
            <p className="p-4 text-center text-sm text-[var(--text-secondary)]">
                Aucun score enregistré à l'étape précédente.
            </p>
        );
    }

    return (
        <div className="overflow-x-auto">
            {Object.entries(deltasByTest).map(([testName, entries]) => (
                <div key={testName}>
                    <div className={`${px} ${compact ? 'py-1.5' : 'py-2'} bg-[var(--card-bg-raised)] border-b border-[var(--border-color)]`}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                            {testName}
                        </p>
                    </div>
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-[var(--border-color)]">
                                <th className={`text-left ${px} ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                                    Sous-test
                                </th>
                                <th className={`text-center px-2 ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                                    Avant
                                </th>
                                <th className={`text-center px-2 ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                                    Après
                                </th>
                                <th className={`text-center px-2 ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                                    Δ
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {entries.map(entry => (
                                <tr key={entry.subtestId} className="hover:bg-[var(--hover-bg)]">
                                    <td
                                        className={`${px} ${py} ${textSize} text-[var(--text-heading)] max-w-[120px] truncate`}
                                        title={entry.subtestName}
                                    >
                                        {entry.subtestName}
                                    </td>
                                    <td className={`px-2 ${py} text-center ${textSize} font-mono text-[var(--text-secondary)]`}>
                                        {entry.prevNS ?? '—'}
                                    </td>
                                    <td className={`px-2 ${py} text-center ${textSize} font-mono font-bold text-[var(--text-heading)]`}>
                                        {entry.newNS ?? '—'}
                                    </td>
                                    <td className={`px-2 ${py} text-center`}>
                                        <span className={`${textSize} font-mono flex items-center justify-center gap-1 ${deltaClass(entry.delta)}`}>
                                            {deltaIcon(entry.delta)}
                                            {entry.delta !== null
                                                ? `${entry.delta > 0 ? '+' : ''}${entry.delta.toFixed(1)}`
                                                : '—'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
            {/* Legend */}
            <div className={`${px} py-2 border-t border-[var(--border-color)] grid grid-cols-3 gap-1`}>
                <div className="flex items-center gap-1 text-[9px] text-emerald-600">
                    <TrendingUp size={10} /> Amélioration
                </div>
                <div className="flex items-center gap-1 text-[9px] text-amber-500">
                    <Minus size={10} /> Stable
                </div>
                <div className="flex items-center gap-1 text-[9px] text-rose-500">
                    <TrendingDown size={10} /> Régression
                </div>
            </div>
        </div>
    );
};
