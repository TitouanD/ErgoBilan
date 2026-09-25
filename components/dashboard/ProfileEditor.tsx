import React, { useState, useRef } from 'react';
import { ArrowLeft, User, Phone, Building, MapPin, Save, Loader2, Download, Upload, HardDrive, PenLine, Trash2, ChevronDown, ChevronUp, Clock, Shield } from 'lucide-react';
import { supabase } from '../../services/db';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ExportService } from '../../services/exportService';
import { getLastBackupDate, formatLastBackupLabel } from '../../utils/backupTracking';
import { FormField } from '../shared/FormField';

interface ProfileEditorProps {
    onClose: () => void;
}

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ onClose }) => {
    const { userProfile, practitioner, updateBranding, refreshProfile } = useAuth();
    const toast = useToast();
    const importInputRef = useRef<HTMLInputElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isResettingPrefs, setIsResettingPrefs] = useState(false);
    const [prefsExpanded, setPrefsExpanded] = useState(false);
    const [lastBackup, setLastBackup] = useState<Date | null>(() =>
        getLastBackupDate(practitioner?.id ?? '')
    );

    const handleExport = async () => {
        if (!practitioner) return;
        setIsExporting(true);
        try {
            await ExportService.exportAll(practitioner.id);
            setLastBackup(new Date());
            toast.success('Backup sauvegardé — vos données restent sous votre seul contrôle.');
        } catch {
            toast.error('Erreur lors de l\'export');
        } finally {
            setIsExporting(false);
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !practitioner) return;
        if (!file.name.endsWith('.ergobilan')) {
            toast.error('Fichier invalide. Choisissez un fichier .ergobilan');
            return;
        }
        setIsImporting(true);
        try {
            const preview = await ExportService.peekBundle(file);
            const ok = window.confirm(
                `Importer ce backup ?\n` +
                `Date\u00a0: ${new Date(preview.exportedAt).toLocaleString()}\n` +
                `${preview.patients} patient(s) \u2022 ${preview.assessments} bilan(s) \u2022 ${preview.drafts} brouillon(s)\n\n` +
                `Les données existantes pour ces patients seront \u00e9crasées.`
            );
            if (!ok) return;
            const result = await ExportService.importFromFile(file, practitioner.id);
            toast.success(`Import réussi\u00a0: ${result.patients} patients, ${result.assessments} bilans`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erreur lors de l\'import');
        } finally {
            setIsImporting(false);
            if (importInputRef.current) importInputRef.current.value = '';
        }
    };

    const [form, setForm] = useState({
        firstName: practitioner?.firstName || '',
        lastName: practitioner?.lastName || '',
        phone: userProfile.branding.phone || '',
        siret: userProfile.branding.siret || '',
        address: userProfile.branding.address || '',
        brandSubtitle: userProfile.branding.brandSubtitle || 'Ergothérapeute',
    });
    const [isSaving, setIsSaving] = useState(false);

    const [editablePrefsGlobal, setEditablePrefsGlobal] = useState<string>(() => {
        const raw = practitioner?.aiStylePreferences;
        if (!raw) return '';
        try { return String(JSON.parse(raw)?.global || '').trim(); } catch { return raw.trim(); }
    });
    const [editablePrefsSections, setEditablePrefsSections] = useState<Partial<Record<string, string>>>(() => {
        const raw = practitioner?.aiStylePreferences;
        if (!raw) return {};
        try {
            const p = JSON.parse(raw);
            return (p?.sections && typeof p.sections === 'object') ? p.sections as Record<string, string> : {};
        } catch { return {}; }
    });
    const [isSavingPrefs, setIsSavingPrefs] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('practitioners')
                .update({
                    first_name: form.firstName.trim(),
                    last_name: form.lastName.trim(),
                    phone_pro: form.phone.trim(),
                    siret: form.siret.trim(),
                    address_pro: form.address.trim(),
                })
                .eq('id', userProfile.id);

            if (error) throw error;

            // Update local branding to reflect new data
            const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
            updateBranding({
                ...userProfile.branding,
                practitionerName: fullName,
                cabinetName: fullName || userProfile.branding.cabinetName,
                brandSubtitle: form.brandSubtitle.trim() || 'Ergothérapeute',
                phone: form.phone.trim(),
                siret: form.siret.trim(),
                address: form.address.trim(),
            });

            await refreshProfile();
            toast.success('Profil mis à jour');
            onClose();
        } catch (err) {
            toast.error('Erreur lors de la sauvegarde');
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetPreferences = async () => {
        if (!window.confirm('Réinitialiser toutes vos préférences de rédaction ?')) return;
        setIsResettingPrefs(true);
        try {
            const { error } = await supabase
                .from('practitioners')
                .update({ ai_style_preferences: null })
                .eq('id', userProfile.id);
            if (error) throw error;
            await refreshProfile();
            setEditablePrefsGlobal('');
            setEditablePrefsSections({});
            toast.success('Préférences réinitialisées');
        } catch {
            toast.error('Erreur lors de la réinitialisation');
        } finally {
            setIsResettingPrefs(false);
        }
    };

    const handleSavePrefs = async () => {
        if (!practitioner) return;
        setIsSavingPrefs(true);
        try {
            const cleanSections = Object.fromEntries(
                Object.entries(editablePrefsSections).filter(([, v]) => v && v.trim())
            );
            const newPrefs = JSON.stringify({
                global: editablePrefsGlobal.trim(),
                sections: cleanSections,
            });
            const { error } = await supabase
                .from('practitioners')
                .update({ ai_style_preferences: newPrefs })
                .eq('id', practitioner.id);
            if (error) throw error;
            await refreshProfile();
            toast.success('Préférences enregistrées');
        } catch {
            toast.error('Erreur lors de la sauvegarde des préférences');
        } finally {
            setIsSavingPrefs(false);
        }
    };


    const SECTION_LABELS: Record<string, string> = {
        mandat_ref: 'Mandat de référencement',
        mandat_eval: "Mandat d'évaluation",
        profil: 'Profil occupationnel',
        diagnostic: 'Synthèse diagnostique',
        objectifs: 'Objectifs généraux',
        project: "Projet d'accompagnement",
        recommandations: 'Recommandations / Préconisations',
    };

    interface ParsedPrefs { global: string; sections: Partial<Record<string, string>>; }
    const parsedPrefs: ParsedPrefs | null = (() => {
        const raw = practitioner?.aiStylePreferences;
        if (!raw) return null;
        try {
            const p = JSON.parse(raw);
            const global = String(p?.global || '').trim();
            const sections = (p?.sections && typeof p.sections === 'object') ? p.sections as Record<string, string> : {};
            const hasContent = global || Object.values(sections).some(v => v);
            return hasContent ? { global, sections } : null;
        } catch {
            return raw.trim() ? { global: raw.trim(), sections: {} } : null;
        }
    })();

    return (
        <div className="max-w-lg mx-auto py-12 px-4">
            <button onClick={onClose} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-main)] font-bold mb-8 transition-colors">
                <ArrowLeft size={16} /> Retour
            </button>

            <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-xl overflow-hidden">
                <div className="px-8 py-6 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                    <h2 className="text-xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
                        <User size={22} className="text-[var(--primary)]" /> Mon Profil
                    </h2>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Ces informations apparaissent sur vos bilans.</p>
                </div>

                <div className="p-8 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <FormField label="Prénom" name="firstName" value={form.firstName} onChange={handleChange} placeholder="Prénom" />
                        <FormField label="Nom" name="lastName" value={form.lastName} onChange={handleChange} placeholder="Nom" />
                    </div>

                    <FormField label="Sous-titre (profession)" name="brandSubtitle" value={form.brandSubtitle} onChange={handleChange} placeholder="Ergothérapeute" />

                    <div className="grid grid-cols-2 gap-4">
                        <FormField label="Téléphone Pro" name="phone" value={form.phone} onChange={handleChange} placeholder="06..." icon={<Phone size={16} />} />
                        <FormField label="SIRET" name="siret" value={form.siret} onChange={handleChange} placeholder="123 456 789..." icon={<Building size={16} />} />
                    </div>

                    <FormField label="Adresse Cabinet" name="address" value={form.address} onChange={handleChange} placeholder="10 Rue de la Santé, 75000 Paris" icon={<MapPin size={16} />} />

                    <div className="bg-stone-50 dark:bg-stone-800/30 p-3 rounded-xl text-xs text-[var(--text-secondary)]">
                        <p>L'email (<strong>{userProfile.email}</strong>) ne peut pas être modifié ici.</p>
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full bg-[var(--primary)] text-white py-3 rounded-xl font-bold text-sm hover:bg-[#d0694e] transition-all shadow-lg hover:-translate-y-0.5 disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Enregistrer
                    </button>
                </div>
            </div>

            {/* ─── Données locales ──────────────────────────────────────── */}
            <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-xl overflow-hidden mt-6">
                <div className="px-8 py-6 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                    <h2 className="text-xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
                        <HardDrive size={22} className="text-[var(--primary)]" /> Mes Données Locales
                    </h2>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Vos bilans sont stockés sur cet appareil. Exportez régulièrement un backup.</p>
                </div>
                <div className="p-8 space-y-3">
                    {/* Last backup indicator */}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium ${lastBackup ? 'text-[var(--text-secondary)] bg-[var(--hover-bg)]' : 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700'}`}>
                        <Clock size={14} className="flex-shrink-0" />
                        <span>Dernier backup : <strong>{formatLastBackupLabel(lastBackup)}</strong></span>
                    </div>

                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-[var(--primary)] text-[var(--primary)] font-bold text-sm hover:bg-[var(--primary)] hover:text-white transition-all disabled:opacity-70"
                    >
                        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        Télécharger un backup (.ergobilan)
                    </button>

                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".ergobilan"
                        className="hidden"
                        onChange={handleImport}
                    />
                    <button
                        onClick={() => importInputRef.current?.click()}
                        disabled={isImporting}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] font-bold text-sm hover:bg-[var(--hover-bg)] transition-all disabled:opacity-70"
                    >
                        {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        Restaurer depuis un backup
                    </button>

                    {/* Data sovereignty message */}
                    <div className="flex items-start gap-3 p-4 bg-[var(--card-bg-raised)] border border-[var(--border-color)] rounded-xl mt-2">
                        <Shield size={18} className="text-[var(--primary)] flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            <strong className="text-[var(--text-main)]">Vos patients ne quittent jamais cet appareil.</strong>{' '}
                            ErgoBilan ne peut pas lire vos données — vous seul en avez la clé.
                            En cas de perte ou changement d'appareil, seul votre fichier <code className="font-mono bg-[var(--hover-bg)] px-1 rounded">.ergobilan</code> vous permettra de les retrouver.
                        </p>
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] text-center pt-1">
                        ⚠️ Utilisez toujours le même navigateur. Les données ne se synchronisent pas entre Chrome, Firefox ou Safari.
                    </p>
                </div>
            </div>

            {/* ─── Préférences de rédaction ─────────────────────────── */}
            <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-xl overflow-hidden mt-6">
                <button
                    onClick={() => setPrefsExpanded(e => !e)}
                    className="w-full px-8 py-6 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)] flex items-center justify-between"
                >
                    <div className="text-left">
                        <h2 className="text-xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
                            <PenLine size={22} className="text-[var(--primary)]" /> Mes préférences de rédaction
                        </h2>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">
                            {(parsedPrefs || editablePrefsGlobal.trim() || Object.values(editablePrefsSections).some(v => v?.trim())) ? 'Préférences en place — modifiables ci-dessous.' : 'Aucune préférence enregistrée. Elles se construisent depuis vos corrections.'}
                        </p>
                    </div>
                    {prefsExpanded ? <ChevronUp size={20} className="text-[var(--text-secondary)] flex-shrink-0 ml-4" /> : <ChevronDown size={20} className="text-[var(--text-secondary)] flex-shrink-0 ml-4" />}
                </button>

                {prefsExpanded && (
                    <div className="p-8 space-y-5">
                        <p className="text-xs text-[var(--text-secondary)]">
                            Ces règles guident l'IA lors de la génération. Elles se construisent automatiquement depuis vos corrections, mais vous pouvez les modifier ou les compléter manuellement.
                        </p>

                        <div>
                            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">Règles générales</label>
                            <textarea
                                value={editablePrefsGlobal}
                                onChange={e => setEditablePrefsGlobal(e.target.value)}
                                placeholder={"- Préférer les phrases courtes et directes.\n- Éviter les softeners inutiles (\"globalement\", \"relativement\")."}
                                rows={4}
                                className="w-full p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none text-sm text-[var(--text-main)] resize-y font-mono leading-relaxed"
                            />
                        </div>

                        {Object.entries(SECTION_LABELS).map(([id, label]) => (
                            <div key={id}>
                                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">{label}</label>
                                <textarea
                                    value={editablePrefsSections[id] || ''}
                                    onChange={e => setEditablePrefsSections(prev => ({ ...prev, [id]: e.target.value }))}
                                    placeholder={`Règles spécifiques à "${label}"...`}
                                    rows={2}
                                    className="w-full p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none text-sm text-[var(--text-main)] resize-y font-mono leading-relaxed"
                                />
                            </div>
                        ))}

                        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
                            <button
                                onClick={handleResetPreferences}
                                disabled={isResettingPrefs}
                                className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 font-bold disabled:opacity-40 transition-colors"
                            >
                                {isResettingPrefs ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                Réinitialiser
                            </button>
                            <button
                                onClick={handleSavePrefs}
                                disabled={isSavingPrefs}
                                className="flex items-center gap-2 text-sm bg-[var(--primary)] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#d0694e] transition-all disabled:opacity-70"
                            >
                                {isSavingPrefs ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                Enregistrer
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
