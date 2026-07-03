import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Patient, ReportSection, TestData, ReportAttachment, BrandingConfig } from '../../types';
import { FileText, ClipboardList, Plus, Image as ImageIcon, LayoutTemplate, X, Trash2, Check, Mail, Phone, ArrowDown, ArrowUp, Home, Star, Sparkles, PieChart, Bold, Italic, List, Heading2, Heading3, Type, Pencil } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { sanitizeReportText, decodeResidualEntities } from '../../utils/textSanitizer';

import { TipTapEditor } from './TipTapEditor';

interface Props {
    patient: Patient;
    sections: ReportSection[];
    tests: TestData;
    onUpdateSection?: (sectionId: string, updates: Partial<ReportSection>) => void;
    branding?: BrandingConfig;
    scoreDisplayModes?: Record<string, 'NS' | 'ET' | '%'>;
    onScoreDisplayModeChange?: (modes: Record<string, 'NS' | 'ET' | '%'>) => void;
    chartType?: 'radar' | 'bar' | 'percentile';
    onChartTypeChange?: (type: 'radar' | 'bar' | 'percentile') => void;
    isPerformance?: boolean;
}

// Parse a dob string (YYYY-MM-DD or other) to DD/MM/YYYY safely without timezone issues
const formatDobFrSafe = (dob?: string): string => {
    if (!dob) return '';
    // Handle ISO YYYY-MM-DD (avoid UTC offset issue by splitting directly)
    const isoMatch = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }
    // Fallback: try Date parsing with explicit locale
    const d = new Date(dob);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('fr-FR');
    return dob;
};

// Helper pour le gras (**text**)
const parseBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-inherit">{part.slice(2, -2)}</strong>;
        }
        return part;
    });
};

const CaptionEditor: React.FC<{
    initialValue: string;
    onSave: (val: string) => void;
}> = ({ initialValue, onSave }) => {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    return (
        <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => onSave(value)}
            className="w-full bg-transparent border border-transparent hover:border-stone-200 outline-none text-sm text-stone-700 italic resize-none focus:bg-white focus:ring-2 focus:ring-[var(--primary-opacity-20)] focus:border-[var(--primary)]/20 rounded p-2 transition-all leading-relaxed print:resize-none print:border-none print:p-0"
            rows={4}
            placeholder="Ajoutez une légende..."
        />
    );
};

// --- FLOATING FORMATTING TOOLBAR ---
const FloatingToolbar: React.FC<{
    position: { top: number; left: number } | null;
    onFormat: (action: 'bold' | 'italic' | 'h2' | 'h3' | 'bullet' | 'paragraph') => void;
    activeFormats: { bold?: boolean; italic?: boolean };
}> = ({ position, onFormat: onFmt, activeFormats }) => {
    if (!position) return null;
    const btnClass = (active?: boolean) =>
        `p-1.5 rounded-md transition-all ${active ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'}`;
    return (
        <div
            className="fixed z-[200] bg-white border border-stone-200 rounded-xl shadow-2xl px-1.5 py-1 flex items-center gap-0.5 animate-in zoom-in-95 fade-in duration-150 no-print"
            style={{ top: position.top - 48, left: position.left, transform: 'translateX(-50%)' }}
        >
            <button onClick={() => onFmt('bold')} className={btnClass(activeFormats.bold)} title="Gras (**texte**)"><Bold size={14} /></button>
            <button onClick={() => onFmt('italic')} className={btnClass(activeFormats.italic)} title="Italique"><Italic size={14} /></button>
            <div className="w-px h-5 bg-stone-200 mx-0.5"></div>
            <button onClick={() => onFmt('h2')} className={btnClass()} title="Titre de section"><Heading2 size={14} /></button>
            <button onClick={() => onFmt('h3')} className={btnClass()} title="Sous-titre"><Heading3 size={14} /></button>
            <button onClick={() => onFmt('bullet')} className={btnClass()} title="Liste à puces"><List size={14} /></button>
            <button onClick={() => onFmt('paragraph')} className={btnClass()} title="Paragraphe"><Type size={14} /></button>
        </div>
    );
};

// --- INLINE PARAGRAPH EDITOR ---
const InlineParagraphEditor: React.FC<{
    text: string;
    onSave: (newText: string) => void;
    onCancel: () => void;
    style?: React.CSSProperties;
    className?: string;
    roundedClass?: string;
}> = ({ text, onSave, onCancel, style, className, roundedClass = 'rounded-xl' }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
    const [activeFormats, setActiveFormats] = useState<{ bold?: boolean; italic?: boolean }>({});
    const savedRef = useRef(false);

    // Convert markdown → HTML for contentEditable initialization
    const markdownToHtml = (md: string): string => {
        // Strip line prefixes for display (they're structural, not content)
        let cleaned = md.replace(/^(#{2,3}\s|[-*]\s)/, '');
        // Convert **bold** → <b>bold</b>
        cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        return cleaned;
    };

    // Initialize content with HTML
    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.innerHTML = markdownToHtml(text);
            // Place cursor at end
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(editorRef.current);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
            editorRef.current.focus();
        }
    }, []);

    const checkSelection = useCallback(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !editorRef.current?.contains(sel.anchorNode)) {
            setToolbarPos(null);
            return;
        }
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setToolbarPos({ top: rect.top + window.scrollY, left: rect.left + rect.width / 2 + window.scrollX });
        // Check active formats
        setActiveFormats({
            bold: document.queryCommandState('bold'),
            italic: document.queryCommandState('italic'),
        });
    }, []);

    useEffect(() => {
        document.addEventListener('selectionchange', checkSelection);
        return () => document.removeEventListener('selectionchange', checkSelection);
    }, [checkSelection]);

    const handleFormat = (action: 'bold' | 'italic' | 'h2' | 'h3' | 'bullet' | 'paragraph') => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        if (action === 'bold') document.execCommand('bold');
        else if (action === 'italic') document.execCommand('italic');
        else if (action === 'h2' || action === 'h3' || action === 'bullet' || action === 'paragraph') {
            // These change the line prefix in markdown — we'll handle on save
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            const selectedText = sel.toString();
            const prefix = action === 'h2' ? '## ' : action === 'h3' ? '### ' : action === 'bullet' ? '- ' : '';
            document.execCommand('insertText', false, prefix + selectedText.replace(/^(#{2,3}\s|[-*]\s)/, ''));
        }
        checkSelection();
    };

    const getMarkdown = (): string => {
        if (!editorRef.current) return text;
        // Convert DOM back to markdown-flavored plain text
        let result = '';
        const walk = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                result += node.textContent || '';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                const tag = el.tagName.toLowerCase();
                if (tag === 'b' || tag === 'strong') {
                    result += '**';
                    el.childNodes.forEach(walk);
                    result += '**';
                } else if (tag === 'i' || tag === 'em') {
                    result += '*';
                    el.childNodes.forEach(walk);
                    result += '*';
                } else if (tag === 'br') {
                    result += '\n';
                } else {
                    el.childNodes.forEach(walk);
                }
            }
        };
        editorRef.current.childNodes.forEach(walk);
        // Re-add the structural line prefix that was stripped during initialization
        const prefix = text.match(/^(#{2,3}\s|[-*]\s)/)?.[0] || '';
        return prefix + result;
    };

    const save = () => {
        if (savedRef.current) return;
        savedRef.current = true;
        onSave(getMarkdown());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
        // Ctrl+B / Ctrl+I
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            handleFormat('bold');
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            handleFormat('italic');
        }
    };

    return (
        <>
            <FloatingToolbar position={toolbarPos} onFormat={handleFormat} activeFormats={activeFormats} />
            <div className="relative group/editor">
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onKeyDown={handleKeyDown}
                    onBlur={save}
                    className={`outline-none min-h-[1.5em] px-3 py-2 -mx-3 -my-2 border-2 border-[var(--primary)]/40 ${roundedClass} bg-[#fff8f6] shadow-inner ring-2 ring-[var(--primary-opacity-10)] transition-all ${className || ''}`}
                    style={{ ...style, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                />
                <div className="absolute -top-8 right-0 flex items-center gap-1 no-print opacity-80">
                    <span className="text-[10px] text-stone-400 bg-white/80 px-2 py-0.5 rounded-full border border-stone-100">Entrée pour sauver · Échap pour annuler</span>
                </div>
            </div>
        </>
    );
};

// --- EDITABLE SECTION TITLE ---
const EditableSectionTitle: React.FC<{
    title: string;
    onSave: (newTitle: string) => void;
    titleStyleCss: React.CSSProperties;
    primaryColor: string;
    secondaryColor: string;
    isCustom: boolean;
    roundedClass: string;
    titleStyle: string;
    fontFamily: string;
    editable: boolean;
}> = ({ title, onSave, titleStyleCss, primaryColor, secondaryColor, isCustom, roundedClass, titleStyle, fontFamily, editable }) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(title);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setValue(title); }, [title]);
    useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

    const save = () => {
        if (value.trim() && value !== title) onSave(value.trim());
        setEditing(false);
    };

    const IconComponent: any = titleStyle === 'icon-house' ? Home : titleStyle === 'icon-star' ? Star : titleStyle === 'icon-sparkle' ? Sparkles : FileText;

    if (editing) {
        return (
            <div className="flex items-center gap-3 mb-6 pb-2 border-b-2" style={{ borderColor: isCustom ? primaryColor + '20' : '#E5E7EB' }}>
                <input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={save}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
                    className="text-xl font-bold uppercase tracking-wide bg-transparent outline-none border-b-2 border-[var(--primary)] flex-1"
                    style={{ fontFamily, color: primaryColor }}
                />
                <button onClick={save} className="p-1 bg-[var(--primary)] rounded-md text-white no-print"><Check size={14} /></button>
            </div>
        );
    }

    const baseTitle = (
        <h2
            className={`text-xl font-bold uppercase tracking-wide ${editable ? 'cursor-pointer group/title' : ''}`}
            style={titleStyleCss}
            onClick={editable ? () => setEditing(true) : undefined}
        >
            {title}
            {editable && <Pencil size={12} className="inline-block ml-2 opacity-0 group-hover/title:opacity-50 transition-opacity no-print" />}
        </h2>
    );

    if (titleStyle === 'simple') {
        return (
            <div className="flex items-center gap-3 mb-6 pb-2 border-b-2" style={{ borderColor: isCustom ? primaryColor + '20' : '#E5E7EB' }}>
                <div className={`p-1.5 ${roundedClass} ${isCustom ? '' : 'bg-stone-100 text-stone-500'}`} style={isCustom ? { backgroundColor: primaryColor + '15', color: primaryColor } : {}}>
                    <FileText size={20} />
                </div>
                {baseTitle}
            </div>
        );
    }

    if (titleStyle === 'underline') {
        return (
            <div className="mb-6" onClick={editable ? () => setEditing(true) : undefined}>
                <h2 className={`text-xl font-bold uppercase tracking-wide pb-2 border-b-4 inline-block ${editable ? 'cursor-pointer' : ''}`} style={{ ...titleStyleCss, borderColor: secondaryColor }}>
                    {title}
                    {editable && <Pencil size={12} className="inline-block ml-2 opacity-0 hover:opacity-50 transition-opacity no-print" />}
                </h2>
            </div>
        );
    }

    if (titleStyle === 'filled-shape') {
        return (
            <div className="flex items-center gap-3 mb-6">
                <div className="relative flex items-center justify-center w-10 h-10">
                    <svg viewBox="0 0 100 100" className="absolute w-full h-full" style={{ fill: primaryColor }}>
                        <path d="M50 0 L100 40 V100 H0 V40 Z" />
                    </svg>
                    <div className="relative z-10 w-2 h-2 bg-white rounded-full"></div>
                </div>
                {baseTitle}
            </div>
        );
    }

    // Icon styles
    return (
        <div className="flex items-center gap-3 mb-6">
            <div style={{ color: secondaryColor }}>
                <IconComponent size={24} fill="currentColor" className="opacity-80" />
            </div>
            {baseTitle}
        </div>
    );
};

// --- COMPOSANT GRAPHIQUE RADAR ---
const ProfileRadarChart: React.FC<{ tests: TestData, branding?: BrandingConfig }> = ({ tests, branding }) => {
    const { catalog } = useCatalog();

    // Calcul des moyennes par catégorie
    const data = useMemo(() => {
        const stats: Record<string, { sum: number, count: number, name: string }> = {};

        // Initialisation des catégories connues pour l'ordre
        catalog.forEach(cat => {
            stats[cat.id] = { sum: 0, count: 0, name: cat.name };
        });

        Object.entries(tests).forEach(([testId, subtests]) => {
            // Trouver la catégorie du test
            const catDef = catalog.find(c => c.tests.some(t => t.id === testId));
            // For tests not in catalog, group under "Autres" pseudo-category
            const categoryId = catDef?.id || '__uncategorized__';
            if (!stats[categoryId]) {
                stats[categoryId] = { sum: 0, count: 0, name: catDef?.name || 'Autres' };
            }

        Object.entries(subtests).forEach(([subId, res]) => {
                const testDef = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                const subDef = testDef?.subtests.find(s => s.id === subId);
                const zVal = getZrv(res, subDef?.scoreType);
                if (zVal === null) return;
                // On clamp les valeurs extremes pour le graphique (-3 a +3)
                let z = zVal;
                if (z < -3) z = -3;
                if (z > 3) z = 3;

                stats[categoryId].sum += z;
                stats[categoryId].count += 1;
            });
        });

        // Transformation pour Recharts
        return Object.values(stats)
            .filter(s => s.count > 0) // On ne montre que les catégories testées
            .map(s => ({
                subject: s.name,
                A: parseFloat((s.sum / s.count).toFixed(2)),
                fullMark: 3 // Max visual range
            }));
    }, [tests, catalog]);

    if (data.length < 3) return null; // Pas assez de données pour un Radar

    const primaryColor = branding?.primaryColor || '#3D405B';
    const secondaryColor = branding?.secondaryColor || '#E07A5F';

    return (
        <div className="w-full h-[300px] mb-8 bg-stone-50 rounded-2xl border border-stone-200 relative break-inside-avoid">
            <div className="absolute top-3 left-4 text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                <PieChart size={14} /> Profil Psychomoteur
            </div>
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#3D405B', fontSize: 10, fontWeight: 700 }} />
                    <PolarRadiusAxis angle={30} domain={[-3, 3]} tick={false} axisLine={false} />
                    <Radar
                        name="Profil"
                        dataKey="A"
                        stroke={secondaryColor}
                        strokeWidth={3}
                        fill={secondaryColor}
                        fillOpacity={0.4}
                    />
                    <Tooltip
                        formatter={(value: number) => [`${value} ET`, 'Moyenne']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px rgba(0,0,0,0.1)' }}
                    />
                </RadarChart>
            </ResponsiveContainer>
            <div className="absolute bottom-3 right-4 text-[9px] text-stone-400 italic">
                0 = Moyenne • -2 = Seuil Pathologique
            </div>
        </div>
    );
};

// ─── Percentile horizontal bar chart (module-level) ─────────────────────
const ProfilePercentileChart: React.FC<{ tests: TestData; branding?: BrandingConfig }> = ({ tests, branding }) => {
    const { catalog } = useCatalog();
    const isCustom = branding?.isEnabled;
    const primaryColor = isCustom ? branding!.primaryColor : '#3D405B';
    const corners = isCustom ? branding!.cornerStyle : 'rounded';
    const roundedCls = corners === 'sharp' ? 'rounded-none' : corners === 'rounded' ? 'rounded-xl' : 'rounded-2xl';
    const titleCss: React.CSSProperties = { fontFamily: isCustom ? branding!.fontFamily : 'Merriweather', color: primaryColor };

    const pctItems = useMemo(() => {
        const result: Array<{ label: string; pct: number; color: string }> = [];
        Object.entries(tests).forEach(([testId, subtests]) => {
            const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
            Object.entries(subtests)
                .filter(([, val]) => val.percentile !== undefined && val.percentile !== null && !isNaN(Number(val.percentile)))
                .forEach(([subId, res]) => {
                    const subDef = def?.subtests.find(s => s.id === subId);
                    const pct = Number(res.percentile);
                    let color = '#81B29A';
                    if (pct < 2) color = '#E07A5F';
                    else if (pct < 9) color = '#F2CC8F';
                    result.push({ label: subDef?.displayName || subDef?.name || subId, pct, color });
                });
        });
        return result;
    }, [tests, catalog]);

    if (pctItems.length === 0) return (
        <div className="text-xs text-stone-400 italic mb-8 text-center py-8">
            Aucune donnée de percentile disponible. Les percentiles sont calculés automatiquement lorsque des normes le permettent.
        </div>
    );

    return (
        <>
            <div className={`mb-8 break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedCls}`}>
                <div className="bg-stone-100 p-4 border-b border-stone-200" style={{ backgroundColor: isCustom ? primaryColor + '08' : undefined }}>
                    <h3 className="font-bold text-sm uppercase tracking-wide" style={titleCss}>Profil des scores (Percentiles)</h3>
                </div>
                <div className="p-4 space-y-2">
                    {pctItems.map((item, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                            <span className="w-36 text-right text-stone-600 font-medium text-[10px] leading-tight break-words shrink-0" title={item.label}>{item.label}</span>
                            <div className="flex-1 h-4 bg-stone-100 rounded-full relative overflow-hidden">
                                <div className="absolute inset-y-0 left-0 w-[2%] bg-rose-200"></div>
                                <div className="absolute inset-y-0 left-[2%] w-[7%] bg-amber-100"></div>
                                <div className="absolute inset-y-0 left-[9%] w-[16%] bg-yellow-50"></div>
                                <div className="absolute inset-y-0 left-[25%] right-0 bg-emerald-50"></div>
                                <div className="absolute top-0 bottom-0 w-px bg-stone-300 left-[50%]"></div>
                                <div className="absolute top-0.5 bottom-0.5 w-3 rounded-full shadow-sm" style={{ left: `calc(${item.pct}% - 6px)`, backgroundColor: item.color }}></div>
                            </div>
                            <span className="w-12 text-right font-bold shrink-0" style={{ color: item.color }}>{item.pct}%ile</span>
                        </div>
                    ))}
                    <div className="flex items-center gap-3 text-[9px] text-stone-400 mt-2 pt-2 border-t border-stone-100">
                        <span className="w-36"></span>
                        <div className="flex-1 flex justify-between px-1">
                            <span>0</span><span>2e</span><span>9e</span><span>25e</span><span className="font-bold">50e</span><span>75e</span><span>91e</span><span>98e</span><span>100</span>
                        </div>
                        <span className="w-12"></span>
                    </div>
                </div>
            </div>
            <div className={`mb-8 p-4 bg-stone-50 border border-stone-200 text-xs ${roundedCls}`}>
                <p className="font-bold mb-2">Guide de lecture (Percentiles) :</p>
                <ul className="list-disc ml-4 space-y-1">
                    <li><span className="font-bold text-[#81B29A]">Vert :</span> Rang percentile ≥ 9 (zone normale).</li>
                    <li><span className="font-bold text-[#F2CC8F]">Orange :</span> Rang percentile 2–9 (norme basse).</li>
                    <li><span className="font-bold text-[var(--primary)]">Rouge :</span> Rang percentile {"<"} 2 (zone de difficulté).</li>
                </ul>
            </div>
        </>
    );
};

// AddPageMenu dropdown
const AddPageMenu: React.FC<{ onAddBlank: () => void; onAddEcole: () => void }> = ({ onAddBlank, onAddEcole }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);
    return (
        <div ref={ref} className="relative inline-block">
            <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-6 py-3 bg-stone-200 text-stone-500 hover:bg-stone-300 hover:text-stone-700 rounded-xl font-bold uppercase text-xs tracking-wider transition-colors">
                <Plus size={16} /> Ajouter une page
            </button>
            {open && (
                <div className="absolute left-0 mt-2 w-56 bg-white border border-stone-200 rounded-xl shadow-lg z-50 overflow-hidden">
                    <button onClick={() => { onAddBlank(); setOpen(false); }} className="w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors flex items-center gap-3">
                        <FileText size={16} className="text-stone-400" /> Page vide
                    </button>
                    <button onClick={() => { onAddEcole(); setOpen(false); }} className="w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors flex items-center gap-3 border-t border-stone-100">
                        <ClipboardList size={16} className="text-stone-400" /> Page École
                    </button>
                </div>
            )}
        </div>
    );
};

// ScoreSelector component
const ScoreSelector: React.FC<{
    selected: 'NS' | 'ET' | '%';
    onChange: (mode: 'NS' | 'ET' | '%') => void;
    isPrint: boolean;
}> = ({ selected, onChange, isPrint }) => {
    if (isPrint) {
        return <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Score ({selected})</span>;
    }

    const modes: Array<'NS' | 'ET' | '%'> = ['NS', 'ET', '%'];

    return (
        <div className="relative inline-block text-left no-print">
            <select
                value={selected}
                onChange={(e) => onChange(e.target.value as 'NS' | 'ET' | '%')}
                className="block w-full pl-3 pr-8 py-1 text-xs font-bold text-[var(--text-main)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)] sm:text-sm cursor-pointer"
            >
                {modes.map(mode => (
                    <option key={mode} value={mode}>{mode}</option>
                ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-main)]">
                <ArrowDown size={12} />
            </div>
        </div>
    );
};

export const ReportView: React.FC<Props> = ({ patient, sections, tests, onUpdateSection, branding, scoreDisplayModes = {}, onScoreDisplayModeChange, chartType = 'bar', onChartTypeChange, isPerformance = false }) => {
    const { ensureCatalogLoaded } = useCatalog();
    useEffect(() => {
        if (Object.keys(tests || {}).length === 0) return;
        ensureCatalogLoaded();
    }, [ensureCatalogLoaded, tests]);
    const { catalog } = useCatalog();
    const getSection = (id: string) => sections.find(s => s.id === id);

    // --- STATE DE MISE EN PAGE (PAGINATION DYNAMIQUE) ---
    const [pages, setPages] = useState<string[][]>([
        ['mandat_ref', 'mandat_eval', 'profil'], // Page 1
        ['diagnostic', 'objectifs', 'project', 'recommandations'], // Page 2
        ['annexes'] // Page 3
    ]);

    // Fonction de déplacement
    const moveSection = (sectionId: string, fromPageIdx: number, direction: 'up' | 'down' | 'next' | 'prev') => {
        const newPages = [...pages.map(p => [...p])]; // Deep copy
        const page = newPages[fromPageIdx];
        const sectionIdx = page.indexOf(sectionId);

        if (sectionIdx === -1) return;

        if (direction === 'up' && sectionIdx > 0) {
            [page[sectionIdx], page[sectionIdx - 1]] = [page[sectionIdx - 1], page[sectionIdx]];
        }
        else if (direction === 'down' && sectionIdx < page.length - 1) {
            [page[sectionIdx], page[sectionIdx + 1]] = [page[sectionIdx + 1], page[sectionIdx]];
        }
        else if (direction === 'next') {
            page.splice(sectionIdx, 1);
            if (fromPageIdx + 1 < newPages.length) {
                newPages[fromPageIdx + 1].unshift(sectionId);
            } else {
                newPages.push([sectionId]);
            }
        }
        else if (direction === 'prev' && fromPageIdx > 0) {
            page.splice(sectionIdx, 1);
            newPages[fromPageIdx - 1].push(sectionId);
        }

        const cleanedPages = newPages.filter((p, idx) => idx === 0 || p.length > 0);
        setPages(cleanedPages);
    };

    // STYLE DYNAMIQUE (BRANDING)
    const isCustom = branding?.isEnabled;
    const primaryColor = isCustom ? branding.primaryColor : '#3D405B';
    const secondaryColor = isCustom ? branding.secondaryColor : '#E07A5F';
    const fontFamily = isCustom ? branding.fontFamily : 'Merriweather';
    const corners = isCustom ? branding.cornerStyle : 'rounded';
    const logoSize = isCustom ? branding.logoSize : 'medium';
    const headerTemplate = isCustom ? (branding.headerTemplate || 'classic') : 'classic';
    const titleStyle = isCustom ? (branding.titleStyle || 'simple') : 'simple';
    const patientBlockStyle = isCustom ? (branding.patientBlockStyle || 'modern') : 'modern';

    const roundedClass = corners === 'sharp' ? 'rounded-none' : corners === 'rounded' ? 'rounded-xl' : 'rounded-2xl';
    const titleStyleCss = { fontFamily, color: primaryColor };
    const accentStyle = { color: secondaryColor };

    // --- SOUS-COMPOSANTS ---

    const ControlBar = ({ sectionId, pageIdx, isFirst, isLast }: { sectionId: string, pageIdx: number, isFirst: boolean, isLast: boolean }) => {
        if (!onUpdateSection) return null;

        return (
            <div className="absolute -left-12 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print z-50">
                <div className="bg-stone-800 text-white rounded-lg p-1 shadow-lg flex flex-col gap-1">
                    <button onClick={() => moveSection(sectionId, pageIdx, 'prev')} disabled={pageIdx === 0} className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => moveSection(sectionId, pageIdx, 'next')} className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"><ArrowDown size={14} /></button>
                    <div className="h-px bg-stone-600 my-0.5"></div>
                    <button onClick={() => moveSection(sectionId, pageIdx, 'up')} disabled={isFirst} className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"><ArrowUp size={10} /></button>
                    <button onClick={() => moveSection(sectionId, pageIdx, 'down')} disabled={isLast} className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"><ArrowDown size={10} /></button>
                </div>
            </div>
        );
    };

    const InteractiveSection = ({ sectionId, pageIdx, indexInPage, totalInPage }: { sectionId: string, pageIdx: number, indexInPage: number, totalInPage: number }) => {
        const section = getSection(sectionId);
        const [editingIndex, setEditingIndex] = useState<number | null>(null);
        const fileInputRef = useRef<HTMLInputElement>(null);
        const [insertIndex, setInsertIndex] = useState<number | null>(null);
        const [insertType, setInsertType] = useState<'image-full' | 'image-text'>('image-full');
        if (!section) return null;
        const sanitizedContent = sanitizeReportText(section.content || '');
        const paragraphs = sanitizedContent.split('\n').filter(line => line.trim().length > 0);

        const saveParagraph = (index: number, newText: string) => {
            if (!onUpdateSection) return;
            const newParagraphs = [...paragraphs];
            newParagraphs[index] = sanitizeReportText(newText);
            onUpdateSection(section.id, { content: sanitizeReportText(newParagraphs.join('\n\n')) });
            setEditingIndex(null);
        };

        const triggerFileSelect = (type: 'image-full' | 'image-text') => { setInsertType(type); fileInputRef.current?.click(); };
        const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files[0] && insertIndex !== null && onUpdateSection) { const file = e.target.files[0]; const url = URL.createObjectURL(file); const newAttachment: ReportAttachment = { id: crypto.randomUUID(), type: insertType, url: url, caption: insertType === 'image-text' ? "Notez ici vos observations..." : undefined, positionIndex: insertIndex }; const currentAttachments = section.attachments || []; onUpdateSection(section.id, { attachments: [...currentAttachments, newAttachment] }); setInsertIndex(null); if (fileInputRef.current) fileInputRef.current.value = ''; } };
        const updateCaption = (aid: string, val: string) => { if (!onUpdateSection) return; onUpdateSection(section.id, { attachments: (section.attachments || []).map(a => a.id === aid ? { ...a, caption: val } : a) }); };
        const removeAttachment = (aid: string) => { if (!onUpdateSection) return; const att = (section.attachments || []).find(a => a.id === aid); if (att?.url?.startsWith('blob:')) URL.revokeObjectURL(att.url); onUpdateSection(section.id, { attachments: (section.attachments || []).filter(a => a.id !== aid) }); };

        return (
            <div className="mb-8 relative group">
                <ControlBar sectionId={sectionId} pageIdx={pageIdx} isFirst={indexInPage === 0} isLast={indexInPage === totalInPage - 1} />
                <EditableSectionTitle
                    title={section.title}
                    onSave={(newTitle) => onUpdateSection?.(section.id, { title: newTitle })}
                    titleStyleCss={titleStyleCss}
                    primaryColor={primaryColor}
                    secondaryColor={secondaryColor}
                    isCustom={!!isCustom}
                    roundedClass={roundedClass}
                    titleStyle={titleStyle}
                    fontFamily={fontFamily}
                    editable={!!onUpdateSection}
                />
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                {(() => {
                    // Auto-convert plain content to HTML on first render
                    const effectiveContent = (() => {
                        if (section.contentFormat === 'html') return decodeResidualEntities(section.content);
                        // Convert plain/markdown content to HTML
                        const paras = sanitizedContent.split('\n').filter(l => l.trim());
                        return paras.map(p => {
                            if (p.startsWith('## ')) return `<h2>${p.slice(3)}</h2>`;
                            if (p.startsWith('### ')) return `<h3>${p.slice(4)}</h3>`;
                            if (p.startsWith('- ') || p.startsWith('* ')) return `<li>${p.replace(/^[*-]\s+/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`;
                            return `<p>${p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`;
                        }).join('');
                    })();
                    return onUpdateSection ? (
                        <TipTapEditor
                            content={effectiveContent}
                            onChange={(html) => onUpdateSection(section.id, { content: html, contentFormat: 'html' })}
                            isPerformance={isPerformance}
                            inline
                        />
                    ) : (
                        <TipTapEditor
                            content={effectiveContent}
                            onChange={() => {}}
                            readOnly
                            isPerformance={isPerformance}
                        />
                    );
                })()}
            </div>
        );
    };

    const AnnexesSection = ({ pageIdx, indexInPage, totalInPage }: { pageIdx: number, indexInPage: number, totalInPage: number }) => (
        <div className="relative group mb-8">
            <ControlBar sectionId="annexes" pageIdx={pageIdx} isFirst={indexInPage === 0} isLast={indexInPage === totalInPage - 1} />
            <section>
                <div className="flex items-center justify-center gap-3 mb-8">
                    <div style={accentStyle}><ClipboardList size={24} /></div>
                    <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyleCss}>Annexes : Résultats</h2>
                </div>

                {/* GRAPHIQUES : sélecteur de type */}
                <div className="flex gap-2 mb-6 no-print justify-center print:hidden">
                    {(['radar', 'bar', 'percentile'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => onChartTypeChange?.(type)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                                chartType === type
                                    ? 'bg-[var(--secondary)] text-white border-[var(--secondary)]'
                                    : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                            }`}
                        >
                            {type === 'radar' ? '🕸 Radar' : type === 'bar' ? '📊 Barres ET' : '📈 Percentiles'}
                        </button>
                    ))}
                </div>

                {/* Radar Chart */}
                {chartType === 'radar' && <ProfileRadarChart tests={tests} branding={branding} />}

                {/* ET Bar Chart */}
                {chartType === 'bar' && Object.values(tests).some(subtests => Object.values(subtests).some(res => hasValidZ(res))) && (
                <>
                {/* HORIZONTAL BAR CHART PROFILE */}
                <div className={`mb-8 break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass}`}>
                    <div className="bg-stone-100 p-4 border-b border-stone-200" style={{ backgroundColor: isCustom ? primaryColor + '08' : undefined }}>
                        <h3 className="font-bold text-sm uppercase tracking-wide" style={titleStyleCss}>Profil des scores (Écarts-types)</h3>
                    </div>
                    <div className="p-4 space-y-2">
                        {Object.entries(tests).flatMap(([testId, subtests]) => {
                            const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                            return Object.entries(subtests)
                                .map(([subId, result]) => {
                                    const subDef = def?.subtests.find(s => s.id === subId);
                                    const z = getZrv(result, subDef?.scoreType);
                                    if (z === null) return null;
                                    const clamped = Math.max(-3.5, Math.min(3.5, z));
                                    const left = ((clamped + 3.5) / 7) * 100;
                                    let color = '#81B29A';
                                    if (z <= -2) color = '#E07A5F';
                                    else if (z <= -1) color = '#F2CC8F';
                                    return (
                                        <div key={`${testId}_${subId}`} className="flex items-center gap-3 text-xs">
                                            <span className="w-32 text-right text-stone-600 font-medium text-[10px] leading-tight break-words shrink-0" title={subDef?.displayName || subDef?.name}>{subDef?.displayName || subDef?.name || subId}</span>
                                            <div className="flex-1 h-4 bg-stone-100 rounded-full relative overflow-hidden">
                                                <div className="absolute inset-y-0 left-0 w-[21.4%] bg-rose-100"></div>
                                                <div className="absolute inset-y-0 left-[21.4%] w-[14.3%] bg-amber-100"></div>
                                                <div className="absolute inset-y-0 left-[35.7%] right-0 bg-emerald-100"></div>
                                                <div className="absolute top-0 bottom-0 w-px bg-stone-300 left-[50%]"></div>
                                                <div className="absolute top-0.5 bottom-0.5 w-3 rounded-full shadow-sm transition-all" style={{ left: `calc(${left}% - 6px)`, backgroundColor: color }}></div>
                                            </div>
                                            <span className="w-10 text-right font-bold shrink-0" style={{ color }}>{z > 0 ? '+' : ''}{z}</span>
                                        </div>
                                    );
                                }).filter(Boolean);
                        })}
                        <div className="flex items-center gap-3 text-[9px] text-stone-400 mt-2 pt-2 border-t border-stone-100">
                            <span className="w-32"></span>
                            <div className="flex-1 flex justify-between px-1">
                                <span>-3.5 ET</span><span>-2 ET</span><span>-1 ET</span><span className="font-bold">0</span><span>+1 ET</span><span>+2 ET</span><span>+3.5 ET</span>
                            </div>
                            <span className="w-10"></span>
                        </div>
                    </div>
                </div>

                <div className={`mb-8 p-4 bg-stone-50 border border-stone-200 text-xs ${roundedClass}`}>
                    <p className="font-bold mb-2">Guide de lecture :</p>
                    <ul className="list-disc ml-4 space-y-1">
                        <li><span className="font-bold text-[#81B29A]">Vert :</span> Dans la moyenne (-1 à +1 ET).</li>
                        <li><span className="font-bold text-[#F2CC8F]">Orange :</span> Zone de fragilité (-1 à -2 ET).</li>
                        <li><span className="font-bold text-[var(--primary)]">Rouge :</span> Zone de difficulté (Inférieur à -2 ET).</li>
                    </ul>
                </div>
                </>
                )}

                {/* Percentile Chart */}
                {chartType === 'percentile' && <ProfilePercentileChart tests={tests} branding={branding} />}
                <div className="space-y-12">
                    {Object.entries(tests).map(([testId, subtests]) => {
                        const catalogDef = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                        // Fallback for private/custom tests absent from catalog — still display their data
                        const def = catalogDef || {
                            id: testId,
                            name: testId === 'custom_observations' ? 'Observations personnalisées' : testId.startsWith('priv_') ? `Test personnalisé` : testId,
                            subtests: Object.keys(subtests).map(subId => ({ id: subId, name: (subtests[subId] as any)?.customLabel || subId, displayName: (subtests[subId] as any)?.customLabel || undefined, unit: 'pts', scoreType: 'standard' as const, lowerIsBetter: false, computationMode: 'LOOKUP' as const, inputModel: 'numeric_4mode' as const, inputConfig: undefined as any })),
                        };
                        // At Step 5, all tests have already been validated — show them unconditionally
                        const validSubtests = Object.entries(subtests);
                        if (validSubtests.length === 0) return null;

                        const enrichedSubtests = validSubtests.map(([subId, result]) => {
                            const subDef = def.subtests.find(s => s.id === subId);
                            const isQualitative = subDef?.inputModel === 'qualitative_category' || !!result.qualitativeCode;
                            const isScoreable = !isQualitative && (subDef?.scoreType || 'standard') !== 'none';
                            const zComputed = isScoreable ? getZrv(result, subDef?.scoreType) : null;
                            return { subId, result, subDef, isQualitative, isScoreable, zComputed };
                        });

                        const quantitativeSubtests = enrichedSubtests.filter((item) => !item.isQualitative);
                        const qualitativeSubtests = enrichedSubtests.filter((item) => item.isQualitative);
                        const hasScoreableSubtests = quantitativeSubtests.some((item) => item.isScoreable);

                        const currentMode = scoreDisplayModes?.[testId] || 'ET';
                        const showSelector = hasScoreableSubtests;

                        // Custom observations: simple card layout (no score table)
                        if (testId === 'custom_observations') {
                            return (
                                <div key={testId} className={`break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass}`}>
                                    <div className="bg-stone-100 p-4 border-b border-stone-200" style={{ backgroundColor: primaryColor + '08' }}>
                                        <h3 className="font-bold text-lg" style={titleStyleCss}>{def.name}</h3>
                                    </div>
                                    <div className="p-6 space-y-5">
                                        {validSubtests.map(([subId, result]) => (
                                            <div key={subId} className="border border-stone-100 rounded-lg p-4">
                                                <h4 className="font-semibold text-sm text-stone-700 mb-2">{result.customLabel || 'Observation personnalisée'}</h4>
                                                <p className="text-sm text-stone-600 whitespace-pre-wrap">{result.observation || '-'}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={testId} className={`break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass}`}>
                                <div className="bg-stone-100 p-4 border-b border-stone-200 flex justify-between items-center" style={{ backgroundColor: isCustom ? primaryColor + '08' : undefined }}>
                                    <div className="flex items-center gap-4">
                                        <h3 className="font-bold text-lg" style={titleStyleCss}>{def.name}</h3>
                                        <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">{validSubtests.length} épreuves</span>
                                    </div>
                                    {onScoreDisplayModeChange && showSelector && (
                                        <ScoreSelector
                                            selected={currentMode}
                                            onChange={(mode) => onScoreDisplayModeChange({ ...scoreDisplayModes, [testId]: mode })}
                                            isPrint={false}
                                        />
                                    )}
                                </div>
                                <div className="p-6">
                                    {quantitativeSubtests.length > 0 && (
                                        <div className="overflow-x-auto w-full mb-6">
                                            <table className="w-full border-collapse text-sm">
                                                <thead>
                                                    <tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider">
                                                        <th className="pb-3 w-[35%]">Épreuves</th>
                                                        <th className="pb-3 w-[15%] text-center">{showSelector ? `Score (${currentMode})` : 'Résultat'}</th>
                                                        <th className="pb-3 w-[50%] pl-4">Observations</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="text-stone-700">
                                                    {quantitativeSubtests.map(({ subId, result, subDef, isScoreable, zComputed }) => {
                                                        const z = zComputed;
                                                        const isPathological = z !== null && z <= -2;
                                                        const isFragile = z !== null && z <= -1 && z > -2;
                                                        const colorClass = isPathological ? "text-[var(--primary)] font-bold" : isFragile ? "text-[#F2CC8F] font-bold" : "text-[#81B29A]";

                                                        let displayScore: string | number = '-';
                                        if (currentMode === 'NS') displayScore = isScoreable ? (result.standard || '-') : '-';
                                        else if (currentMode === 'ET') displayScore = (isScoreable && z !== null) ? (z > 0 ? '+' : '') + z.toFixed(2) + ' ET' : '-';
                                        else if (currentMode === '%') displayScore = (isScoreable && result.percentile !== undefined && result.percentile !== null) ? result.percentile + '%' : '-';

                                        if (!isScoreable) displayScore = '-';
                                                        return (
                                                            <tr key={subId} className="border-b border-stone-50 last:border-0 align-top">
                                                                <td className="py-3 pr-4 font-medium">• {subDef?.displayName || subDef?.name}</td>
                                                                <td className={`py-3 text-center ${isScoreable && (currentMode === 'ET' || currentMode === 'NS') ? colorClass : 'text-stone-500'}`}>{displayScore}</td>
                                                                <td className="py-3 pl-4 italic text-xs text-stone-500">{result.observation || "-"}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {qualitativeSubtests.length > 0 && (
                                        <div className="overflow-x-auto w-full">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Qualitatif</div>
                                            <table className="w-full border-collapse text-sm">
                                                <thead>
                                                    <tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider">
                                                        <th className="pb-3 w-[30%]">Épreuves</th>
                                                        <th className="pb-3 w-[20%] text-center">Catégorie</th>
                                                        <th className="pb-3 w-[25%] pl-3">Interprétation</th>
                                                        <th className="pb-3 w-[25%] pl-3">Observations</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="text-stone-700">
                                                    {qualitativeSubtests.map(({ subId, result, subDef }) => {
                                                        const selectedOption = subDef?.inputConfig?.options?.find(
                                                            (opt) =>
                                                                opt.code === result.qualitativeCode ||
                                                                opt.code === result.raw ||
                                                                opt.label === result.qualitativeLabel,
                                                        );
                                                        const displayCategory = result.qualitativeLabel || selectedOption?.label || result.qualitativeCode || result.raw || '-';
                                                        const displayInterpretation = selectedOption?.reportText || '-';

                                                        return (
                                                            <tr key={subId} className="border-b border-stone-50 last:border-0 align-top">
                                                                <td className="py-3 pr-4 font-medium">• {subDef?.displayName || subDef?.name}</td>
                                                                <td className="py-3 text-center font-semibold text-[var(--secondary)]">{displayCategory}</td>
                                                                <td className="py-3 pl-3 text-xs text-stone-600">{displayInterpretation}</td>
                                                                <td className="py-3 pl-3 italic text-xs text-stone-500">{result.observation || "-"}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );

    const HeaderRenderer = () => {
        const logoClass = logoSize === 'small' ? 'w-28 h-12' : logoSize === 'medium' ? 'w-40 h-20' : 'w-64 h-32';

        // LOGIC LOGO
        const LogoBlock = () => {
            if (isCustom && branding?.logoUrl) {
                return <img src={branding.logoUrl} alt="Logo" className={`${logoClass} object-contain mb-2`} loading="eager" decoding="async" />;
            }
            // Si pas de logo et pas de texte principal custom, on ne met rien pour éviter le vide
            // Ou on met un placeholder si rien n'est configuré
            return null;
        };

        // LOGIC TITRE CABINET (Marque)
        const CabinetTitle = () => {
            // Priorité : Text Custom > Cabinet Name > Fallback
            const title = branding?.cabinetName || "Cabinet d'Ergothérapie";
            const subtitle = branding?.brandSubtitle || "";

            return (
                <div>
                    <h1 className="font-bold text-3xl tracking-tight leading-tight" style={titleStyleCss}>
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-sm font-bold mt-1" style={{ color: secondaryColor }}>{subtitle}</p>
                    )}
                </div>
            );
        };

        // LOGIC INFOS PRATICIEN (Détails) — locked, linked to profile
        const PractitionerDetails = () => (
            <div className={`text-xs space-y-1 mt-3 ${isCustom ? 'text-stone-500' : 'text-stone-600'}`}>
                {branding?.practitionerName && <p className="flex items-center gap-1.5 font-semibold text-stone-700"><Star size={10} className="shrink-0" /> {branding.practitionerName}</p>}
                {branding?.phone && <p className="flex items-center gap-1.5"><Phone size={10} className="shrink-0" /> {branding.phone}</p>}
                {branding?.email && <p className="flex items-center gap-1.5"><Mail size={10} className="shrink-0" /> {branding.email}</p>}
                {branding?.siret && <p className="flex items-center gap-1.5 text-stone-400"><Home size={10} className="shrink-0" /> SIRET : {branding.siret}</p>}
                {branding?.address && <p className="flex items-center gap-1.5"><Home size={10} className="shrink-0" /> {branding.address}</p>}
            </div>
        );

        const PatientBlock = ({ align }: { align: 'left' | 'right' | 'center' }) => {
            if (patientBlockStyle === 'minimal') {
                return (
                    <div className={`w-full text-${align}`}>
                        <h2 className="font-bold text-2xl text-stone-900 mb-1">{patient.firstName} {patient.lastName}</h2>
                        <p className="text-sm text-stone-600 font-medium">Né(e) le {formatDobFrSafe(patient.dob)}</p>
                        <p className="text-sm text-stone-500">{patient.age}</p>
                        {patient.address && <p className="text-xs text-stone-400 mt-1">{patient.address}</p>}
                    </div>
                );
            }
            // Modern (Boxed) - Default
            return (
                <div className={`p-4 bg-stone-50 border border-stone-100 ${roundedClass} min-w-[200px] w-full text-${align}`}>
                    <h2 className="font-bold text-2xl text-stone-900 mb-1">{patient.firstName} {patient.lastName}</h2>
                    <p className="text-sm text-stone-600 font-medium">Né(e) le {formatDobFrSafe(patient.dob)}</p>
                    <p className="text-sm text-stone-500">{patient.age}</p>
                </div>
            );
        };

        // MODE CORPORATE (PDF Style) : Patient Left, Praticien Right
        if (headerTemplate === 'corporate') {
            return (
                <header className="flex flex-col mb-12 border-b-2 border-stone-100 pb-8">
                    <div className="flex justify-between items-start">
                        <div className="w-1/3 pt-4">
                            <PatientBlock align="left" />
                        </div>
                        <div className="w-1/2 text-right flex flex-col items-end">
                            <LogoBlock />
                            <CabinetTitle />
                            <PractitionerDetails />
                        </div>
                    </div>
                </header>
            );
        }

        // MODE CENTRÉ
        if (headerTemplate === 'centered') {
            return (
                <header className="flex flex-col items-center text-center mb-12 border-b-2 border-stone-100 pb-8 gap-6">
                    <LogoBlock />
                    <CabinetTitle />
                    <PractitionerDetails />
                    <div className="w-2/3 border-t border-stone-100 pt-6">
                        <PatientBlock align="center" />
                    </div>
                </header>
            );
        }

        // MODE CLASSIC (Default) : Logo/Prac Left, Patient Right
        return (
            <header className="flex flex-col mb-12 border-b-2 border-stone-100 pb-8">
                <div className="flex justify-between items-start gap-6">
                    <div className="flex-1">
                        <LogoBlock />
                        <CabinetTitle />
                        <PractitionerDetails />
                    </div>
                    <div className="w-1/3 pt-2">
                        <PatientBlock align="right" />
                    </div>
                </div>
            </header>
        );
    };

    return (
        <div id="printable-report" className="w-full flex flex-col items-center gap-8 no-scrollbar">
            {pages.map((pageSections, pageIdx) => (
                <div key={pageIdx} className="page-a4">
                    {pageIdx === 0 && (
                        <>
                            <HeaderRenderer />

                            <div className="mb-8 text-sm text-stone-500 italic text-right">
                                Fait le {new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>

                            {/* TITRE DOCUMENT CONFIGURABLE */}
                            <h1 className="text-center font-bold text-3xl mb-12" style={titleStyle === 'underline' ? { ...titleStyleCss, borderBottom: `4px solid ${secondaryColor}`, display: 'inline-block', paddingBottom: '8px' } : titleStyleCss}>
                                {branding?.documentTitle || "Rapport d’évaluation"}
                            </h1>

                            <div className={`text-xs text-stone-600 text-justify mb-10 leading-relaxed border-l-4 pl-4 py-2 bg-stone-50 ${roundedClass}`} style={{ borderColor: secondaryColor }}>
                                <p className="mb-2"><strong>{patient.firstName}</strong> et ses parents consentent à cette évaluation.</p>
                                <p>Ce bilan a pour objectif d'analyser les capacités fonctionnelles et de proposer des axes d'intervention adaptés.</p>
                            </div>
                        </>
                    )}
                    {pageSections.map((sectionId, idx) => {
                        if (sectionId === 'annexes') return (
                            <React.Fragment key={sectionId}>
                                <AnnexesSection pageIdx={pageIdx} indexInPage={idx} totalInPage={pageSections.length} />
                            </React.Fragment>
                        );
                        return (
                            <React.Fragment key={sectionId}>
                                <InteractiveSection sectionId={sectionId} pageIdx={pageIdx} indexInPage={idx} totalInPage={pageSections.length} />
                            </React.Fragment>
                        );
                    })}
                    <div className="absolute bottom-10 left-[15mm] right-[15mm] border-t border-stone-200 pt-4 flex justify-between items-end text-xs text-stone-400">
                        <div>
                            <p>{branding?.footerText || "Document confidentiel"}</p>
                            <p className="mt-1">Profession inscrite au code de la santé publique.</p>
                            {pageIdx === pages.length - 1 && (
                                <p className="mt-1 text-[9px] italic">Résultats saisis et revus par le praticien.</p>
                            )}
                        </div>
                        {branding?.showPageNumbers && <div className="font-mono">Page {pageIdx + 1}/{pages.length}</div>}
                    </div>
                </div>
            ))}
            {onUpdateSection && (
                <div className="no-print pb-20 relative">
                    <AddPageMenu onAddBlank={() => setPages([...pages, []])} onAddEcole={() => {
                        onUpdateSection('ecole', { title: 'Recommandations scolaires', content: '<p>Aménagements et recommandations pour le milieu scolaire.</p>' });
                        setPages([...pages, ['ecole']]);
                    }} />
                </div>
            )}
        </div>
    );
};

const hasAnyScoreValue = (result?: any): boolean => {
    if (!result) return false;
    return Boolean(
        (result.raw && String(result.raw).trim()) ||
        (result.standard && String(result.standard).trim()) ||
        (result.percentile && String(result.percentile).trim()) ||
        (typeof result.zScore === 'number' && Number.isFinite(result.zScore)) ||
        (result.qualitativeCode && String(result.qualitativeCode).trim()) ||
        (result.qualitativeLabel && String(result.qualitativeLabel).trim())
    );
};

const hasValidZ = (result?: any): boolean => typeof result?.zScore === 'number' && Number.isFinite(result.zScore);

/** Scale parameters — mirrors SCALE_PARAMS in ScorePage.tsx */
const RV_SCALE_PARAMS: Record<string, { mean: number; sd: number } | null> = {
    scaled:     { mean: 10,  sd: 3  },
    standard:   { mean: 100, sd: 15 },
    't-score':  { mean: 50,  sd: 10 },
    sten:       { mean: 5.5, sd: 2  },
    stanine:    { mean: 5,   sd: 2  },
    percentile: null,
    none:       null,
};

/** Recompute z from standard score + scoreType; falls back to stored zScore */
const getZrv = (result: any, scoreType?: string): number | null => {
    const params = RV_SCALE_PARAMS[scoreType || ''];
    if (params && result?.standard) {
        const n = parseFloat(String(result.standard).replace(',', '.'));
        if (Number.isFinite(n)) return parseFloat(((n - params.mean) / params.sd).toFixed(2));
    }
    return typeof result?.zScore === 'number' && Number.isFinite(result.zScore) ? result.zScore : null;
};

const isReviewedScore = (result?: any): boolean =>
    result?.reviewState === 'reviewed' || result?.status === 'validated' || result?.status === 'certified';
