/**
 * AppHeader — top bar of the signed-in app: credits, account menu (backup
 * export/import, profile, subscription, admin, logout) or, during an
 * assessment, the autosave indicator and "save & quit". The "Signaler" button
 * (feedback to Sentry) stays visible in both cases.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Crown, Download, Loader2, LogOut, MessageSquareText, Save, ShieldAlert, Sparkles, Upload, User } from 'lucide-react';
import type { PractitionerProfile, UserProfile } from '../../types';
import { ExportService } from '../../services/exportService';
import { getDaysSinceBackup } from '../../utils/backupTracking';
import { useToast } from '../../contexts/ToastContext';
import { ThemeToggle } from '../shared/ThemeToggle';
import { FeedbackModal } from '../shared/FeedbackModal';
import { Logger } from '../../utils/logger';

const BACKUP_OVERDUE_DAYS = 30;

interface Props {
  isAssessment: boolean;
  isAutoSaving: boolean;
  onSaveAndQuit: () => void;
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  isDemoMode: boolean;
  onHome: () => void;
  onShowPricing: () => void;
  onOpenProfile: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  /** Called after a successful backup import so the patient list reloads. */
  onImported: () => void;
}

export const AppHeader: React.FC<Props> = ({
  isAssessment,
  isAutoSaving,
  onSaveAndQuit,
  userProfile,
  practitioner,
  isDemoMode,
  onHome,
  onShowPricing,
  onOpenProfile,
  onOpenAdmin,
  onLogout,
  onImported,
}) => {
  const toast = useToast();
  const [showMenu, setShowMenu] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [backupOverdue, setBackupOverdue] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!practitioner?.id || isDemoMode) return setBackupOverdue(false);
    const days = getDaysSinceBackup(practitioner.id);
    setBackupOverdue(days === null || days > BACKUP_OVERDUE_DAYS);
  }, [practitioner?.id, isDemoMode]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowMenu(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  const displayName = (
    userProfile.branding.practitionerName ||
    `${practitioner?.firstName || ''} ${practitioner?.lastName || ''}`.trim() ||
    userProfile.email.split('@')[0]
  ).trim();
  const initials =
    displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0].toUpperCase())
      .join('') || 'AB';

  const run = (action: () => void) => () => {
    setShowMenu(false);
    action();
  };

  const handleExport = async () => {
    if (!practitioner) return;
    setShowMenu(false);
    setIsExporting(true);
    try {
      await ExportService.exportAll(practitioner.id);
      setBackupOverdue(false);
      toast.success('Backup sauvegardé — gardez ce fichier en lieu sûr : il contient les dossiers patients en clair.');
    } catch (e) {
      Logger.error('DB', 'Backup export failed', e);
      toast.error("Erreur lors de l'export.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !practitioner) return;
    setShowMenu(false);
    try {
      if (!file.name.endsWith('.ergobilan')) throw new Error('Fichier invalide. Choisissez un fichier .ergobilan');
      const preview = await ExportService.peekBundle(file);
      const ok = window.confirm(
        `Importer ce backup ?\nDate : ${new Date(preview.exportedAt).toLocaleString()}\n` +
          `${preview.patients} patient(s) • ${preview.assessments} bilan(s) • ${preview.drafts} brouillon(s)\n\n` +
          'Les données existantes pour ces patients seront écrasées.',
      );
      if (!ok) return;
      const result = await ExportService.importFromFile(file, practitioner.id);
      toast.success(`Import réussi : ${result.patients} patients, ${result.assessments} bilans`);
      onImported();
    } catch (err) {
      Logger.error('DB', 'Backup import failed', err);
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'import");
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const menuItem = 'w-full px-3 py-2 text-left text-sm font-medium rounded-xl flex items-center gap-2 transition-colors';

  return (
    <header className="relative z-40 bg-[var(--card-bg)]/90 backdrop-blur-md border-b border-[var(--border-color)] px-6 h-20 flex items-center justify-between no-print shadow-sm">
      <button className="font-serif font-bold text-xl text-[var(--text-main)] flex items-center gap-2" onClick={onHome}>
        <Sparkles size={18} className="text-[#E07A5F]" /> ErgoBilan.
      </button>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowFeedback(true)}
          className="flex items-center gap-1.5 h-8 rounded-full px-2 lg:px-3 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors"
          title="Signaler un problème ou une idée"
          aria-label="Signaler un problème ou une idée"
        >
          <MessageSquareText size={16} /> <span className="hidden lg:inline">Signaler</span>
        </button>
        <ThemeToggle />
        {isAssessment ? (
          <>
            {isAutoSaving && (
              <div className="text-xs text-amber-600 font-bold flex gap-1 items-center bg-amber-50 px-2 py-1 rounded-lg mr-2">
                <Loader2 size={12} className="animate-spin" /> Sauvegarde...
              </div>
            )}
            <button
              onClick={onSaveAndQuit}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--btn-secondary-bg)] hover:bg-rose-50 text-[var(--btn-secondary-text)] hover:text-rose-600 rounded-xl font-bold text-xs uppercase tracking-wider transition-all border border-[var(--border-color)] hover:border-rose-200"
            >
              <Save size={16} /> <span className="hidden md:inline">Sauvegarder &amp; Quitter</span>
            </button>
          </>
        ) : (
          <>
            {userProfile.isAdmin ? (
              // The admin generates without credits (consume_credit): no balance to show (#112), nothing to
              // buy either, so a plain badge and not a second « Admin » button next to the menu entry.
              <span className="flex items-center gap-2 bg-[#F2CC8F]/20 text-[#d97706] px-4 py-2 rounded-full text-xs font-bold border border-[#F2CC8F]/50">
                <Crown size={14} /> Admin
              </span>
            ) : (
              <button
                onClick={onShowPricing}
                className="flex items-center gap-2 bg-[#F2CC8F]/20 text-[#d97706] px-4 py-2 rounded-full text-xs font-bold border border-[#F2CC8F]/50 hover:bg-[#F2CC8F]/30 transition-all"
              >
                <Crown size={14} /> {userProfile.credits} Crédits
              </button>
            )}
            <div className="h-8 w-px bg-[var(--border-color)] mx-1" />

            <div className="relative z-50" ref={menuRef}>
              <button
                onClick={() => setShowMenu((prev) => !prev)}
                className="flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1.5 transition-colors hover:border-[var(--text-main)]"
                aria-label="Menu du compte"
              >
                <div className="relative h-8 w-8 flex-shrink-0">
                  <div className="h-8 w-8 rounded-full bg-[#3D405B] text-white text-xs font-bold flex items-center justify-center">
                    {initials}
                  </div>
                  {backupOverdue && (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-[var(--card-bg)]" />
                  )}
                </div>
                <ChevronDown size={14} className={`text-[var(--text-light)] transition-transform ${showMenu ? 'rotate-180' : ''}`} />
              </button>

              {showMenu && (
                <div className="absolute right-0 z-[60] mt-2 w-64 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-2 shadow-xl">
                  <div className="px-3 py-2 border-b border-[var(--border-color)]">
                    <p className="text-sm font-bold text-[var(--text-main)] truncate">{displayName}</p>
                    <p className="text-xs text-[var(--text-light)] truncate">{userProfile.email}</p>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={handleExport}
                      disabled={isExporting}
                      className={`${menuItem} font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-60 ${backupOverdue ? 'text-amber-600' : 'text-[var(--text-main)]'}`}
                    >
                      {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      Sauvegarder mes données
                      {backupOverdue && <span className="ml-auto text-amber-500 text-xs font-bold">!</span>}
                    </button>
                    <label className={`${menuItem} font-semibold text-[var(--text-main)] hover:bg-[var(--hover-bg)] cursor-pointer`}>
                      <Upload size={14} /> Importer un backup
                      <input ref={importRef} type="file" accept=".ergobilan" className="hidden" onChange={handleImport} />
                    </label>
                  </div>
                  <div className="mx-2 h-px bg-[var(--border-color)]" />
                  <button onClick={run(onOpenProfile)} className={`${menuItem} text-[var(--text-main)] hover:bg-[var(--hover-bg)]`}>
                    <User size={14} /> Mon Profil
                  </button>
                  <button onClick={run(onShowPricing)} className={`${menuItem} text-[var(--text-main)] hover:bg-[var(--hover-bg)]`}>
                    <Crown size={14} /> Mon abonnement
                  </button>
                  {userProfile.isAdmin && (
                    <button onClick={run(onOpenAdmin)} className={`${menuItem} text-rose-700 hover:bg-rose-50`}>
                      <ShieldAlert size={14} /> Admin
                    </button>
                  )}
                  <button onClick={run(onLogout)} className={`${menuItem} text-rose-600 hover:bg-rose-50`}>
                    <LogOut size={14} /> Déconnexion
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <FeedbackModal isOpen={showFeedback} onClose={() => setShowFeedback(false)} source="header" askEmail={isDemoMode} />
    </header>
  );
};
