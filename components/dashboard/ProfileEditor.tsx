import React, { useState, useRef } from 'react';
import { ArrowLeft, User, Phone, Building, MapPin, Save, Loader2, Download, Upload, HardDrive } from 'lucide-react';
import { supabase } from '../../services/db';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ExportService } from '../../services/exportService';

interface ProfileEditorProps {
    onClose: () => void;
}

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ onClose }) => {
    const { userProfile, practitioner, updateUserProfile, refreshProfile } = useAuth();
    const toast = useToast();
    const importInputRef = useRef<HTMLInputElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const handleExport = async () => {
        if (!practitioner) return;
        setIsExporting(true);
        try {
            await ExportService.exportAll(practitioner.id);
            toast.success('Backup téléchargé');
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
                `Les données existantes pour ces patients seront \u00e9crasées.`
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
            updateUserProfile({
                branding: {
                    ...userProfile.branding,
                    practitionerName: fullName,
                    cabinetName: fullName || userProfile.branding.cabinetName,
                    brandSubtitle: form.brandSubtitle.trim() || 'Ergothérapeute',
                    phone: form.phone.trim(),
                    siret: form.siret.trim(),
                    address: form.address.trim(),
                }
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
                        <div>
                            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider">Prénom</label>
                            <input name="firstName" value={form.firstName} onChange={handleChange}
                                className="w-full mt-1 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]"
                                placeholder="Prénom" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider">Nom</label>
                            <input name="lastName" value={form.lastName} onChange={handleChange}
                                className="w-full mt-1 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]"
                                placeholder="Nom" />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider">Sous-titre (profession)</label>
                        <input name="brandSubtitle" value={form.brandSubtitle} onChange={handleChange}
                            className="w-full mt-1 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]"
                            placeholder="Ergothérapeute" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider">Téléphone Pro</label>
                            <div className="relative mt-1">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={16} />
                                <input name="phone" value={form.phone} onChange={handleChange}
                                    className="w-full pl-10 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]"
                                    placeholder="06..." />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider">SIRET</label>
                            <div className="relative mt-1">
                                <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={16} />
                                <input name="siret" value={form.siret} onChange={handleChange}
                                    className="w-full pl-10 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]"
                                    placeholder="123 456 789..." />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider">Adresse Cabinet</label>
                        <div className="relative mt-1">
                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={16} />
                            <input name="address" value={form.address} onChange={handleChange}
                                className="w-full pl-10 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]"
                                placeholder="10 Rue de la Santé, 75000 Paris" />
                        </div>
                    </div>

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

                    <p className="text-xs text-[var(--text-secondary)] text-center pt-1">
                        ⚠️ Utilisez toujours le même navigateur. Les données ne se synchronisent pas entre Chrome, Firefox ou Safari.
                    </p>
                </div>
            </div>
        </div>
    );
};
