import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardDraftMeta, PendingQuestionnaire, PatientDashboardPreviewMeta, PatientFile, PatientFollowup, UserProfile } from '../../types';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Calendar,
  Copy,
  Clock,
  Crown,
  Download,
  Edit3,
  Filter,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { ImportAnimation } from '../shared/ImportAnimation';
import { CommandPalette } from './CommandPalette';
import { NewPatientChoiceModal } from './NewPatientChoiceModal';

interface Props {
  userProfile: UserProfile;
  pendingQuestionnaires: PendingQuestionnaire[];
  patientFiles: PatientFile[];
  onCreateNew: () => void;
  onOpenPatient: (patientId: string) => void;
  onGenerateLink: () => void;
  onCreateHistorical: () => void;
  onShowPricing: () => void;
  onProcessPending?: (q: PendingQuestionnaire) => void;
  processingQueueId?: string | null;
  draftsIndex?: Record<string, DashboardDraftMeta>;
  onResumeDraft?: (patientId: string) => void;
  isDemoMode?: boolean;
  onCopyLink: (q: PendingQuestionnaire) => void;
  onDeletePending: (q: PendingQuestionnaire) => void;
  hasMorePatients?: boolean;
  isLoadingMorePatients?: boolean;
  onLoadMorePatients?: () => void;
}

type UrgencyLevel = 'overdue' | 'due' | 'draft' | 'none';

const monthDate = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

const fullDate = (value: string | null | undefined) => {
  if (!value) return 'Aucune activité récente';
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

const mapDraftStepToProgress = (step: number | null | undefined): number | null => {
  if (typeof step !== 'number') return null;
  if (step <= 1) return 20;
  if (step === 2) return 40;
  if (step === 3) return 60;
  return 80;
};

const mapWorkflowToProgress = (workflow: PatientDashboardPreviewMeta['workflow']): number => {
  if (workflow.progressLabel === 'tests_saisis') return 40;
  return 20;
};

const buildInProgressState = (
  previewMeta: PatientDashboardPreviewMeta,
  draftStep: number | null | undefined,
): { progressPercent: number; label: string; tone: PatientDashboardPreviewMeta['workflow']['statusTone'] } => {
  const stepProgress = mapDraftStepToProgress(draftStep);
  if (stepProgress === 20) return { progressPercent: 20, label: 'Informations administratives en cours', tone: 'warning' };
  if (stepProgress === 40) return { progressPercent: 40, label: 'Tests en cours', tone: 'neutral' };
  if (stepProgress === 60) return { progressPercent: 60, label: 'Synthèse en cours', tone: 'neutral' };
  if (stepProgress === 80) return { progressPercent: 80, label: 'Validation en cours', tone: 'neutral' };

  const fallbackProgress = mapWorkflowToProgress(previewMeta.workflow);
  if (fallbackProgress === 40) return { progressPercent: 40, label: 'Tests en cours', tone: 'neutral' };
  return { progressPercent: 20, label: 'Bilan initial en cours', tone: 'warning' };
};

const workflowLabelMap: Record<PatientDashboardPreviewMeta['workflow']['progressLabel'], string> = {
  created: 'Dossier créé',
  infos_recues: 'Infos reçues',
  tests_saisis: 'Tests saisis',
  termine: 'Dossier terminé',
};

const nextActionLabelMap: Record<PatientDashboardPreviewMeta['workflow']['nextAction'], string> = {
  complete_initial: 'Compléter bilan initial',
  resume_draft: 'Brouillon',
  open_patient: 'Suivi clinique',
  reevaluation_candidate: 'Réévaluation à planifier',
};

const getToneClasses = (tone: PatientDashboardPreviewMeta['workflow']['statusTone']) => {
  if (tone === 'success') return { badge: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40', progress: 'bg-emerald-500' };
  if (tone === 'warning') return { badge: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/40', progress: 'bg-amber-500' };
  return { badge: 'bg-[var(--secondary)]/10 text-[var(--text-heading)] border-[var(--secondary)]/20', progress: 'bg-[var(--secondary)]' };
};

const buildSyntheticFollowup = (file: PatientFile): PatientFollowup | null => {
  if (file.followup) return file.followup;
  const previewMeta = file.previewMeta || deriveFallbackPreviewMeta(file);
  const lastFormalDate = previewMeta.metrics.lastFormalReportDate;
  if (!lastFormalDate || !previewMeta.flags.hasInitialReport) return null;

  const dueDate = new Date(lastFormalDate);
  if (Number.isNaN(dueDate.getTime())) return null;
  dueDate.setMonth(dueDate.getMonth() + 6);

  const overdueDate = new Date(dueDate);
  overdueDate.setMonth(overdueDate.getMonth() + 6);
  const now = Date.now();
  const status = now < dueDate.getTime() ? 'upcoming' : now <= overdueDate.getTime() ? 'due' : 'overdue';

  return {
    id: `virtual-${file.id}`,
    patientId: file.id,
    organizationId: null,
    status,
    dueAt: dueDate.toISOString(),
    snoozedUntil: null,
    note: null,
    createdAt: lastFormalDate,
    updatedAt: lastFormalDate,
  };
};

const buildFollowupStatusLabel = (followup: PatientFollowup): string => {
  const dueDateLabel = new Date(followup.dueAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  if (followup.status === 'due') {
    return 'Fenêtre de réévaluation ouverte';
  }
  if (followup.status === 'overdue') {
    return 'Réévaluation en retard';
  }
  if (followup.status === 'scheduled') {
    return `Réévaluation planifiée (${dueDateLabel})`;
  }
  if (followup.status === 'snoozed') {
    const snoozedDateLabel = followup.snoozedUntil
      ? new Date(followup.snoozedUntil).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : dueDateLabel;
    return `Rappel reporté jusqu'au ${snoozedDateLabel}`;
  }
  if (followup.status === 'completed') {
    return 'Rappel complété';
  }
  return `Prochain rappel le ${dueDateLabel}`;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
};

const deriveFallbackPreviewMeta = (file: PatientFile): PatientDashboardPreviewMeta => {
  const assessments = file.assessments || [];
  const reportsCount = assessments.filter((assessment) => assessment.hasFormalReport).length;
  const sessionsCount = assessments.length;
  const hasInitialReport = assessments.some((assessment) => assessment.hasFormalReport && assessment.kind === 'initial');
  const hasReevaluationReport = assessments.some((assessment) => assessment.hasFormalReport && assessment.kind === 'reevaluation');
  const hasReevaluationOpportunity = hasInitialReport && !hasReevaluationReport;
  const lastReportDate = reportsCount > 0 ? assessments.filter((assessment) => assessment.hasFormalReport).map((assessment) => assessment.date).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] : null;
  const lastSessionDate = sessionsCount > 0 ? assessments.map((assessment) => assessment.date).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] : null;

  if (reportsCount > 0) {
    return {
      uiVersion: 2,
      workflow: { progressPercent: 100, progressLabel: 'termine', statusTone: 'success', nextAction: hasReevaluationOpportunity ? 'reevaluation_candidate' : 'open_patient' },
      metrics: { assessmentsCount: sessionsCount, formalReportsCount: reportsCount, lastAssessmentDate: lastSessionDate, lastFormalReportDate: lastReportDate },
      flags: { _archived: file.archived === true, hasInitialReport, hasReevaluationOpportunity },
    };
  }

  if (sessionsCount > 0) {
    return {
      uiVersion: 2,
      workflow: { progressPercent: 60, progressLabel: 'tests_saisis', statusTone: 'neutral', nextAction: 'open_patient' },
      metrics: { assessmentsCount: sessionsCount, formalReportsCount: reportsCount, lastAssessmentDate: lastSessionDate, lastFormalReportDate: lastReportDate },
      flags: { _archived: file.archived === true, hasInitialReport, hasReevaluationOpportunity },
    };
  }

  return {
    uiVersion: 2,
    workflow: { progressPercent: 10, progressLabel: 'created', statusTone: 'warning', nextAction: 'complete_initial' },
    metrics: { assessmentsCount: sessionsCount, formalReportsCount: reportsCount, lastAssessmentDate: lastSessionDate, lastFormalReportDate: lastReportDate },
    flags: { _archived: file.archived === true, hasInitialReport, hasReevaluationOpportunity },
  };
};

const KpiCard = ({
  icon: Icon,
  value,
  label,
  subtext,
  colorClass,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: string;
  label: string;
  subtext: string;
  colorClass: string;
}) => (
  <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
    <div className="mb-4 flex items-center gap-3">
      <div className={`rounded-2xl p-3 ${colorClass}`}>
        <Icon size={22} />
      </div>
      <div className="text-3xl font-serif font-bold text-[var(--text-heading)]">{value}</div>
    </div>
    <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-main)]">{label}</div>
    <div className="mt-1 text-xs text-[var(--text-secondary)]">{subtext}</div>
  </div>
);

export const Dashboard: React.FC<Props> = ({
  userProfile,
  pendingQuestionnaires,
  patientFiles,
  onCreateNew,
  onOpenPatient,
  onGenerateLink,
  onCreateHistorical,
  onShowPricing,
  onProcessPending,
  processingQueueId,
  draftsIndex = {},
  onResumeDraft,
  isDemoMode = false,
  onCopyLink,
  onDeletePending,
  hasMorePatients = false,
  isLoadingMorePatients = false,
  onLoadMorePatients,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportAnim, setShowImportAnim] = useState(false);
  const [targetDemoQ, setTargetDemoQ] = useState<PendingQuestionnaire | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isNewPatientChoiceOpen, setIsNewPatientChoiceOpen] = useState(false);
  const [deleteConfirmQ, setDeleteConfirmQ] = useState<PendingQuestionnaire | null>(null);
  const [showAllQuestionnaires, setShowAllQuestionnaires] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const shortcutLabel = useMemo(() => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? 'Cmd+K' : 'Ctrl+K'), []);
  const practitionerFirstName = useMemo(() => userProfile.branding.practitionerName.split(' ')[0] || 'Thérapeute', [userProfile.branding.practitionerName]);
  const activeFiles = useMemo(() => patientFiles.filter((file) => !file.archived), [patientFiles]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return patientFiles.filter((file) => {
      const inScope = showArchived ? file.archived : !file.archived;
      if (!inScope) return false;
      if (!q) return true;
      return `${file.patient.firstName} ${file.patient.lastName} ${file.patient.classLevel}`.toLowerCase().includes(q);
    });
  }, [patientFiles, searchQuery, showArchived]);

  const kpis = useMemo(() => {
    const now = new Date();
    // Count patients with a formal report finalized this month (from previewMeta)
    const bilansThisMonth = activeFiles.filter((file) => {
      const d = file.previewMeta?.metrics?.lastFormalReportDate;
      if (!d) return false;
      const date = new Date(d);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const newThisMonth = activeFiles.filter((file) => {
      const d = new Date(file.lastInteraction);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const followups = activeFiles.map((file) => buildSyntheticFollowup(file)).filter((item): item is PatientFollowup => item !== null);
    const dueFollowups = followups.filter((item) => item.status === 'due' || item.status === 'overdue').length;
    const reevaluationOpportunities = activeFiles.filter((file) => (file.previewMeta || deriveFallbackPreviewMeta(file)).flags.hasReevaluationOpportunity).length;
    return { hoursSaved: Math.round(bilansThisMonth * 1.5), activeCount: activeFiles.length, newThisMonth, dueFollowups, reevaluationOpportunities };
  }, [activeFiles]);

  const pendingCompleted = useMemo(
    () => pendingQuestionnaires.filter((q) => q.status === 'completed'),
    [pendingQuestionnaires],
  );
  const pendingWaiting = useMemo(
    () => pendingQuestionnaires.filter((q) => q.status === 'pending'),
    [pendingQuestionnaires],
  );
  const allQuestionnaires = useMemo(
    () => [...pendingCompleted, ...pendingWaiting],
    [pendingCompleted, pendingWaiting],
  );
  const visibleQuestionnaires = showAllQuestionnaires ? allQuestionnaires : allQuestionnaires.slice(0, 4);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'k' && !isEditableTarget(event.target)) {
        event.preventDefault();
        setIsPaletteOpen(true);
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (key === 'escape') {
        setIsPaletteOpen(false);
        setDeleteConfirmQ(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="relative animate-in fade-in duration-700 motion-reduce:animate-none">
      <ImportAnimation isOpen={showImportAnim} onComplete={() => { setShowImportAnim(false); if (targetDemoQ && onProcessPending) onProcessPending(targetDemoQ); }} />
      <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} patientFiles={patientFiles} draftsIndex={draftsIndex} onOpenPatient={onOpenPatient} onOpenNewPatientChoice={() => setIsNewPatientChoiceOpen(true)} onResumeDraft={onResumeDraft} />
      <NewPatientChoiceModal isOpen={isNewPatientChoiceOpen} onClose={() => setIsNewPatientChoiceOpen(false)} onChooseFamilyLink={onGenerateLink} onChooseManual={onCreateNew} onChooseHistorical={onCreateHistorical} />

      {/* Delete confirmation modal */}
      {deleteConfirmQ && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onMouseDown={() => setDeleteConfirmQ(null)}
        >
          <div
            className="w-full max-w-[480px] rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="rounded-xl bg-red-100 p-2.5 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <Trash2 size={18} />
              </div>
              <h3 className="font-serif text-xl font-bold text-[var(--text-heading)]">Supprimer ce lien ?</h3>
            </div>
            <p className="text-sm text-[var(--text-main)]">
              Le questionnaire <span className="font-semibold text-[var(--text-heading)]">{deleteConfirmQ.label}</span> sera supprimé définitivement. La famille ne pourra plus accéder au lien.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => { onDeletePending(deleteConfirmQ); setDeleteConfirmQ(null); }}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
              >
                <Trash2 size={14} /> Supprimer
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmQ(null)}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-2.5 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--text-light)] hover:text-[var(--text-main)]"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {!isDemoMode && (userProfile.isTrial || userProfile.subscriptionPlan === 'free') && (
        <div className="sticky top-0 z-30 flex items-center justify-center gap-4 bg-[var(--secondary)] px-6 py-3 text-white shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <Clock size={16} className="animate-pulse text-[var(--primary)] motion-reduce:animate-none" />
            <span className="hidden font-medium md:inline">Vous êtes en mode essai.</span>
            <span className="font-bold text-stone-200">{userProfile.trialDaysRemaining} jours restants</span>
          </div>
          <button onClick={onShowPricing} className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white hover:text-[var(--primary)] motion-reduce:transition-none"><Crown size={14} /> Passer en premium</button>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-6 py-8 md:px-8 md:py-10">
        {/* Header */}
        <section className="mb-9 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <div>
            <h1 className="font-serif text-[38px] font-bold leading-[1.05] text-[var(--text-heading)] md:text-[44px]">Bonjour, {practitionerFirstName} <span className="align-middle text-2xl opacity-75">👋</span></h1>
            <p className="mt-2 text-sm font-medium text-[var(--text-secondary)]">Votre journée clinique est prête.</p>
          </div>
          <div className="w-full lg:pt-1">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <div className="relative w-full md:flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
                <input ref={searchRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Rechercher un patient" className="h-11 w-full rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] pl-10 pr-24 text-sm font-medium text-[var(--text-main)] shadow-sm outline-none transition-all focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary-opacity-10)] motion-reduce:transition-none" />
                <button type="button" onClick={() => setIsPaletteOpen(true)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-color)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] motion-reduce:transition-none">{shortcutLabel}</button>
              </div>
              <button onClick={() => setIsNewPatientChoiceOpen(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-bold text-white shadow-lg shadow-orange-200 dark:shadow-black/30 transition-all hover:-translate-y-0.5 hover:bg-[#d0694e] motion-reduce:transform-none motion-reduce:transition-none"><Plus size={18} /> Nouveau patient</button>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          <KpiCard icon={Clock} value={`${kpis.hoursSaved}h`} label="Temps économisé" subtext="Ce mois-ci" colorClass="bg-blue-500/10 text-blue-500" />
          <KpiCard icon={Users} value={`${kpis.activeCount}`} label="Patients actifs" subtext={`Dont ${kpis.newThisMonth} nouveaux`} colorClass="bg-[var(--primary)]/10 text-[var(--primary)]" />
          <KpiCard icon={Calendar} value={`${kpis.dueFollowups}`} label="Rappels actifs" subtext={`${kpis.reevaluationOpportunities} opportunités de suivi`} colorClass="bg-emerald-500/10 text-emerald-500" />
        </section>

        {/* Questionnaires section — only shown when there are pending items */}
        {allQuestionnaires.length > 0 && (
          <section className="mb-10">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)]">Questionnaires</h2>
                <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px] font-bold text-white">{allQuestionnaires.length}</span>
              </div>
              <button
                onClick={onGenerateLink}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <Plus size={12} /> Nouveau lien
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm">
              {visibleQuestionnaires.map((q, idx) => {
                const isDone = q.status === 'completed';
                const isBusy = processingQueueId === q.id;
                return (
                  <div
                    key={q.id}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--hover-bg)] ${idx !== 0 ? 'border-t border-[var(--border-color)]' : ''}`}
                  >
                    {/* Status dot */}
                    <div className={`h-2 w-2 shrink-0 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-[var(--text-disabled)]'}`} />

                    {/* Label + date */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--text-heading)]">{q.label}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{monthDate(q.createdAt)}</p>
                    </div>

                    {/* Status badge */}
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${isDone ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-[var(--hover-bg)] text-[var(--text-secondary)]'}`}>
                      {isDone ? 'Réponse reçue' : 'En attente'}
                    </span>

                    {/* Action button */}
                    {isDone ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          if (isDemoMode) { setTargetDemoQ(q); setShowImportAnim(true); return; }
                          if (onProcessPending) onProcessPending(q);
                        }}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:opacity-90 disabled:opacity-60"
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                        {isBusy ? 'Import...' : 'Importer'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onCopyLink(q)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                      >
                        <Copy size={11} /> Copier lien
                      </button>
                    )}

                    {/* Delete button — only for pending */}
                    {!isDone && (
                      <button
                        type="button"
                        aria-label="Supprimer ce lien"
                        onClick={() => setDeleteConfirmQ(q)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-disabled)] transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Show all / collapse */}
              {allQuestionnaires.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllQuestionnaires((p) => !p)}
                  className="w-full border-t border-[var(--border-color)] py-2.5 text-center text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
                >
                  {showAllQuestionnaires ? 'Voir moins' : `Voir tous (${allQuestionnaires.length})`}
                </button>
              )}
            </div>
          </section>
        )}

        {/* Patients section */}
        <section className="max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <h2 className="font-serif text-3xl font-bold text-[var(--text-heading)]">{showArchived ? 'Patients archivés' : 'Patients suivis'}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowArchived((prev) => !prev)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${showArchived ? 'border-stone-800 bg-stone-800 text-white' : 'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-[var(--text-heading)] hover:text-[var(--text-heading)]'}`}><Archive size={12} /> {showArchived ? 'Voir patients suivis' : 'Voir archives'}</button>
              <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"><Filter size={12} /> Trier par date</button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredFiles.map((file) => {
              const previewMeta = file.previewMeta || deriveFallbackPreviewMeta(file);
              const draftMeta = draftsIndex[file.id];
              const hasDraft = Boolean(draftMeta);
              const activityDate = previewMeta.metrics.lastFormalReportDate || previewMeta.metrics.lastAssessmentDate || file.lastInteraction;
              const isInitialCompleted = previewMeta.flags.hasInitialReport;
              const followup = !file.archived ? buildSyntheticFollowup(file) : null;
              const followUpLabel = followup ? buildFollowupStatusLabel(followup) : null;
              const inProgressState = buildInProgressState(previewMeta, draftMeta?.step ?? null);
              const showProgress = !file.archived && !isInitialCompleted;
              const tone = getToneClasses(showProgress ? inProgressState.tone : previewMeta.workflow.statusTone);
              const progressPercent = inProgressState.progressPercent;
              const progressLabel = inProgressState.label;
              const statusBadgeLabel = isInitialCompleted ? null : hasDraft ? 'Brouillon' : 'En cours';

              // Urgency signal for left border
              const urgencyLevel: UrgencyLevel =
                followup?.status === 'overdue' ? 'overdue' :
                followup?.status === 'due' ? 'due' :
                (hasDraft && !isInitialCompleted) ? 'draft' : 'none';

              const urgencyBorder =
                urgencyLevel === 'overdue' ? 'border-l-4 border-l-red-400' :
                urgencyLevel === 'due' ? 'border-l-4 border-l-orange-400' :
                urgencyLevel === 'draft' ? 'border-l-4 border-l-amber-400' :
                'border-l-4 border-l-transparent';

              return (
                <div
                  key={file.id}
                  onClick={() => onOpenPatient(file.id)}
                  className={`group cursor-pointer rounded-2xl border bg-[var(--card-bg)] p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${urgencyBorder} ${file.archived ? 'border-[var(--border-color)] opacity-80 hover:opacity-100' : 'border-[var(--border-color)] hover:border-[var(--primary)]/30'}`}
                >
                  <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(220px,1.55fr)_minmax(220px,1.1fr)_minmax(170px,0.95fr)_auto] lg:items-center lg:gap-4">
                    {/* Identity */}
                    <div className="flex items-center gap-3">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${file.archived ? 'bg-[var(--hover-bg)] text-[var(--text-secondary)]' : 'bg-[var(--secondary)] text-white'}`}>
                        {(file.patient.firstName[0] || '').toUpperCase()}{(file.patient.lastName[0] || '').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-bold text-[var(--text-heading)] transition-colors group-hover:text-[var(--primary)]">{`${file.patient.firstName} ${file.patient.lastName}`.trim() || 'Patient sans nom'}</h3>
                        <p className="truncate text-[11px] text-[var(--text-secondary)]">{file.patient.age || '-'} • {file.patient.classLevel || 'Classe non renseignée'}</p>
                      </div>
                    </div>

                    {/* Progress / followup */}
                    <div>
                      {showProgress ? (
                        <>
                          <div className="mb-1 flex items-center gap-2">
                            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--progress-bg)]">
                              <div className={`h-full ${tone.progress}`} style={{ width: `${progressPercent}%` }} />
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{progressPercent}%</span>
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)]">{progressLabel}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-[var(--text-main)]">Dossier patient actif</p>
                          {followUpLabel && (
                            <p className={`mt-0.5 flex items-center gap-1 text-[10px] font-medium ${urgencyLevel === 'overdue' ? 'text-red-500 dark:text-red-400' : urgencyLevel === 'due' ? 'text-orange-500 dark:text-orange-400' : 'text-[var(--text-secondary)]'}`}>
                              {(urgencyLevel === 'overdue' || urgencyLevel === 'due') && <AlertTriangle size={10} />}
                              {followUpLabel}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Date + badge */}
                    <div className="flex items-center justify-between gap-3 lg:justify-start">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">Dernière modif.</p>
                        <p className="text-xs font-bold text-[var(--text-heading)]">{fullDate(activityDate)}</p>
                      </div>
                      {statusBadgeLabel && (
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${hasDraft ? 'border-[var(--border-color)] bg-[var(--hover-bg)] text-[var(--text-main)]' : tone.badge}`}>
                          {statusBadgeLabel}
                        </span>
                      )}
                    </div>

                    {/* CTA */}
                    <div className="flex items-center justify-end gap-2">
                      {hasDraft && !file.archived && !isInitialCompleted && onResumeDraft ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onResumeDraft(file.id); }}
                          className="flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-[10px] font-bold uppercase tracking-wider text-amber-700 transition-colors hover:bg-amber-100"
                        >
                          <Edit3 size={12} /> Reprendre
                        </button>
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--hover-bg)] text-[var(--text-disabled)] transition-all group-hover:bg-[var(--primary)] group-hover:text-white">
                          <ArrowRight size={16} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredFiles.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] py-10 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--hover-bg)] text-[var(--text-disabled)]"><Search size={22} /></div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">{showArchived ? 'Aucun patient archivé.' : searchQuery ? `Aucun patient trouvé pour "${searchQuery}".` : 'Aucun patient enregistré pour le moment.'}</p>
                {!showArchived && <button onClick={() => setIsNewPatientChoiceOpen(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white"><Plus size={14} /> Nouveau patient</button>}
              </div>
            )}

            {hasMorePatients && !showArchived && (
              <div className="flex justify-center pt-4">
                <button onClick={() => onLoadMorePatients && onLoadMorePatients()} disabled={isLoadingMorePatients || !onLoadMorePatients} className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-all hover:border-[var(--text-heading)] hover:text-[var(--text-heading)] disabled:opacity-50">
                  {isLoadingMorePatients ? <span className="inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Chargement...</span> : 'Voir plus'}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
