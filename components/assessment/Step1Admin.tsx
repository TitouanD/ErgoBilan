
import React, { useState, useCallback, useMemo } from 'react';
import type { Patient } from '../../types';
import { calculateAge, getPatientAgeForIdentity, isAdministrativeSectionReady, isPatientCreationReady } from '../../utils';
import { User, Lock, AlertTriangle, Mic, MicOff, Edit3, Check, FileText, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { SharedQuestionnaire } from '../shared/SharedQuestionnaire';
import { useAuth } from '../../contexts/AuthContext';
import { StorageService } from '../../services/storage';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';

interface Props {
  data: Patient;
  updateData: (data: Partial<Patient>) => void;
  onNext: () => void;
  onPatientCreated: () => void;
}

// --- VOICE TEXTAREA COMPONENT (reusable across steps) ---
export const VoiceTextarea: React.FC<{
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    rows?: number;
    className?: string;
    label?: string;
}> = ({ value, onChange, placeholder, rows = 5, className = '', label }) => {
    const handleTranscript = useCallback((text: string) => {
        onChange(value ? `${value} ${text}` : text);
    }, [value, onChange]);

    const { isListening, isSupported, interimText, toggleListening } = useVoiceDictation({
        onTranscript: handleTranscript,
    });

    return (
        <div className="relative">
            {label && <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{label}</label>}
            <div className="relative">
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows}
                    className={`w-full bg-[var(--input-bg)] border rounded-xl p-4 text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:ring-2 focus:ring-[#E07A5F]/30 focus:border-[#E07A5F]/50 resize-none leading-relaxed pr-12 ${className}`}
                />
                {isSupported && (
                    <button
                        type="button"
                        onClick={toggleListening}
                        className={`absolute top-3 right-3 p-2 rounded-xl transition-all ${
                            isListening 
                                ? 'bg-red-100 text-red-600 animate-pulse shadow-lg shadow-red-200' 
                                : 'bg-[var(--progress-bg)] text-[var(--text-secondary)] hover:bg-[#E07A5F]/10 hover:text-[#E07A5F]'
                        }`}
                        title={isListening ? 'Arrêter la dictée' : 'Dictée vocale'}
                    >
                        {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                )}
            </div>
            {isListening && interimText && (
                <div className="mt-1 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 italic animate-pulse">
                    🎙️ {interimText}...
                </div>
            )}
        </div>
    );
};

// --- Human-readable label maps for chip/select values ---
const LABEL_MAP: Record<string, string> = {
    // Guard mode
    commune: 'Garde commune', alternate: 'Garde alternée', exclusive_mere: 'Exclusive (mère)',
    exclusive_pere: 'Exclusive (père)', exclusive: 'Exclusive', third: 'Tiers / Foyer',
    // Crawling
    oui: 'Oui', non: 'Non', atypique: 'Atypique (fesses)', inconnu: 'Ne sais pas',
    // Cleanliness
    acquise: 'Acquise jour/nuit', jour_seul: 'Jour uniquement', en_cours: 'En cours',
    accidents: 'Accidents fréquents', enuresie: 'Énurésie nocturne',
    // Language
    standard: 'Apparition standard', retard: 'Retard simple', suivi_ortho: 'Suivi ortho',
    inintelligible: 'Difficile à comprendre', begaiement: 'Bégaiement',
    // Sleep
    ok: 'Paisible', endormissement: 'Endormissement long', reveils: 'Réveils multiples',
    agite: 'Agité / Cauchemars', fatigue_diurne: 'Fatigue en journée',
    // Eating
    autonomie: 'Mange en autonomie', aide_repas: 'A besoin d\'aide pour manger', agite_repas: 'Agité(e) lors des repas',
    couverts: 'Utilisation des couverts', mains: 'Mange avec les mains', salit: 'Se salit beaucoup',
    seul: 'Mange en autonomie', aide: 'A besoin d\'aide pour manger', couverts_ok: 'Utilisation des couverts',
    doigts: 'Mange avec les mains', selectif: 'Très sélectif',
    with: 'Vit au domicile', partial: 'Vit partiellement au domicile', away: 'Ne vit pas au domicile', other: 'Autre',
    // Clothing
    acquis: 'Acquis', difficile: 'Difficile', aide_totale: 'Impossible',
    // Scissors
    hache: 'Hache le papier', tenue_incorrecte: 'Tenue incorrecte',
    ne_sait_pas: 'Ne sait pas utiliser', refuse: 'Refuse',
    // Writing pain
    oui_long: 'Sur longues tâches', oui_vite: 'Au bout de 5 min', oui_constante: 'Immédiate',
    // Writing difficulties
    orthographe: "Fautes d'orthographe", lisibilite: 'Lisibilité des écrits', miroir: 'Lettres miroir', douleur: 'Douleur', posture: 'Mauvaise posture', lenteur: 'Lenteur',
    // Hand
    Droitier: 'Droitier', Gaucher: 'Gaucher', 'Indeterminé': 'Non latéralisé',
    // Gender
    M: 'Garçon', F: 'Fille',
};
const humanize = (raw?: string): string => {
    if (!raw) return '';
    return raw.split(',').map(v => LABEL_MAP[v.trim()] || v.trim()).join(' / ');
};

// --- SECTION SUMMARY (read-only condensed view with expand) ---
const SectionSummary: React.FC<{
    title: string;
    fields: { label: string; value?: string; raw?: boolean }[];
    isFilled: boolean;
    onEditSection: () => void;
}> = ({ title, fields, isFilled, onEditSection }) => {
    const [expanded, setExpanded] = useState(false);
    const filledFields = fields.filter(f => f.value?.trim());
    const emptyFields = fields.filter(f => !f.value?.trim());
    const preview = filledFields.slice(0, 4);
    const hasMore = filledFields.length > 4;
    
    return (
        <div className={`border rounded-2xl transition-all ${isFilled ? 'border-[var(--border-color)] bg-[var(--card-bg)]' : 'border-amber-200 dark:border-amber-800/20 bg-amber-50/30 dark:bg-amber-950/20'}`}>
            <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                    <div className={`p-2 rounded-xl ${isFilled ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}>
                        <FileText size={16} />
                    </div>
                    <div className="flex-1">
                        <h4 className="font-bold text-sm text-[var(--text-heading)]">{title}</h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isFilled ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {isFilled ? `✓ ${filledFields.length} champ${filledFields.length > 1 ? 's' : ''} renseigné${filledFields.length > 1 ? 's' : ''}` : '⚠ À compléter'}
                            {emptyFields.length > 0 && isFilled && <span className="text-stone-300 ml-2">· {emptyFields.length} vide{emptyFields.length > 1 ? 's' : ''}</span>}
                        </span>
                    </div>
                    <div className="p-1 text-[var(--text-disabled)]">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                </div>
                <button onClick={onEditSection} className="p-2 hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-[var(--text-secondary)] hover:text-[#E07A5F] ml-2" title="Modifier cette section">
                    <Edit3 size={16} />
                </button>
            </div>
            
            {/* Preview (collapsed) — always show top fields */}
            {!expanded && filledFields.length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1">
                    {preview.map((f, i) => (
                        <span key={i} className="text-xs text-[var(--text-secondary)]">
                            <span className="text-[var(--text-secondary)]">{f.label}:</span>{' '}
                            <span className="font-medium text-[var(--text-main)]">{(f.value?.length || 0) > 50 ? f.value?.slice(0, 50) + '\u2026' : f.value}</span>
                        </span>
                    ))}
                    {hasMore && <span className="text-xs text-stone-300 italic">+{filledFields.length - 4}</span>}
                </div>
            )}

            {/* Expanded — all fields displayed */}
            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t border-[var(--border-color)] space-y-2 animate-in slide-in-from-top-2">
                    {fields.map((f, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                            <span className="text-[var(--text-secondary)] min-w-[90px] shrink-0 text-right">{f.label}</span>
                            {f.value?.trim() ? (
                                <span className="font-medium text-[var(--text-main)] whitespace-pre-wrap">{f.value}</span>
                            ) : (
                                <span className="italic text-stone-300">—</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const Step1Admin: React.FC<Props> = ({ data, updateData, onNext, onPatientCreated }) => {
  const { orgKey } = useAuth(); 
  const [viewMode, setViewMode] = useState<'review' | 'edit'>('review');
    const [userSwitchedToReview, setUserSwitchedToReview] = useState(false);
  const toast = useToast();
    const isAdministrativeReady = isAdministrativeSectionReady(data);
  
  const handleDataChange = (partialData: Partial<Patient>) => {
      if (partialData.dob) {
          partialData.age = calculateAge(partialData.dob);
      }
      updateData(partialData);
  };

  const handleNotesChange = useCallback((val: string) => {
      updateData({ interviewNotes: val });
  }, [updateData]);

  // Determine if parent questionnaire has meaningful content (not only reason/expectations).
  const hasQuestionnaireData = !!(
      data.reason ||
      data.familyExpectations ||
      data.goals?.length ||
      data.remarks ||
      data.interviewNotes ||
      data.parentNames ||
      data.school ||
      data.medicalDiagnosis ||
      data.developmentMotor ||
      data.meals ||
      data.writingIssues
  );
  const hasParentData = !!(data.firstName && data.lastName && data.dob && hasQuestionnaireData);
  
  // Section fill status checks
  const sectionDefs = useMemo(() => [
      { title: 'État Civil', filled: !!(data.firstName && data.lastName && data.dob), fields: [
          { label: 'Prénom', value: data.firstName }, { label: 'Nom', value: data.lastName },
          { label: 'Naissance', value: data.dob }, { label: 'Genre', value: humanize(data.gender) },
          { label: 'Âge', value: data.age }, { label: 'Adresse', value: data.address },
      ]},
      { title: 'Situation Familiale', filled: !!(data.parentNames || data.guardMode), fields: [
          { label: 'Responsable 1', value: data.parent1Name }, { label: 'Tél. resp. 1', value: data.parent1Phone },
          { label: 'Mail resp. 1', value: data.parent1Email },
          { label: 'Responsable 2', value: data.parent2Name }, { label: 'Tél. resp. 2', value: data.parent2Phone },
          { label: 'Mail resp. 2', value: data.parent2Email },
          { label: 'Garde', value: humanize(data.guardMode) || data.guardArrangement },
          { label: 'Garde (autre)', value: data.guardExclusiveOther },
          { label: 'Fratrie', value: data.siblings?.length ? data.siblings.map(s => {
              const resStatus = s.residenceStatus || (s.livesPartially ? 'partial' : s.livesWithChild ? 'with' : 'away');
              const resLabel = resStatus === 'other' ? s.residenceOther : humanize(resStatus);
              return `${s.firstName} (${s.relation}, ${s.age} ans, ${resLabel})`;
          }).join(' · ') : undefined },
      ]},
      { title: 'Suivi Médical', filled: !!(data.prescribingDoctor || (data.medicalTracking?.length ?? 0) > 0), fields: [
          { label: 'Médecin prescripteur', value: data.prescribingDoctor },
          { label: 'Médecin traitant', value: data.treatingDoctor },
          { label: 'Diagnostic', value: data.medicalDiagnosis },
          { label: 'Traitements', value: data.medicalTreatments },
          { label: 'Suivis', value: data.medicalTracking?.length ? data.medicalTracking.map(t => `${t.type}${t.name ? ` (${t.name})` : ''} — ${t.frequency}${t.reason ? `, motif: ${t.reason}` : ''}${t.endDate ? `, terminé le ${t.endDate}` : ''}${t.sessionCount ? `, ${t.sessionCount} séances` : ''}`).join(' · ') : undefined },
      ]},
      { title: 'Scolarité', filled: !!(data.school && data.classLevel), fields: [
          { label: 'École', value: data.school }, { label: 'Classe', value: data.classLevel }, { label: 'Filière', value: data.schoolType },
          { label: 'Redoublement', value: humanize(data.schoolRepeatYear) },
          { label: 'Dispositifs', value: humanize(data.carePlan) || 'Aucun' },
          { label: 'AVS/AESH', value: data.avs === 'OUI' ? `Oui — ${data.avsHours || '?'}h (${data.avsMissions || '?'})` : data.avs === 'NON' ? 'Non' : undefined },
          { label: 'Matières préférées', value: data.schoolFavoriteSubjects },
          { label: 'Matières moins appréciées', value: data.schoolDislikedSubjects },
          { label: 'Comportement en classe', value: data.classroomBehavior },
          { label: 'Organisation', value: data.schoolOrganization },
          { label: 'Mémorisation', value: data.schoolMemory },
          { label: 'Attention & participation', value: data.schoolAttention },
          { label: 'Relation avec pairs', value: data.peerRelations || data.socialBehavior },
          { label: 'Devoirs', value: data.homeworkHabits },
          { label: 'Aménagements', value: data.schoolAccommodations },
          { label: 'Latéralité', value: humanize(data.handDominance) },
          { label: 'Difficultés écriture typiques', value: humanize(data.writingDifficultyTags) },
          { label: 'Difficultés écriture (texte)', value: data.writingIssues },
          { label: 'Douleur écriture', value: humanize(data.writingPain) },
          { label: 'Utilisation outils scolaires', value: data.toolUsage },
          { label: 'Autres remarques', value: data.writingOther },
      ]},
      { title: 'Développement', filled: !!(data.walkingAge || data.developmentMotor || data.pregnancyBirth), fields: [
          { label: 'Grossesse', value: data.pregnancyBirth },
          { label: 'Marche', value: data.walkingAge }, { label: '4 pattes', value: humanize(data.crawling) },
          { label: 'Motricité', value: data.developmentMotor },
          { label: 'Langage', value: humanize(data.languageStatus) || data.developmentLanguage },
          { label: 'Langage (détails)', value: data.developmentLanguage && data.languageStatus ? data.developmentLanguage : undefined },
          { label: 'Sommeil', value: humanize(data.sleepStatus) },
          { label: 'Sommeil (détails)', value: data.sleep },
          { label: 'Sensoriel', value: data.sensory },
      ]},
      { title: 'Vie Quotidienne', filled: !!(data.meals || data.dressing || data.eatingHabits || data.continence), fields: [
          { label: 'Repas', value: humanize(data.eatingHabits) },
          { label: 'Repas (détails)', value: data.meals },
          { label: 'Boutons', value: humanize(data.clothingButtons) },
          { label: 'Lacets', value: humanize(data.clothingLaces) },
          { label: 'Fermetures', value: humanize(data.clothingZippers) },
          { label: 'Habillage', value: data.dressing },
          { label: 'Hygiène', value: data.continence },
          { label: 'Temps/Espace', value: data.timeSpace },
          { label: 'Temps d\'écran', value: data.screenTime },
      ]},
      { title: 'Gestion des émotions', filled: !!(data.emotionalRegulation || data.screenTime), fields: [
          { label: 'Écrans', value: data.screenTime },
          { label: 'Émotions', value: data.emotionalRegulation },
      ]},
      { title: 'Motif & Priorités', filled: !!(data.reason || (data.goals?.length ?? 0) > 0 || data.remarks), fields: [
          { label: 'Motif', value: data.reason },
          { label: 'Objectifs', value: data.goals?.length ? data.goals.map((g, i) => `${i + 1}. ${g}`).join(' · ') : undefined },
          { label: 'Remarques', value: data.remarks },
      ]},
  ], [data]);

  const filledSections = sectionDefs.filter(s => s.filled).length;
  const totalSections = sectionDefs.length;
    const isFullyCompleted = totalSections > 0 && filledSections === totalSections;
    const shouldAutoUseCondensed = hasParentData || isFullyCompleted;
    const isCondensedMode = viewMode === 'review' && (shouldAutoUseCondensed || userSwitchedToReview);

  const ensurePatientPersisted = async (): Promise<void> => {
      if (!orgKey) throw new Error('Missing org key');
      if (!isPatientCreationReady(data)) throw new Error('PATIENT_REQUIRED_FIELDS_MISSING');

      const patientId = await StorageService.ensurePatientId(data, orgKey);
      const patientSnapshot: Patient = {
          ...data,
          id: patientId,
          age: getPatientAgeForIdentity(data),
      };

      if (data.id !== patientId || data.age !== patientSnapshot.age) {
          updateData({ id: patientId, age: patientSnapshot.age });
      }

      await StorageService.syncPatientIdentityPreview(patientId, patientSnapshot, orgKey);
      onPatientCreated();
  };

  const handleNextStep = async () => {
      try {
          if (!isAdministrativeReady) {
              toast.error("La partie administrative est obligatoire (identité, responsables, médical, motif) avant de continuer.");
              return;
          }
          await ensurePatientPersisted();
          onNext();
      } catch (e) {
          Logger.error('DB', "Erreur sauvegarde patient:", e);
          toast.error("Impossible de sauvegarder le patient. Réessayez.");
      }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in duration-500">
      
      <div className="mb-8 border-b border-[var(--border-color)] pb-6 flex justify-between items-end relative z-10">
        <div>
            <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Dossier Patient</h2>
            <p className="text-[var(--text-secondary)] font-medium mt-2">
                {hasParentData ? 'Revue des données transmises par la famille.' : 'Saisie des informations patient.'}
            </p>
        </div>
        <div className="flex gap-3 items-center">
            <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 border border-emerald-100">
                <User size={14} /> Mode Praticien
            </div>
        </div>
      </div>

      {/* PROGRESS INDICATOR */}
      {isCondensedMode && (
          <div className="mb-6 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Complétion du dossier</span>
                  <span className="text-sm font-bold text-[var(--text-heading)]">{filledSections}/{totalSections} sections</span>
              </div>
              <div className="h-2 bg-[var(--progress-bg)] rounded-full overflow-hidden">
                  <div 
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ 
                          width: `${(filledSections / totalSections) * 100}%`,
                          background: filledSections === totalSections ? '#81B29A' : 'linear-gradient(90deg, #E07A5F, #F2CC8F)'
                      }}
                  />
              </div>
          </div>
      )}

      {/* CLINICAL NOTES — Always visible, prominently placed, fed to AI */}
      <div className="bg-gradient-to-br from-[#fffdf5] to-[#fff8ec] dark:from-amber-950/30 dark:to-amber-950/30 border border-[#F2CC8F]/40 dark:border-amber-800/30 rounded-[24px] p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[#d97706] dark:text-amber-400">
                  <FileText size={18} />
                  <h3 className="font-bold text-sm uppercase tracking-wider">Notes Cliniques d'Entretien</h3>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-stone-400">
                  <Lock size={10} /> Chiffré · Utilisé par l'IA pour la rédaction
              </div>
          </div>
          <VoiceTextarea
              value={data.interviewNotes || ''}
              onChange={handleNotesChange}
              placeholder="Dictez ou tapez vos notes d'entretien : comportement observé, coopération, impression clinique, contexte familial, éléments non couverts par le questionnaire..."
              rows={5}
              className="border-[#F2CC8F]/30 focus:ring-[#F2CC8F]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-[var(--text-secondary)]">
              <span className="flex items-center gap-1"><AlertTriangle size={10} /> Notes chiffrées, invisibles dans l'espace famille.</span>
              <span className="flex items-center gap-1"><Mic size={10} /> Utilisez le micro pour dicter.</span>
          </div>
      </div>

      {/* QUESTIONNAIRE — Review mode (condensed) or Edit mode (full form) */}
      {isCondensedMode ? (
          <div className="space-y-3 mb-8">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2">
                      <Eye size={14} /> Résumé du questionnaire famille
                  </h3>
                  <button 
                      onClick={() => {
                          setViewMode('edit');
                          setUserSwitchedToReview(false);
                      }}
                      className="text-xs font-bold text-[#E07A5F] hover:underline flex items-center gap-1"
                  >
                      <Edit3 size={12} /> Tout modifier
                  </button>
              </div>
              {sectionDefs.map((sec, i) => (
                  <SectionSummary
                      key={i}
                      title={sec.title}
                      fields={sec.fields}
                      isFilled={sec.filled}
                      onEditSection={() => {
                          setViewMode('edit');
                          setUserSwitchedToReview(false);
                      }}
                  />
              ))}
          </div>
      ) : (
          <>
              {viewMode === 'edit' && shouldAutoUseCondensed && (
                  <div className="mb-4 flex justify-end">
                      <button 
                          onClick={() => {
                              setViewMode('review');
                              setUserSwitchedToReview(true);
                          }}
                      className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] flex items-center gap-1 px-3 py-2 rounded-xl hover:bg-[var(--hover-bg)] transition-colors"
                      >
                          <Check size={12} /> Retour à la vue résumée
                      </button>
                  </div>
              )}
              <SharedQuestionnaire 
                  data={data} 
                  onChange={handleDataChange} 
                  mode="practitioner" 
              />
          </>
      )}

      <div className="flex justify-center pt-12">
        <button onClick={handleNextStep}
                        disabled={!isAdministrativeReady}
            className="px-10 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-sm shadow-xl hover:bg-[#E07A5F] hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
            Suivant : Tests & Mesures
        </button>
      </div>
    </div>
  );
};
