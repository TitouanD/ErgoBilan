
import React, { useState, useEffect } from 'react';
import type { Patient, ReportSection, TestData, BrandingConfig } from '../../types';
import { Download, Check, Palette, X, Upload, Palette as PaletteIcon, Type, Home, Crown, Lock, Layout, MousePointerClick, Star, Sparkles, FileType, User, ArrowLeft, Brush, Loader2 } from 'lucide-react';
import { ReportView } from './ReportView';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCatalog } from '../../contexts/CatalogContext';
import { Logger } from '../../utils/logger';

interface Props {
    patient: Patient;
    sections: ReportSection[];
    tests: TestData;
    onValidate: () => Promise<void>; // Promise pour gérer le loading
    onUpdateSection: (sectionId: string, updates: Partial<ReportSection>) => void;
    branding: BrandingConfig;
    onUpdateBranding: (newBranding: BrandingConfig) => void;
    isPremium: boolean;
    onShowPricing: () => void;
    onBack: () => void;
    isDemoMode: boolean;
    onDemoConvert: (action: string) => void;
    onOpenProfile?: () => void;
}

// COMPOSANT LOCAL POUR ÉVITER L'ERREUR REACT #185 (Too many re-renders)
const DebouncedColorInput: React.FC<{
    value: string;
    onChange: (val: string) => void;
}> = ({ value, onChange }) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    return (
        <div className="h-10 rounded-lg border border-[var(--border-color)] relative overflow-hidden mb-1 shadow-sm group">
            <input
                type="color"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={() => onChange(localValue)}
                className="absolute -top-2 -left-2 w-20 h-20 cursor-pointer"
            />
        </div>
    );
};

// --- BARRE D'OUTILS STANDARDISÉE ---
const ReportToolbar: React.FC<{
    currentBranding: BrandingConfig,
    onApply: (b: BrandingConfig) => void,
    onOpenEditor: () => void,
    isPremium: boolean
}> = ({ currentBranding, onApply, onOpenEditor, isPremium }) => {

    const PRESETS = [
        { name: "Moderne", primary: "#264653", secondary: "#E9C46A", font: "Open Sans", template: "corporate" },
        { name: "Douceur", primary: "#81B29A", secondary: "#F2CC8F", font: "Quicksand", template: "centered" },
        { name: "Sérieux", primary: "#1D3557", secondary: "#457B9D", font: "Roboto", template: "classic" }
    ];

    return (
        <div className="fixed left-4 top-1/2 -translate-y-1/2 z-[100] animate-in slide-in-from-left-10 fade-in duration-700 bg-[var(--card-bg)] rounded-2xl p-2 shadow-2xl border border-[var(--border-color)] flex flex-col items-center gap-3 print:hidden">
            <div className="flex flex-col items-center gap-1 text-sm font-bold text-[var(--text-heading)]">
                <Palette size={16} className="text-[var(--primary)]" />
            </div>

            <div className="flex flex-col gap-2">
                {PRESETS.map((preset, idx) => (
                    <button
                        key={idx}
                        onClick={() => {
                            if (!isPremium) { onOpenEditor(); return; } // Trigger pricing via editor flow
                            onApply({
                                ...currentBranding,
                                isEnabled: true, // Auto-enable
                                primaryColor: preset.primary,
                                secondaryColor: preset.secondary,
                                fontFamily: preset.font as any,
                                headerTemplate: preset.template as any
                            })
                        }}
                        className="w-8 h-8 rounded-full border-2 border-white shadow-md hover:scale-110 transition-transform relative overflow-hidden group"
                        style={{ backgroundColor: preset.primary }}
                        title={preset.name}
                    >
                        <div className="absolute bottom-0 right-0 w-4 h-4 rounded-tl-full" style={{ backgroundColor: preset.secondary }}></div>
                        {!isPremium && <div className="absolute inset-0 bg-black/20 flex items-center justify-center"><Lock size={10} className="text-white" /></div>}
                    </button>
                ))}
            </div>

            <div className="h-px w-6 bg-[var(--border-color)] my-1"></div>

            <button onClick={onOpenEditor} className="bg-[var(--secondary)] text-white p-2 rounded-full text-xs font-bold hover:brightness-90 transition-colors flex items-center gap-2" title="Éditeur Complet">
                <Brush size={12} />
            </button>
        </div>
    );
};

const BrandingEditor: React.FC<{
    branding: BrandingConfig;
    onUpdate: (b: BrandingConfig) => void;
    onClose: () => void;
    onOpenProfile?: () => void;
}> = ({ branding, onUpdate, onClose, onOpenProfile }) => {

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    onUpdate({ ...branding, logoUrl: ev.target.result as string });
                }
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    return (
        <div className="fixed inset-y-0 right-0 w-96 bg-[var(--card-bg)] shadow-2xl z-[150] animate-in slide-in-from-right duration-300 flex flex-col no-print border-l border-[var(--border-color)]">
            <div className="p-6 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--card-bg-raised)]">
                <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] flex items-center gap-2">
                    <Palette size={24} className="text-[var(--primary)]" /> Studio Design
                </h3>
                <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] p-2 hover:bg-[var(--border-color)] rounded-full transition-colors"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

                {/* 1. ACTIVATION */}
                <div className="flex items-center justify-between p-4 bg-[var(--primary)]/10 rounded-xl border border-[var(--primary)]/20">
                    <span className="text-sm font-bold text-[var(--primary)]">Mode Personnalisé</span>
                    <button
                        onClick={() => onUpdate({ ...branding, isEnabled: !branding.isEnabled })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${branding.isEnabled ? 'bg-[var(--primary)]' : 'bg-[var(--border-color)]'}`}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform shadow-sm ${branding.isEnabled ? 'left-7' : 'left-1'}`}></div>
                    </button>
                </div>

                {branding.isEnabled && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-top-2">

                        {/* --- TITRE DOCUMENT --- */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><FileType size={14} /> Titre du Document</label>
                            <input
                                value={branding.documentTitle || "Bilan d'Ergothérapie"}
                                onChange={(e) => onUpdate({ ...branding, documentTitle: e.target.value })}
                                placeholder="Bilan d'Ergothérapie"
                                className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--input-bg)] focus:bg-[var(--card-bg)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[#E07A5F] text-[var(--text-heading)] font-bold"
                            />
                        </div>

                        <div className="w-full h-px bg-[var(--border-color)]"></div>

                        {/* --- EN-TÊTE : LAYOUT SELECTOR --- */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Layout size={14} /> Structure En-tête</label>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <button
                                    onClick={() => onUpdate({ ...branding, headerTemplate: 'classic', headerLayout: 'row', headerAlignment: 'left' })}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col gap-2 ${branding.headerTemplate === 'classic' ? 'border-[var(--primary)] bg-[#fff5f2]' : 'border-[var(--border-color)] bg-[var(--hover-bg)] hover:border-[var(--text-secondary)]'}`}
                                >
                                    <div className="w-full h-10 bg-[var(--card-bg)] rounded border border-[var(--border-color)] p-1 flex items-center gap-1">
                                        <div className="w-4 h-4 bg-[var(--border-color)] rounded-sm"></div>
                                        <div className="w-full h-2 bg-[var(--hover-bg)] rounded-sm"></div>
                                    </div>
                                    <span className={`text-xs font-bold ${branding.headerTemplate === 'classic' ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]'}`}>Classique</span>
                                </button>

                                <button
                                    onClick={() => onUpdate({ ...branding, headerTemplate: 'corporate', headerLayout: 'row', headerAlignment: 'right' })}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col gap-2 ${branding.headerTemplate === 'corporate' ? 'border-[var(--primary)] bg-[#fff5f2]' : 'border-[var(--border-color)] bg-[var(--hover-bg)] hover:border-[var(--text-secondary)]'}`}
                                >
                                    <div className="w-full h-10 bg-[var(--card-bg)] rounded border border-[var(--border-color)] p-1 flex items-center justify-between gap-1">
                                        <div className="w-1/2 h-2 bg-[var(--hover-bg)] rounded-sm"></div>
                                        <div className="w-4 h-4 bg-[var(--border-color)] rounded-sm"></div>
                                    </div>
                                    <span className={`text-xs font-bold ${branding.headerTemplate === 'corporate' ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]'}`}>Corporate</span>
                                </button>

                                <button
                                    onClick={() => onUpdate({ ...branding, headerTemplate: 'centered', headerLayout: 'column', headerAlignment: 'center' })}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col gap-2 ${branding.headerTemplate === 'centered' ? 'border-[var(--primary)] bg-[#fff5f2]' : 'border-[var(--border-color)] bg-[var(--hover-bg)] hover:border-[var(--text-secondary)]'}`}
                                >
                                    <div className="w-full h-10 bg-[var(--card-bg)] rounded border border-[var(--border-color)] p-1 flex flex-col items-center justify-center gap-1">
                                        <div className="w-4 h-4 bg-[var(--border-color)] rounded-sm"></div>
                                        <div className="w-2/3 h-1.5 bg-[var(--hover-bg)] rounded-sm"></div>
                                    </div>
                                    <span className={`text-xs font-bold ${branding.headerTemplate === 'centered' ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]'}`}>Centré</span>
                                </button>
                            </div>
                        </div>

                        {/* --- COORDONNÉES EN-TÊTE (enrichi, verrouillé) --- */}
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Home size={14} /> Coordonnées En-tête</label>
                                <span className="text-[10px] bg-[var(--hover-bg)] text-[var(--text-secondary)] px-2 py-0.5 rounded font-bold uppercase"><Lock size={8} className="inline mr-1" />Sécurisé</span>
                            </div>

                            {/* Nom Principal (verrouillé) */}
                            <div className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--hover-bg)] text-[var(--text-heading)] select-none opacity-80">
                                {branding.practitionerName || branding.cabinetName || 'Nom du praticien'}
                            </div>

                            {/* Sous-titre (verrouillé) */}
                            <div className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--hover-bg)] text-[var(--text-secondary)] select-none opacity-80">
                                {branding.brandSubtitle || 'Ergothérapeute'}
                            </div>

                            {/* Données Vérifiées (Read-Only) */}
                            <div className="bg-[var(--hover-bg)] p-3 rounded-xl border border-[var(--border-color)] select-none">
                                <div className="flex items-center gap-1 mb-2">
                                    <Lock size={10} className="text-[var(--text-secondary)]" />
                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Détails Légaux (Auto-généré)</p>
                                </div>
                                <div className="text-[10px] text-[var(--text-secondary)] space-y-0.5">
                                    {branding.practitionerName && <p className="font-bold">{branding.practitionerName}</p>}
                                    {branding.phone && <p>{branding.phone}</p>}
                                    {branding.email && <p>{branding.email}</p>}
                                    {branding.siret && <p className="font-mono text-[var(--text-disabled)]">SIRET : {branding.siret}</p>}
                                    {branding.address && <p className="text-[var(--text-disabled)]">{branding.address}</p>}
                                </div>
                            </div>

                            <button
                                onClick={() => onOpenProfile?.()}
                                className="w-full text-[11px] text-[var(--primary)] hover:text-[#d0694e] text-center font-bold py-1.5 hover:underline transition-colors"
                            >
                                Modifier ces informations dans Mon Profil →
                            </button>
                        </div>

                        {/* --- STYLE PATIENT --- */}
                        <div>
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2"><User size={14} /> Bloc Patient</label>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => onUpdate({ ...branding, patientBlockStyle: 'modern' })}
                                    className={`flex-1 p-2 rounded-lg border text-xs font-bold transition-all ${branding.patientBlockStyle === 'modern' ? 'bg-[var(--secondary)] text-white border-[var(--secondary)]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'}`}
                                >
                                    Encadré (Défaut)
                                </button>
                                <button
                                    onClick={() => onUpdate({ ...branding, patientBlockStyle: 'minimal' })}
                                    className={`flex-1 p-2 rounded-lg border text-xs font-bold transition-all ${branding.patientBlockStyle === 'minimal' ? 'bg-[var(--secondary)] text-white border-[var(--secondary)]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'}`}
                                >
                                    Minimaliste (Texte)
                                </button>
                            </div>
                        </div>

                        <div className="w-full h-px bg-[var(--border-color)]"></div>

                        {/* --- LOGO --- */}
                        <div>
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2"><Upload size={14} /> Logo Cabinet</label>

                            <div className="flex items-center gap-4 mb-3">
                                <div className="w-20 h-20 bg-[var(--hover-bg)] border-2 border-dashed border-[var(--border-color)] rounded-xl flex items-center justify-center overflow-hidden relative group hover:border-[var(--primary)] transition-colors cursor-pointer">
                                    {branding.logoUrl ? (
                                        <img src={branding.logoUrl} className="w-full h-full object-contain p-1" alt="Logo" width={80} height={80} />
                                    ) : (
                                        <div className="text-center text-[var(--text-disabled)] group-hover:text-[var(--primary)]">
                                            <Upload size={20} className="mx-auto mb-1" />
                                            <span className="text-[9px] font-bold">Ajouter</span>
                                        </div>
                                    )}
                                    <input type="file" onChange={handleLogoUpload} accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs text-[var(--text-secondary)] mb-2 leading-relaxed">Format PNG (Fond transparent) conseillé.</p>
                                    {branding.logoUrl && (
                                        <button onClick={() => onUpdate({ ...branding, logoUrl: undefined })} className="text-xs text-rose-500 hover:underline font-bold">Supprimer</button>
                                    )}
                                </div>
                            </div>

                            {/* Slider Taille Logo */}
                            {branding.logoUrl && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Taille du logo</label>
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs text-[var(--text-secondary)]">S</span>
                                        <input
                                            type="range" min="0" max="2" step="1"
                                            value={branding.logoSize === 'small' ? 0 : branding.logoSize === 'medium' ? 1 : 2}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                onUpdate({ ...branding, logoSize: val === 0 ? 'small' : val === 1 ? 'medium' : 'large' });
                                            }}
                                            className="w-full h-2 bg-[var(--hover-bg)] rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                                        />
                                        <span className="text-xs text-[var(--text-secondary)]">L</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="w-full h-px bg-[var(--border-color)]"></div>

                        {/* --- STYLE TITRES (déplacé en fin) --- */}
                        <div>
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2"><Star size={14} /> Style des Titres</label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: 'simple', label: 'Simple' },
                                    { id: 'underline', label: 'Souligné' },
                                    { id: 'filled-shape', label: 'Formes', icon: Home },
                                    { id: 'icon-star', label: 'Étoile', icon: Star },
                                    { id: 'icon-sparkle', label: 'Sparkle', icon: Sparkles },
                                ].map((style) => (
                                    <button
                                        key={style.id}
                                        onClick={() => onUpdate({ ...branding, titleStyle: style.id as any })}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 ${branding.titleStyle === style.id ? 'bg-[var(--secondary)] text-white border-[var(--secondary)]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:bg-[var(--hover-bg)]'}`}
                                    >
                                        {style.icon && <style.icon size={12} />}
                                        {style.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* --- PALETTE (déplacé en fin) --- */}
                        <div>
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2"><PaletteIcon size={14} /> Palette</label>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <DebouncedColorInput
                                        value={branding.primaryColor}
                                        onChange={(val) => onUpdate({ ...branding, primaryColor: val })}
                                    />
                                    <span className="text-[10px] text-[var(--text-secondary)] font-mono font-bold">Titres</span>
                                </div>
                                <div className="flex-1">
                                    <DebouncedColorInput
                                        value={branding.secondaryColor}
                                        onChange={(val) => onUpdate({ ...branding, secondaryColor: val })}
                                    />
                                    <span className="text-[10px] text-[var(--text-secondary)] font-mono font-bold">Accents</span>
                                </div>
                            </div>
                        </div>

                        {/* --- TYPOGRAPHIE (déplacé en fin) --- */}
                        <div>
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2"><Type size={14} /> Typographie</label>
                            <select
                                value={branding.fontFamily}
                                onChange={(e) => onUpdate({ ...branding, fontFamily: e.target.value as any })}
                                className="w-full p-3 bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-heading)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-20)]"
                            >
                                <option value="Merriweather">Merriweather</option>
                                <option value="Quicksand">Quicksand</option>
                                <option value="Roboto">Roboto</option>
                                <option value="Playfair Display">Playfair Display</option>
                                <option value="Open Sans">Open Sans</option>
                                <option value="Lato">Lato</option>
                            </select>
                        </div>

                        {/* --- PIED DE PAGE (déplacé en fin) --- */}
                        <div className="space-y-3 pt-4 border-t border-[var(--border-color)]">
                            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1 flex items-center gap-2"><MousePointerClick size={14} /> Pied de page</label>
                            <textarea
                                value={branding.footerText || ''}
                                onChange={(e) => onUpdate({ ...branding, footerText: e.target.value })}
                                placeholder="Texte personnalisé (ex: Confidentiel)"
                                rows={3}
                                className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--card-bg)] focus:bg-[var(--card-bg)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[#E07A5F] text-[var(--text-heading)] resize-y"
                            />
                            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={branding.showPageNumbers}
                                    onChange={(e) => onUpdate({ ...branding, showPageNumbers: e.target.checked })}
                                    className="accent-[var(--primary)] w-4 h-4"
                                />
                                Afficher la numérotation des pages
                            </label>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const Step5Export: React.FC<Props> = ({ patient, sections, tests, onValidate, onUpdateSection, branding, onUpdateBranding, isPremium, onShowPricing, onBack, isDemoMode, onDemoConvert, onOpenProfile }) => {
    const [showBranding, setShowBranding] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [scoreDisplayModes, setScoreDisplayModes] = useState<Record<string, 'Brut' | 'NS' | 'ET' | '%'>>({});
    const [chartType, setChartType] = useState<'radar' | 'bar' | 'percentile'>('bar');
    const { toast } = useToast();
    const { catalog } = useCatalog();

    const handlePrint = async () => {
        setIsExporting(true);
        try {
            const { pdf } = await import('@react-pdf/renderer');
            const { ensurePdfFontsRegistered } = await import('../../utils/pdfStyles');
            await ensurePdfFontsRegistered();
            const { PdfDocument } = await import('./PdfDocument');
            const attachmentUrls = await convertBlobAttachments();
            const blob = await pdf(
                <PdfDocument
                    patient={patient}
                    sections={sections}
                    tests={tests}
                    branding={branding}
                    catalog={catalog}
                    scoreDisplayModes={scoreDisplayModes}
                    chartType={chartType}
                    attachmentUrls={attachmentUrls}
                />
            ).toBlob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch (err) {
            Logger.error('SYSTEM', 'Print PDF error', err);
            toast?.error?.('Erreur lors de la génération du PDF pour impression');
        } finally {
            setIsExporting(false);
        }
    };

    /** Convert blob: URLs to base64 data URLs for @react-pdf compatibility */
    const convertBlobAttachments = async (): Promise<Record<string, string>> => {
        const map: Record<string, string> = {};
        for (const section of sections) {
            for (const att of section.attachments || []) {
                if (att.url.startsWith('blob:')) {
                    try {
                        const resp = await fetch(att.url);
                        const blob = await resp.blob();
                        const base64 = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                        map[att.id] = base64;
                    } catch {
                        // skip failed conversions
                    }
                }
            }
        }
        return map;
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        try {
            // Dynamic imports for @react-pdf/renderer (tree-shaking friendly)
            const { pdf } = await import('@react-pdf/renderer');
            const { ensurePdfFontsRegistered } = await import('../../utils/pdfStyles');
            await ensurePdfFontsRegistered();
            const { PdfDocument } = await import('./PdfDocument');

            // Pre-convert blob attachments to base64
            const attachmentUrls = await convertBlobAttachments();

            const sanitizeFilename = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
            const fileName = `Bilan_${sanitizeFilename(patient.lastName)}_${sanitizeFilename(patient.firstName)}_${new Date().toISOString().split('T')[0]}.pdf`;

            // Generate PDF blob
            const blob = await pdf(
                <PdfDocument
                    patient={patient}
                    sections={sections}
                    tests={tests}
                    branding={branding}
                    catalog={catalog}
                    scoreDisplayModes={scoreDisplayModes}
                    chartType={chartType}
                    attachmentUrls={attachmentUrls}
                />
            ).toBlob();

            // Trigger download
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            toast.success('PDF exporté avec succès ✓');
            if (isDemoMode) {
                onDemoConvert('Exporter le PDF');
            }
        } catch (err) {
            Logger.error('SYSTEM', 'PDF export error', err);
            toast.error('Erreur lors de l\'export PDF');
        } finally {
            setIsExporting(false);
        }
    };

    const handleOpenBranding = () => {
        if (!isPremium) {
            onShowPricing();
            return;
        }
        setShowBranding(true);
    };

    const handleFinalValidate = async () => {
        if (isDemoMode) {
            onDemoConvert('Finaliser le bilan');
            return;
        }
        setIsValidating(true);
        try {
            await onValidate();
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto pb-32 animate-in fade-in duration-500 relative">

            {/* BARRE D'OUTILS STANDARDISÉE */}
            <ReportToolbar
                currentBranding={branding}
                onApply={onUpdateBranding}
                onOpenEditor={handleOpenBranding}
                isPremium={isPremium}
            />

            {/* Actions Bar (No Print) */}
            <div className="flex justify-between items-center mb-8 border-b border-[var(--border-color)] pb-6 no-print">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-heading)] rounded-xl hover:bg-[var(--hover-bg)] transition-all"
                        title="Retour à la validation"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Export & Impression</h2>
                        <p className="text-[var(--text-secondary)] font-medium mt-2">Personnalisez et finalisez votre document.</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-2 px-5 py-3 bg-[var(--hover-bg)] text-[var(--text-secondary)] rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[var(--border-color)] transition-all"
                    >
                        <Download size={16} /> Imprimer
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={isExporting}
                        className="flex items-center gap-2 px-5 py-3 bg-[var(--secondary)] text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:brightness-90 transition-all disabled:opacity-70"
                    >
                        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        {isExporting ? 'Export...' : 'Télécharger PDF'}
                    </button>
                    <button
                        onClick={handleFinalValidate}
                        disabled={isValidating}
                        className="flex items-center gap-2 px-8 py-3 bg-[var(--primary)] text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[#d0694e] transition-all shadow-lg hover:-translate-y-1 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isValidating ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        Terminer & Archiver
                    </button>
                </div>
            </div>

            {/* Report Preview */}
            <div className={`pdf-viewer-panel shadow-xl shadow-black/20 min-h-[29.7cm] p-[10mm] md:p-[20mm] mx-auto print:shadow-none print:p-0 print:m-0 print:w-full transition-all duration-300 ${showBranding ? 'mr-[26rem]' : ''}`}>
                <ReportView
                    patient={patient}
                    sections={sections}
                    tests={tests}
                    branding={branding}
                    onUpdateSection={onUpdateSection}
                    scoreDisplayModes={scoreDisplayModes}
                    onScoreDisplayModeChange={setScoreDisplayModes}
                    chartType={chartType}
                    onChartTypeChange={setChartType}
                    isPerformance={isPremium}
                />
            </div>

            {/* Branding Editor Drawer */}
            {showBranding && (
                <BrandingEditor
                    branding={branding}
                    onUpdate={onUpdateBranding}
                    onClose={() => setShowBranding(false)}
                    onOpenProfile={onOpenProfile}
                />
            )}
        </div>
    );
};
