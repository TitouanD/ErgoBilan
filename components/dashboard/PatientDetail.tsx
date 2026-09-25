import React, { useEffect, useMemo, useState } from 'react';
import type { Patient, PatientAssessment, PatientFile, PatientFollowup } from '../../types';
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowLeft, CheckCircle2, Clock3, Calendar, BellOff, Edit3, FileText, GraduationCap, Mail, MapPin, Pencil, Phone, Save, Stethoscope, Trash2, User, Users, Zap
} from 'lucide-react';
import { StorageService } from '../../services/storage';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';
import { getPatientAgeForIdentity } from '../../utils/patient';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

interface Props {
  file: PatientFile;
  onBack: () => void;
  onDelete?: (patientId: string) => void;
  onNewBilan: (type: 'initial' | 'reevaluation' | 'historique') => void;
  onOpenReport: (reportId: string) => void;
  draftAvailable?: boolean;
  draftReportType?: 'initial' | 'reevaluation' | 'historique' | null;
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

export const PatientDetail: React.FC<Props> = ({
  file,
  onBack,
  onDelete,
  onNewBilan,
  onOpenReport,
  draftAvailable,
  draftReportType,
  onResumeDraft,
  hasMoreHistory = false,
  isLoadingMoreHistory = false,
  onLoadMoreHistory,
  onFollowupChange,
}) => {
  const toast = useToast();

  // ── local patient state (editable inline without reloading parent) ───────
  const [localPatient, setLocalPatient] = useState<Patient>(file.patient);
  const [editingSection, setEditingSection] = useState<'identity' | 'school' | 'family' | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Patient>>({});
  const [isSavingProfile, setIsSavingProfile] = useState(false);

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

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'formal') return formalAssessments;
    return assessments;
  }, [assessments, formalAssessments, timelineFilter]);

  useEffect(() => {
    setFollowupState(file.followup || null);
  }, [file.followup]);

  useEffect(() => {
    setLocalPatient(file.patient);
  }, [file.patient]);

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

  const refreshFollowup = async () => {
    const latest = await StorageService.getPatientFollowup(file.id);
    setFollowupState(latest);
    if (onFollowupChange) onFollowupChange(latest);
  };

  // ── Profile inline edit helpers ──────────────────────────────────────────
  const startEdit = (section: 'identity' | 'school' | 'family') => {
    setEditingSection(section);
    setEditDraft({ ...localPatient });
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setEditDraft({});
  };

  const saveEdit = async () => {
    if (!file.id) return;
    setIsSavingProfile(true);
    try {
      const merged: Patient = { ...localPatient, ...editDraft };
      merged.age = getPatientAgeForIdentity(merged);
      await StorageService.syncPatientIdentityPreview(file.id, merged);
      setLocalPatient(merged);
      setEditingSection(null);
      setEditDraft({});
      toast.success('Profil mis à jour.');
    } catch (e) {
      Logger.error('DB', 'Patient identity update failed', e, { patientId: file.id });
      toast.error('Impossible de sauvegarder les modifications.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const updateDraft = (updates: Partial<Patient>) => setEditDraft(prev => ({ ...prev, ...updates }));

  // ── Followup handlers ────────────────────────────────────────────────────
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
    } catch (e) {
      Logger.error('DB', 'Followup scheduling failed', e, { patientId: file.id });
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
    } catch (e) {
      Logger.error('DB', 'Followup snooze failed', e, { patientId: file.id });
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
    } catch (e) {
      Logger.error('DB', 'Followup completion failed', e, { patientId: file.id });
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
    } catch (e) {
      Logger.error('DB', 'Patient archive toggle failed', e, { patientId: file.id });
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
    } catch (e) {
      Logger.error('DB', 'Patient deletion failed', e, { patientId: file.id });
      toast.error('Erreur lors de la suppression.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Shared style helpers ─────────────────────────────────────────────────
  const inputCls = 'w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all';
  const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1';
  const emptyVal = <span className="text-[var(--text-disabled)] italic text-xs">Non renseigné</span>;

  const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; sectionKey: 'identity' | 'school' | 'family' }> = ({ icon, title, sectionKey }) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        {icon}
        <h3 className="text-[10px] font-bold uppercase tracking-widest">{title}</h3>
      </div>
      {editingSection !== sectionKey && (
        <button onClick={() => startEdit(sectionKey)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-heading)] transition-colors">
          <Pencil size={11} /> Modifier
        </button>
      )}
    </div>
  );

  const EditActions: React.FC = () => (
    <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--border-color)]">
      <button onClick={saveEdit} disabled={isSavingProfile} className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-bold text-white hover:brightness-90 disabled:opacity-60 transition-all">
        <Save size={12} /> Enregistrer
      </button>
      <button onClick={cancelEdit} className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-all">
        Annuler
      </button>
    </div>
  );

  const displayAge = getPatientAgeForIdentity(localPatient);

  return (
    <div className="mx-auto max-w-7xl animate-in slide-in-from-right px-6 py-10 duration-500">
      {/* Back */}
      <button onClick={onBack} className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-heading)]">
        <ArrowLeft size={16} /> Retour Dashboard
      </button>

      {/* Draft banners */}
      {draftAvailable && draftReportType === 'reevaluation' && (
        <div className="mb-6 flex items-center justify-between rounded-xl border-l-4 border-[var(--secondary)] bg-[var(--secondary)]/10 p-4">
          <div className="flex items-center gap-3">
            <Zap size={20} className="text-[var(--secondary)] shrink-0" />
            <div>
              <p className="text-sm font-bold text-[var(--text-heading)]">Réévaluation en cours</p>
              <p className="text-xs text-[var(--text-secondary)]">Un brouillon de réévaluation est disponible.</p>
            </div>
          </div>
          <button onClick={onResumeDraft} className="rounded-lg bg-[var(--secondary)] px-5 py-2 text-xs font-bold uppercase text-white hover:brightness-90">Reprendre</button>
        </div>
      )}
      {draftAvailable && draftReportType !== 'reevaluation' && (
        <div className="mb-6 flex items-center justify-between rounded-xl border-l-4 border-amber-400 bg-amber-50 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-amber-500" />
            <div>
              <p className="text-sm font-bold text-amber-900">Brouillon non terminé</p>
              <p className="text-xs text-amber-700">Un travail est en cours pour ce patient.</p>
            </div>
          </div>
          <button onClick={onResumeDraft} className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold uppercase text-white hover:bg-amber-600">Reprendre</button>
        </div>
      )}

      {/* Page header */}
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="font-serif text-4xl font-bold text-[var(--text-heading)]">
            {localPatient.firstName} {localPatient.lastName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {displayAge && <span className="rounded-full bg-[var(--hover-bg)] px-3 py-1 text-xs font-bold text-[var(--text-secondary)]">{displayAge}</span>}
            {localPatient.gender && <span className="rounded-full bg-[var(--hover-bg)] px-3 py-1 text-xs font-bold text-[var(--text-secondary)]">{localPatient.gender === 'M' ? 'Garçon' : 'Fille'}</span>}
            {localPatient.classLevel && <span className="rounded-full bg-[var(--hover-bg)] px-3 py-1 text-xs font-bold text-[var(--text-secondary)]">{localPatient.classLevel}</span>}
            {followup && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${followupTone[followup.status]}`}>
                <Clock3 size={10} /> Rééval. {followupLabel[followup.status]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

        {/* ── LEFT column ── */}
        <div className="space-y-6 lg:col-span-2">

          {/* ── PROFIL PATIENT ── */}
          <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] divide-y divide-[var(--border-color)] overflow-hidden shadow-sm">

            {/* Section Identité */}
            <div className="p-6">
              <SectionHeader icon={<User size={14} />} title="Identité" sectionKey="identity" />
              {editingSection === 'identity' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Prénom</label>
                      <input className={inputCls} value={editDraft.firstName ?? ''} onChange={e => updateDraft({ firstName: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Nom</label>
                      <input className={inputCls} value={editDraft.lastName ?? ''} onChange={e => updateDraft({ lastName: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Date de naissance</label>
                      <input type="date" className={inputCls} value={editDraft.dob ?? ''} max={new Date().toISOString().slice(0, 10)} onChange={e => updateDraft({ dob: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Genre</label>
                      <div className="flex gap-5 pt-2.5">
                        {(['M', 'F'] as const).map(g => (
                          <label key={g} className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]">
                            <input type="radio" name="edit-gender" value={g} checked={editDraft.gender === g} onChange={() => updateDraft({ gender: g })} className="accent-[var(--primary)] w-4 h-4" />
                            {g === 'M' ? 'Garçon' : 'Fille'}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Adresse</label>
                    <input className={inputCls} value={editDraft.address ?? ''} onChange={e => updateDraft({ address: e.target.value })} placeholder="Adresse postale" />
                  </div>
                  <EditActions />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <div>
                    <span className={labelCls}>Date de naissance</span>
                    {localPatient.dob ? (
                      <span className="font-medium text-[var(--text-main)]">
                        {(() => { const m = localPatient.dob.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : localPatient.dob; })()}
                      </span>
                    ) : emptyVal}
                  </div>
                  <div>
                    <span className={labelCls}>Genre</span>
                    {localPatient.gender ? <span className="font-medium text-[var(--text-main)]">{localPatient.gender === 'M' ? 'Garçon' : 'Fille'}</span> : emptyVal}
                  </div>
                  {localPatient.address && (
                    <div className="col-span-2 flex items-start gap-2">
                      <MapPin size={13} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
                      <span className="text-[var(--text-main)]">{localPatient.address}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section École */}
            <div className="p-6">
              <SectionHeader icon={<GraduationCap size={14} />} title="Scolarité" sectionKey="school" />
              {editingSection === 'school' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Établissement</label>
                      <input className={inputCls} value={editDraft.school ?? ''} onChange={e => updateDraft({ school: e.target.value })} placeholder="Nom de l'école" />
                    </div>
                    <div>
                      <label className={labelCls}>Classe</label>
                      <input className={inputCls} value={editDraft.classLevel ?? ''} onChange={e => updateDraft({ classLevel: e.target.value })} placeholder="ex. CM2, 6ème…" />
                    </div>
                    <div>
                      <label className={labelCls}>Type d'établissement</label>
                      <input className={inputCls} value={editDraft.schoolType ?? ''} onChange={e => updateDraft({ schoolType: e.target.value })} placeholder="Privé, Public…" />
                    </div>
                    <div>
                      <label className={labelCls}>Enseignant(e)</label>
                      <input className={inputCls} value={editDraft.teacher ?? ''} onChange={e => updateDraft({ teacher: e.target.value })} placeholder="Nom de l'enseignant" />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>AVS / AESH</label>
                      <div className="flex gap-5 pt-1">
                        {(['Oui', 'Non', 'En cours'] as const).map(v => (
                          <label key={v} className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]">
                            <input type="radio" name="edit-avs" value={v} checked={editDraft.avs === v} onChange={() => updateDraft({ avs: v })} className="accent-[var(--primary)] w-4 h-4" />
                            {v}
                          </label>
                        ))}
                      </div>
                    </div>
                    {(editDraft.avs === 'Oui' || editDraft.avs === 'En cours') && (
                      <div className="col-span-2">
                        <label className={labelCls}>Détails AESH</label>
                        <input className={inputCls} value={editDraft.avsDetails ?? ''} onChange={e => updateDraft({ avsDetails: e.target.value })} placeholder="Temps plein, partiel…" />
                      </div>
                    )}
                  </div>
                  <EditActions />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <div>
                    <span className={labelCls}>Établissement</span>
                    {localPatient.school ? <span className="font-medium text-[var(--text-main)]">{localPatient.school}</span> : emptyVal}
                  </div>
                  <div>
                    <span className={labelCls}>Classe</span>
                    {localPatient.classLevel ? <span className="font-medium text-[var(--text-main)]">{localPatient.classLevel}</span> : emptyVal}
                  </div>
                  {localPatient.teacher && (
                    <div>
                      <span className={labelCls}>Enseignant(e)</span>
                      <span className="font-medium text-[var(--text-main)]">{localPatient.teacher}</span>
                    </div>
                  )}
                  <div>
                    <span className={labelCls}>AESH</span>
                    {localPatient.avs ? (
                      <span className="font-medium text-[var(--text-main)]">{localPatient.avs}{localPatient.avsDetails ? ` — ${localPatient.avsDetails}` : ''}</span>
                    ) : emptyVal}
                  </div>
                </div>
              )}
            </div>

            {/* Section Famille */}
            <div className="p-6">
              <SectionHeader icon={<Users size={14} />} title="Famille" sectionKey="family" />
              {editingSection === 'family' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Responsable légal 1</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Nom</label>
                        <input className={inputCls} value={editDraft.parent1Name ?? ''} onChange={e => updateDraft({ parent1Name: e.target.value })} placeholder="Nom complet" />
                      </div>
                      <div>
                        <label className={labelCls}>Téléphone</label>
                        <input type="tel" className={inputCls} value={editDraft.parent1Phone ?? ''} onChange={e => updateDraft({ parent1Phone: e.target.value })} placeholder="06 XX XX XX XX" />
                      </div>
                      <div className="col-span-2">
                        <label className={labelCls}>Email</label>
                        <input type="email" className={inputCls} value={editDraft.parent1Email ?? ''} onChange={e => updateDraft({ parent1Email: e.target.value })} placeholder="email@exemple.fr" />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mt-2">Responsable légal 2</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Nom</label>
                        <input className={inputCls} value={editDraft.parent2Name ?? ''} onChange={e => updateDraft({ parent2Name: e.target.value })} placeholder="Nom complet" />
                      </div>
                      <div>
                        <label className={labelCls}>Téléphone</label>
                        <input type="tel" className={inputCls} value={editDraft.parent2Phone ?? ''} onChange={e => updateDraft({ parent2Phone: e.target.value })} placeholder="06 XX XX XX XX" />
                      </div>
                      <div className="col-span-2">
                        <label className={labelCls}>Email</label>
                        <input type="email" className={inputCls} value={editDraft.parent2Email ?? ''} onChange={e => updateDraft({ parent2Email: e.target.value })} placeholder="email@exemple.fr" />
                      </div>
                    </div>
                  </div>
                  <EditActions />
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  {(localPatient.parent1Name || localPatient.parent1Phone || localPatient.parent1Email) ? (
                    <div className="flex flex-col gap-1">
                      {localPatient.parent1Name && <span className="font-semibold text-[var(--text-main)]">{localPatient.parent1Name}</span>}
                      {localPatient.parent1Phone && (
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Phone size={12} /> {localPatient.parent1Phone}</span>
                      )}
                      {localPatient.parent1Email && (
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Mail size={12} /> {localPatient.parent1Email}</span>
                      )}
                    </div>
                  ) : emptyVal}
                  {(localPatient.parent2Name || localPatient.parent2Phone || localPatient.parent2Email) && (
                    <div className="flex flex-col gap-1 pt-2 border-t border-[var(--border-color)]">
                      {localPatient.parent2Name && <span className="font-semibold text-[var(--text-main)]">{localPatient.parent2Name}</span>}
                      {localPatient.parent2Phone && (
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Phone size={12} /> {localPatient.parent2Phone}</span>
                      )}
                      {localPatient.parent2Email && (
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Mail size={12} /> {localPatient.parent2Email}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section Contexte clinique (conditionnel) */}
            {(localPatient.medicalDiagnosis || localPatient.reason) && (
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4 text-[var(--text-secondary)]">
                  <Stethoscope size={14} />
                  <h3 className="text-[10px] font-bold uppercase tracking-widest">Contexte clinique</h3>
                </div>
                <div className="space-y-3 text-sm">
                  {localPatient.medicalDiagnosis && (
                    <div>
                      <span className={labelCls}>Diagnostic</span>
                      <p className="text-[var(--text-main)]">{localPatient.medicalDiagnosis}</p>
                    </div>
                  )}
                  {localPatient.reason && (
                    <div>
                      <span className={labelCls}>Motif de consultation</span>
                      <p className="text-[var(--text-main)]">{localPatient.reason}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── HISTORIQUE DES BILANS ── */}
          <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] p-5">
              <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-[var(--text-heading)]">
                <FileText size={20} className="text-[var(--primary)]" /> Historique des bilans
              </h2>
              <div className="flex gap-2">
                {(['all', 'formal'] as const).map((tab) => (
                  <button key={tab} onClick={() => setTimelineFilter(tab)} className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase transition-colors ${timelineFilter === tab ? 'border-[var(--secondary)] bg-[var(--secondary)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-heading)]'}`}>
                    {tab === 'all' ? 'Tout' : 'Formels'}
                  </button>
                ))}
              </div>
            </div>

            {filteredTimeline.length === 0 ? (
              <p className="p-8 text-center text-sm text-[var(--text-secondary)] italic">Aucun bilan enregistré.</p>
            ) : (
              <div className="divide-y divide-[var(--border-color)]">
                {filteredTimeline.map((item) => (
                  <div key={item.id} className={`flex items-center justify-between p-5 transition-colors ${item.hasFormalReport ? 'hover:bg-[var(--hover-bg)]' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.hasFormalReport ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'bg-[var(--hover-bg)] text-[var(--text-secondary)]'}`}>
                        <FileText size={15} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[var(--text-heading)]">{kindLabel[item.kind]}</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                          {item.testName && <span className="ml-1.5 text-[var(--text-disabled)]">· {item.testName}</span>}
                        </p>
                      </div>
                    </div>
                    {item.hasFormalReport ? (
                      <button onClick={() => onOpenReport(item.id)} className="flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white hover:brightness-90 transition-all">
                        <FileText size={11} /> Voir le rapport
                      </button>
                    ) : (
                      <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-bold uppercase text-[var(--text-secondary)]">
                        {Object.keys(item.results || {}).length} scores
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {hasMoreHistory && onLoadMoreHistory && (
              <div className="border-t border-[var(--border-color)] p-4 flex justify-center">
                <button onClick={onLoadMoreHistory} disabled={isLoadingMoreHistory} className="rounded-xl border border-[var(--border-color)] px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-heading)] disabled:opacity-50 transition-colors">
                  {isLoadingMoreHistory ? 'Chargement…' : 'Charger plus'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT sidebar ── */}
        <div className="space-y-6">

          {/* Actions */}
          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Actions</h4>
            <div className="space-y-3">
              {draftAvailable && draftReportType === 'reevaluation' ? (
                <button onClick={onResumeDraft} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--secondary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:brightness-90">
                  <Zap size={14} className="text-[#F2CC8F]" /> Reprendre la réévaluation
                </button>
              ) : draftAvailable ? (
                <button onClick={onResumeDraft} className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-amber-600">
                  <Edit3 size={14} /> Reprendre le bilan
                </button>
              ) : formalAssessments.length > 0 ? (
                <button onClick={() => onNewBilan('reevaluation')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--secondary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:brightness-90">
                  <Zap size={14} className="text-[#F2CC8F]" /> Réévaluation 1 clic
                </button>
              ) : (
                <button onClick={() => onNewBilan('initial')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--secondary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:brightness-90">
                  <Edit3 size={14} /> Commencer le bilan initial
                </button>
              )}
            </div>
          </div>

          {/* Rappel réévaluation */}
          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Rappel réévaluation</h4>
            {followup ? (
              <div className="space-y-4">
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${followupTone[followup.status]}`}>
                  <Clock3 size={12} />
                  {followupLabel[followup.status]}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  <p>Échéance : <span className="font-bold text-[var(--text-heading)]">{new Date(followup.dueAt).toLocaleDateString('fr-FR')}</span></p>
                  {followup.snoozedUntil && <p className="mt-0.5">Reporté jusqu'au : <span className="font-bold text-[var(--text-heading)]">{new Date(followup.snoozedUntil).toLocaleDateString('fr-FR')}</span></p>}
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
                      <CheckCircle2 size={12} /> Marquer complété
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-xs text-[var(--text-secondary)] italic">Aucun rappel actif. Créez un bilan formel pour démarrer le suivi.</p>
            )}
          </div>

          {/* Actions dossier */}
          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Dossier</h4>
            <div className="space-y-3">
              <button onClick={handleArchive} disabled={isProcessing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--progress-bg)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--border-color)]">
                {file.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                {file.archived ? 'Désarchiver' : 'Archiver'}
              </button>
              <button onClick={() => setShowDeleteModal(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-100 bg-[var(--card-bg)] py-3 text-xs font-bold uppercase tracking-wider text-rose-500 hover:bg-rose-50">
                <Trash2 size={14} /> Supprimer
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteModal && <DeleteConfirmationModal onConfirm={handleDelete} onCancel={() => setShowDeleteModal(false)} />}
    </div>
  );
};
