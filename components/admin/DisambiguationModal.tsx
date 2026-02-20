import React, { useState, useMemo } from 'react';
import { X, Tag, Check, AlertTriangle } from 'lucide-react';
import type { ExtractedRow } from '../../types';

interface Props {
    /** Only the rows from each page are needed — accepts ExtractionPage[] from ContributionStudio. */
    pages: Array<{ rows: ExtractedRow[] }>;
    onConfirm: (renames: Record<string, string>) => void;
    onClose: () => void;
}

const VARIANT_PATTERN = /\(variante \d+\)$/;

/**
 * Group variant rows: returns one entry per unique (variante N) name,
 * with the base name, abbreviation hint (source_abbreviation from first row),
 * and sample score values.
 */
function buildVariantGroups(pages: Array<{ rows: ExtractedRow[] }>) {
    // Collect all rows from all pages
    const allRows: ExtractedRow[] = pages.flatMap(p => p.rows);

    // Find unique "variante" names
    const variantNames = Array.from(new Set(
        allRows.map(r => r.subtest).filter(s => VARIANT_PATTERN.test(s))
    ));

    // Group rows by variant name
    return variantNames.map(variantName => {
        const rows = allRows.filter(r => r.subtest === variantName);
        const abbr = rows.find(r => r.source_abbreviation)?.source_abbreviation ?? '';
        const baseName = variantName.replace(VARIANT_PATTERN, '').trim();
        const sample = rows.slice(0, 3).map(r =>
            [r.raw, r.standard, r.mean, r.sd].filter(Boolean).join(' / ')
        ).filter(Boolean);

        return { variantName, baseName, abbr, sample };
    });
}

/**
 * A modal that lets the user rename (variante N) suffixed subtests to proper
 * French clinical names, informed by the original column abbreviation and sample data.
 */
export const DisambiguationModal: React.FC<Props> = ({ pages, onConfirm, onClose }) => {
    const groups = useMemo(() => buildVariantGroups(pages), [pages]);

    // renames: variantName → user-supplied new name (pre-filled with baseName + abbr hint)
    const [renames, setRenames] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {};
        groups.forEach(g => {
            // Smart default: if we have an abbreviation, append it in parentheses
            init[g.variantName] = g.abbr
                ? `${g.baseName} (${g.abbr})`
                : g.baseName;
        });
        return init;
    });

    const hasDuplicateNames = useMemo(() => {
        const names = (Object.values(renames) as string[]).map(n => n.trim());
        return names.length !== new Set(names).size;
    }, [renames]);

    const hasBlankNames = useMemo(() => {
        return (Object.values(renames) as string[]).some(n => !n.trim());
    }, [renames]);

    const handleConfirm = () => {
        if (hasDuplicateNames || hasBlankNames) return;
        const trimmed: Record<string, string> = {};
        (Object.entries(renames) as Array<[string, string]>).forEach(([k, v]) => { trimmed[k] = v.trim(); });
        onConfirm(trimmed);
    };

    if (groups.length === 0) return null;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[var(--card-bg)] w-full max-w-xl rounded-[24px] shadow-2xl animate-in zoom-in-95 duration-200 relative overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--border-color)]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shadow-sm shadow-amber-200">
                            <Tag size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <h3 className="font-serif font-bold text-lg text-[var(--text-heading)]">
                                Disambiguation des sous-tests
                            </h3>
                            <p className="text-xs text-[var(--text-secondary)]">
                                {groups.length} colonne{groups.length > 1 ? 's' : ''} détectée{groups.length > 1 ? 's' : ''} à nommer
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Explanation */}
                <div className="px-6 pt-4 pb-2">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                        Gemini a détecté plusieurs colonnes portant un nom similaire dans le tableau.
                        Chaque colonne doit recevoir un <strong className="text-[var(--text-heading)]">nom clinique unique</strong>.
                        L'abréviation d'origine est indiquée pour vous aider.
                    </p>
                </div>

                {/* Variant list */}
                <div className="px-6 py-3 space-y-4 max-h-[55vh] overflow-y-auto">
                    {groups.map(({ variantName, abbr, sample }) => (
                        <div key={variantName} className="rounded-2xl border border-[var(--border-color)] bg-[var(--hover-bg)] p-4 space-y-3">
                            {/* Abbreviation + sample badge row */}
                            <div className="flex flex-wrap items-center gap-2">
                                {abbr && (
                                    <span className="px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-mono font-bold">
                                        abrév. : {abbr}
                                    </span>
                                )}
                                {sample.length > 0 && (
                                    <span className="text-xs text-[var(--text-secondary)] italic truncate">
                                        ex. {sample.join(' · ')}
                                    </span>
                                )}
                            </div>

                            {/* Detected (variante N) label */}
                            <p className="text-xs text-amber-600 font-medium truncate">
                                Importé comme : <span className="font-mono">{variantName}</span>
                            </p>

                            {/* Rename input */}
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-[var(--text-heading)]">
                                    Nom clinique final
                                </label>
                                <input
                                    type="text"
                                    value={renames[variantName] ?? ''}
                                    onChange={e => setRenames(prev => ({ ...prev, [variantName]: e.target.value }))}
                                    placeholder="ex. Mémoire de figures - Différé"
                                    className={`w-full px-3 py-2 rounded-xl border text-sm bg-[var(--card-bg)] text-[var(--text-main)] outline-none transition-colors ${
                                        !renames[variantName]?.trim()
                                            ? 'border-red-300 focus:border-red-500'
                                            : 'border-[var(--border-color)] focus:border-indigo-400'
                                    }`}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Validation errors */}
                {(hasDuplicateNames || hasBlankNames) && (
                    <div className="px-6 pb-2">
                        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
                            <AlertTriangle size={14} className="shrink-0" />
                            {hasBlankNames
                                ? 'Tous les noms doivent être renseignés.'
                                : 'Les noms doivent être uniques — deux colonnes ne peuvent pas avoir le même nom.'}
                        </div>
                    </div>
                )}

                {/* Footer buttons */}
                <div className="px-6 py-4 border-t border-[var(--border-color)] flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors border border-[var(--border-color)]"
                    >
                        Reporter
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={hasDuplicateNames || hasBlankNames}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 hover:-translate-y-0.5 disabled:translate-y-0"
                    >
                        <Check size={16} />
                        Appliquer les noms
                    </button>
                </div>
            </div>
        </div>
    );
};
