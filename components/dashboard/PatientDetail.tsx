import React, { Suspense, useEffect, useMemo, useState } from 'react';
import type { PatientAssessment, PatientFile, PatientFollowup, ScoreResult } from '../../types';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Calendar,
  ChevronRight,
  BellOff,
  FileText,
  History,
  TrendingUp,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { StorageService } from '../../services/storage';
import { useToast } from '../../contexts/ToastContext';
import { useCatalog } from '../../contexts/CatalogContext';

const PatientEvolutionChart = React.lazy(() =>
  import('./PatientEvolutionChart').then((module) => ({ default: module.PatientEvolutionChart })),
);

interface Props {
  file: PatientFile;
  onBack: () => void;
  onDelete?: (patientId: string) => void;
  onNewBilan: (type: 'initial' | 'reevaluation' | 'historique') => void;
  onOpenReport: (reportId: string) => void;
  draftAvailable?: boolean;
  onResumeDraft?: () => void;
  hasMoreHistory?: boolean;
  isLoadingMoreHistory?: boolean;
  onLoadMoreHistory?: () => void;
  onFollowupChange?: (followup: PatientFollowup | null) => void;
}

const kindLabel: Record<PatientAssessment['kind'], string> = {
  initial: 'Bilan initial',
  reevaluation: 'Réévaluation',
};

const followupLabel: Record<PatientFollowup['status'], string> = {
  upcoming: 'À venir',
  due: 'À planifier',
  overdue: 'En retard',
  scheduled: 'Planifie',
  completed: 'Complété',
  snoozed: 'Reporte',
};

const followupTone: Record<PatientFollowup['status'], string> = {
  upcoming: 'border-blue-200 bg-blue-50 text-blue-700',
  due: 'border-amber-200 bg-amber-50 text-amber-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  scheduled: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  snoozed: 'border-[var(--border-color)] bg-[var(--hover-bg)] text-[var(--text-main)]',
};

const addMonths = (dateIso: string, months: number): string => {
  const base = new Date(dateIso);
  if (Number.isNaN(base.getTime())) return new Date().toISOString();
  base.setMonth(base.getMonth() + months);
  return base.toISOString();
};

const deriveTemporalStatus = (dueAt: string): PatientFollowup['status'] => {
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) return 'upcoming';
  const overdueDate = new Date(dueDate);
  overdueDate.setMonth(overdueDate.getMonth() + 6);
  const now = Date.now();
  if (now < dueDate.getTime()) return 'upcoming';
  if (now <= overdueDate.getTime()) return 'due';
  return 'overdue';
};

const parseScoreValue = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
};

const computeAverage = (results?: Record<string, ScoreResult>): number | null => {
  if (!results) return null;
  const valid = Object.values(results).filter(
    (item) => item.reviewState === 'reviewed' || item.status === 'validated' || item.status === 'certified',
  );
  const nums = valid
    .map((item) => parseScoreValue(item.standard) ?? parseScoreValue(item.raw))
    .filter((value): value is number => value !== null);
  if (nums.length === 0) return null;
  return nums.reduce((acc, value) => acc + value, 0) / nums.length;
};

const DeleteConfirmationModal: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  const [input, setInput] = useState('');
  const isValid = input.toLowerCase() === 'supprimer';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--secondary)]/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-[32px] bg-[var(--card-bg)] p-8 text-center shadow-2xl">
        <button onClick={onCancel} className="absolute right-6 top-6 text-[var(--text-disabled)] hover:text-[var(--text-secondary)]">
          <X size={24} />
        </button>
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <Trash2 size={32} />
        </div>
        <h3 className="mb-2 font-serif text-2xl font-bold text-[var(--text-heading)]">Zone de danger</h3>
        <p className="mb-6 text-sm text-[var(--text-secondary)]">Tapez "supprimer" pour confirmer la suppression définitive.</p>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="w-full rounded-xl border-2 border-[var(--input-border)] p-4 text-center font-bold text-rose-500 outline-none focus:border-rose-500 bg-[var(--input-bg)]"
          placeholder="supprimer"
        />
        <div className="mt-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-xl py-3 font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]">
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={!isValid}
            className={`flex-1 rounded-xl py-3 font-bold text-white ${isValid ? 'bg-rose-500 hover:bg-rose-600' : 'cursor-not-allowed bg-[var(--card-bg-raised)] text-[var(--text-disabled)]'}`}
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
};

export const PatientDetail: React.FC<Props> = ({
  file,
  onBack,
  onDelete,
  onNewBilan,
  onOpenReport,
  draftAvailable,
  onResumeDraft,
  hasMoreHistory = false,
  isLoadingMoreHistory = false,
  onLoadMoreHistory,
  onFollowupChange,
}) => {
  const toast = useToast();
  const { catalog } = useCatalog();
  const subtestNameMap = useMemo(() =>
    new Map(catalog.flatMap(c => c.tests.flatMap(t =>
      t.subtests.map(s => [s.id, s.displayName ?? s.name])
    ))),
  [catalog]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFollowupBusy, setIsFollowupBusy] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'formal'>('all');
  const [followupState, setFollowupState] = useState<PatientFollowup | null>(file.followup || null);

  const assessments = useMemo(
    () => [...(file.assessments || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [file.assessments],
  );

  const formalAssessments = useMemo(() => assessments.filter((item) => item.hasFormalReport), [assessments]);
  const chartData = useMemo(() => {
    return assessments
      .map((item) => ({ date: new Date(item.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), score: computeAverage(item.results), label: item.testName || kindLabel[item.kind] }))
      .filter((item) => item.score !== null);
  }, [assessments]);

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'formal') return formalAssessments;
    return assessments;
    return assessments;
  }, [assessments, formalAssessments, timelineFilter]);

  useEffect(() => {
    setFollowupState(file.followup || null);
  }, [file.followup]);

  const fallbackFollowup = useMemo(() => {
    const lastFormal = formalAssessments[0];
    if (!lastFormal) return null;
    const dueAt = addMonths(lastFormal.date, 6);
    return {
      id: `fallback-${file.id}`,
      patientId: file.id,
      organizationId: null,
      status: deriveTemporalStatus(dueAt),
      dueAt,
      snoozedUntil: null,
      note: null,
      createdAt: lastFormal.date,
      updatedAt: lastFormal.date,
    } satisfies PatientFollowup;
  }, [formalAssessments, file.id]);

  const followup = followupState || fallbackFollowup;

  const latestFormalIsReevaluation = formalAssessments[0]?.kind === 'reevaluation';

  const matrixSnapshots = useMemo(
    () => assessments.filter((item) => item.results && Object.keys(item.results).length > 0).slice(0, 4),
    [assessments],
  );

  const matrixRows = useMemo(() => {
    const rowIds: string[] = [];
    matrixSnapshots.forEach((snapshot) => {
      Object.keys(snapshot.results || {}).forEach((subtestId) => {
        if (!rowIds.includes(subtestId)) rowIds.push(subtestId);
      });
    });
    return rowIds.slice(0, 12);
  }, [matrixSnapshots]);

  const getScoreValue = (result?: ScoreResult) => {
    if (!result) return '-';
    if (result.standard && result.standard.trim() !== '') return result.standard;
    if (result.raw && result.raw.trim() !== '') return result.raw;
    return '-';
  };

  const refreshFollowup = async () => {
    const latest = await StorageService.getPatientFollowup(file.id);
    setFollowupState(latest);
    if (onFollowupChange) onFollowupChange(latest);
  };

  const handleScheduleFollowup = async () => {
    setIsFollowupBusy(true);
    try {
      await StorageService.upsertPatientFollowup({
        patientId: file.id,
        status: 'scheduled',
        dueAt: followup?.dueAt || addMonths(new Date().toISOString(), 1),
        note: 'Rappel planifie depuis la fiche patient',
      });
      await refreshFollowup();
      toast.success('Rappel planifie.');
    } catch {
      toast.error('Impossible de planifier le rappel.');
    } finally {
      setIsFollowupBusy(false);
    }
  };

  const handleSnoozeFollowup = async () => {
    const snoozedUntil = addMonths(new Date().toISOString(), 1);
    setIsFollowupBusy(true);
    try {
      if (followupState) {
        await StorageService.snoozeFollowup(file.id, snoozedUntil);
      } else {
        await StorageService.upsertPatientFollowup({
          patientId: file.id,
          status: 'snoozed',
          dueAt: followup?.dueAt || addMonths(new Date().toISOString(), 6),
          snoozedUntil,
          note: 'Rappel reporte depuis la fiche patient',
        });
      }
      await refreshFollowup();
      toast.success('Rappel reporte d un mois.');
    } catch {
      toast.error('Impossible de reporter le rappel.');
    } finally {
      setIsFollowupBusy(false);
    }
  };

  const handleMarkFollowupCompleted = async () => {
    if (!latestFormalIsReevaluation) return;
    setIsFollowupBusy(true);
    try {
      if (followupState) {
        await StorageService.markFollowupCompleted(file.id);
      } else {
        await StorageService.upsertPatientFollowup({
          patientId: file.id,
          status: 'completed',
          dueAt: followup?.dueAt || addMonths(new Date().toISOString(), 6),
          note: 'Rappel clôturé après réévaluation formelle',
        });
      }
      await refreshFollowup();
      toast.success('Rappel marqué comme complété.');
    } catch {
      toast.error('Impossible de mettre à jour le rappel.');
    } finally {
      setIsFollowupBusy(false);
    }
  };

  const handleArchive = async () => {
    setIsProcessing(true);
    try {
      await StorageService.toggleArchive(file);
      onBack();
    } catch {
      toast.error('Erreur lors de la mise à jour.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    setIsProcessing(true);
    try {
      await StorageService.deleteFile(file.id);
      onDelete?.(file.id);
      onBack();
    } catch {
      toast.error('Erreur lors de la suppression.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl animate-in slide-in-from-right px-6 py-10 duration-500">
      <button onClick={onBack} className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-heading)]">
        <ArrowLeft size={16} /> Retour Dashboard
      </button>

      {draftAvailable && (
        <div className="mb-8 flex items-center justify-between rounded-xl border-l-4 border-amber-400 bg-amber-50 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-amber-500" />
            <div>
              <p className="text-sm font-bold text-amber-900">Brouillon non termine</p>
              <p className="text-xs text-amber-700">Un travail est en cours pour ce patient.</p>
            </div>
          </div>
          <button onClick={onResumeDraft} className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold uppercase text-white hover:bg-amber-600">
            Reprendre
          </button>
        </div>
      )}

      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="font-serif text-4xl font-bold text-[var(--text-heading)]">{file.patient.firstName} {file.patient.lastName}</h1>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">{file.patient.age || '-'} • {file.patient.classLevel || 'Classe non renseignée'}</p>
          {followup && <p className="mt-2 text-sm font-semibold text-[var(--text-heading)]">Rappel réévaluation : {followupLabel[followup.status]} (échéance {new Date(followup.dueAt).toLocaleDateString('fr-FR')})</p>}
        </div>
        <div className="flex gap-3">
          <button onClick={() => onNewBilan('historique')} className="flex items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-4 text-sm font-bold text-[var(--text-main)] hover:bg-[var(--hover-bg)]">
            <History size={16} /> Importer bilan antérieur
          </button>
          <button onClick={() => onNewBilan('reevaluation')} className="flex items-center gap-2 rounded-2xl bg-[var(--secondary)] px-8 py-4 text-sm font-bold text-white hover:brightness-90">
            <Zap size={18} className="text-[#F2CC8F]" /> Réévaluation 1 clic
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <div className="rounded-[32px] border border-[var(--border-color)] bg-[var(--card-bg)] p-8 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-bold text-[var(--text-heading)]"><TrendingUp size={22} className="text-[var(--primary)]" /> Evolution</h2>
            {chartData.length >= 3 ? (
              <div className="h-[280px] w-full">
                <Suspense fallback={<div className="h-full w-full rounded-lg bg-[var(--hover-bg)] animate-pulse" />}>
                  <PatientEvolutionChart data={chartData} />
                </Suspense>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">Pas assez de points comparables (minimum 3) pour afficher une courbe pertinente.</p>
            )}
          </div>

          <div className="rounded-[32px] border border-[var(--border-color)] bg-[var(--card-bg)] p-8 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-bold text-[var(--text-heading)]"><FileText size={20} className="text-[var(--text-heading)]" /> Matrice résultats multi-tests</h2>
            {matrixSnapshots.length === 0 || matrixRows.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">Aucun jeu de scores exploitable pour afficher la matrice.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-[var(--card-bg)] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Sous-test</th>
                      {matrixSnapshots.map((snapshot) => (
                        <th key={snapshot.id} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                          {new Date(snapshot.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((subtestId) => (
                      <tr key={subtestId} className="odd:bg-[var(--hover-bg)]">
                        <td className="sticky left-0 bg-inherit px-3 py-2 text-xs font-semibold text-[var(--text-heading)]">{subtestNameMap.get(subtestId) ?? subtestId}</td>
                        {matrixSnapshots.map((snapshot) => (
                          <td key={`${snapshot.id}-${subtestId}`} className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                            {getScoreValue(snapshot.results?.[subtestId])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] p-5">
              <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-[var(--text-heading)]"><Calendar size={22} /> Evenements cliniques</h2>
              <div className="flex gap-2">
                {(['all', 'formal'] as const).map((tab) => (
                  <button key={tab} onClick={() => setTimelineFilter(tab)} className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${timelineFilter === tab ? 'border-[var(--secondary)] bg-[var(--secondary)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
                    {tab === 'all' ? 'Tout' : 'Formels'}
                  </button>
                ))}
              </div>
            </div>
            {filteredTimeline.length === 0 ? (
              <p className="p-8 text-center text-sm text-[var(--text-secondary)]">Aucun evenement.</p>
            ) : (
              <div className="divide-y divide-[var(--border-color)]">
                {filteredTimeline.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-5">
                    <div>
                      <p className="text-sm font-bold text-[var(--text-heading)]">{kindLabel[item.kind]}</p>
                      <p className="text-xs text-[var(--text-secondary)]">{new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })} • {item.testName || 'Sans libelle'}</p>
                    </div>
                    {item.hasFormalReport ? (
                      <button onClick={() => onOpenReport(item.id)} className="flex items-center gap-2 rounded-lg bg-[var(--primary)]/10 px-3 py-1 text-[10px] font-bold uppercase text-[var(--primary)]">
                        <FileText size={12} /> Document
                      </button>
                    ) : (
                      <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">{Object.keys(item.results || {}).length} scores</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {hasMoreHistory && onLoadMoreHistory && (
            <div className="flex justify-center">
              <button onClick={onLoadMoreHistory} disabled={isLoadingMoreHistory} className="rounded-xl border border-[var(--border-color)] px-6 py-3 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-heading)] disabled:opacity-50">
                {isLoadingMoreHistory ? 'Chargement...' : 'Charger plus'}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="font-serif text-lg font-bold text-[var(--text-heading)]">Documents formels</h3>
            {formalAssessments.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-xs text-[var(--text-secondary)]">Aucun document formel.</p>
            ) : (
              formalAssessments.map((item) => (
                <button key={item.id} onClick={() => onOpenReport(item.id)} className="flex w-full items-center justify-between rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-left hover:border-[var(--primary)]">
                  <div>
                    <p className="text-sm font-bold text-[var(--text-heading)]">{kindLabel[item.kind]}</p>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)]">{new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                  </div>
                  <ChevronRight size={16} className="text-[var(--text-disabled)]" />
                </button>
              ))
            )}
          </div>

          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Rappel reevaluation</h4>
            {followup ? (
              <div className="space-y-4">
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${followupTone[followup.status]}`}>
                  <Clock3 size={12} />
                  {followupLabel[followup.status]}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  <p>Échéance : <span className="font-bold text-[var(--text-heading)]">{new Date(followup.dueAt).toLocaleDateString('fr-FR')}</span></p>
                  {followup.snoozedUntil && <p>Reporté jusqu'au : <span className="font-bold text-[var(--text-heading)]">{new Date(followup.snoozedUntil).toLocaleDateString('fr-FR')}</span></p>}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <button onClick={handleScheduleFollowup} disabled={isFollowupBusy} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                    <Calendar size={12} /> Planifier
                  </button>
                  <button onClick={handleSnoozeFollowup} disabled={isFollowupBusy} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-main)] hover:bg-[var(--hover-bg)] disabled:opacity-60">
                    <BellOff size={12} /> Reporter 1 mois
                  </button>
                  {latestFormalIsReevaluation && (
                    <button onClick={handleMarkFollowupCompleted} disabled={isFollowupBusy} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-[var(--card-bg)] py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                      <CheckCircle2 size={12} /> Marquer complete
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-xs text-[var(--text-secondary)]">Aucun rappel actif. Creez un bilan formel pour demarrer le suivi.</p>
            )}
          </div>

          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Actions dossier</h4>
            <div className="space-y-3">
              <button onClick={handleArchive} disabled={isProcessing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--progress-bg)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--border-color)]">
                {file.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                {file.archived ? 'Désarchiver' : 'Archiver'}
              </button>
              <button onClick={() => setShowDeleteModal(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-100 bg-[var(--card-bg)] py-3 text-xs font-bold uppercase tracking-wider text-rose-500 hover:bg-rose-50">
                <Trash2 size={16} /> Supprimer
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteModal && <DeleteConfirmationModal onConfirm={handleDelete} onCancel={() => setShowDeleteModal(false)} />}
    </div>
  );
};
