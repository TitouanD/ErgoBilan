import React, { useEffect, useMemo, useState } from 'react';
import type { PatientFile } from '../../types';
import { Command, FilePenLine, Plus, Search, UserRound } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientFiles: PatientFile[];
  draftsIndex: Record<string, string>;
  onOpenPatient: (patientId: string) => void;
  onOpenNewPatientChoice: () => void;
  onResumeDraft?: (patientId: string) => void;
}

interface PaletteAction {
  id: string;
  label: string;
  description: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onSelect: () => void;
}

const getPatientName = (file: PatientFile) => `${file.patient.firstName} ${file.patient.lastName}`.trim();

export const CommandPalette: React.FC<Props> = ({
  isOpen,
  onClose,
  patientFiles,
  draftsIndex,
  onOpenPatient,
  onOpenNewPatientChoice,
  onResumeDraft,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  const latestDraftPatientId = useMemo(() => {
    const ranked = Object.entries(draftsIndex)
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
      .map(([patientId]) => patientId);
    return ranked[0];
  }, [draftsIndex]);

  const actions = useMemo<PaletteAction[]>(() => {
    const baseActions: PaletteAction[] = [
      {
        id: 'new-patient',
        label: 'Nouveau patient',
        description: 'Choisir lien famille ou saisie manuelle',
        keywords: 'nouveau patient dossier bilan lien famille saisie manuelle',
        icon: Plus,
        onSelect: onOpenNewPatientChoice,
      },
    ];

    if (latestDraftPatientId && onResumeDraft) {
      baseActions.push({
        id: 'resume-draft',
        label: 'Reprendre le brouillon',
        description: 'Retourner sur le brouillon le plus récent',
        keywords: 'brouillon reprise draft',
        icon: FilePenLine,
        onSelect: () => onResumeDraft(latestDraftPatientId),
      });
    }

    return baseActions;
  }, [latestDraftPatientId, onOpenNewPatientChoice, onResumeDraft]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredActions = useMemo(
    () =>
      actions.filter((action) => {
        if (!normalizedQuery) return true;
        const haystack = `${action.label} ${action.description} ${action.keywords}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    [actions, normalizedQuery],
  );

  const filteredPatients = useMemo(
    () =>
      patientFiles
        .filter((file) => {
          if (!normalizedQuery) return true;
          const haystack = `${file.patient.firstName} ${file.patient.lastName}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
        .slice(0, 8),
    [normalizedQuery, patientFiles],
  );

  if (!isOpen) return null;

  const closeAndRun = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-[#3D405B]/40 p-4 backdrop-blur-sm md:p-8" onMouseDown={onClose}>
      <div
        className="mx-auto mt-[8vh] w-full max-w-2xl rounded-[24px] border border-stone-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
          <Search size={18} className="text-stone-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher patient ou action..."
            className="h-10 w-full bg-transparent text-sm text-[#3D405B] outline-none"
          />
          <div className="hidden items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 md:flex">
            <Command size={12} /> K
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3">
          <div className="mb-3 px-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">Actions rapides</div>
          <div className="space-y-1">
            {filteredActions.map((action) => (
              <button
                key={action.id}
                onClick={() => closeAndRun(action.onSelect)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-stone-50"
              >
                <div className="rounded-lg bg-stone-100 p-2 text-[#3D405B]">
                  <action.icon size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[#3D405B]">{action.label}</div>
                  <div className="text-xs text-stone-500">{action.description}</div>
                </div>
              </button>
            ))}
            {filteredActions.length === 0 && (
              <div className="rounded-xl border border-dashed border-stone-200 px-3 py-4 text-xs text-stone-500">Aucune action correspondante.</div>
            )}
          </div>

          <div className="mb-3 mt-5 px-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">Patients</div>
          <div className="space-y-1">
            {filteredPatients.map((file) => (
              <button
                key={file.id}
                onClick={() => closeAndRun(() => onOpenPatient(file.id))}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-stone-50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3D405B] text-xs font-bold text-white">
                  {(file.patient.firstName[0] || '').toUpperCase()}
                  {(file.patient.lastName[0] || '').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[#3D405B]">{getPatientName(file)}</div>
                  <div className="truncate text-xs text-stone-500">{file.patient.classLevel || 'Patient suivi'}</div>
                </div>
                <UserRound size={14} className="text-stone-300" />
              </button>
            ))}
            {filteredPatients.length === 0 && (
              <div className="rounded-xl border border-dashed border-stone-200 px-3 py-4 text-xs text-stone-500">Aucun patient trouvé.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
