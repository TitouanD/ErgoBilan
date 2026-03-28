import React, { useState, useMemo } from 'react';
import { X, Tag, Check, AlertTriangle, ChevronDown, CircleHelp, Search } from 'lucide-react';
import type { ExtractedRow } from '../../types';
import { findBestMatches, confidenceLabel, type MatchCandidate } from '../../utils/subtestMatcher';

/** Sentinel value used in `renames` to indicate a subtest should be dropped. */
export const SKIP_SENTINEL = '__skip__';

interface OfficialSubtest {
    id: string;
    name: string;
}

interface Props {
    /** Pages from the current extraction session. */
    pages: Array<{ rows: ExtractedRow[] }>;
    /** Official subtests for the current test (from Supabase catalog). May be empty. */
    officialSubtests?: OfficialSubtest[];
    /** Additional extracted names that must be reviewed manually (forced queue). */
    forcedNames?: string[];
    /**
     * Called when the user confirms the mapping.
     * Values are the new canonical name, the original name (to keep as-is),
     * or SKIP_SENTINEL to drop all rows with that subtest name.
     */
    onConfirm: (renames: Record<string, string>) => void;
    onClose: () => void;
}

const VARIANT_PATTERN = /\(variante \d+\)$/;

interface SubtestGroup {
    extractedName: string;
    baseName: string;
    sourceAbbr: string;
    sample: string[];
    isVariant: boolean;
    matches: MatchCandidate[];
}

function buildSubtestGroups(
    pages: Array<{ rows: ExtractedRow[] }>,
    officialSubtests: OfficialSubtest[],
    forcedNames: string[] = [],
): SubtestGroup[] {
    const allRows: ExtractedRow[] = pages.flatMap((p) => p.rows);

    const variantNames = Array.from(
        new Set(allRows.map((r) => r.subtest).filter((s) => VARIANT_PATTERN.test(s))),
    );

    // Surface non-variant names with weak catalog match (only when catalog is available)
    const allUniqueNames = Array.from(new Set(allRows.map((r) => r.subtest)));
    const lowConfidenceNonVariants =
        officialSubtests.length > 0
            ? allUniqueNames.filter((name) => {
                  if (VARIANT_PATTERN.test(name)) return false;
                  const top = findBestMatches(name, officialSubtests, 1, 0);
                  return (top[0]?.score ?? 0) < 0.7;
              })
            : [];

    const allNames = Array.from(new Set([
        ...variantNames,
        ...lowConfidenceNonVariants,
        ...forcedNames.map((value) => String(value || '').trim()).filter(Boolean),
    ]));

    return allNames.map((extractedName) => {
        const rows = allRows.filter((r) => r.subtest === extractedName);
        const sourceAbbr = rows.find((r) => r.source_abbreviation)?.source_abbreviation ?? '';
        const baseName = extractedName.replace(VARIANT_PATTERN, '').trim();
        const sample = rows
            .slice(0, 3)
            .map((r) => [r.raw, r.standard, r.mean, r.sd].filter(Boolean).join(' / '))
            .filter(Boolean);
        const query = sourceAbbr ? `${baseName} ${sourceAbbr}` : baseName;
        const matches = findBestMatches(query, officialSubtests);
        return { extractedName, baseName, sourceAbbr, sample, isVariant: VARIANT_PATTERN.test(extractedName), matches };
    });
}

// ── Confidence badge ────────────────────────────────────────────────────────

const ConfidencePip: React.FC<{ score: number }> = ({ score }) => {
    const level = confidenceLabel(score);
    const [color, label] =
        level === 'high' ? ['bg-emerald-500', 'Confiance élevée']
        : level === 'medium' ? ['bg-amber-400', 'Confiance moyenne']
        : level === 'low' ? ['bg-rose-400', 'Confiance faible']
        : ['bg-gray-300', '—'];
    return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-secondary)]">
            <span className={`w-2 h-2 rounded-full ${color}`} />
            {label}
        </span>
    );
};

// ── Per-subtest card ────────────────────────────────────────────────────────

const SubtestCard: React.FC<{
    group: SubtestGroup;
    value: string;
    onChange: (v: string) => void;
}> = ({ group, value, onChange }) => {
    const [customInput, setCustomInput] = useState('');
    const [showCustom, setShowCustom] = useState(false);
    const isSkipped = value === SKIP_SENTINEL;
    const topMatch = group.matches[0];

    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const v = e.target.value;
        if (v === '__custom__') {
            setShowCustom(true);
        } else {
            setShowCustom(false);
            onChange(v);
        }
    };

    return (
        <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${isSkipped ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-[var(--border-color)] bg-[var(--hover-bg)]'}`}>
            {/* Header */}
            <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-heading)] truncate">
                        {group.isVariant && <span className="text-amber-600 mr-1">⚠</span>}
                        {group.baseName}
                        {group.isVariant && <span className="font-normal text-[var(--text-secondary)]"> (colonne ambiguë)</span>}
                    </p>
                    {group.isVariant && (
                        <p className="text-[10px] text-[var(--text-secondary)] font-mono truncate mt-0.5">
                            clé extraite : {group.extractedName}
                        </p>
                    )}
                </div>
                {group.sourceAbbr && (
                    <span className="px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-mono font-bold shrink-0">
                        {group.sourceAbbr}
                    </span>
                )}
            </div>
            {group.sample.length > 0 && (
                <p className="text-[11px] text-[var(--text-secondary)] italic">ex. {group.sample.join(' · ')}</p>
            )}
            {topMatch && <ConfidencePip score={topMatch.score} />}

            {!isSkipped ? (
                <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-[var(--text-heading)] uppercase tracking-wider">
                        Correspondance catalogue
                    </label>
                    <div className="relative">
                        <select
                            value={showCustom ? '__custom__' : value}
                            onChange={handleSelectChange}
                            className="w-full appearance-none pl-3 pr-8 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-sm text-[var(--text-main)] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/10 outline-none transition-colors"
                        >
                            {group.matches.length > 0 && (
                                <optgroup label="Correspondances catalogue">
                                    {group.matches.map((m) => (
                                        <option key={m.id} value={m.name}>
                                            {m.name} {confidenceLabel(m.score) === 'high' ? '✓' : confidenceLabel(m.score) === 'medium' ? '~' : '?'}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            <optgroup label="Autres options">
                                <option value={group.baseName}>Garder tel quel — « {group.baseName} »</option>
                                <option value="__custom__">Saisir un nom personnalisé…</option>
                                <option value={SKIP_SENTINEL}>Ignorer cette colonne</option>
                            </optgroup>
                        </select>
                        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                    </div>
                    {showCustom && (
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                            <input
                                autoFocus
                                type="text"
                                value={customInput}
                                onChange={(e) => { setCustomInput(e.target.value); onChange(e.target.value); }}
                                placeholder="Nom clinique exact…"
                                className="w-full pl-8 pr-3 py-2 rounded-xl border border-indigo-300 bg-[var(--card-bg)] text-sm text-[var(--text-main)] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/10 outline-none"
                            />
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-400 italic flex-1">Colonne ignorée — données supprimées.</p>
                    <button onClick={() => onChange(group.baseName)} className="text-xs text-indigo-500 font-semibold hover:underline">Annuler</button>
                </div>
            )}
        </div>
    );
};

// ── Main modal ──────────────────────────────────────────────────────────────

export const DisambiguationModal: React.FC<Props> = ({ pages, officialSubtests = [], forcedNames = [], onConfirm, onClose }) => {
    const groups = useMemo(() => buildSubtestGroups(pages, officialSubtests, forcedNames), [pages, officialSubtests, forcedNames]);

    const [selections, setSelections] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {};
        groups.forEach((g) => {
            const top = g.matches[0];
            init[g.extractedName] = top && confidenceLabel(top.score) !== 'low' ? top.name : g.baseName;
        });
        return init;
    });

    const hasDuplicates = useMemo(() => {
        const active = (Object.entries(selections) as [string, string][]).filter(([, v]) => v !== SKIP_SENTINEL).map(([, v]) => v.trim());
        return active.length !== new Set(active).size;
    }, [selections]);

    const hasBlank = useMemo(
        () => (Object.entries(selections) as [string, string][]).some(([, v]) => v !== SKIP_SENTINEL && !v.trim()),
        [selections],
    );

    const handleConfirm = () => {
        if (hasDuplicates || hasBlank) return;
        const trimmed: Record<string, string> = {};
        (Object.entries(selections) as [string, string][]).forEach(([k, v]) => { trimmed[k] = v.trim(); });
        onConfirm(trimmed);
    };

    if (groups.length === 0) return null;

    const variantCount = groups.filter((g) => g.isVariant).length;
    const lowCount = groups.filter((g) => !g.isVariant).length;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-[var(--secondary)]/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[var(--card-bg)] w-full max-w-xl rounded-[24px] shadow-2xl animate-in zoom-in-95 duration-200 relative overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--border-color)] shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shadow-sm shadow-amber-200">
                            <Tag size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <h3 className="font-serif font-bold text-lg text-[var(--text-heading)]">Correspondance des sous-tests</h3>
                            <p className="text-xs text-[var(--text-secondary)]">
                                {variantCount > 0 && <span className="text-amber-600 font-semibold">{variantCount} colonne{variantCount > 1 ? 's' : ''} ambiguë{variantCount > 1 ? 's' : ''}</span>}
                                {variantCount > 0 && lowCount > 0 && ' · '}
                                {lowCount > 0 && <span>{lowCount} correspondance{lowCount > 1 ? 's' : ''} incertaine{lowCount > 1 ? 's' : ''}</span>}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Explanation */}
                <div className="px-6 pt-4 pb-2 shrink-0">
                    <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)] bg-indigo-50 rounded-xl px-4 py-3">
                        <CircleHelp size={16} className="text-indigo-500 shrink-0 mt-0.5" />
                        <span>
                            Sélectionnez la correspondance officielle pour chaque sous-test extrait.
                            Les candidats sont classés par pertinence.{' '}
                            <strong className="text-indigo-700">Ignorer</strong> supprime les données de cette colonne.
                        </span>
                    </div>
                </div>

                {/* Subtest list */}
                <div className="px-6 py-3 space-y-4 overflow-y-auto flex-1">
                    {groups.map((g) => (
                        <SubtestCard
                            key={g.extractedName}
                            group={g}
                            value={selections[g.extractedName] ?? g.baseName}
                            onChange={(v) => setSelections((prev) => ({ ...prev, [g.extractedName]: v }))}
                        />
                    ))}
                </div>

                {/* Validation errors */}
                {(hasDuplicates || hasBlank) && (
                    <div className="px-6 pb-2 shrink-0">
                        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
                            <AlertTriangle size={14} className="shrink-0" />
                            {hasBlank ? 'Tous les noms doivent être renseignés (ou ignorés).' : 'Les noms actifs doivent être uniques.'}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="px-6 py-4 border-t border-[var(--border-color)] flex gap-3 shrink-0">
                    <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors border border-[var(--border-color)]">
                        Reporter
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={hasDuplicates || hasBlank}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 hover:-translate-y-0.5 disabled:translate-y-0"
                    >
                        <Check size={16} />
                        Appliquer la correspondance
                    </button>
                </div>
            </div>
        </div>
    );
};