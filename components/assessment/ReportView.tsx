import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Patient, ReportSection, TestData, ReportAttachment, BrandingConfig } from '../../types';
// GaussianChart removed — using horizontal bar profile only
// import { SCALES } from '../../utils/scoring';
import { FileText, ClipboardList, Plus, Image as ImageIcon, LayoutTemplate, X, Trash2, Edit2, Check, Upload, MapPin, Mail, Phone, ArrowDown, ArrowUp, ArrowRight, ArrowLeft, Move, Home, Star, Sparkles, PieChart } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
    patient: Patient;
    sections: ReportSection[];
    tests: TestData;
    onUpdateSection?: (sectionId: string, updates: Partial<ReportSection>) => void;
    branding?: BrandingConfig;
    scoreDisplayModes?: Record<string, 'Brut' | 'NS' | 'ET' | '%'>;
    onScoreDisplayModeChange?: (modes: Record<string, 'Brut' | 'NS' | 'ET' | '%'>) => void;
}

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
            className="w-full bg-transparent border border-transparent hover:border-stone-200 outline-none text-sm text-stone-700 italic resize-none focus:bg-white focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]/20 rounded p-2 transition-all leading-relaxed print:resize-none print:border-none print:p-0"
            rows={4}
            placeholder="Ajoutez une légende..."
        />
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
            if (!catDef) return;

            Object.values(subtests).forEach(res => {
                if (res.status === 'validated' || res.status === 'certified') {
                    // On inverse le score si lowerIsBetter ? Non, Z-Score est déjà normalisé par le moteur.
                    // On clamp les valeurs extrêmes pour le graphique (-3 à +2)
                    let z = res.zScore;
                    if (z < -3) z = -3;
                    if (z > 2) z = 2;

                    stats[catDef.id].sum += z;
                    stats[catDef.id].count += 1;
                }
            });
        });

        // Transformation pour Recharts
        return Object.values(stats)
            .filter(s => s.count > 0) // On ne montre que les catégories testées
            .map(s => ({
                subject: s.name,
                A: parseFloat((s.sum / s.count).toFixed(2)),
                fullMark: 2 // Max visual range
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
                    <PolarRadiusAxis angle={30} domain={[-3, 2]} tick={false} axisLine={false} />
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

// ScoreSelector component
const ScoreSelector: React.FC<{
    selected: 'Brut' | 'NS' | 'ET' | '%';
    onChange: (mode: 'Brut' | 'NS' | 'ET' | '%') => void;
    isPrint: boolean;
}> = ({ selected, onChange, isPrint }) => {
    if (isPrint) {
        return <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Score ({selected})</span>;
    }

    const modes: Array<'Brut' | 'NS' | 'ET' | '%'> = ['Brut', 'NS', 'ET', '%'];

    return (
        <div className="relative inline-block text-left no-print">
            <select
                value={selected}
                onChange={(e) => onChange(e.target.value as 'Brut' | 'NS' | 'ET' | '%')}
                className="block w-full pl-3 pr-8 py-1 text-xs font-bold text-stone-600 bg-white border border-stone-200 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#E07A5F] focus:border-[#E07A5F] sm:text-sm cursor-pointer"
            >
                {modes.map(mode => (
                    <option key={mode} value={mode}>{mode}</option>
                ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-stone-700">
                <ArrowDown size={12} />
            </div>
        </div>
    );
};

export const ReportView: React.FC<Props> = ({ patient, sections, tests, onUpdateSection, branding, scoreDisplayModes = {}, onScoreDisplayModeChange }) => {
    const { ensureCatalogLoaded } = useCatalog();
    useEffect(() => {
        ensureCatalogLoaded();
    }, [ensureCatalogLoaded]);
    const { catalog } = useCatalog();
    const getSection = (id: string) => sections.find(s => s.id === id);

    // --- STATE DE MISE EN PAGE (PAGINATION DYNAMIQUE) ---
    const [pages, setPages] = useState<string[][]>([
        ['mandat_ref', 'mandat_eval', 'profil'], // Page 1
        ['diagnostic', 'objectifs', 'recommandations'], // Page 2
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

    const SectionTitle = ({ title }: { title: string }) => {
        // Style Icones (Personnalisation avancée)
        let IconComponent: any = FileText;
        const isFilledShape = titleStyle === 'filled-shape';

        if (titleStyle === 'icon-house') IconComponent = Home;
        else if (titleStyle === 'icon-star') IconComponent = Star;
        else if (titleStyle === 'icon-sparkle') IconComponent = Sparkles;
        else if (titleStyle === 'filled-shape') IconComponent = Home; // Default shape icon

        if (titleStyle === 'simple') {
            return (
                <div className="flex items-center gap-3 mb-6 pb-2 border-b-2" style={{ borderColor: isCustom ? primaryColor + '20' : '#E5E7EB' }}>
                    <div className={`p-1.5 ${roundedClass} ${isCustom ? '' : 'bg-stone-100 text-stone-500'}`} style={isCustom ? { backgroundColor: primaryColor + '15', color: primaryColor } : {}}>
                        <FileText size={20} />
                    </div>
                    <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyleCss}>{title}</h2>
                </div>
            );
        }

        if (titleStyle === 'underline') {
            return (
                <h2 className="text-xl font-bold uppercase tracking-wide mb-6 pb-2 border-b-4 inline-block" style={{ ...titleStyleCss, borderColor: secondaryColor }}>{title}</h2>
            );
        }

        if (isFilledShape) {
            return (
                <div className="flex items-center gap-3 mb-6">
                    {/* Forme pleine type "Maison" ou "Rond" avec icône blanche */}
                    <div className="relative flex items-center justify-center w-10 h-10">
                        {/* Forme de fond SVG simple */}
                        <svg viewBox="0 0 100 100" className="absolute w-full h-full" style={{ fill: primaryColor }}>
                            <path d="M50 0 L100 40 V100 H0 V40 Z" /> {/* Forme Maison */}
                        </svg>
                        <div className="relative z-10 text-white">
                            {/* On peut varier l'icône selon le titre si on veut être intelligent, pour l'instant icône générique */}
                            <div className="w-2 h-2 bg-white rounded-full"></div>
                        </div>
                    </div>
                    <h2 className="text-xl font-bold uppercase tracking-wide" style={{ color: secondaryColor, fontFamily }}>{title}</h2>
                </div>
            );
        }

        // Icon Styles (Outline)
        return (
            <div className="flex items-center gap-3 mb-6">
                <div style={{ color: secondaryColor }}>
                    <IconComponent size={24} fill="currentColor" className="opacity-80" />
                </div>
                <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyleCss}>{title}</h2>
            </div>
        );
    };

    const InteractiveSection = ({ sectionId, pageIdx, indexInPage, totalInPage }: { sectionId: string, pageIdx: number, indexInPage: number, totalInPage: number }) => {
        const section = getSection(sectionId);
        const [editingIndex, setEditingIndex] = useState<number | null>(null);
        const [tempText, setTempText] = useState('');
        const fileInputRef = useRef<HTMLInputElement>(null);
        const [insertIndex, setInsertIndex] = useState<number | null>(null);
        const [insertType, setInsertType] = useState<'image-full' | 'image-text'>('image-full');
        if (!section) return null;
        const paragraphs = (section.content || '').split('\n').filter(line => line.trim().length > 0);

        const handleTextClick = (index: number, text: string) => { if (!onUpdateSection) return; setEditingIndex(index); setTempText(text); };
        const saveText = (index: number) => { if (!onUpdateSection) return; const newParagraphs = [...paragraphs]; newParagraphs[index] = tempText; onUpdateSection(section.id, { content: newParagraphs.join('\n\n') }); setEditingIndex(null); };
        const triggerFileSelect = (type: 'image-full' | 'image-text') => { setInsertType(type); fileInputRef.current?.click(); };
        const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files[0] && insertIndex !== null && onUpdateSection) { const file = e.target.files[0]; const url = URL.createObjectURL(file); const newAttachment: ReportAttachment = { id: crypto.randomUUID(), type: insertType, url: url, caption: insertType === 'image-text' ? "Notez ici vos observations..." : undefined, positionIndex: insertIndex }; const currentAttachments = section.attachments || []; onUpdateSection(section.id, { attachments: [...currentAttachments, newAttachment] }); setInsertIndex(null); if (fileInputRef.current) fileInputRef.current.value = ''; } };
        const updateCaption = (aid: string, val: string) => { if (!onUpdateSection) return; onUpdateSection(section.id, { attachments: (section.attachments || []).map(a => a.id === aid ? { ...a, caption: val } : a) }); };
        const removeAttachment = (aid: string) => { if (!onUpdateSection) return; const att = (section.attachments || []).find(a => a.id === aid); if (att?.url?.startsWith('blob:')) URL.revokeObjectURL(att.url); onUpdateSection(section.id, { attachments: (section.attachments || []).filter(a => a.id !== aid) }); };

        return (
            <div className="mb-8 relative group">
                <ControlBar sectionId={sectionId} pageIdx={pageIdx} isFirst={indexInPage === 0} isLast={indexInPage === totalInPage - 1} />
                <SectionTitle title={section.title} />
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                <div className="space-y-2">
                    {paragraphs.map((para, idx) => {
                        const attachmentsHere = section.attachments?.filter(a => a.positionIndex === idx) || [];
                        const isEditing = editingIndex === idx;
                        let textStyle = "text-stone-700 leading-relaxed text-sm text-justify mb-2";
                        let content = para;
                        if (para.startsWith('## ')) { textStyle = "text-lg font-bold mt-6 mb-2 uppercase border-b pb-1 border-stone-100"; }
                        else if (para.startsWith('### ')) { textStyle = "text-md font-bold text-stone-800 mt-4 mb-1"; content = para.replace('### ', ''); }
                        else if (para.startsWith('- ') || para.startsWith('* ')) { textStyle = "text-stone-700 leading-relaxed text-sm text-justify ml-4 list-item list-disc marker:text-stone-800"; content = para.replace(/^[*-]\s+/, ''); }

                        return (
                            <div key={idx} className="relative group/block">
                                {isEditing ? (
                                    <div className="relative mb-4 print:hidden">
                                        <textarea value={tempText} onChange={(e) => setTempText(e.target.value)} className={`w-full p-4 border-2 border-[#E07A5F] ${roundedClass} shadow-lg outline-none text-sm min-h-[150px] bg-white text-stone-900 font-medium leading-relaxed resize-y`} autoFocus />
                                        <div className="flex justify-end gap-2 mt-2 absolute bottom-3 right-3">
                                            <button onClick={() => setEditingIndex(null)} className="p-1.5 bg-stone-100 rounded-md shadow text-stone-500"><X size={14} /></button>
                                            <button onClick={() => saveText(idx)} className="p-1.5 bg-[#E07A5F] rounded-md shadow text-white"><Check size={14} /></button>
                                        </div>
                                    </div>
                                ) : (
                                    <div onClick={() => handleTextClick(idx, para)} className={`${textStyle} ${onUpdateSection ? 'cursor-text hover:bg-[#fff5f2] rounded px-2 -mx-2 py-1 -my-1 transition-colors relative border border-transparent hover:border-[#E07A5F]/20 print:border-none' : ''}`} style={para.startsWith('## ') ? { color: primaryColor, fontFamily } : {}}>
                                        {parseBold(content.replace('## ', ''))}
                                        {onUpdateSection && <Edit2 size={12} className="absolute top-1 right-1 text-[#E07A5F] opacity-0 group-hover/block:opacity-100 print:hidden" />}
                                    </div>
                                )}
                                {attachmentsHere.map(att => (
                                    <div key={att.id} className="relative group my-6 break-inside-avoid">
                                        {att.type === 'image-full' ? (
                                            <img src={att.url} alt="" className={`w-full max-h-[400px] object-contain ${roundedClass} border border-stone-200 bg-stone-50 print:border-none`} />
                                        ) : (
                                            <div className={`flex gap-6 items-start bg-stone-50 p-4 ${roundedClass} border border-stone-100 print:bg-transparent print:border-none print:p-0`}>
                                                <img src={att.url} alt="" className={`w-1/2 h-auto shadow-sm bg-white border border-stone-100 print:border-none ${roundedClass}`} />
                                                <div className="w-1/2 pt-1">{onUpdateSection ? <CaptionEditor initialValue={att.caption || ''} onSave={(val) => updateCaption(att.id, val)} /> : <p className="text-sm text-stone-600 italic text-justify">{att.caption}</p>}</div>
                                            </div>
                                        )}
                                        {onUpdateSection && <button onClick={() => removeAttachment(att.id)} className="absolute top-2 right-2 bg-white/90 text-rose-500 p-2 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity no-print"><Trash2 size={16} /></button>}
                                    </div>
                                ))}
                                {onUpdateSection && (
                                    <div className="h-4 -my-2 relative z-10 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center group/insert no-print print:hidden">
                                        <div className="w-full h-px bg-[#E07A5F]/20 group-hover/insert:bg-[#E07A5F]/50 transition-colors"></div>
                                        {insertIndex === idx ? (
                                            <div className="absolute bg-white shadow-xl border border-stone-100 rounded-xl p-2 flex gap-2 animate-in zoom-in-95 duration-200 z-50">
                                                <button onClick={() => triggerFileSelect('image-full')} className="flex flex-col items-center gap-1 p-2 hover:bg-stone-50 rounded-lg text-xs font-bold text-stone-500 hover:text-[#E07A5F]"><div className="p-2 bg-stone-100 rounded-lg text-stone-400 group-hover:text-[#E07A5F]"><ImageIcon size={18} /></div>Img</button>
                                                <div className="w-px bg-stone-100"></div>
                                                <button onClick={() => triggerFileSelect('image-text')} className="flex flex-col items-center gap-1 p-2 hover:bg-stone-50 rounded-lg text-xs font-bold text-stone-500 hover:text-[#E07A5F]"><div className="p-2 bg-stone-100 rounded-lg text-stone-400 group-hover:text-[#E07A5F]"><LayoutTemplate size={18} /></div>Img+Txt</button>
                                                <button onClick={() => setInsertIndex(null)} className="absolute -top-2 -right-2 bg-white rounded-full p-1 border border-stone-100 shadow-sm text-stone-400"><X size={12} /></button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setInsertIndex(idx)} className="absolute bg-white border border-[#E07A5F] text-[#E07A5F] rounded-full p-1 shadow-sm hover:scale-110 transition-transform"><Plus size={14} strokeWidth={3} /></button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const AnnexesSection = ({ pageIdx, indexInPage, totalInPage }: { pageIdx: number, indexInPage: number, totalInPage: number }) => (
        <div className="relative group mb-8">
            <ControlBar sectionId="annexes" pageIdx={pageIdx} isFirst={indexInPage === 0} isLast={indexInPage === totalInPage - 1} />
            <section>
                <div className="flex items-center justify-center gap-3 mb-8">
                    <div style={accentStyle}><ClipboardList size={24} /></div>
                    <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyleCss}>Annexes : Résultats Chiffrés</h2>
                </div>

                {/* GRAPHIQUE GLOBAL (Radar) */}
                <ProfileRadarChart tests={tests} branding={branding} />

                {/* HORIZONTAL BAR CHART PROFILE */}
                <div className={`mb-8 break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass}`}>
                    <div className="bg-stone-100 p-4 border-b border-stone-200" style={{ backgroundColor: isCustom ? primaryColor + '08' : undefined }}>
                        <h3 className="font-bold text-sm uppercase tracking-wide" style={titleStyleCss}>Profil des scores (Écarts-types)</h3>
                    </div>
                    <div className="p-4 space-y-2">
                        {Object.entries(tests).flatMap(([testId, subtests]) => {
                            const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                            return Object.entries(subtests)
                                .filter(([, val]) => val.raw && (val.status === 'validated' || val.status === 'certified'))
                                .map(([subId, result]) => {
                                    const subDef = def?.subtests.find(s => s.id === subId);
                                    const z = result.zScore || 0;
                                    const clamped = Math.max(-3.5, Math.min(3.5, z));
                                    const left = ((clamped + 3.5) / 7) * 100;
                                    let color = '#81B29A';
                                    if (z <= -2) color = '#E07A5F';
                                    else if (z <= -1) color = '#F2CC8F';
                                    return (
                                        <div key={`${testId}_${subId}`} className="flex items-center gap-3 text-xs">
                                            <span className="w-32 text-right text-stone-600 font-medium truncate shrink-0" title={subDef?.name}>{subDef?.name || subId}</span>
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
                                });
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
                        <li><span className="font-bold text-[#E07A5F]">Rouge :</span> Zone de difficulté (Inférieur à -2 ET).</li>
                    </ul>
                </div>
                <div className="space-y-12">
                    {Object.entries(tests).map(([testId, subtests]) => {
                        const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                        if (!def) return null;
                        const validSubtests = Object.entries(subtests).filter(([, val]) => val.raw && (val.status === 'validated' || val.status === 'certified'));
                        if (validSubtests.length === 0) return null;

                        // Determine default score mode if not set
                        // Smart check: if no subtest has a scoreType, default to 'Brut' and hide selector
                        const hasScoreableSubtests = validSubtests.some(([subId]) => {
                            const subDef = def.subtests.find(s => s.id === subId);
                            return (subDef?.scoreType || 'standard') !== 'none';
                        });

                        const currentMode = scoreDisplayModes?.[testId] || (hasScoreableSubtests ? 'ET' : 'Brut');
                        const showSelector = hasScoreableSubtests;

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
                                    <div className="overflow-x-auto w-full">
                                        <table className="w-full border-collapse text-sm mb-4">
                                            <thead>
                                                <tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider">
                                                    <th className="pb-3 w-[35%]">Épreuves</th>
                                                    <th className="pb-3 w-[15%] text-center">{showSelector ? `Score (${currentMode})` : 'Résultat'}</th>
                                                    <th className="pb-3 w-[50%] pl-4">Observations</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-stone-700">
                                                {validSubtests.map(([subId, result]) => {
                                                    const subDef = def.subtests.find(s => s.id === subId);
                                                    const isPathological = result.zScore <= -2;
                                                    const isFragile = result.zScore <= -1 && result.zScore > -2;
                                                    const isScoreable = (subDef?.scoreType || 'standard') !== 'none';
                                                    const colorClass = isPathological ? "text-[#E07A5F] font-bold" : isFragile ? "text-[#F2CC8F] font-bold" : "text-[#81B29A]";

                                                    // Display logic based on selected mode
                                                    let displayScore: string | number = '-';
                                                    if (currentMode === 'Brut') displayScore = result.raw;
                                                    else if (currentMode === 'NS') displayScore = isScoreable ? (result.standard || '-') : '-';
                                                    else if (currentMode === 'ET') displayScore = (isScoreable && result.zScore !== undefined && result.zScore !== null) ? (result.zScore > 0 ? '+' : '') + result.zScore.toFixed(2) + ' ET' : '-';
                                                    else if (currentMode === '%') displayScore = (isScoreable && result.percentile !== undefined && result.percentile !== null) ? result.percentile + '%' : '-';

                                                    // Fallback for non-scoreable tests wanting standard/zscore: show raw if relevant, or '-'
                                                    if (!isScoreable && currentMode !== 'Brut') displayScore = '-';
                                                    // User requested flexibility: if they select 'Brut' on a scoreable test, show raw. Correct.

                                                    return (
                                                        <tr key={subId} className="border-b border-stone-50 last:border-0 align-top">
                                                            <td className="py-3 pr-4 font-medium">• {subDef?.name}</td>
                                                            <td className={`py-3 text-center ${isScoreable && (currentMode === 'ET' || currentMode === 'NS') ? colorClass : 'text-stone-500'}`}>{displayScore}</td>
                                                            <td className="py-3 pl-4 italic text-xs text-stone-500">{result.observation || "—"}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );

    const HeaderRenderer = () => {
        const logoClass = logoSize === 'small' ? 'h-12' : logoSize === 'medium' ? 'h-20' : 'h-32';

        // LOGIC LOGO
        const LogoBlock = () => {
            if (isCustom && branding?.logoUrl) {
                return <img src={branding.logoUrl} alt="Logo" className={`${logoClass} object-contain mb-2`} />;
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

        // LOGIC INFOS PRATICIEN (Détails)
        // Toujours affiché, mais plus discret
        const PractitionerDetails = () => (
            <div className={`text-xs space-y-1 mt-4 ${isCustom ? 'text-stone-500' : 'text-stone-600'}`}>
                <p>{branding?.address}</p>
                <div className="flex gap-4">
                    {branding?.phone && <p className="flex items-center gap-1"><Phone size={10} /> {branding.phone}</p>}
                    {branding?.email && <p className="flex items-center gap-1"><Mail size={10} /> {branding.email}</p>}
                </div>
            </div>
        );

        const PatientBlock = ({ align }: { align: 'left' | 'right' | 'center' }) => {
            if (patientBlockStyle === 'minimal') {
                return (
                    <div className={`w-full text-${align}`}>
                        <h2 className="font-bold text-2xl text-stone-900 mb-1">{patient.firstName} {patient.lastName}</h2>
                        <p className="text-sm text-stone-600 font-medium">Né(e) le {new Date(patient.dob).toLocaleDateString()}</p>
                        <p className="text-sm text-stone-500">{patient.age}</p>
                        {patient.address && <p className="text-xs text-stone-400 mt-1">{patient.address}</p>}
                    </div>
                );
            }
            // Modern (Boxed) - Default
            return (
                <div className={`p-4 bg-stone-50 border border-stone-100 ${roundedClass} min-w-[200px] w-full text-${align}`}>
                    <h2 className="font-bold text-2xl text-stone-900 mb-1">{patient.firstName} {patient.lastName}</h2>
                    <p className="text-sm text-stone-600 font-medium">Né(e) le {new Date(patient.dob).toLocaleDateString()}</p>
                    <p className="text-sm text-stone-500">{patient.age}</p>
                </div>
            );
        };

        // MODE CORPORATE (PDF Style) : Patient Left, Praticien Right
        if (headerTemplate === 'corporate') {
            return (
                <header className="flex justify-between items-start mb-12 border-b-2 border-stone-100 pb-8">
                    <div className="w-1/3 pt-4">
                        <PatientBlock align="left" />
                    </div>
                    <div className="w-1/2 text-right flex flex-col items-end">
                        <LogoBlock />
                        <CabinetTitle />
                        <PractitionerDetails />
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
            <header className="flex justify-between items-start mb-12 border-b-2 border-stone-100 pb-8 gap-6">
                <div className="flex-1">
                    <LogoBlock />
                    <CabinetTitle />
                    <PractitionerDetails />
                </div>
                <div className="w-1/3 pt-2">
                    <PatientBlock align="right" />
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
                                <p className="mt-1 text-[9px] italic">Scores certifiés par le praticien. Calculs vérifiés et validés individuellement.</p>
                            )}
                        </div>
                        {branding?.showPageNumbers && <div className="font-mono">Page {pageIdx + 1}/{pages.length}</div>}
                    </div>
                </div>
            ))}
            {onUpdateSection && (
                <div className="no-print pb-20">
                    <button onClick={() => setPages([...pages, []])} className="flex items-center gap-2 px-6 py-3 bg-stone-200 text-stone-500 hover:bg-stone-300 hover:text-stone-700 rounded-xl font-bold uppercase text-xs tracking-wider transition-colors"><Plus size={16} /> Ajouter une page vide</button>
                </div>
            )}
        </div>
    );
};
