
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { X, Upload, FileText, Check, ArrowLeft, ShieldAlert, ZoomIn, ZoomOut, Save, Layers, Camera, Database, Sparkles, Trash2, Plus, Calculator, Table as TableIcon, Loader2, ArrowRight, Scale, BookOpen, Scan, Link2, Globe, Lock, AlertTriangle } from 'lucide-react';
import type { Contribution, ExtractedRow, AIExtractionResult, AIExtractedTable, AIExtractedNormRow, SimilarTestMatch } from '../../types';
import { callExtractionTask } from '../../services/extractionProxy';
import { fileToGenerativePart, cleanAndParseJson, expandCompactKeys } from '../../utils/aiHelpers';
import { calculateFromStandard, calculateFromZ, calculateFromPercentile, zScoreToPercentile } from '../../utils/scoring';
import { supabase } from '../../services/db';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { Logger } from '../../utils/logger';
import { TEST_CATALOG } from '../../data/testCatalog';
import { resolveSubtestAlias } from '../../data/subtestAliases';
import { normalizeSubtestName, normalizeTestName, findBestCanonicalMatch } from '../../utils';
import { DisambiguationModal } from './DisambiguationModal';

interface Props {
    onClose: () => void;
    onSubmit: (contribution: Contribution) => void;
}

// Mapping approximatif Classe -> Âge pour l'affichage
const GRADE_TO_AGE: Record<string, string> = {
    'PS': '3 ans', 'MS': '4 ans', 'GS': '5 ans',
    'CP': '6 ans', 'CE1': '7 ans', 'CE2': '8 ans',
    'CM1': '9 ans', 'CM2': '10 ans',
    '6EME': '11 ans', '5EME': '12 ans', '4EME': '13 ans', '3EME': '14 ans',
    '6ÈME': '11 ans', '5ÈME': '12 ans', '4ÈME': '13 ans', '3ÈME': '14 ans'
};

// Grade → age in months for filename age parsing
const GRADE_TO_MONTHS: Record<string, number> = {
    'PS': 36, 'MS': 48, 'GS': 60,
    'CP': 72, 'CE1': 84, 'CE2': 96,
    'CM1': 108, 'CM2': 120,
    '6EME': 132, '5EME': 144, '4EME': 156, '3EME': 168,
    '6E': 132, '5E': 144, '4E': 156, '3E': 168,
};

/**
 * Parse an age range from a filename.
 * Handles patterns like:
 *   "10;6-10;11.jpg"   → { min: 126, max: 131 }
 *   "13ans.jpg"        → { min: 156, max: 167 }
 *   "5ans6mois.png"    → { min: 66, max: 66 }
 *   "CE1.png"          → { min: 84, max: 95 }
 *   "4;0-4;5.jpg"      → { min: 48, max: 53 }
 */
const parseAgeFromFilename = (filename: string): { min: number; max: number } | null => {
    const base = filename.replace(/\.[^.]+$/, '').toUpperCase();

    // Pattern: "10;6-10;11" or "4;0 - 4;5"  (years;months range)
    const rangeMatch = base.match(/(\d{1,2})\s*[;:.]\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*[;:.]\s*(\d{1,2})/);
    if (rangeMatch) {
        const min = parseInt(rangeMatch[1]) * 12 + parseInt(rangeMatch[2]);
        const max = parseInt(rangeMatch[3]) * 12 + parseInt(rangeMatch[4]);
        return { min, max };
    }

    // Pattern: "5ANS6MOIS" or "5 ANS 6 MOIS"
    const yrmMatch = base.match(/(\d{1,2})\s*ANS?\s*(\d{1,2})\s*MOIS/);
    if (yrmMatch) {
        const months = parseInt(yrmMatch[1]) * 12 + parseInt(yrmMatch[2]);
        return { min: months, max: months };
    }

    // Pattern: "13ANS" or "13 ANS"
    const yrMatch = base.match(/(\d{1,2})\s*ANS?/);
    if (yrMatch) {
        const years = parseInt(yrMatch[1]);
        return { min: years * 12, max: years * 12 + 11 };
    }

    // Pattern: single age "10;6" (years;months, no range)
    const singleMatch = base.match(/(\d{1,2})\s*[;:.]\s*(\d{1,2})/);
    if (singleMatch) {
        const months = parseInt(singleMatch[1]) * 12 + parseInt(singleMatch[2]);
        return { min: months, max: months };
    }

    // Pattern: grade level "CE1", "CM2", "6EME"
    for (const [grade, months] of Object.entries(GRADE_TO_MONTHS)) {
        if (base.includes(grade)) {
            return { min: months, max: months + 11 };
        }
    }

    return null;
};

type TableStructure = 'PARAMETRIC' | 'LOOKUP' | 'UNKNOWN';
type ExtractionPage = {
    id: string;
    fileIndex: number;
    rows: ExtractedRow[];
    validated: boolean;
    detectedStructure: TableStructure;
};

type CategoryOption = {
    id: string;
    label: string;
    sortOrder?: number | null;
};

type CanonicalSubtestEntry = {
    id: string;
    name: string;
    abbreviation?: string | null;
};

type CanonicalGroupedEntry = {
    name: string;
    abbreviation?: string | null;
    displayName: string;
    rows: ExtractedRow[];
};

const normalizeAbbreviation = (value?: string | null): string => (
    (value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ')
);

const splitSubtestDisplayName = (name: string): { baseName: string; abbreviation?: string } => {
    const trimmed = name.trim();
    if (!trimmed) return { baseName: '' };
    const match = trimmed.match(/^(.*)\(([A-Z0-9][A-Z0-9&/\- ]{0,19})\)\s*$/);
    if (!match) return { baseName: trimmed };
    return {
        baseName: match[1].trim(),
        abbreviation: normalizeAbbreviation(match[2]) || undefined,
    };
};

const formatSubtestDisplayName = (name: string, abbreviation?: string | null): string => {
    const trimmedName = name.trim();
    const normalizedAbbr = normalizeAbbreviation(abbreviation);
    if (!trimmedName) return '';
    return normalizedAbbr ? `${trimmedName} (${normalizedAbbr})` : trimmedName;
};

const buildSubtestIdentityKey = (name: string, abbreviation?: string | null): string => (
    `${normalizeSubtestName(name)}::${normalizeAbbreviation(abbreviation)}`
);

// --- DRAFT PERSISTENCE (survives PIN lock, crash, tab close) ---
const DRAFT_KEY = 'contrib_studio_draft';

interface ContribDraft {
    testName: string;
    selectedCategory: string;
    tableStructure: TableStructure;
    pages: ExtractionPage[];
    savedAt: string;
}

const saveDraft = (d: ContribDraft) => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* quota */ }
};
const loadDraft = (): ContribDraft | null => {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw) as ContribDraft;
        // Discard drafts older than 24 h
        if (Date.now() - new Date(d.savedAt).getTime() > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(DRAFT_KEY);
            return null;
        }
        return d;
    } catch { return null; }
};
const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

/**
 * Re-disambiguate pages in-place when multiple rows share the same subtest name
 * but carry different source_abbreviation values (e.g. AAO/AAC/AAI for NEPSY-2
 * "Attention Auditive", or MFC/MFS/MFT for "Mémoire de figures").
 * Always appends the abbreviation when there are ≥2 distinct abbreviations for
 * the same subtest — these are genuinely different score columns that must be
 * stored separately. Non-canonical names will prompt a confirmation modal.
 *
 */
const reDisambiguateByAbbreviation = (pages: ExtractionPage[]): void => {
    const subtestAbbrMap = new Map<string, Set<string>>();
    pages.forEach(page => {
        page.rows.forEach(row => {
            const normalizedAbbr = normalizeAbbreviation(row.source_abbreviation);
            if (!normalizedAbbr) return;
            row.source_abbreviation = normalizedAbbr;
            if (!subtestAbbrMap.has(row.subtest)) subtestAbbrMap.set(row.subtest, new Set());
            subtestAbbrMap.get(row.subtest)!.add(normalizedAbbr);
        });
    });
    subtestAbbrMap.forEach((abbrs, subtest) => {
        if (abbrs.size > 1) {
            const trailMatch = subtest.match(/^(.*)\(([A-Z0-9][A-Z0-9&/\- ]{0,19})\)\s*$/);
            const trailingAbbr = trailMatch ? normalizeAbbreviation(trailMatch[2]) : '';
            const baseName = trailMatch && abbrs.has(trailingAbbr)
                ? trailMatch[1].trim()
                : subtest;
            pages.forEach(page => {
                page.rows.forEach(row => {
                    if (row.subtest === subtest && row.source_abbreviation) {
                        row.subtest = `${baseName} (${normalizeAbbreviation(row.source_abbreviation)})`;
                    }
                });
            });
        }
    });
};

export const ContributionStudio: React.FC<Props> = ({ onClose, onSubmit }) => {
    const [step, setStep] = useState<'intro' | 'upload' | 'processing' | 'editor' | 'success'>('intro');
    const [files, setFiles] = useState<File[]>([]);
    const [currentFileIndex, setCurrentFileIndex] = useState(0);
    const { suppressIdleLock, resumeIdleLock } = useAuth();
    const [hasPendingDraft, setHasPendingDraft] = useState(false);
    const draftRef = useRef<ContribDraft | null>(null);

    const [testName, setTestName] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
    const [isCategoryLoading, setIsCategoryLoading] = useState(true);
    const [testNameError, setTestNameError] = useState(false);

    const [tableStructure, setTableStructure] = useState<TableStructure>('UNKNOWN');
    const [pages, setPages] = useState<ExtractionPage[]>([]);
    const [zoom, setZoom] = useState(1);

    // LEGAL & MODAL STATE
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [legalConsent, setLegalConsent] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // MERGE STATE
    const [showMergeModal, setShowMergeModal] = useState(false);
    const [mergeTarget, setMergeTarget] = useState<{ id: string; name: string; subtestCount: number; isPublic: boolean } | null>(null);
    const [mergeNewAgeRanges, setMergeNewAgeRanges] = useState(0);
    const [mergeNewSubtests, setMergeNewSubtests] = useState(0);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    // FUZZY MATCH STATE (when multiple similar tests are found)
    const [showFuzzyModal, setShowFuzzyModal] = useState(false);
    const [fuzzyMatches, setFuzzyMatches] = useState<SimilarTestMatch[]>([]);
    const [canonicalTest, setCanonicalTest] = useState<{ id: string; name: string } | null>(null);
    const [canonicalSubtests, setCanonicalSubtests] = useState<CanonicalSubtestEntry[]>([]);
    const [isCanonicalLoading, setIsCanonicalLoading] = useState(false);
    const [showUnmappedModal, setShowUnmappedModal] = useState(false);
    // Track subtest names that had duplicate sids from extraction (user must rename)
    const [duplicatedSids, setDuplicatedSids] = useState<string[]>([]);
    const [showDisambiguationModal, setShowDisambiguationModal] = useState(false);

    const toast = useToast();

    // --- DRAFT: check on mount ---
    useEffect(() => {
        const d = loadDraft();
        if (d && d.pages.length > 0) {
            draftRef.current = d;
            setHasPendingDraft(true);
        }
    }, []);

    // --- DRAFT: auto-save when editor state changes ---
    const persistDraft = useCallback(() => {
        if (pages.length === 0) return;
        saveDraft({
            testName,
            selectedCategory,
            tableStructure,
            pages,
            savedAt: new Date().toISOString(),
        });
    }, [testName, selectedCategory, tableStructure, pages]);

    useEffect(() => { persistDraft(); }, [persistDraft]);

    const restoreDraft = () => {
        const d = draftRef.current;
        if (!d) return;
        // Re-disambiguate variant subtests that may have been collapsed before the fix
        reDisambiguateByAbbreviation(d.pages);
        setTestName(d.testName);
        setSelectedCategory(d.selectedCategory);
        setTableStructure(d.tableStructure);
        setPages(d.pages);
        setCurrentFileIndex(0);
        setStep('editor');
        setHasPendingDraft(false);
        draftRef.current = null;
        toast.success(`Brouillon restauré (${d.pages.length} page${d.pages.length > 1 ? 's' : ''})`);
    };

    const discardDraft = () => {
        clearDraft();
        setHasPendingDraft(false);
        draftRef.current = null;
    };

    const currentPage = pages[currentFileIndex] || null;
    const currentRows = currentPage?.rows || [];
    const allRows = useMemo(() => pages.flatMap(page => page.rows), [pages]);
    const canonicalSubtestsNormalized = useMemo<CanonicalSubtestEntry[]>(() => (
        canonicalSubtests.map((sub) => {
            const parsed = splitSubtestDisplayName(sub.name);
            const normalizedAbbr = normalizeAbbreviation(sub.abbreviation || parsed.abbreviation);
            return {
                id: sub.id,
                name: parsed.baseName || sub.name.trim(),
                abbreviation: normalizedAbbr || null,
            };
        })
    ), [canonicalSubtests]);
    const canonicalNameInventory = useMemo(
        () => Array.from(new Set(canonicalSubtestsNormalized.map((sub) => sub.name).filter(Boolean))),
        [canonicalSubtestsNormalized]
    );
    const canonicalSubtestsByAbbreviation = useMemo(() => {
        const map = new Map<string, CanonicalSubtestEntry[]>();
        canonicalSubtestsNormalized.forEach((sub) => {
            const abbr = normalizeAbbreviation(sub.abbreviation);
            if (!abbr) return;
            const existing = map.get(abbr) || [];
            existing.push(sub);
            map.set(abbr, existing);
        });
        return map;
    }, [canonicalSubtestsNormalized]);
    const canonicalSubtestsByName = useMemo(() => {
        const map = new Map<string, CanonicalSubtestEntry[]>();
        canonicalSubtestsNormalized.forEach((sub) => {
            const normalized = normalizeSubtestName(sub.name);
            if (!normalized) return;
            const existing = map.get(normalized) || [];
            existing.push(sub);
            map.set(normalized, existing);
        });
        return map;
    }, [canonicalSubtestsNormalized]);

    // Stable object URL for current file preview — revoke on change to prevent memory leaks
    const currentFileUrl = useMemo(() => {
        if (files.length === 0 || currentFileIndex >= files.length) return null;
        return URL.createObjectURL(files[currentFileIndex]);
    }, [files, currentFileIndex]);

    useEffect(() => {
        return () => { if (currentFileUrl) URL.revokeObjectURL(currentFileUrl); };
    }, [currentFileUrl]);

    useEffect(() => {
        const trimmed = testName.trim();
        if (!trimmed || trimmed.length < 3) {
            setCanonicalTest(null);
            setCanonicalSubtests([]);
            return;
        }

        let canceled = false;
        const loadCanonicalSubtests = async () => {
            setIsCanonicalLoading(true);
            try {
                const { data: tests, error: testsError } = await supabase
                    .from('view_unified_catalog')
                    .select('id, label')
                    .ilike('label', `%${trimmed}%`);

                if (testsError) throw testsError;

                const normalized = normalizeTestName(trimmed);
                const matchedTest = (tests || []).find(t => normalizeTestName(t.label) === normalized) || null;

                if (!matchedTest) {
                    if (!canceled) {
                        setCanonicalTest(null);
                        setCanonicalSubtests([]);
                    }
                    return;
                }

                const { data: subs, error: subsError } = await supabase
                    .from('view_unified_subtests')
                    .select('id, name, abbreviation')
                    .eq('test_id', matchedTest.id);

                if (subsError) throw subsError;

                if (!canceled) {
                    setCanonicalTest({ id: matchedTest.id, name: matchedTest.label });
                    setCanonicalSubtests(
                        (subs || []).map((sub: { id: string; name: string; abbreviation?: string | null }) => ({
                            id: sub.id,
                            name: sub.name,
                            abbreviation: sub.abbreviation ?? null,
                        }))
                    );
                }
            } catch (error) {
                Logger.error('DB', 'Canonical subtests load failed', error);
                if (!canceled) {
                    setCanonicalTest(null);
                    setCanonicalSubtests([]);
                }
            } finally {
                if (!canceled) setIsCanonicalLoading(false);
            }
        };

        loadCanonicalSubtests();
        return () => { canceled = true; };
    }, [testName]);

    // Load categories from DB (official_categories) for the category selector
    useEffect(() => {
        let canceled = false;
        const loadCategories = async () => {
            setIsCategoryLoading(true);
            try {
                const { data, error } = await supabase
                    .from('official_categories')
                    .select('id, label, sort_order')
                    .order('sort_order', { ascending: true });

                if (error) throw error;

                const options = (data || []).map((c: { id: string; label: string; sort_order?: number | null }) => ({
                    id: c.id,
                    label: c.label,
                    sortOrder: c.sort_order ?? null
                }));

                const fallback = options.length > 0
                    ? options
                    : (TEST_CATALOG || []).map(c => ({ id: c.id, label: c.name, sortOrder: c.sortOrder }));

                if (!canceled) {
                    setCategoryOptions(fallback);
                    setSelectedCategory(prev => prev || fallback[0]?.id || '');
                }
            } catch (error) {
                Logger.error('DB', 'Failed to load categories', error);
                const fallback = (TEST_CATALOG || []).map(c => ({ id: c.id, label: c.name, sortOrder: c.sortOrder }));
                if (!canceled) {
                    setCategoryOptions(fallback);
                    setSelectedCategory(prev => prev || fallback[0]?.id || '');
                }
            } finally {
                if (!canceled) setIsCategoryLoading(false);
            }
        };

        loadCategories();
        return () => { canceled = true; };
    }, []);

    // --- HELPER FUNCTIONS ---

    const cleanNumberStr = (val: string): string => {
        if (!val) return "";
        let cleaned = val.replace(/,/g, '.').replace(/[^\d.-]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) {
            cleaned = parts[0] + '.' + parts.slice(1).join('');
        }
        return cleaned;
    };

    const formatLabel = (rawLabel: string): string => {
        if (!rawLabel) return "";
        const upper = rawLabel.toUpperCase().trim();
        if (upper.includes('ANS') || upper.match(/\d+[-:]\d+/)) return rawLabel;
        const age = GRADE_TO_AGE[upper];
        if (age) return `${age} (${rawLabel})`;
        return rawLabel;
    };

    /** Build a human-readable label from age-in-months values (e.g. 60,65 → "5;0 – 5;5") */
    const formatAgeLabel = (ageMin?: number, ageMax?: number): string => {
        if (ageMin === undefined || ageMax === undefined) return "";
        const fmtAge = (m: number) => `${Math.floor(m / 12)};${m % 12}`;
        if (ageMin === ageMax) return fmtAge(ageMin);
        return `${fmtAge(ageMin)} – ${fmtAge(ageMax)}`;
    };

    const sanitizeAndCalculate = (row: ExtractedRow, currentStructure: TableStructure, triggerField?: keyof ExtractedRow): ExtractedRow => {
        const newRow = { ...row };

        // Nettoyage des valeurs numériques
        newRow.standard = cleanNumberStr(newRow.standard || '');
        newRow.zScore = cleanNumberStr(newRow.zScore || '');
        newRow.percentile = cleanNumberStr(newRow.percentile || '');
        if (newRow.mean) newRow.mean = cleanNumberStr(newRow.mean);
        if (newRow.sd) newRow.sd = cleanNumberStr(newRow.sd || '');

        const sVal = parseFloat(newRow.standard);
        const zVal = parseFloat(newRow.zScore);
        const pVal = parseFloat(newRow.percentile);

        // Si Paramétrique : Pas de calcul auto NS/ET/% car ce sont des constantes statistiques
        if (currentStructure === 'PARAMETRIC') {
            return newRow;
        }

        // Si Lookup : Calculs automatiques de cohérence
        if ((triggerField === 'standard' && !isNaN(sVal)) || (!triggerField && !isNaN(sVal) && isNaN(zVal))) {
            const type = sVal > 20 ? 'standard' : 'scaled';
            const res = calculateFromStandard(sVal, type);
            newRow.zScore = res.zScore.toString();
            newRow.percentile = res.percentile.toString();
        }
        else if ((triggerField === 'zScore' && !isNaN(zVal)) || (!triggerField && !isNaN(zVal) && isNaN(sVal))) {
            const res = calculateFromZ(zVal, 'standard');
            newRow.percentile = res.percentile.toString();
            if (!newRow.standard) newRow.standard = res.standard;
        }
        else if ((triggerField === 'percentile' && !isNaN(pVal)) || (!triggerField && !isNaN(pVal) && isNaN(zVal))) {
            const res = calculateFromPercentile(pVal, 'standard');
            newRow.zScore = res.zScore.toString();
            if (!newRow.standard) newRow.standard = res.standard;
        }

        return newRow;
    };

    const groupRowsBySubtest = (inputRows: ExtractedRow[]): Record<string, ExtractedRow[]> => (
        inputRows.reduce((acc, row) => {
            const key = row.subtest || "Global";
            if (!acc[key]) acc[key] = [];
            acc[key].push(row);
            return acc;
        }, {} as Record<string, ExtractedRow[]>)
    );

    // --- PROCESSING FUNCTION (now uses dedicated extract-norms edge function with restored prompts) ---

    const processSingleExtraction = async (file: File, knownSubtestNames?: string[]) => {
        const imagePart = await fileToGenerativePart(file);
        const filename = file.name;

        const response = await callExtractionTask({
            filename,
            imagePart,
            knownSubtestNames: knownSubtestNames || [],
            canonicalSubtestNames: canonicalNameInventory,
        });

        const expandedData = expandCompactKeys(cleanAndParseJson(response.text));
        const extractedData = expandedData as AIExtractionResult | null;
        const flatRows: ExtractedRow[] = [];
        const detectedStructure: TableStructure = extractedData?.structure_type || 'LOOKUP';

        // Page-level age fallback: if Gemini set pa0/pa1, propagate to rows with null a0/a1
        const pageAgeMin = (extractedData as Record<string, unknown>)?.page_age_min as number | null | undefined;
        const pageAgeMax = (extractedData as Record<string, unknown>)?.page_age_max as number | null | undefined;

        // Ultimate fallback: parse age from filename if Gemini missed it entirely
        const filenameAge = parseAgeFromFilename(filename);
        const fallbackAgeMin = pageAgeMin ?? filenameAge?.min ?? undefined;
        const fallbackAgeMax = pageAgeMax ?? filenameAge?.max ?? undefined;

        const duplicatedBaseNames: string[] = [];
        if (extractedData && Array.isArray(extractedData.tables)) {
            // --- DETECT DUPLICATE subtest_ids across tables ---
            const sidCounts = new Map<string, number>();
            extractedData.tables.forEach((table: AIExtractedTable) => {
                const sid = table.subtest_id || extractedData?.test_context || "Global";
                sidCounts.set(sid, (sidCounts.get(sid) || 0) + 1);
            });

            // Pre-collect abbreviations per sid: if every duplicate table for a given
            // sid carries a unique source_abbreviation, use it instead of "(variante N)".
            const sidAbbrSets = new Map<string, Set<string>>();
            extractedData.tables.forEach((table: AIExtractedTable) => {
                const sid = table.subtest_id || extractedData?.test_context || "Global";
                if (table.source_abbreviation) {
                    if (!sidAbbrSets.has(sid)) sidAbbrSets.set(sid, new Set());
                    sidAbbrSets.get(sid)!.add(table.source_abbreviation);
                }
            });
            const canUseAbbrNaming = (sid: string): boolean => {
                const abbrs = sidAbbrSets.get(sid);
                return !!abbrs && abbrs.size === (sidCounts.get(sid) || 0);
            };

            const sidCounters = new Map<string, number>();

            extractedData.tables.forEach((table: AIExtractedTable) => {
                const originalSid = table.subtest_id || extractedData?.test_context || "Global";
                let effectiveSid = originalSid;
                if ((sidCounts.get(originalSid) || 0) > 1) {
                    const counter = (sidCounters.get(originalSid) || 0) + 1;
                    sidCounters.set(originalSid, counter);
                    if (canUseAbbrNaming(originalSid) && table.source_abbreviation) {
                        effectiveSid = `${originalSid} (${table.source_abbreviation})`;
                    } else {
                        effectiveSid = `${originalSid} (variante ${counter})`;
                    }
                    if (!duplicatedBaseNames.includes(originalSid)) duplicatedBaseNames.push(originalSid);
                }
                if (Array.isArray(table.rows)) {
                    table.rows.forEach((r: AIExtractedNormRow) => {
                        const rawRow: ExtractedRow = {
                            id: crypto.randomUUID(),
                            subtest: effectiveSid,
                            raw: detectedStructure === 'LOOKUP' ? (r.raw_range ? String(r.raw_range) : '') : '',
                            standard: detectedStructure === 'LOOKUP' ? (r.standard ? String(r.standard) : '') : '',
                            mean: detectedStructure === 'PARAMETRIC' ? (r.mean ? String(r.mean) : '') : undefined,
                            sd: detectedStructure === 'PARAMETRIC' ? (r.sd ? String(r.sd) : '') : undefined,
                            zScore: r.z_score ? String(r.z_score) : '',
                            percentile: r.percentile ? String(r.percentile) : '',

                            // CAPTURE DES CHAMPS CACHÉS — fallback to page-level age, then filename age
                            hidden_age_min: r.age_min_months ?? fallbackAgeMin,
                            hidden_age_max: r.age_max_months ?? fallbackAgeMax,
                            hidden_raw_min: r.raw_min,
                            hidden_raw_max: r.raw_max,

                            // Preserve original column abbreviation for disambiguation UI
                            source_abbreviation: table.source_abbreviation || undefined,
                        };
                        // Auto-compute label from age fields (AI no longer outputs label)
                        rawRow.label = formatAgeLabel(rawRow.hidden_age_min, rawRow.hidden_age_max);
                        flatRows.push(sanitizeAndCalculate(rawRow, detectedStructure));
                    });
                }
            });
        }

        if (flatRows.length === 0) {
            flatRows.push({ id: crypto.randomUUID(), subtest: 'Nouveau Sous-test', label: '', raw: '', standard: '', zScore: '', percentile: '' });
        }

        return {
            rows: flatRows,
            detectedStructure,
            testContext: extractedData?.test_context || '',
            duplicatedSids: duplicatedBaseNames
        };
    };

    const processFilesSequentially = async (inputFiles: File[]) => {
        suppressIdleLock();
        try {
            const nextPages: ExtractionPage[] = [];
            let resolvedStructure: TableStructure = tableStructure;
            let resolvedTestName = testName;
            const knownSubtestNames: string[] = [];

            // PARALLEL PROCESSING: Extract all files at once for much faster processing
            Logger.info('ADMIN', `Starting parallel extraction of ${inputFiles.length} file(s)`);
            
            const extractionPromises = inputFiles.map(async (file, i) => {
                try {
                    setCurrentFileIndex(i);
                    const result = await processSingleExtraction(file, knownSubtestNames.length > 0 ? knownSubtestNames : undefined);
                    
                    // Collect unique subtest names from this page
                    const pageSubtests = new Set(result.rows.map(r => r.subtest).filter(Boolean));
                    pageSubtests.forEach(name => {
                        if (!knownSubtestNames.includes(name)) knownSubtestNames.push(name);
                    });
                    
                    return { result, index: i, success: true };
                } catch (error) {
                    Logger.error('ADMIN', `Failed to extract ${file.name}`, error);
                    return { result: null, index: i, success: false, error };
                }
            });
            
            const results = await Promise.all(extractionPromises);
            
            // Collect all duplicated sids from across pages
            const allDuplicatedSids = new Set<string>();
            results.forEach(({ result }) => {
                if (result?.duplicatedSids) {
                    result.duplicatedSids.forEach(sid => allDuplicatedSids.add(sid));
                }
            });
            if (allDuplicatedSids.size > 0) {
                setDuplicatedSids(Array.from(allDuplicatedSids));
                setShowDisambiguationModal(true);
            } else {
                setDuplicatedSids([]);
            }

            // Process results in order — save draft progressively so no data is lost
            for (let i = 0; i < results.length; i += 1) {
                const { result, success, error } = results[i];
                
                if (!success || !result) {
                    toast.error(`Erreur sur la page ${i + 1}: ${error instanceof Error ? error.message : 'Extraction échouée'}`);
                    continue;
                }
                
                if (resolvedStructure === 'UNKNOWN') {
                    resolvedStructure = result.detectedStructure;
                } else if (result.detectedStructure !== resolvedStructure) {
                    toast.error("Structure différente détectée entre pages. Vérifiez les documents.");
                }

                if (result.testContext && !resolvedTestName) {
                    resolvedTestName = result.testContext;
                    setTestName(result.testContext);
                }

                nextPages.push({
                    id: crypto.randomUUID(),
                    fileIndex: i,
                    rows: result.rows,
                    validated: false,
                    detectedStructure: result.detectedStructure
                });

                // Progressive draft save — each successful page is persisted immediately
                saveDraft({
                    testName: resolvedTestName || testName,
                    selectedCategory,
                    tableStructure: resolvedStructure,
                    pages: nextPages,
                    savedAt: new Date().toISOString(),
                });
            }

            // --- Post-extraction: strict canonical matching or legacy dedup ---
            const canonicalNames = canonicalNameInventory;

            if (canonicalSubtestsNormalized.length > 0) {
                // DB-backed test → strict filter: only keep rows matching a canonical subtest
                let droppedCount = 0;
                nextPages.forEach(page => {
                    const kept: ExtractedRow[] = [];
                    page.rows.forEach(row => {
                        const parsed = splitSubtestDisplayName(row.subtest);
                        const rowAbbr = normalizeAbbreviation(row.source_abbreviation || parsed.abbreviation);
                        const aliased = resolveSubtestAlias(resolvedTestName, parsed.baseName || row.subtest);

                        let matchedCanonical: CanonicalSubtestEntry | null = null;

                        // 1) Abbreviation-first match when available (most reliable for variants)
                        if (rowAbbr) {
                            const abbrCandidates = canonicalSubtestsByAbbreviation.get(rowAbbr) || [];
                            if (abbrCandidates.length === 1) {
                                matchedCanonical = abbrCandidates[0];
                            } else if (abbrCandidates.length > 1) {
                                const narrowed = findBestCanonicalMatch(aliased, abbrCandidates.map(c => c.name));
                                if (narrowed) {
                                    matchedCanonical = abbrCandidates.find(c => c.name === narrowed) || null;
                                }
                            }
                        }

                        // 2) Fallback to name-based canonical match
                        if (!matchedCanonical) {
                            const matchName = findBestCanonicalMatch(aliased, canonicalNames);
                            if (matchName) {
                                const candidates = canonicalSubtestsByName.get(normalizeSubtestName(matchName)) || [];
                                if (candidates.length === 1) {
                                    matchedCanonical = candidates[0];
                                } else if (candidates.length > 1) {
                                    if (rowAbbr) {
                                        matchedCanonical = candidates.find(c => normalizeAbbreviation(c.abbreviation) === rowAbbr) || candidates[0];
                                    } else {
                                        matchedCanonical = candidates[0];
                                    }
                                }
                            }
                        }

                        if (!matchedCanonical) {
                            droppedCount++;
                            return;
                        }

                        const canonicalAbbr = normalizeAbbreviation(matchedCanonical.abbreviation);
                        const displayAbbr = canonicalAbbr || rowAbbr || null;
                        kept.push({
                            ...row,
                            subtest: formatSubtestDisplayName(matchedCanonical.name, displayAbbr),
                            source_abbreviation: rowAbbr || canonicalAbbr || undefined,
                        });
                    });
                    page.rows = kept;
                });
                if (droppedCount > 0) {
                    Logger.info('AI', `Strict filter: ${droppedCount} row(s) dropped (no canonical match)`);
                }
            } else {
                // Unknown test → legacy dedup: unify subtest names across pages
                const nameMapping = new Map<string, string>();
                nextPages.forEach(page => {
                    page.rows.forEach(row => {
                        const alias = resolveSubtestAlias(resolvedTestName, row.subtest);
                        const norm = normalizeSubtestName(alias);
                        if (!norm) return;
                        if (!nameMapping.has(norm)) {
                            nameMapping.set(norm, alias);
                        }
                    });
                });
                nextPages.forEach(page => {
                    page.rows = page.rows.map(row => {
                        const alias = resolveSubtestAlias(resolvedTestName, row.subtest);
                        const norm = normalizeSubtestName(alias);
                        const canonical = norm ? nameMapping.get(norm) : null;
                        if (canonical && canonical !== row.subtest) {
                            return { ...row, subtest: canonical };
                        }
                        return row;
                    });
                });
            }

            // Re-disambiguate variant subtests collapsed by canonical matching
            reDisambiguateByAbbreviation(nextPages);

            setTableStructure(resolvedStructure);
            setPages(nextPages);
            setCurrentFileIndex(0);
            setStep('editor');
        } catch (error) {
            Logger.error('AI', "Gemini Extraction Error", error);
            toast.error("Erreur lors de l'analyse du document. Vérifiez la qualité de l'image.");
            setStep('upload');
        } finally {
            resumeIdleLock();
        }
    };

    // --- HANDLERS ---

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files) as File[];
            setFiles(newFiles);
            setCurrentFileIndex(0);
            setTableStructure('UNKNOWN');
            setPages([]);
            setStep('processing');
            processFilesSequentially(newFiles);
        }
    };

    const currentGroupedRows = useMemo(() => groupRowsBySubtest(currentRows), [currentRows]);
    const currentGroupedEntries = useMemo(
        () => Object.entries(currentGroupedRows) as Array<[string, ExtractedRow[]]>,
        [currentGroupedRows]
    );

    const stripAgeQualifier = useCallback((name: string): string => {
        const trimmed = name.trim();
        if (!trimmed) return trimmed;

        const cleaned = trimmed.replace(/\(([^)]*)\)/g, (match, inner) => {
            const content = String(inner).toLowerCase();
            const hasAgeHint = /\bage\b|\bans\b|\bmois\b|\d+\s*;\s*\d+|\d+\s*[-:]\s*\d+/.test(content);
            return hasAgeHint ? '' : match;
        });

        return cleaned
            .replace(/\s*(?:[-–—:]\s*)?age\s*\d.*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }, []);

    const resolveCanonicalSubtest = useCallback((row: ExtractedRow) => {
        const parsed = splitSubtestDisplayName(row.subtest);
        const sourceAbbr = normalizeAbbreviation(row.source_abbreviation || parsed.abbreviation);
        const baseName = canonicalSubtestsNormalized.length > 0
            ? stripAgeQualifier(parsed.baseName)
            : parsed.baseName;
        const alias = resolveSubtestAlias(testName, baseName).trim();
        const fallbackName = alias || parsed.baseName || row.subtest;
        const normalized = normalizeSubtestName(alias);

        if (canonicalSubtestsNormalized.length === 0 || !normalized) {
            return {
                name: fallbackName,
                abbreviation: sourceAbbr || null,
                displayName: formatSubtestDisplayName(fallbackName, sourceAbbr || null),
                isMapped: true,
            };
        }

        const candidates = canonicalSubtestsByName.get(normalized) || [];
        if (candidates.length === 1) {
            const candidate = candidates[0];
            const candidateAbbr = normalizeAbbreviation(candidate.abbreviation);
            const displayAbbr = candidateAbbr || sourceAbbr || null;
            return {
                name: candidate.name,
                abbreviation: candidateAbbr || sourceAbbr || null,
                displayName: formatSubtestDisplayName(candidate.name, displayAbbr),
                isMapped: true,
            };
        }

        if (candidates.length > 1) {
            if (sourceAbbr) {
                const exact = candidates.find(c => normalizeAbbreviation(c.abbreviation) === sourceAbbr);
                if (exact) {
                    const exactAbbr = normalizeAbbreviation(exact.abbreviation) || sourceAbbr;
                    return {
                        name: exact.name,
                        abbreviation: exactAbbr || null,
                        displayName: formatSubtestDisplayName(exact.name, exactAbbr || null),
                        isMapped: true,
                    };
                }
            }

            const narrowedName = findBestCanonicalMatch(alias, candidates.map(c => c.name));
            if (narrowedName) {
                const narrowed = candidates.find(c => c.name === narrowedName) || candidates[0];
                const narrowedAbbr = normalizeAbbreviation(narrowed.abbreviation) || sourceAbbr;
                return {
                    name: narrowed.name,
                    abbreviation: narrowedAbbr || null,
                    displayName: formatSubtestDisplayName(narrowed.name, narrowedAbbr || null),
                    isMapped: true,
                };
            }
        }

        return {
            name: fallbackName,
            abbreviation: sourceAbbr || null,
            displayName: formatSubtestDisplayName(fallbackName, sourceAbbr || null),
            isMapped: false,
        };
    }, [canonicalSubtestsNormalized.length, canonicalSubtestsByName, stripAgeQualifier, testName]);

    const VARIANT_PATTERN = /\(variante \d+\)$/;
    const unrenamedVariants = useMemo(() => {
        return currentGroupedEntries
            .map(([name]) => name)
            .filter(name => VARIANT_PATTERN.test(name));
    }, [currentGroupedEntries]);
    const hasUnrenamedVariants = unrenamedVariants.length > 0;

    const canonicalGroupedEntries = useMemo<CanonicalGroupedEntry[]>(() => {
        const grouped = new Map<string, CanonicalGroupedEntry>();
        allRows.forEach((row) => {
            const resolved = resolveCanonicalSubtest(row);
            const key = buildSubtestIdentityKey(resolved.name, resolved.abbreviation);
            const existing = grouped.get(key);
            if (existing) {
                existing.rows.push(row);
            } else {
                grouped.set(key, {
                    name: resolved.name,
                    abbreviation: resolved.abbreviation || null,
                    displayName: resolved.displayName,
                    rows: [row],
                });
            }
        });
        return Array.from(grouped.values());
    }, [allRows, resolveCanonicalSubtest]);

    const unmappedSubtests = useMemo(() => {
        if (!canonicalTest || canonicalSubtestsNormalized.length === 0) return [];
        const missing = new Set<string>();
        allRows.forEach((row) => {
            const resolved = resolveCanonicalSubtest(row);
            if (!resolved.isMapped) {
                missing.add(resolved.displayName);
            }
        });
        return Array.from(missing.values());
    }, [allRows, canonicalSubtestsNormalized.length, canonicalTest, resolveCanonicalSubtest]);

    const updateCurrentPageRows = (updater: (rows: ExtractedRow[]) => ExtractedRow[]) => {
        setPages(prev => prev.map((page, index) => {
            if (index !== currentFileIndex) return page;
            return { ...page, rows: updater(page.rows) };
        }));
    };

    const updateAllPagesRows = (updater: (rows: ExtractedRow[]) => ExtractedRow[]) => {
        setPages(prev => prev.map(page => ({ ...page, rows: updater(page.rows) })));
    };

    /** Apply user-supplied renames from DisambiguationModal to all rows across all pages. */
    const handleDisambiguationConfirm = useCallback((renames: Record<string, string>) => {
        setPages(prev => prev.map(page => ({
            ...page,
            rows: page.rows.map(row => {
                const newName = renames[row.subtest];
                return newName ? { ...row, subtest: newName } : row;
            }),
        })));
        setDuplicatedSids([]);
        setShowDisambiguationModal(false);
        toast.success('Sous-tests renommés avec succès.');
    }, [toast]);

    const handleValidateCurrentPage = () => {
        setPages(prev => prev.map((page, index) => (
            index === currentFileIndex ? { ...page, validated: true } : page
        )));
    };

    const handleRowChange = (id: string, field: keyof ExtractedRow, value: string) => {
        updateCurrentPageRows(prev => prev.map(r => {
            if (r.id !== id) return r;
            const updated = { ...r, [field]: value };
            if (tableStructure === 'LOOKUP' && ['standard', 'zScore', 'percentile'].includes(field)) {
                return sanitizeAndCalculate(updated, tableStructure, field);
            }
            return updated;
        }));
    };

    // NEW: Update label for a whole batch (group)
    const handleBatchLabelChange = (subtestName: string, oldLabel: string, newLabel: string) => {
        updateCurrentPageRows(prev => prev.map(r =>
            (r.subtest === subtestName && r.label === oldLabel)
                ? { ...r, label: newLabel }
                : r
        ));
    };

    // NEW: Add row to a specific batch
    const handleAddRowToBatch = (subtestName: string, label: string) => {
        updateCurrentPageRows(prev => [...prev, {
            id: crypto.randomUUID(),
            subtest: subtestName,
            label: label,
            raw: '', standard: '', zScore: '', percentile: ''
        }]);
    };

    const checkConsistency = (row: ExtractedRow): boolean => {
        if (tableStructure === 'PARAMETRIC') return true;
        const zStr = cleanNumberStr(row.zScore || '');
        const pStr = cleanNumberStr(row.percentile || '');
        const z = parseFloat(zStr);
        const p = parseFloat(pStr);
        if (isNaN(z) || isNaN(p)) return true;
        const expectedP = zScoreToPercentile(z);
        return Math.abs(expectedP - p) < 5;
    };

    const handleSubtestNameChange = (oldName: string, iName: string) => {
        updateAllPagesRows(prev => prev.map(r => r.subtest === oldName ? { ...r, subtest: iName } : r));
    };

    const handleAddRowToSubtest = (subtestName: string) => {
        updateCurrentPageRows(prev => [...prev, { id: crypto.randomUUID(), subtest: subtestName, label: '', raw: '', standard: '', zScore: '', percentile: '' }]);
    };

    const handleDeleteRow = (id: string) => updateCurrentPageRows(prev => prev.filter(r => r.id !== id));
    const handleAddSubtest = () => handleAddRowToSubtest("Nouveau Sous-test " + (Object.keys(currentGroupedRows).length + 1));

    // --- PRE-SAVE CHECK ---
    const handlePreSave = () => {
        if (!testName.trim()) {
            setTestNameError(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (pages.length > 0 && pages.some(page => !page.validated)) {
            toast.error("Validez chaque page avant d'enregistrer le test.");
            return;
        }
        if (hasUnrenamedVariants) {
            toast.error(`${unrenamedVariants.length} sous-test(s) portent encore un suffixe "(variante N)". Renommez-les avant d'enregistrer.`);
            return;
        }
        if (canonicalTest && unmappedSubtests.length > 0) {
            setShowUnmappedModal(true);
            return;
        }
        setShowSaveModal(true);
    };

    // --- HELPER: Build norm payload from an ExtractedRow ---
    const buildNormPayload = (row: ExtractedRow) => {
        const mode: TableStructure = tableStructure === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP';
        // AGE: AI values first, JS fallback
        let ageMin = row.hidden_age_min;
        let ageMax = row.hidden_age_max;
        if (ageMin === undefined || ageMax === undefined) {
            // Fallback: try to parse age from label string (e.g. "5;0 – 5;5")
            const ageMatch = (row.label || '').match(/(\d+)[;:.](\d+)/);
            if (ageMatch) {
                const months = parseInt(ageMatch[1]) * 12 + parseInt(ageMatch[2]);
                ageMin = ageMin ?? months;
                ageMax = ageMax ?? months;
            } else {
                ageMin = ageMin ?? 0;
                ageMax = ageMax ?? 0;
            }
        }

        // RAW SCORES / STATS
        let mean: number | null = null;
        let sd: number | null = null;
        let rawMin: number | null = null;
        let rawMax: number | null = null;

        if (mode === 'PARAMETRIC') {
            mean = parseFloat(row.mean || row.raw) || 0;
            sd = parseFloat(row.sd || row.zScore) || 0;
            rawMin = null;
            rawMax = null;
        } else {
            if (row.hidden_raw_min !== undefined && row.hidden_raw_max !== undefined) {
                rawMin = row.hidden_raw_min;
                rawMax = row.hidden_raw_max;
            } else {
                const cleanRaw = row.raw.replace(',', '.').replace(/[^\d.-]/g, '');
                if (cleanRaw.includes('-')) {
                    const parts = cleanRaw.split('-');
                    rawMin = parseFloat(parts[0]);
                    rawMax = parseFloat(parts[1]);
                } else {
                    const val = parseFloat(cleanRaw);
                    rawMin = val;
                    rawMax = val;
                }
                if (rawMin !== null && isNaN(rawMin)) rawMin = null;
                if (rawMax !== null && isNaN(rawMax)) rawMax = null;
            }
        }

        return {
            age_min_months: ageMin,
            age_max_months: ageMax,
            gender: 'Mixed',
            raw_min: rawMin,
            raw_max: rawMax,
            mean,
            sd,
            standard_score: mode === 'LOOKUP' ? (parseFloat(row.standard) || null) : null,
            percentile: mode === 'LOOKUP' ? (parseFloat(row.percentile) || null) : null
        };
    };

    const makeComparableSubtestKey = useCallback((name: string, abbreviation?: string | null): string => {
        const parsed = splitSubtestDisplayName(name);
        const resolvedName = resolveSubtestAlias(testName, stripAgeQualifier(parsed.baseName)).trim() || parsed.baseName || name;
        const resolvedAbbr = normalizeAbbreviation(abbreviation || parsed.abbreviation);
        return buildSubtestIdentityKey(resolvedName, resolvedAbbr || null);
    }, [stripAgeQualifier, testName]);

    const buildTestPayload = () => ({
        test: {
            name: testName.trim(),
            category_id: selectedCategory,
            version: '1.0',
            structure_type: tableStructure === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP'
        },
        subtests: canonicalGroupedEntries.map((entry) => ({
            name: entry.name,
            abbreviation: normalizeAbbreviation(entry.abbreviation) || null,
            unit: 'pts',
            score_type: 'scaled',
            computation_mode: tableStructure === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP',
            input_model: 'numeric_4mode',
            input_config: {},
            norms: entry.rows.map(row => buildNormPayload(row))
        }))
    });

    // --- DETECT DUPLICATE & ASK USER (cross-scope fuzzy search) ---
    const handleFinalSave = async () => {
        if (!legalConsent) return;
        if (!selectedCategory) {
            toast.error('Veuillez sélectionner une catégorie valide.');
            return;
        }

        setIsSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Utilisateur non connecté");
            setCurrentUserId(user.id);

            // --- CROSS-SCOPE DEDUP: fuzzy search (public + org private) ---
            const similarTests = await AdminService.findSimilarTests(testName, 0.3);

            if (similarTests.length > 0) {
                // Check for high-confidence match (score > 0.85)
                const bestMatch = similarTests[0];

                if (bestMatch.similarity_score > 0.85) {
                    // Strong match → show merge/attach modal directly
                    const { data: existingSubs } = await supabase
                        .from('view_unified_subtests')
                        .select('id, name, abbreviation')
                        .eq('test_id', bestMatch.id);
                    const existingSubKeys = new Set(
                        (existingSubs || []).map(s => makeComparableSubtestKey(s.name, s.abbreviation))
                    );
                    const newSubs = canonicalGroupedEntries
                        .filter(entry => !existingSubKeys.has(makeComparableSubtestKey(entry.name, entry.abbreviation)));

                    const isPublic = bestMatch.organization_id === null;
                    setMergeTarget({ id: bestMatch.id, name: bestMatch.name, subtestCount: existingSubs?.length || 0, isPublic });
                    setMergeNewSubtests(newSubs.length);
                    setMergeNewAgeRanges(allRows.length);
                    setShowSaveModal(false);
                    setShowMergeModal(true);
                    return;
                }

                // Medium matches → show fuzzy selection modal
                setFuzzyMatches(similarTests);
                setShowSaveModal(false);
                setShowFuzzyModal(true);
                return;
            }

            // No similar test found → create normally
            await performCreate();

        } catch (e: unknown) {
            Logger.error('DB', "Erreur sauvegarde test:", e);
            toast.error("Erreur lors de la création : " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsSaving(false);
        }
    };

    // --- SELECT FROM FUZZY MATCHES ---
    const handleSelectFuzzyMatch = async (match: SimilarTestMatch) => {
        setShowFuzzyModal(false);
        setIsSaving(true);
        try {
            const { data: existingSubs } = await supabase
                .from('view_unified_subtests')
                .select('id, name, abbreviation')
                .eq('test_id', match.id);
            const existingSubKeys = new Set(
                (existingSubs || []).map(s => makeComparableSubtestKey(s.name, s.abbreviation))
            );
            const newSubs = canonicalGroupedEntries
                .filter(entry => !existingSubKeys.has(makeComparableSubtestKey(entry.name, entry.abbreviation)));

            const isPublic = match.organization_id === null;
            setMergeTarget({ id: match.id, name: match.name, subtestCount: existingSubs?.length || 0, isPublic });
            setMergeNewSubtests(newSubs.length);
            setMergeNewAgeRanges(allRows.length);
            setShowMergeModal(true);
        } catch (e) {
            Logger.error('DB', 'Error loading match details:', e);
            toast.error('Erreur chargement du test similaire.');
        } finally {
            setIsSaving(false);
        }
    };

    // --- SKIP FUZZY, CREATE NEW ---
    const handleSkipFuzzy = async () => {
        setShowFuzzyModal(false);
        setIsSaving(true);
        try {
            await performCreate();
        } catch (e: unknown) {
            Logger.error('DB', "Erreur création:", e);
            toast.error("Erreur : " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsSaving(false);
        }
    };

    // --- CREATE NEW TEST (original flow) ---
    const performCreate = async () => {
        const payload = buildTestPayload();
        const testId = await AdminService.createPrivateTest(payload);

        Logger.info('DB', "Test privé créé avec succès.");
        finishSuccess(testId);
    };

    // --- MERGE / ATTACH INTO EXISTING TEST ---
    const performMerge = async () => {
        if (!mergeTarget) return;
        setIsSaving(true);
        try {
            const existingTestId = mergeTarget.id;
            const payload = buildTestPayload();

            if (mergeTarget.isPublic) {
                // Public test → attach private subtests (scoped to user's org)
                const result = await AdminService.attachSubtestsToTest(existingTestId, payload);
                Logger.info('DB', `Attach réussi: +${result.new_subtests} sous-tests, +${result.new_norms} normes dans ${existingTestId}`);
                toast.success(`Rattachement réussi ! ${result.new_norms} nouvelles normes ajoutées au test public.`);
            } else {
                // Private test (same org) → merge
                const result = await AdminService.mergePrivateTest(existingTestId, payload);
                Logger.info('DB', `Merge réussi: +${result.new_subtests} sous-tests, +${result.new_norms} normes dans ${existingTestId}`);
                toast.success(`Fusion réussie ! ${result.new_norms} nouvelles entrées ajoutées.`);
            }

            setShowMergeModal(false);
            finishSuccess(existingTestId);

        } catch (e: unknown) {
            Logger.error('DB', "Erreur merge/attach test:", e);
            toast.error("Erreur lors de la fusion : " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsSaving(false);
        }
    };

    // --- FORCE CREATE (user chose "Créer séparé" from merge modal) ---
    const handleForceCreate = async () => {
        setIsSaving(true);
        setShowMergeModal(false);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Utilisateur non connecté");
            setCurrentUserId(user.id);
            await performCreate();
        } catch (e: unknown) {
            Logger.error('DB', "Erreur création forcée:", e);
            toast.error("Erreur : " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsSaving(false);
        }
    };

    // --- SHARED SUCCESS CALLBACK ---
    const finishSuccess = (testId: string) => {
        const { data: { user } } = { data: { user: null as any } }; // ID already captured by caller
        const contributionData: Contribution = {
            id: testId,
            userId: currentUserId || 'unknown',
            userName: 'Moi',
            testName: testName,
            docType: 'image',
            status: 'validated',
            vigilanceScore: 'pass',
            submittedAt: new Date().toISOString(),
            structureType: tableStructure,
            rows: allRows
        };
        setShowSaveModal(false);
        onSubmit(contributionData);
        clearDraft();
        setStep('success');
    };

    // --- RENDER ---
    if (step === 'intro') {
        return (
            <div className="fixed inset-0 z-[50] bg-[#3D405B]/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-500">
                <div className="bg-[var(--card-bg)] max-w-4xl w-full rounded-[40px] overflow-hidden shadow-2xl flex flex-col md:flex-row relative">
                    <button onClick={onClose} className="absolute top-6 right-6 text-[var(--text-secondary)] hover:text-[var(--text-heading)] z-10"><X size={24} /></button>
                    <div className="w-full md:w-2/5 bg-[var(--app-bg)] p-10 flex flex-col justify-center items-center relative overflow-hidden">
                        <div className="absolute top-[-20%] left-[-20%] w-64 h-64 bg-[#E07A5F]/10 rounded-full blur-3xl"></div>
                        <div className="relative z-10 text-center">
                            <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8 mx-auto transform -rotate-6">
                                <Scan size={48} className="text-[#E07A5F]" />
                            </div>
                            <h2 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Studio de Numérisation</h2>
                            <p className="text-[var(--text-secondary)] text-sm font-medium">Transformez vos manuels papiers en outils numériques interactifs.</p>
                        </div>
                    </div>
                    <div className="w-full md:w-3/5 p-10 md:p-12">
                        <h3 className="text-2xl font-bold text-[var(--text-heading)] mb-8">Comment ça marche ?</h3>
                        <div className="space-y-8">
                            <div className="flex gap-4">
                                <div className="w-10 h-10 bg-[var(--hover-bg)] rounded-full flex items-center justify-center text-[var(--text-heading)] font-bold text-lg shrink-0">1</div>
                                <div>
                                    <h4 className="font-bold text-[var(--text-heading)]">Usage Personnel & Privé</h4>
                                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">Le test est chiffré et stocké dans le silo sécurisé de votre organisation. Il n'est <strong>jamais partagé</strong> avec d'autres utilisateurs.</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="w-10 h-10 bg-[var(--hover-bg)] rounded-full flex items-center justify-center text-[var(--text-heading)] font-bold text-lg shrink-0">2</div>
                                <div>
                                    <h4 className="font-bold text-[var(--text-heading)]">Extraction par IA</h4>
                                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">Prenez en photo vos tableaux d'étalonnage. Notre moteur extrait les valeurs et crée une grille de saisie interactive.</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="w-10 h-10 bg-[var(--hover-bg)] rounded-full flex items-center justify-center text-[var(--text-heading)] font-bold text-lg shrink-0">3</div>
                                <div>
                                    <h4 className="font-bold text-[var(--text-heading)]">Respect des Droits</h4>
                                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">Conformément à l'exception d'interopérabilité, vous devez posséder l'original du test numérisé.</p>
                                </div>
                            </div>
                        </div>
                        <div className="mt-10 pt-6 border-t border-[var(--border-color)] space-y-4">
                            {hasPendingDraft && draftRef.current && (
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-start gap-3">
                                    <Database size={20} className="text-amber-600 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-amber-800 dark:text-amber-200">Brouillon non sauvegardé</p>
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                            {draftRef.current.testName || 'Test sans nom'} — {draftRef.current.pages.length} page{draftRef.current.pages.length > 1 ? 's' : ''} extraite{draftRef.current.pages.length > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                    <button onClick={restoreDraft} className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors shrink-0">Reprendre</button>
                                    <button onClick={discardDraft} className="text-amber-500 hover:text-amber-700 p-1 rounded-lg hover:bg-amber-100 transition-colors shrink-0" title="Supprimer le brouillon"><Trash2 size={16} /></button>
                                </div>
                            )}
                            <div className="flex justify-end">
                                <button onClick={() => setStep('upload')} className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center gap-2 group">
                                    Numériser un test <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'upload' || step === 'processing') {
        return (
            <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
                <div className="w-full max-w-2xl bg-[var(--card-bg)] rounded-[32px] shadow-xl p-10 text-center relative overflow-hidden">
                    <button onClick={onClose} className="absolute top-6 left-6 text-[var(--text-secondary)] hover:text-[var(--text-heading)] flex items-center gap-2 font-bold text-sm uppercase tracking-wider">
                        <ArrowLeft size={16} /> Annuler
                    </button>
                    <div className="mb-8 flex justify-center">
                        <div className="w-20 h-20 bg-[#E07A5F] text-white rounded-3xl flex items-center justify-center transform -rotate-3 shadow-lg shadow-orange-200 dark:shadow-black/30">
                            <Camera size={40} />
                        </div>
                    </div>
                    <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)] mb-4">Scanner un tableau</h1>
                    <p className="text-[var(--text-secondary)] mb-10 max-w-md mx-auto leading-relaxed">Prenez en photo une page de votre manuel (Tableau des Moyennes/ET ou Table de conversion).</p>
                    {step === 'upload' ? (
                        <div className="space-y-6 max-w-md mx-auto">
                            <div className="text-left">
                                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Nom du Test <span className="text-rose-500">*</span></label>
                                <input
                                    value={testName}
                                    onChange={(e) => { setTestName(e.target.value); setTestNameError(false); }}
                                    placeholder="Ex: Mon Test Perso"
                                    className={`w-full p-4 bg-[var(--input-bg)] rounded-xl border outline-none focus:border-[#E07A5F] font-bold text-[var(--text-heading)] ${testNameError ? 'border-rose-500 bg-rose-50' : 'border-[var(--input-border)]'}`}
                                />
                                {testNameError && <p className="text-xs text-rose-500 font-bold mt-1 ml-1">Le nom est obligatoire.</p>}
                            </div>
                            <div className="border-3 border-dashed border-[var(--border-color)] rounded-[24px] p-10 hover:border-[#E07A5F] hover:bg-[#fff5f2] transition-all cursor-pointer group relative">
                                <input type="file" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" accept="image/*" multiple />
                                <div className="relative z-10 pointer-events-none">
                                    <Upload size={32} className="text-[var(--text-disabled)] group-hover:text-[#E07A5F] mx-auto mb-2 transition-colors" />
                                    <p className="font-bold text-[var(--text-heading)]">Importer la photo</p>
                                    <p className="text-xs text-[var(--text-secondary)] mt-1">Plusieurs images possibles. L'IA détectera la structure.</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-12">
                            <Loader2 size={48} className="text-[#E07A5F] animate-spin mx-auto mb-4" />
                            <p className="font-bold text-[var(--text-heading)]">Extraction des données...</p>
                            <p className="text-xs text-[var(--text-secondary)]">Analyse en parallèle pour un traitement ultra-rapide</p>
                            {files.length > 1 && (
                                <p className="text-xs text-[var(--text-secondary)] mt-2">{files.length} page{files.length > 1 ? 's' : ''} en cours...</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (step === 'success') {
        return (
            <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center p-6 animate-in zoom-in-95 duration-500">
                <div className="text-center">
                    <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                        <Check size={48} strokeWidth={4} />
                    </div>
                    <h2 className="font-serif text-4xl font-bold text-[var(--text-heading)] mb-4">Test Numérisé !</h2>
                    <p className="text-[var(--text-secondary)] text-lg mb-8 max-w-md mx-auto">Ce test est désormais disponible dans votre catalogue personnel.</p>
                    <button onClick={onClose} className="bg-[#3D405B] text-white px-10 py-4 rounded-2xl font-bold shadow-xl hover:bg-[#2c2e42] transition-all">Retour au Dashboard</button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[50] bg-[var(--card-bg)] flex flex-col h-screen animate-in fade-in duration-300">
            <div className="h-16 border-b border-[var(--border-color)] flex items-center justify-between px-6 bg-[var(--card-bg)] shrink-0 z-20">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-[var(--hover-bg)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors"><X size={20} /></button>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="font-bold text-[var(--text-heading)] max-w-[200px] truncate">{testName || "Nouveau Test"}</h2>
                            {tableStructure === 'PARAMETRIC' && (
                                <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded flex items-center gap-1">
                                    <Calculator size={10} /> Paramétrique (Moy/SD)
                                </span>
                            )}
                            {tableStructure === 'LOOKUP' && (
                                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded flex items-center gap-1">
                                    <TableIcon size={10} /> Table de Conversion
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1"><ShieldAlert size={10} className="text-[#E07A5F]" /> Test Privé (Chiffré)</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={handlePreSave} className="bg-[#E07A5F] text-white px-6 py-2.5 rounded-xl font-bold shadow-md hover:bg-[#d0694e] transition-all flex items-center gap-2 text-sm"><Save size={16} /> Enregistrer le test</button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-1/2 bg-[var(--hover-bg)] border-r border-[var(--border-color)] relative flex flex-col">
                    {pages.length > 1 && (
                        <div className="absolute top-4 right-4 bg-[var(--card-bg)]/90 backdrop-blur rounded-full shadow-sm border border-[var(--border-color)] px-3 py-1 flex items-center gap-2 z-10">
                            <button
                                onClick={() => setCurrentFileIndex(Math.max(0, currentFileIndex - 1))}
                                disabled={currentFileIndex === 0}
                                className="p-1 rounded-full text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40 disabled:hover:bg-transparent"
                            >
                                <ArrowLeft size={14} />
                            </button>
                            <span className="text-xs font-bold text-[var(--text-secondary)]">
                                Page {currentFileIndex + 1} / {pages.length}
                            </span>
                            <button
                                onClick={() => setCurrentFileIndex(Math.min(pages.length - 1, currentFileIndex + 1))}
                                disabled={currentFileIndex >= pages.length - 1}
                                className="p-1 rounded-full text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-40 disabled:hover:bg-transparent"
                            >
                                <ArrowRight size={14} />
                            </button>
                        </div>
                    )}
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[var(--card-bg)]/90 backdrop-blur rounded-full shadow-sm border border-[var(--border-color)] p-1 flex gap-1 z-10">
                        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="p-2 hover:bg-[var(--hover-bg)] rounded-full text-[var(--text-secondary)]"><ZoomOut size={16} /></button>
                        <span className="text-xs font-mono font-bold text-[var(--text-secondary)] py-2 px-1 w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="p-2 hover:bg-[var(--hover-bg)] rounded-full text-[var(--text-secondary)]"><ZoomIn size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-auto flex items-center justify-center p-10 cursor-grab active:cursor-grabbing">
                        <div className="bg-white shadow-2xl transition-transform duration-200 ease-out origin-center relative" style={{ width: 'auto', height: 'auto', transform: `scale(${zoom})` }}>
                            {currentFileUrl ? <img src={currentFileUrl} alt="Source" className="max-w-full max-h-[80vh] object-contain" /> : null}
                        </div>
                    </div>
                </div>

                <div className="w-1/2 bg-[var(--card-bg)] flex flex-col">
                    <div className="flex-1 overflow-y-auto p-8">
                        <div className="max-w-3xl mx-auto space-y-12">

                            <div className={`p-4 rounded-xl border flex items-center gap-3 bg-[var(--hover-bg)] border-[var(--border-color)]`}>
                                <div className="p-2 rounded-lg bg-[var(--card-bg)] text-[#E07A5F]">
                                    <FileText size={20} />
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block text-[var(--text-secondary)]">Nom Global du Test</label>
                                    <input
                                        value={testName}
                                        onChange={(e) => { setTestName(e.target.value); setTestNameError(false); }}
                                        placeholder="Ex: WISC-V"
                                        className="bg-transparent font-bold text-[var(--text-heading)] w-full outline-none placeholder:text-[var(--text-disabled)]"
                                    />
                                </div>
                            </div>

                            {/* CATEGORY SELECTOR */}
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider mb-2 block text-[var(--text-secondary)]">Catégorie du Test</label>
                                <div className="flex flex-wrap gap-2">
                                    {categoryOptions.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setSelectedCategory(cat.id)}
                                            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${selectedCategory === cat.id
                                                    ? 'bg-[#3D405B] text-white border-[#3D405B] shadow-md'
                                                    : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--text-secondary)]'
                                                }`}
                                        >
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>
                                {!isCategoryLoading && categoryOptions.length === 0 && (
                                    <p className="text-[10px] text-rose-500 mt-2 font-semibold">
                                        Aucune catégorie disponible (vérifiez la table `official_categories`).
                                    </p>
                                )}
                            </div>

                            {pages.length > 0 && (
                                <div className="bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col gap-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Pages</span>
                                        <button
                                            onClick={handleValidateCurrentPage}
                                            className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${currentPage?.validated ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[#E07A5F] hover:text-[#E07A5F]'}`}
                                        >
                                            {currentPage?.validated ? 'Page validée' : 'Valider cette page'}
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {pages.map((page, index) => (
                                            <button
                                                key={page.id}
                                                onClick={() => setCurrentFileIndex(index)}
                                                className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 ${index === currentFileIndex ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--text-secondary)]'}`}
                                            >
                                                {`Page ${index + 1}`}
                                                {page.validated && <Check size={12} className="text-emerald-200" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {testName.trim() && (
                                <div className={`border rounded-xl p-4 text-sm ${canonicalTest ? 'bg-indigo-50 border-indigo-200 text-indigo-900' : 'bg-[var(--hover-bg)] border-[var(--border-color)] text-[var(--text-main)]'}`}>
                                    {isCanonicalLoading ? (
                                        <div className="flex items-center gap-2">
                                            <Loader2 size={14} className="animate-spin" />
                                            <span className="font-semibold">Recherche de sous-tests canoniques...</span>
                                        </div>
                                    ) : canonicalTest ? (
                                        <div className="space-y-2">
                                            <div className="font-semibold">Liste canonique detectee : {canonicalTest.name} ({canonicalSubtests.length} sous-tests)</div>
                                            {unmappedSubtests.length > 0 && (
                                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                                                    {unmappedSubtests.length} sous-test{unmappedSubtests.length > 1 ? 's' : ''} non reconnus : {unmappedSubtests.join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="font-semibold">Aucune liste canonique trouvée : les sous-tests seront créés tels quels.</div>
                                    )}
                                </div>
                            )}

                            {hasUnrenamedVariants && duplicatedSids.length > 0 && (
                                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-3">
                                    <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                                    <div>
                                        <div className="font-bold mb-1">Sous-tests dupliqués détectés</div>
                                        <p className="mb-2">L'extraction a produit plusieurs groupes portant le même nom. Ils ont été suffixés automatiquement avec "(variante N)". <strong>Renommez-les</strong> avec un intitulé explicite avant d'enregistrer.</p>
                                        <div className="flex flex-wrap gap-1">
                                            {duplicatedSids.map(sid => (
                                                <span key={sid} className="bg-amber-200 text-amber-900 text-xs font-semibold px-2 py-0.5 rounded-full">{sid}</span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {currentGroupedEntries.map(([subtest, subRows]) => {
                                const isVariant = VARIANT_PATTERN.test(subtest);
                                return (
                                <div key={subtest} className={`bg-[var(--card-bg)] rounded-2xl border shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 ${isVariant ? 'border-amber-400 ring-2 ring-amber-200' : 'border-[var(--border-color)]'}`}>
                                    <div className="bg-[var(--hover-bg)] px-4 py-3 border-b border-[var(--border-color)] flex justify-between items-center">
                                        <div className="flex items-center gap-2 flex-1">
                                            {isVariant ? <AlertTriangle size={14} className="text-amber-500" /> : <Layers size={14} className="text-[var(--text-secondary)]" />}
                                            <input
                                                value={subtest}
                                                onChange={(e) => handleSubtestNameChange(subtest, e.target.value)}
                                                className={`bg-transparent font-bold text-sm w-full outline-none focus:bg-[var(--input-bg)] rounded px-1 transition-all ${isVariant ? 'text-amber-700' : 'text-[var(--text-heading)]'}`}
                                                placeholder={isVariant ? 'Renommez ce sous-test...' : undefined}
                                            />
                                        </div>
                                        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{subRows.length} entrées</span>
                                    </div>

                                    <div className="p-2">
                                        {/* HEADERS CONDITIONNELS */}
                                        {tableStructure === 'PARAMETRIC' && (
                                            <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 px-3">
                                                <div className="col-span-3">Âge / Classe</div>
                                                <div className="col-span-4 text-center" title="Moyenne Statistique">Moyenne (M)</div>
                                                <div className="col-span-4 text-center" title="Ecart-Type Statistique">Ecart-Type (SD)</div>
                                                <div className="col-span-1"></div>
                                            </div>
                                        )}

                                        {/* MODE 1 : LOOKUP BATCHED (REGROUPÉ PAR ÂGE) */}
                                        {tableStructure === 'LOOKUP' ? (
                                            <div className="space-y-4">
                                                {Array.from(
                                                    subRows.reduce((entryMap, e) => {
                                                        // Group by age: use label (auto-computed from age) or age fields directly
                                                        const l = e.label || formatAgeLabel(e.hidden_age_min, e.hidden_age_max) || "N/A";
                                                        if (!entryMap.has(l)) entryMap.set(l, []);
                                                        entryMap.get(l)!.push(e);
                                                        return entryMap;
                                                    }, new Map<string, ExtractedRow[]>())
                                                ).map(([label, batchRows], batchIdx) => (
                                                    <div key={`${subtest}-${batchIdx}`} className="bg-[var(--hover-bg)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">

                                                        {/* BATCH HEADER (L'ÂGE EST ICI UNE SEULE FOIS) */}
                                                        <div className="bg-[var(--card-bg-raised)] px-4 py-2 border-b border-[var(--border-color)] flex items-center justify-between group/header hover:bg-[var(--hover-bg)] transition-colors">
                                                            <div className="flex items-center gap-3 flex-1">
                                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider shrink-0">Groupe :</span>
                                                                <input
                                                                    value={label}
                                                                    onChange={(e) => handleBatchLabelChange(subtest, label, e.target.value)}
                                                                    className="font-bold text-[var(--text-heading)] text-sm bg-transparent outline-none focus:bg-[var(--input-bg)] focus:ring-2 focus:ring-[#E07A5F]/20 rounded px-2 py-1 w-full transition-all border border-transparent focus:border-[#E07A5F]/20"
                                                                    placeholder="Ex: 4;0 à 4;5 ans"
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider bg-[var(--card-bg)] px-2 py-0.5 rounded border border-[var(--border-color)]">{batchRows.length} lignes</span>
                                                            </div>
                                                        </div>

                                                        {/* BATCH ROWS (JUSTE LES SCORES) */}
                                                        <div className="p-2 bg-[var(--card-bg)]">
                                                            <div className="grid grid-cols-9 gap-2 text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 px-2 text-center bg-[var(--hover-bg)] py-1 rounded-lg mx-1">
                                                                <div className="col-span-2">Brut</div>
                                                                <div className="col-span-2">NS</div>
                                                                <div className="col-span-2">ET / Z</div>
                                                                <div className="col-span-2">%</div>
                                                                <div className="col-span-1"></div>
                                                            </div>

                                                            {batchRows.map((row) => {
                                                                const isConsistent = checkConsistency(row);
                                                                return (
                                                                    <div key={row.id} className="grid grid-cols-9 gap-2 items-center mb-1 px-1 group/row hover:bg-[var(--hover-bg)] rounded-lg p-1 transition-colors">
                                                                        <div className="col-span-2">
                                                                            <input value={row.raw} onChange={(e) => handleRowChange(row.id, 'raw', e.target.value)} className="w-full p-1.5 text-center bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-medium text-[var(--text-main)] transition-all" />
                                                                        </div>
                                                                        <div className="col-span-2">
                                                                            <input value={row.standard} onChange={(e) => handleRowChange(row.id, 'standard', e.target.value)} className="w-full p-1.5 text-center bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-bold text-[var(--text-heading)] transition-all" />
                                                                        </div>
                                                                        <div className="col-span-2">
                                                                            <input value={row.zScore} onChange={(e) => handleRowChange(row.id, 'zScore', e.target.value)} className={`w-full p-1.5 text-center bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-bold transition-all ${!isConsistent ? 'text-rose-500' : 'text-[var(--text-heading)]'}`} />
                                                                        </div>
                                                                        <div className="col-span-2">
                                                                            <input value={row.percentile} onChange={(e) => handleRowChange(row.id, 'percentile', e.target.value)} className={`w-full p-1.5 text-center bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-bold transition-all ${!isConsistent ? 'text-rose-500' : 'text-[var(--text-heading)]'}`} />
                                                                        </div>
                                                                        <div className="col-span-1 text-center">
                                                                            <button onClick={() => handleDeleteRow(row.id)} className="text-[var(--text-disabled)] hover:text-rose-500 p-1.5 rounded hover:bg-rose-50 transition-all"><Trash2 size={14} /></button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}

                                                            <button onClick={() => handleAddRowToBatch(subtest, label)} className="mt-2 w-full py-2 border border-dashed border-[var(--border-color)] rounded-lg text-[var(--text-secondary)] text-[10px] font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] hover:bg-[#fff5f2] transition-all flex items-center justify-center gap-1">
                                                                <Plus size={12} /> Ajouter une ligne à ce groupe
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            // MODE 2 : PARAMETRIC (LISTE PLATE CLASSIQUE)
                                            <>
                                                {subRows.map((row) => (
                                                    <div key={row.id} className="grid grid-cols-12 gap-2 items-center group mb-1 hover:bg-[var(--hover-bg)] p-1 rounded-lg transition-colors">
                                                        <div className="col-span-3">
                                                            <input value={row.label || ''} onChange={(e) => handleRowChange(row.id, 'label', e.target.value)} className="w-full p-2 bg-[var(--input-bg)] rounded-lg border border-[var(--input-border)] focus:border-[#E07A5F] outline-none text-sm font-bold text-[var(--text-heading)] transition-all" />
                                                        </div>
                                                        <div className="col-span-4">
                                                            <input value={row.mean || ''} onChange={(e) => handleRowChange(row.id, 'mean', e.target.value)} className="w-full p-2 text-center bg-indigo-50/30 rounded-lg border border-indigo-100 focus:bg-white focus:border-indigo-500 outline-none text-sm font-bold text-indigo-900 transition-all" placeholder="Moyenne" />
                                                        </div>
                                                        <div className="col-span-4">
                                                            <input value={row.sd || ''} onChange={(e) => handleRowChange(row.id, 'sd', e.target.value)} className="w-full p-2 text-center bg-indigo-50/30 rounded-lg border border-indigo-100 focus:bg-white focus:border-indigo-500 outline-none text-sm font-bold text-indigo-900 transition-all" placeholder="SD" />
                                                        </div>
                                                        <div className="col-span-1 text-center">
                                                            <button onClick={() => handleDeleteRow(row.id)} className="text-[var(--text-disabled)] hover:text-rose-500 p-2 rounded hover:bg-rose-50 transition-all"><Trash2 size={14} /></button>
                                                        </div>
                                                    </div>
                                                ))}

                                                <button onClick={() => handleAddRowToSubtest(subtest)} className="mt-2 w-full py-2 border border-dashed border-[var(--border-color)] rounded-lg text-[var(--text-secondary)] text-xs font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] transition-all flex items-center justify-center gap-1">
                                                    <Plus size={12} /> Ajouter une ligne
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                            })}

                            <button onClick={handleAddSubtest} className="w-full py-4 border-2 border-dashed border-[var(--border-color)] rounded-xl text-[var(--text-secondary)] font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] hover:bg-[#fff5f2] transition-all flex items-center justify-center gap-2">
                                <Plus size={18} /> Créer un nouveau bloc (Sous-test)
                            </button>

                        </div>
                    </div>
                </div>
            </div>

            {/* --- MODAL CONFIRMATION LÉGALE --- */}
            {showSaveModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
                        <div className="p-6">
                            <div className="w-16 h-16 bg-[#3D405B] rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg shadow-stone-300">
                                <Scale size={32} className="text-white" />
                            </div>
                            <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] text-center mb-2">Certification Légale</h3>
                            <p className="text-center text-sm text-[var(--text-secondary)] mb-6">Pour valider cette numérisation, votre engagement est requis.</p>
                            <div className="bg-[var(--hover-bg)] p-4 rounded-xl border border-[var(--border-color)] mb-6">
                                <label className="flex gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="mt-1 w-5 h-5 accent-[#E07A5F] shrink-0"
                                        checked={legalConsent}
                                        onChange={(e) => setLegalConsent(e.target.checked)}
                                    />
                                    <span className="text-xs text-[var(--text-main)] font-medium leading-relaxed text-justify">
                                        Je certifie sur l'honneur être en possession de l'original papier de ce test (Manuel + Cahiers). Cette numérisation est effectuée au titre de l'exception d'interopérabilité (Code de la Propriété Intellectuelle) pour mon usage professionnel personnel et exclusif.
                                    </span>
                                </label>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowSaveModal(false)}
                                    className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-sm"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleFinalSave}
                                    disabled={!legalConsent || isSaving}
                                    className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${legalConsent ? 'bg-[#E07A5F] hover:bg-[#d0694e] hover:-translate-y-1' : 'bg-stone-300 cursor-not-allowed'}`}
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Confirmer
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showUnmappedModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
                        <div className="p-6">
                            <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg shadow-amber-100">
                                <BookOpen size={32} className="text-amber-600" />
                            </div>
                            <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] text-center mb-2">Sous-tests non reconnus</h3>
                            <p className="text-center text-sm text-[var(--text-secondary)] mb-4">Ces sous-tests ne correspondent pas à la liste canonique du test. Voulez-vous les créer quand même ?</p>

                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 text-xs text-amber-800">
                                {unmappedSubtests.join(', ')}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowUnmappedModal(false)}
                                    className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-sm border border-[var(--border-color)]"
                                >
                                    Revenir
                                </button>
                                <button
                                    onClick={() => { setShowUnmappedModal(false); setShowSaveModal(true); }}
                                    className="flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 hover:-translate-y-1"
                                >
                                    Créer quand même
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL MERGE / ATTACH CONFIRMATION --- */}
            {showMergeModal && mergeTarget && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
                        <div className="p-6">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg ${mergeTarget.isPublic ? 'bg-blue-100 shadow-blue-100' : 'bg-amber-100 shadow-amber-100'}`}>
                                {mergeTarget.isPublic ? <Globe size={32} className="text-blue-600" /> : <Database size={32} className="text-amber-600" />}
                            </div>
                            <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] text-center mb-2">
                                {mergeTarget.isPublic ? 'Test public existant' : 'Test existant détecté'}
                            </h3>
                            <p className="text-center text-sm text-[var(--text-secondary)] mb-2">
                                Le test <strong className="text-[var(--text-heading)]">« {mergeTarget.name} »</strong> existe déjà avec {mergeTarget.subtestCount} sous-test{mergeTarget.subtestCount > 1 ? 's' : ''}.
                            </p>
                            {mergeTarget.isPublic && (
                                <p className="text-center text-xs text-blue-600 bg-blue-50 rounded-lg p-2 mb-4">
                                    <Globe size={12} className="inline mr-1" />
                                    Vos sous-tests seront rattachés au test public. Seul vous pourrez les voir jusqu'à validation par un admin.
                                </p>
                            )}

                            <div className={`border p-4 rounded-xl mb-6 space-y-2 ${mergeTarget.isPublic ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                                <div className="flex items-center gap-2 text-sm">
                                    <Layers size={14} className={`shrink-0 ${mergeTarget.isPublic ? 'text-blue-600' : 'text-amber-600'}`} />
                                    <span className="text-[var(--text-main)]">
                                        <strong className="text-[var(--text-heading)]">{allRows.length}</strong> entrée{allRows.length > 1 ? 's' : ''} à {mergeTarget.isPublic ? 'rattacher' : 'fusionner'}
                                        {mergeNewSubtests > 0 && <> dont <strong className="text-[var(--text-heading)]">{mergeNewSubtests}</strong> nouveau{mergeNewSubtests > 1 ? 'x' : ''} sous-test{mergeNewSubtests > 1 ? 's' : ''}</>}
                                    </span>
                                </div>
                                <p className={`text-xs leading-relaxed ${mergeTarget.isPublic ? 'text-blue-700' : 'text-amber-700'}`}>
                                    Seules les lignes manquantes seront ajoutées (âge + score). Les données existantes ne seront pas modifiées.
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleForceCreate}
                                    disabled={isSaving}
                                    className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-sm border border-[var(--border-color)]"
                                >
                                    Créer séparé
                                </button>
                                <button
                                    onClick={performMerge}
                                    disabled={isSaving}
                                    className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 hover:-translate-y-1 ${mergeTarget.isPublic ? 'bg-blue-500 hover:bg-blue-600' : 'bg-amber-500 hover:bg-amber-600'}`}
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : mergeTarget.isPublic ? <Link2 size={18} /> : <Sparkles size={18} />}
                                    {mergeTarget.isPublic ? 'Rattacher' : 'Fusionner'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL FUZZY MATCHES (multiple similar tests found) --- */}
            {showFuzzyModal && fuzzyMatches.length > 0 && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] w-full max-w-lg rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
                        <div className="p-6">
                            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg shadow-indigo-100">
                                <Scale size={32} className="text-indigo-600" />
                            </div>
                            <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] text-center mb-2">Tests similaires détectés</h3>
                            <p className="text-center text-sm text-[var(--text-secondary)] mb-6">
                                Nous avons trouvé des tests qui ressemblent à <strong className="text-[var(--text-heading)]">« {testName} »</strong>. Voulez-vous rattacher vos données à l'un d'eux ?
                            </p>

                            <div className="space-y-2 max-h-[300px] overflow-y-auto mb-6 custom-scrollbar">
                                {fuzzyMatches.map(match => (
                                    <button
                                        key={match.id}
                                        onClick={() => handleSelectFuzzyMatch(match)}
                                        disabled={isSaving}
                                        className="w-full text-left p-4 rounded-xl border border-[var(--border-color)] hover:border-indigo-400 hover:bg-indigo-50/50 transition-all group"
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                {match.organization_id === null ? (
                                                    <Globe size={14} className="text-blue-500 shrink-0" />
                                                ) : (
                                                    <Lock size={14} className="text-amber-500 shrink-0" />
                                                )}
                                                <span className="font-bold text-sm text-[var(--text-heading)] group-hover:text-indigo-700">
                                                    {match.name}
                                                </span>
                                            </div>
                                            <span className="text-[10px] bg-[var(--hover-bg)] text-[var(--text-secondary)] px-2 py-0.5 rounded font-bold">
                                                {Math.round(match.similarity_score * 100)}%
                                            </span>
                                        </div>
                                        <div className="flex gap-3 mt-1 text-xs text-[var(--text-secondary)]">
                                            <span>{match.subtests_count} sous-test{match.subtests_count > 1 ? 's' : ''}</span>
                                            <span>{match.organization_id === null ? 'Public' : 'Privé (votre cabinet)'}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowFuzzyModal(false)}
                                    className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-sm border border-[var(--border-color)]"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleSkipFuzzy}
                                    disabled={isSaving}
                                    className="flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 bg-stone-500 hover:bg-stone-600 hover:-translate-y-1"
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                                    Créer nouveau test
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* --- MODAL DISAMBIGUATION (variante N -> proper clinical name) --- */}
            {showDisambiguationModal && (
                <DisambiguationModal
                    pages={pages}
                    onConfirm={handleDisambiguationConfirm}
                    onClose={() => setShowDisambiguationModal(false)}
                />
            )}
        </div>
    );
};

