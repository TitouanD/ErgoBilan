import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PendingQuestionnaire, PatientDashboardPreviewMeta, PatientFile, PatientFollowup, UserProfile } from '../../types';
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  Clock,
  Coffee,
  Crown,
  Download,
  Edit3,
  Filter,
  Loader2,
  Plus,
  Search,
  Users,
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
  onShowPricing: () => void;
  onProcessPending?: (q: PendingQuestionnaire) => void;
  processingQueueId?: string | null;
  draftsIndex?: Record<string, string>;
  onResumeDraft?: (patientId: string) => void;
  isDemoMode?: boolean;
  onCopyLink: (q: PendingQuestionnaire) => void;
  hasMorePatients?: boolean;
  isLoadingMorePatients?: boolean;
  onLoadMorePatients?: () => void;
}

type UrgencyKind = 'draft' | 'pending_done' | 'pending_waiting' | 'followup';
interface UrgencyItem {
  id: string;
  kind: UrgencyKind;
  title: string;
  subtitle: string;
  date: string;
  actionHint: string;
  isBusy?: boolean;
  onClick: () => void;
}
interface PendingLinkConfirmationState {
  urgencyId: string;
  title: string;
}

const monthDate = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

const fullDate = (value: string | null | undefined) => {
  if (!value) return 'Aucune activité récente';
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const REEVALUATION_TARGET_DAYS = 180;
const REEVALUATION_MAX_DAYS = 365;

interface ReevaluationProgress {
  progressPercent: number;
  label: string;
  targetDateLabel: string;
  badgeLabel: string;
  statusTone: PatientDashboardPreviewMeta['workflow']['statusTone'];
}

const buildReevaluationProgress = (lastReportDate: string | null | undefined): ReevaluationProgress | null => {
  if (!lastReportDate) return null;
  const referenceDate = new Date(lastReportDate);
  if (Number.isNaN(referenceDate.getTime())) return null;
  const targetDate = new Date(referenceDate.getTime() + REEVALUATION_TARGET_DAYS * DAY_IN_MS);
  const targetDateLabel = targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const daysSince = Math.max(0, Math.floor((Date.now() - referenceDate.getTime()) / DAY_IN_MS));
  if (daysSince < REEVALUATION_TARGET_DAYS) {
    const monthsLeft = Math.max(1, Math.ceil((REEVALUATION_TARGET_DAYS - daysSince) / 30));
    return {
      progressPercent: clampPercent((daysSince / REEVALUATION_TARGET_DAYS) * 100),
      label: `Prochaine réévaluation dans ${monthsLeft} mois`,
      targetDateLabel,
      badgeLabel: 'Suivi',
      statusTone: 'neutral',
    };
  }

  if (daysSince < REEVALUATION_MAX_DAYS) {
    return {
      progressPercent: 100,
      label: 'Fenêtre de réévaluation ouverte',
      targetDateLabel,
      badgeLabel: 'Réévaluation',
      statusTone: 'warning',
    };
  }

  const monthsLate = Math.max(1, Math.ceil((daysSince - REEVALUATION_MAX_DAYS) / 30));
  return {
    progressPercent: 100,
    label: `Réévaluation en retard (${monthsLate} mois)`,
    targetDateLabel,
    badgeLabel: 'Réévaluation',
    statusTone: 'warning',
  };
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
  if (tone === 'success') return { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', progress: 'bg-emerald-500' };
  if (tone === 'warning') return { badge: 'bg-amber-50 text-amber-700 border-amber-200', progress: 'bg-amber-500' };
  return { badge: 'bg-[#3D405B]/10 text-[#3D405B] border-[#3D405B]/20', progress: 'bg-[#3D405B]' };
};

const getUrgencyTone = (kind: UrgencyKind) => {
  if (kind === 'draft') return { card: 'border-rose-200 bg-rose-50/60 hover:border-rose-300', icon: 'bg-rose-100 text-rose-600', action: 'text-rose-700' };
  if (kind === 'pending_done') return { card: 'border-amber-200 bg-amber-50/60 hover:border-amber-300', icon: 'bg-amber-100 text-amber-600', action: 'text-amber-700' };
  if (kind === 'followup') return { card: 'border-orange-200 bg-orange-50/60 hover:border-orange-300', icon: 'bg-orange-100 text-orange-600', action: 'text-orange-700' };
  return { card: 'border-stone-200 bg-white hover:border-stone-300', icon: 'bg-stone-100 text-stone-500', action: 'text-stone-600' };
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
    organizationId: file.patient.organizationId || '',
    status,
    dueAt: dueDate.toISOString(),
    snoozedUntil: null,
    note: null,
    createdAt: lastFormalDate,
    updatedAt: lastFormalDate,
  };
};

const buildFollowupProgress = (followup: PatientFollowup): ReevaluationProgress => {
  const dueDateLabel = new Date(followup.dueAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  if (followup.status === 'due') {
    return {
      progressPercent: 100,
      label: 'Fenetre de reevaluation ouverte',
      targetDateLabel: dueDateLabel,
      badgeLabel: 'Reevaluation',
      statusTone: 'warning',
    };
  }
  if (followup.status === 'overdue') {
    return {
      progressPercent: 100,
      label: 'Reevaluation en retard',
      targetDateLabel: dueDateLabel,
      badgeLabel: 'Retard',
      statusTone: 'warning',
    };
  }
  if (followup.status === 'scheduled') {
    return {
      progressPercent: 80,
      label: `Reevaluation planifiee (${dueDateLabel})`,
      targetDateLabel: dueDateLabel,
      badgeLabel: 'Planifie',
      statusTone: 'neutral',
    };
  }
  if (followup.status === 'snoozed') {
    const snoozedDateLabel = followup.snoozedUntil
      ? new Date(followup.snoozedUntil).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : dueDateLabel;
    return {
      progressPercent: 70,
      label: `Rappel reporte jusqu'au ${snoozedDateLabel}`,
      targetDateLabel: dueDateLabel,
      badgeLabel: 'Reporte',
      statusTone: 'neutral',
    };
  }
  if (followup.status === 'completed') {
    return {
      progressPercent: 100,
      label: 'Rappel complete',
      targetDateLabel: dueDateLabel,
      badgeLabel: 'Complete',
      statusTone: 'success',
    };
  }
  return {
    progressPercent: 45,
    label: `Prochain rappel le ${dueDateLabel}`,
    targetDateLabel: dueDateLabel,
    badgeLabel: 'Suivi',
    statusTone: 'neutral',
  };
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
  <div className="rounded-[24px] border border-stone-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
    <div className="mb-4 flex items-center gap-3">
      <div className={`rounded-2xl p-3 ${colorClass}`}>
        <Icon size={22} />
      </div>
      <div className="text-3xl font-serif font-bold text-[#3D405B]">{value}</div>
    </div>
    <div className="text-xs font-bold uppercase tracking-wide text-[#3D405B]">{label}</div>
    <div className="mt-1 text-xs text-stone-500">{subtext}</div>
  </div>
);

export const Dashboard: React.FC<Props> = ({
  userProfile,
  pendingQuestionnaires,
  patientFiles,
  onCreateNew,
  onOpenPatient,
  onGenerateLink,
  onShowPricing,
  onProcessPending,
  processingQueueId,
  draftsIndex = {},
  onResumeDraft,
  isDemoMode = false,
  onCopyLink,
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
  const [rewardedUrgencyId, setRewardedUrgencyId] = useState<string | null>(null);
  const [pendingLinkConfirmation, setPendingLinkConfirmation] = useState<PendingLinkConfirmationState | null>(null);
  const [hiddenUrgencyIds, setHiddenUrgencyIds] = useState<Set<string>>(new Set());
  const [railCanScroll, setRailCanScroll] = useState(false);
  const [railAtStart, setRailAtStart] = useState(true);
  const [railAtEnd, setRailAtEnd] = useState(true);
  const [railScrollProgress, setRailScrollProgress] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const todoRailRef = useRef<HTMLDivElement | null>(null);
  const rewardTimeoutRef = useRef<number | null>(null);
  const dismissTimeoutsRef = useRef<number[]>([]);

  const shortcutLabel = useMemo(() => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? 'Cmd+K' : 'Ctrl+K'), []);
  const practitionerFirstName = useMemo(() => userProfile.branding.practitionerName.split(' ')[0] || 'Thérapeute', [userProfile.branding.practitionerName]);
  const activeFiles = useMemo(() => patientFiles.filter((file) => !file.archived), [patientFiles]);
  const patientById = useMemo(() => new Map(patientFiles.map((file) => [file.id, file])), [patientFiles]);

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
    const newThisMonth = activeFiles.filter((file) => {
      const d = new Date(file.lastInteraction);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const followups = activeFiles.map((file) => buildSyntheticFollowup(file)).filter((item): item is PatientFollowup => item !== null);
    const dueFollowups = followups.filter((item) => item.status === 'due' || item.status === 'overdue').length;
    const reevaluationOpportunities = activeFiles.filter((file) => (file.previewMeta || deriveFallbackPreviewMeta(file)).flags.hasReevaluationOpportunity).length;
    return { hoursSaved: Math.round(userProfile.totalBilansGenerated * 1.5), activeCount: activeFiles.length, newThisMonth, dueFollowups, reevaluationOpportunities };
  }, [activeFiles, userProfile.totalBilansGenerated]);

  const urgencyItems = useMemo<UrgencyItem[]>(() => {
    const drafts: UrgencyItem[] = Object.entries(draftsIndex)
      .map(([patientId, draftDate]) => {
        const file = patientById.get(patientId);
        if (!file || file.archived) return null;
        return {
          id: `draft-${patientId}`,
          kind: 'draft',
          title: `${file.patient.firstName} ${file.patient.lastName}`.trim() || 'Brouillon sans nom',
          subtitle: 'Brouillon a reprendre',
          date: draftDate,
          actionHint: 'Reprendre',
          onClick: () => onResumeDraft && onResumeDraft(patientId),
        };
      })
      .filter((item): item is UrgencyItem => item !== null);

    const done: UrgencyItem[] = pendingQuestionnaires
      .filter((item) => item.status === 'completed')
      .map((item) => ({
        id: `pending-completed-${item.id}`,
        kind: 'pending_done',
        title: item.label || 'Questionnaire recu',
        subtitle: 'Questionnaire complete a importer',
        date: item.createdAt,
        actionHint: 'Importer',
        isBusy: processingQueueId === item.id,
        onClick: () => {
          if (isDemoMode) {
            setTargetDemoQ(item);
            setShowImportAnim(true);
            return;
          }
          if (onProcessPending) onProcessPending(item);
        },
      }));

    const followupsDue: UrgencyItem[] = activeFiles
      .map((file) => {
        const followup = buildSyntheticFollowup(file);
        if (!followup || (followup.status !== 'due' && followup.status !== 'overdue')) return null;
        return {
          id: `followup-${file.id}`,
          kind: 'followup',
          title: `${file.patient.firstName} ${file.patient.lastName}`.trim() || 'Patient',
          subtitle: followup.status === 'overdue' ? 'Reevaluation en retard' : 'Reevaluation a planifier',
          date: followup.dueAt,
          actionHint: 'Ouvrir',
          onClick: () => onOpenPatient(file.id),
        } satisfies UrgencyItem;
      })
      .filter((item): item is UrgencyItem => item !== null);

    const waiting: UrgencyItem[] = pendingQuestionnaires
      .filter((item) => item.status === 'pending')
      .slice(0, 6)
      .map((item) => ({
        id: `pending-waiting-${item.id}`,
        kind: 'pending_waiting',
        title: item.label || 'Questionnaire en attente',
        subtitle: 'Lien envoye, en attente de reponse famille',
        date: item.createdAt,
        actionHint: 'Copier lien',
        onClick: () => onCopyLink(item),
      }));

    const order = { draft: 0, pending_done: 1, followup: 2, pending_waiting: 3 };
    return [...drafts, ...done, ...followupsDue, ...waiting].sort(
      (a, b) => order[a.kind] - order[b.kind] || new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [
    draftsIndex,
    patientById,
    pendingQuestionnaires,
    onResumeDraft,
    processingQueueId,
    isDemoMode,
    onProcessPending,
    onCopyLink,
    activeFiles,
    onOpenPatient,
  ]);

  const visibleUrgencyItems = useMemo(
    () => urgencyItems.filter((item) => !hiddenUrgencyIds.has(item.id)),
    [urgencyItems, hiddenUrgencyIds],
  );

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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => () => {
    if (rewardTimeoutRef.current !== null) window.clearTimeout(rewardTimeoutRef.current);
    dismissTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  useEffect(() => {
    if (!pendingLinkConfirmation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingLinkConfirmation(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingLinkConfirmation]);

  useEffect(() => {
    setHiddenUrgencyIds((current) => {
      if (current.size === 0) return current;
      const availableIds = new Set(urgencyItems.map((item) => item.id));
      let changed = false;
      const next = new Set<string>();
      current.forEach((id) => {
        if (availableIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [urgencyItems]);

  useEffect(() => {
    const rail = todoRailRef.current;
    if (!rail) {
      setRailCanScroll(false);
      setRailAtStart(true);
      setRailAtEnd(true);
      setRailScrollProgress(0);
      return;
    }

    const updateRailState = () => {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
      const currentScroll = rail.scrollLeft;
      setRailCanScroll(maxScroll > 1);
      setRailAtStart(currentScroll <= 1);
      setRailAtEnd(currentScroll >= maxScroll - 1);
      setRailScrollProgress(maxScroll > 0 ? currentScroll / maxScroll : 0);
    };

    updateRailState();
    rail.addEventListener('scroll', updateRailState, { passive: true });
    window.addEventListener('resize', updateRailState);
    return () => {
      rail.removeEventListener('scroll', updateRailState);
      window.removeEventListener('resize', updateRailState);
    };
  }, [visibleUrgencyItems.length]);

  const handleUrgencyAction = (item: UrgencyItem) => {
    if (item.isBusy) return;
    item.onClick();
    setRewardedUrgencyId(item.id);
    if (item.kind === 'pending_waiting') {
      setPendingLinkConfirmation({ urgencyId: item.id, title: item.title });
    } else if (item.kind === 'draft') {
      const dismissTimer = window.setTimeout(() => {
        setHiddenUrgencyIds((current) => {
          const next = new Set(current);
          next.add(item.id);
          return next;
        });
      }, 760);
      dismissTimeoutsRef.current.push(dismissTimer);
    }
    if (rewardTimeoutRef.current !== null) window.clearTimeout(rewardTimeoutRef.current);
    rewardTimeoutRef.current = window.setTimeout(() => setRewardedUrgencyId(null), 820);
  };

  const scrollTodoRailBy = (offset: number) => {
    if (!todoRailRef.current) return;
    todoRailRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const handleTodoRailWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!todoRailRef.current || !railCanScroll) return;
    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (primaryDelta === 0) return;
    todoRailRef.current.scrollBy({ left: primaryDelta, behavior: 'auto' });
    event.preventDefault();
    event.stopPropagation();
  };

  const handleLinkConfirmationKeep = () => {
    setPendingLinkConfirmation(null);
  };

  const handleLinkConfirmationDone = () => {
    if (!pendingLinkConfirmation) return;
    setHiddenUrgencyIds((current) => {
      const next = new Set(current);
      next.add(pendingLinkConfirmation.urgencyId);
      return next;
    });
    setPendingLinkConfirmation(null);
  };

  return (
    <div className="relative animate-in fade-in duration-700 motion-reduce:animate-none">
      <ImportAnimation isOpen={showImportAnim} onComplete={() => { setShowImportAnim(false); if (targetDemoQ && onProcessPending) onProcessPending(targetDemoQ); }} />
      <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} patientFiles={patientFiles} draftsIndex={draftsIndex} onOpenPatient={onOpenPatient} onOpenNewPatientChoice={() => setIsNewPatientChoiceOpen(true)} onResumeDraft={onResumeDraft} />
      <NewPatientChoiceModal isOpen={isNewPatientChoiceOpen} onClose={() => setIsNewPatientChoiceOpen(false)} onChooseFamilyLink={onGenerateLink} onChooseManual={onCreateNew} />
      {pendingLinkConfirmation && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-[#3D405B]/45 p-4 backdrop-blur-sm" onMouseDown={handleLinkConfirmationKeep}>
          <div className="w-full max-w-[520px] rounded-[24px] border border-stone-200 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <h3 className="font-serif text-2xl font-bold text-[#3D405B]">Lien copié</h3>
            <p className="mt-2 text-sm text-stone-600">Avez-vous bien envoyé le lien au parent pour <span className="font-semibold text-[#3D405B]">{pendingLinkConfirmation.title}</span> ?</p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleLinkConfirmationKeep}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:text-[#3D405B]"
              >
                Garder dans À traiter
              </button>
              <button
                type="button"
                onClick={handleLinkConfirmationDone}
                className="rounded-xl bg-[#E07A5F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#d0694e]"
              >
                Oui, retirer la tâche
              </button>
            </div>
          </div>
        </div>
      )}

      {!isDemoMode && (userProfile.isTrial || userProfile.subscriptionPlan === 'free') && (
        <div className="sticky top-0 z-30 flex items-center justify-center gap-4 bg-[#3D405B] px-6 py-3 text-white shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <Clock size={16} className="animate-pulse text-[#E07A5F] motion-reduce:animate-none" />
            <span className="hidden font-medium md:inline">Vous êtes en mode essai.</span>
            <span className="font-bold text-stone-200">{userProfile.trialDaysRemaining} jours restants</span>
          </div>
          <button onClick={onShowPricing} className="flex items-center gap-2 rounded-full bg-[#E07A5F] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white hover:text-[#E07A5F] motion-reduce:transition-none"><Crown size={14} /> Passer en premium</button>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-6 py-8 md:px-8 md:py-10">
        <section className="mb-9 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <div>
            <h1 className="font-serif text-[38px] font-bold leading-[1.05] text-[#3D405B] md:text-[44px]">Bonjour, {practitionerFirstName} <span className="align-middle text-2xl opacity-75">👋</span></h1>
            <p className="mt-2 text-sm font-medium text-stone-400">Votre journée clinique est prête.</p>
          </div>
          <div className="w-full lg:pt-1"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="relative w-full md:flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
              <input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Rechercher un patient" className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-24 text-sm font-medium text-[#3D405B] shadow-sm outline-none transition-all focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 motion-reduce:transition-none" />
              <button type="button" onClick={() => setIsPaletteOpen(true)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 transition-colors hover:border-[#E07A5F] hover:text-[#E07A5F] motion-reduce:transition-none">{shortcutLabel}</button>
            </div>
            <button onClick={() => setIsNewPatientChoiceOpen(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#E07A5F] px-5 text-sm font-bold text-white shadow-lg shadow-orange-200 transition-all hover:-translate-y-0.5 hover:bg-[#d0694e] motion-reduce:transform-none motion-reduce:transition-none"><Plus size={18} /> Nouveau patient</button>
          </div></div>
        </section>

        <section className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          <KpiCard icon={Clock} value={`${kpis.hoursSaved}h`} label="Temps économisé" subtext="Ce mois-ci" colorClass="bg-blue-50 text-blue-600" />
          <KpiCard icon={Users} value={`${kpis.activeCount}`} label="Patients actifs" subtext={`Dont ${kpis.newThisMonth} nouveaux`} colorClass="bg-orange-50 text-[#E07A5F]" />
          <KpiCard icon={Calendar} value={`${kpis.dueFollowups}`} label="Rappels actifs" subtext={`${kpis.reevaluationOpportunities} opportunités de suivi`} colorClass="bg-emerald-50 text-emerald-600" />
        </section>

        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-3xl font-bold text-[#3D405B]">À traiter</h2>
              {visibleUrgencyItems.length > 0 && <span className="rounded-full bg-[#3D405B] px-2 py-0.5 text-[10px] font-bold text-white">{visibleUrgencyItems.length}</span>}
            </div>
            {railCanScroll && (
              <div className="hidden items-center gap-1.5 sm:flex">
                <button
                  type="button"
                  aria-label="Voir les actions précédentes"
                  onClick={() => scrollTodoRailBy(-360)}
                  disabled={railAtStart}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-300 hover:text-[#3D405B] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Voir les actions suivantes"
                  onClick={() => scrollTodoRailBy(360)}
                  disabled={railAtEnd}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-300 hover:text-[#3D405B] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          {visibleUrgencyItems.length === 0 ? (
            <div className="flex items-center justify-between gap-4 rounded-[24px] border border-emerald-100 bg-emerald-50/40 p-6 shadow-sm">
              <div className="flex items-center gap-4"><div className="rounded-2xl bg-emerald-100 p-3 text-emerald-600"><Coffee size={24} /></div><div><h3 className="font-serif text-xl font-bold text-[#3D405B]">Tout est à jour</h3><p className="text-xs font-medium text-stone-500">Aucun brouillon ni urgence en attente.</p></div></div>
              <button onClick={() => setIsNewPatientChoiceOpen(true)} className="hidden items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-xs font-bold text-emerald-700 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50 md:flex"><Plus size={14} /> Nouveau patient</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <div
                  className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-10 transition-opacity ${railCanScroll && !railAtStart ? 'opacity-100' : 'opacity-0'}`}
                  style={{ backgroundImage: 'linear-gradient(to right, var(--app-bg), transparent)' }}
                />
                <div
                  className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-10 transition-opacity ${railCanScroll && !railAtEnd ? 'opacity-100' : 'opacity-0'}`}
                  style={{ backgroundImage: 'linear-gradient(to left, var(--app-bg), transparent)' }}
                />
                <div ref={todoRailRef} onWheel={handleTodoRailWheel} className="overflow-x-auto overscroll-x-contain overscroll-y-contain pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"><div className="flex snap-x snap-mandatory gap-3 px-1">
                {visibleUrgencyItems.map((item) => {
                  const tone = getUrgencyTone(item.kind);
                  const isRewarded = rewardedUrgencyId === item.id;
                  const ActionIcon = item.kind === 'draft' ? Edit3 : item.kind === 'pending_done' ? Download : item.kind === 'followup' ? Calendar : Copy;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleUrgencyAction(item)}
                      disabled={item.isBusy}
                      aria-label={`${item.actionHint}: ${item.title}`}
                      className={`relative min-h-[108px] shrink-0 basis-[83%] snap-start rounded-[18px] border p-3 text-left shadow-sm transition-all duration-200 motion-reduce:transition-none sm:basis-[64%] lg:basis-[42%] xl:basis-[34%] 2xl:basis-[28.5%] ${
                        tone.card
                      } ${item.isBusy ? 'cursor-wait opacity-70' : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none'} ${isRewarded ? 'scale-[0.985] ring-2 ring-emerald-300 bg-emerald-50/75 shadow-lg shadow-emerald-200/70' : ''}`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0"><h3 className="truncate text-lg font-serif font-bold text-[#3D405B]">{item.title}</h3><p className="truncate text-xs text-stone-600">{item.subtitle}</p></div>
                        <div className={`rounded-lg p-1.5 ${tone.icon}`}>{item.kind === 'draft' ? <Edit3 size={13} /> : item.kind === 'pending_done' ? <ClipboardList size={13} /> : item.kind === 'followup' ? <Calendar size={13} /> : <AlertCircle size={13} />}</div>
                      </div>
                      <div className="flex items-end justify-between border-t border-black/5 pt-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400"><Clock size={10} /> {monthDate(item.date)}</div>
                        <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${tone.action}`}>
                          {item.isBusy ? <Loader2 size={12} className="animate-spin" /> : <ActionIcon size={12} />}
                          <span>{item.isBusy ? 'Import...' : item.actionHint}</span>
                        </div>
                      </div>
                      <div className={`pointer-events-none absolute right-3 top-3 transition-all duration-150 motion-reduce:transition-none ${isRewarded ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}>
                        <div className="rounded-full bg-white/90 p-1 text-emerald-600 shadow-sm"><CheckCircle2 size={14} /></div>
                      </div>
                    </button>
                  );
                })}
              </div></div>
                {railCanScroll && (
                  <div className="mt-1 px-1">
                    <div className="relative h-1 rounded-full bg-stone-200/80">
                      <div
                        className="absolute top-0 h-1 w-16 rounded-full bg-stone-400 transition-all"
                        style={{ left: `${railScrollProgress * (100 - 12)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <p className="px-1 text-[11px] font-medium text-stone-400">Faites défiler pour voir toutes les actions prioritaires.</p>
            </div>
          )}
        </section>

        <section className="max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <h2 className="font-serif text-3xl font-bold text-[#3D405B]">{showArchived ? 'Patients archivés' : 'Patients suivis'}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowArchived((prev) => !prev)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${showArchived ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 bg-white text-stone-500 hover:border-[#3D405B] hover:text-[#3D405B]'}`}><Archive size={12} /> {showArchived ? 'Voir patients suivis' : 'Voir archives'}</button>
              <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-400 transition-colors hover:bg-white hover:text-[#3D405B]"><Filter size={12} /> Trier par date</button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredFiles.map((file) => {
              const previewMeta = file.previewMeta || deriveFallbackPreviewMeta(file);
              const hasDraft = Boolean(draftsIndex[file.id]);
              const activityDate = previewMeta.metrics.lastFormalReportDate || previewMeta.metrics.lastAssessmentDate || file.lastInteraction;
              const followup = !file.archived && !hasDraft ? buildSyntheticFollowup(file) : null;
              const followUpProgress = followup
                ? buildFollowupProgress(followup)
                : !file.archived && !hasDraft && previewMeta.flags.hasInitialReport
                  ? buildReevaluationProgress(previewMeta.metrics.lastFormalReportDate || file.lastInteraction)
                  : null;
              const tone = getToneClasses(followUpProgress?.statusTone || previewMeta.workflow.statusTone);
              const progressPercent = followUpProgress ? followUpProgress.progressPercent : previewMeta.workflow.progressPercent;
              const progressLabel = followUpProgress ? followUpProgress.label : workflowLabelMap[previewMeta.workflow.progressLabel];
              const followUpTargetDateLabel = followUpProgress ? followUpProgress.targetDateLabel : null;
              const statusBadgeLabel = hasDraft ? 'Brouillon' : followUpProgress ? followUpProgress.badgeLabel : nextActionLabelMap[previewMeta.workflow.nextAction];

              return (
                <div key={file.id} onClick={() => onOpenPatient(file.id)} className={`group rounded-2xl border bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${file.archived ? 'border-stone-200 opacity-80 hover:opacity-100' : 'border-stone-100 hover:border-[#E07A5F]/30'}`}>
                  <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(220px,1.55fr)_minmax(220px,1.1fr)_minmax(170px,0.95fr)_auto] lg:items-center lg:gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold ${file.archived ? 'bg-stone-200 text-stone-500' : 'bg-[#3D405B] text-white'}`}>{(file.patient.firstName[0] || '').toUpperCase()}{(file.patient.lastName[0] || '').toUpperCase()}</div>
                      <div className="min-w-0"><h3 className="truncate text-base font-bold text-[#3D405B] transition-colors group-hover:text-[#E07A5F]">{`${file.patient.firstName} ${file.patient.lastName}`.trim() || 'Patient sans nom'}</h3><p className="truncate text-[11px] text-stone-400">{file.patient.age || '-'} • {file.patient.classLevel || 'Classe non renseignée'}</p></div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2"><div className="h-1.5 w-28 overflow-hidden rounded-full bg-stone-100"><div className={`h-full ${tone.progress}`} style={{ width: `${progressPercent}%` }} /></div><span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{progressPercent}%</span></div>
                      <p className="text-[11px] text-stone-500">{progressLabel}</p>
                      {followUpTargetDateLabel && <p className="mt-0.5 text-[10px] text-stone-400">Cible: {followUpTargetDateLabel}</p>}
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:justify-start"><div><p className="text-[10px] font-medium uppercase tracking-wider text-stone-400">Dernière modif.</p><p className="text-xs font-bold text-[#3D405B]">{fullDate(activityDate)}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${hasDraft ? 'border-stone-200 bg-stone-50 text-stone-600' : tone.badge}`}>{statusBadgeLabel}</span></div>
                    <div className="flex items-center justify-end gap-2">
                      {hasDraft && !file.archived && onResumeDraft ? (
                        <button onClick={(event) => { event.stopPropagation(); onResumeDraft(file.id); }} className="flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-[10px] font-bold uppercase tracking-wider text-amber-700 transition-colors hover:bg-amber-100"><Edit3 size={12} /> Reprendre</button>
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-50 text-stone-300 transition-all group-hover:bg-[#E07A5F] group-hover:text-white"><ArrowRight size={16} /></div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredFiles.length === 0 && (
              <div className="rounded-2xl border border-dashed border-stone-200 bg-white py-10 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-stone-50 text-stone-300"><Search size={22} /></div>
                <p className="text-sm font-medium text-stone-500">{showArchived ? 'Aucun patient archivé.' : searchQuery ? `Aucun patient trouvé pour "${searchQuery}".` : 'Aucun patient enregistré pour le moment.'}</p>
                {!showArchived && <button onClick={() => setIsNewPatientChoiceOpen(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#E07A5F]/30 bg-[#E07A5F]/5 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#E07A5F] transition-colors hover:bg-[#E07A5F] hover:text-white"><Plus size={14} /> Nouveau patient</button>}
              </div>
            )}

            {hasMorePatients && !showArchived && (
              <div className="flex justify-center pt-4">
                <button onClick={() => onLoadMorePatients && onLoadMorePatients()} disabled={isLoadingMorePatients || !onLoadMorePatients} className="rounded-xl border border-stone-200 px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest text-stone-500 transition-all hover:border-[#3D405B] hover:bg-white hover:text-[#3D405B] disabled:opacity-50">
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
