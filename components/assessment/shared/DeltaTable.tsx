/**
 * DeltaTable — shared comparison table for reevaluation flow.
 * Flat table: TEST | SOUS-TEST | AVANT | APRÈS | Δ with unit labels.
 * Used by: reevaluation/Step2Evolution, reevaluation/Step3Synthesis (compact mode)
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DeltaEntry } from '../../../utils/reevaluationHelpers';
import { deltaClass } from '../../../utils/reevaluationHelpers';

interface Props {
    entries: DeltaEntry[];
    /** Compact mode for sidebars — smaller padding, smaller font */
    compact?: boolean;
}

const deltaIcon = (delta: number | null) => {
    if (delta === null) return <Minus size={12} className="text-[var(--text-disabled)]" />;
    if (delta > 0.5) return <TrendingUp size={12} className="text-emerald-500" />;
    if (delta < -0.5) return <TrendingDown size={12} className="text-rose-500" />;
    return <Minus size={12} className="text-amber-400" />;
};

const formatValue = (value: number | null, metric: string): string => {
    if (value === null) return '—';
    if (metric === 'ET') return `${value > 0 ? '+' : ''}${value.toFixed(2)} ET`;
    if (metric === '%') return `${value} %`;
    return `${value} NS`;
};

export const DeltaTable: React.FC<Props> = ({ entries, compact = false }) => {
    const px = compact ? 'px-2' : 'px-4';
    const py = compact ? 'py-1.5' : 'py-2.5';
    const textSize = compact ? 'text-[10px]' : 'text-xs';

    if (entries.length === 0) {
        return (
            <p className="p-4 text-center text-sm text-[var(--text-secondary)]">
                Aucun score enregistré à l'étape précédente.
            </p>
        );
    }

    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full">
                <thead>
                    <tr className="border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                        <th className={`text-left ${px} ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                            Test
                        </th>
                        <th className={`text-left ${px} ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                            Sous-test
                        </th>
                        <th className={`text-center px-3 ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                            Avant
                        </th>
                        <th className={`text-center px-3 ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                            Après
                        </th>
                        <th className={`text-center px-3 ${py} ${textSize} font-bold uppercase tracking-wider text-[var(--text-disabled)]`}>
                            Δ
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                    {entries.map((entry, idx) => (
                        <tr key={`${entry.subtestId}-${idx}`} className="hover:bg-[var(--hover-bg)]">
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
                                <span className={`${textSize} font-mono flex items-center justify-center gap-1 ${deltaClass(entry.delta)}`}>
                                    {deltaIcon(entry.delta)}
                                    {entry.delta !== null
                                        ? `${entry.delta > 0 ? '+' : ''}${entry.delta.toFixed(1)} ${entry.metric}`
                                        : '—'}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
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
