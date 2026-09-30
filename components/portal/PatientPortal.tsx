
import React, { useState, useEffect, useRef } from 'react';
import type { Patient } from '../../types';
import { Send, Lock, ArrowLeft, Sparkles, CheckCircle2, Loader2, ShieldCheck, AlertCircle, Key, FileText } from 'lucide-react';
import { SharedQuestionnaire } from '../shared/SharedQuestionnaire';
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../../services/db';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';
import { importQuestionnaireKey, encryptToEnvelope, decryptEnvelope, parseEnvelope } from '../../utils/crypto';
import { isAdministrativeSectionReady } from '../../utils/patient';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';

/** Crée un client Supabase anonyme avec le header x-questionnaire-token pour les policies RLS. */
const createPortalClient = (accessToken: string) => {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { 'x-questionnaire-token': accessToken } },
  });
};

/** Expected link problem (malformed, incomplete, expired): logged as a warning, not a Sentry issue. */
const PORTAL_LINK_ERROR = 'PortalLinkError';
const linkError = (message: string) => Object.assign(new Error(message), { name: PORTAL_LINK_ERROR });

interface Props {
  onBack: () => void;
  initialUrl?: string; // Permet l'auto-login si l'URL est fournie
}

export const PatientPortal: React.FC<Props> = ({ onBack, initialUrl }) => {
  const [loadingStep, setLoadingStep] = useState<'idle' | 'validating' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const toast = useToast();
  
  // State pour le login manuel
  const [pastedLink, setPastedLink] = useState('');
  
  const [questionnaireId, setQuestionnaireId] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const portalClientRef = useRef<ReturnType<typeof createPortalClient> | null>(null);

  const [localPatient, setLocalPatient] = useState<Patient>({
      firstName: '', lastName: '', dob: '', age: '', gender: '', address: '',
      parentNames: '', parentPhone: '', parentEmail: '', guardArrangement: '', siblings: [],
      school: '', classLevel: '', teacher: '', carePlan: '', avs: '', avsDetails: '',
      prescribingDoctor: '', medicalDiagnosis: '', medicalTreatments: '', medicalFollowup: '',
      reason: '', familyExpectations: '',
      pregnancyBirth: '', developmentMotor: '', developmentLanguage: '', sleep: '', sensory: '',
      crawlingFourPattes: '', crawlingRamper: '',
      meals: '', dressing: '', continence: '', timeSpace: '',
      dressingAutonomy: '', dressingObservations: '',
      hygieneTeeth: '', hygieneHands: '', hygieneBath: '', hygieneFace: '', hygieneHair: '', hygieneContinenceStatus: '', hygieneObservations: '',
      timeSpaceClockReading: '', timeSpaceObservations: '',
      schoolAttention: '', writingIssues: '', toolUsage: '', schoolAccommodations: '',
      emotionalGlobalTags: '', emotionalReactionTags: '', emotionalNotes: '',
      prescribingDoctorProfession: '',
      remarks: '', priorities: ''
  });

    const isAdministrativeReady = isAdministrativeSectionReady(localPatient);

  // Fonction de connexion unifiée
  const attemptLogin = async (urlStr: string) => {
      setLoadingStep('validating');
      setErrorMessage('');
      Logger.info('UI', 'Portal Login Attempt', { urlLength: urlStr.length });
      
      try {
          // Parsing URL
          // On supporte le lien complet (http...) ou juste les params (?q_id=...)
          let fullUrl: URL;
          try {
              fullUrl = new URL(urlStr);
          } catch {
              // Si ce n'est pas une URL valide, on essaie de construire une URL factice si l'input est juste le hash/query
              try {
                  fullUrl = new URL(window.location.origin + '/' + urlStr);
              } catch {
                  throw linkError("Format de lien invalide. Veuillez copier le lien complet.");
              }
          }

          const qId = fullUrl.searchParams.get('q_id');
          const accessToken = fullUrl.searchParams.get('t') || ''; // Token d'accès pour la policy RLS
          // The key only travels in the URL fragment (#key=...), never sent to any server.
          const keyString = fullUrl.hash.includes('key=') ? fullUrl.hash.split('key=')[1] : '';

          if (!qId || !keyString) {
              throw linkError("Lien incomplet. Vérifiez que vous avez copié tout le lien.");
          }

          Logger.debug('AUTH', 'Extracted ID & Key', { qId });

          // 1. Importation Clé
          const key = await importQuestionnaireKey(keyString);
          setEncryptionKey(key);
          setQuestionnaireId(qId);

          // 2. Créer un client Supabase dédié avec le token d'accès
          const portalClient = accessToken ? createPortalClient(accessToken) : supabase;
          portalClientRef.current = portalClient;

          // 3. Récupération Supabase (avec token d'accès en header pour RLS anon)
          setLoadingStep('loading');
          const { data, error } = await portalClient
              .from('pending_questionnaires')
              .select('status, family_encrypted_data')
              .eq('id', qId)
              .single();

          if (error) throw linkError("Dossier introuvable ou expiré.");

          if (data.status === 'completed') {
              setIsCompleted(true);
          }

          // 3. Déchiffrement si existant
          if (data.family_encrypted_data) {
              Logger.info('CRYPTO', 'Decrypting existing family data...');
              if (parseEnvelope(data.family_encrypted_data)) {
                  const decrypted = await decryptEnvelope(data.family_encrypted_data, key) as { patient?: Patient } | null;
                  if (decrypted && decrypted.patient) {
                      setLocalPatient(prev => ({ ...prev, ...decrypted.patient as Patient }));
                  }
              }
          }

          setLoadingStep('ready');

      } catch (e: unknown) {
          if (e instanceof Error && e.name === PORTAL_LINK_ERROR) Logger.warn('AUTH', 'Portal login rejected', { reason: e.message });
          else Logger.error('AUTH', "Portal Login Error", e);
          setLoadingStep('idle'); // Retour au formulaire
          setErrorMessage(e instanceof Error ? e.message : "Erreur de connexion.");
      }
  };

  // Auto-login si URL fournie (via App routing)
  useEffect(() => {
      if (initialUrl) {
          attemptLogin(initialUrl);
      }
  }, [initialUrl]);

  const handleManualSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      attemptLogin(pastedLink);
  };

  const handleSaveData = async () => {
      if (!isAdministrativeReady) {
          toast.error("La partie administrative est obligatoire (identité, responsables, médical, motif) avant l'envoi.");
          return;
      }
      if (!questionnaireId || !encryptionKey) return;

      Logger.info('DB', 'Encrypting and sending family data...');
      setLoadingStep('loading');
      try {
          const payload = {
              patient: localPatient,
              timestamp: new Date().toISOString()
          };
          
          const encryptedString = await encryptToEnvelope(payload, encryptionKey);

          // Utiliser le client portail (avec header token) pour l'update anon
          const client = portalClientRef.current || supabase;
          const { error } = await client
              .from('pending_questionnaires')
              .update({
                  family_encrypted_data: encryptedString,
                  status: 'completed'
              })
              .eq('id', questionnaireId);

          if (error) throw error;

          Logger.info('DB', 'Data sent successfully.');
          setIsCompleted(true);
          setLoadingStep('ready');
          window.scrollTo(0, 0);

      } catch (e) {
          Logger.error('DB', "Portal Save Error", e);
          toast.error("Erreur lors de l'envoi sécurisé.");
          setLoadingStep('ready');
      }
  };

  // --- ÉCRAN LOGIN MANUEL ---
  if (loadingStep === 'idle' || (loadingStep === 'error' && !initialUrl)) {
      return (
          <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center p-6 text-center relative">
              <button onClick={onBack} className="absolute top-6 left-6 text-[var(--text-secondary)] hover:text-[var(--text-heading)] flex items-center gap-2 font-bold text-sm uppercase tracking-widest transition-colors z-50">
                  <ArrowLeft size={16} /> Retour
              </button>

              <div className="w-full max-w-md bg-[var(--card-bg)] p-10 rounded-[32px] shadow-xl border border-[var(--border-color)]">
                  <div className="w-16 h-16 bg-[var(--secondary)] text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#3D405B]/20">
                      <Key size={32} />
                  </div>
                  <h1 className="font-serif text-2xl font-bold text-[var(--text-heading)] mb-2">Accès Sécurisé</h1>
                  <p className="text-[var(--text-secondary)] text-sm mb-8 leading-relaxed">
                      Collez le lien reçu par email pour déverrouiller votre dossier.
                  </p>

                  <form onSubmit={handleManualSubmit} className="space-y-4">
                      <div className="relative">
                          <input 
                              type="text" 
                              value={pastedLink}
                              onChange={(e) => { setPastedLink(e.target.value); setErrorMessage(''); }}
                              placeholder="https://app.com/?q_id=..."
                              className="w-full p-4 bg-[var(--input-bg)] rounded-xl border border-[var(--border-color)] outline-none focus:border-[var(--primary)] focus:bg-[var(--card-bg)] transition-all text-sm font-medium text-[var(--text-main)]"
                          />
                      </div>
                      
                      {errorMessage && (
                          <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-xs font-bold flex items-center gap-2 justify-center">
                              <AlertCircle size={14}/> {errorMessage}
                          </div>
                      )}

                      <button type="submit" disabled={!pastedLink} className="w-full py-4 bg-[var(--secondary)] text-white rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all disabled:opacity-50">
                          Accéder au questionnaire
                      </button>
                  </form>
              </div>
          </div>
      );
  }

  // --- ÉCRAN CHARGEMENT ---
  if (loadingStep === 'validating' || loadingStep === 'loading') {
      return (
          <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center relative">
              {/* Bouton Annuler/Retour de secours si le chargement bloque */}
              <button onClick={onBack} className="absolute top-6 left-6 text-[var(--text-secondary)] hover:text-[var(--text-heading)] flex items-center gap-2 font-bold text-sm uppercase tracking-widest transition-colors z-50">
                  <ArrowLeft size={16} /> Annuler
              </button>
              <Loader2 size={48} className="text-[var(--primary)] animate-spin mb-4" />
              <p className="text-[var(--text-secondary)] font-medium animate-pulse">Déchiffrement sécurisé...</p>
          </div>
      );
  }

  // --- ÉCRAN SUCCÈS ---
  if (isCompleted) {
      return (
          <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-700">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-emerald-100">
                <CheckCircle2 size={40} />
            </div>
            <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)] mb-4">Dossier Transmis !</h1>
            <p className="text-[var(--text-secondary)] max-w-md leading-relaxed mb-8">
                Les informations ont été chiffrées et envoyées à votre ergothérapeute. <br/>
                Vous pouvez fermer cette page en toute sécurité.
            </p>
            
            <div className="space-y-4">
                <button onClick={onBack} className="bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:border-[var(--text-heading)] px-6 py-3 rounded-xl text-sm font-bold transition-all">
                    Retour à l'accueil
                </button>
                <div className="bg-[var(--hover-bg)] p-4 rounded-xl border border-[var(--border-color)] flex items-center gap-2 text-xs text-[var(--text-secondary)] mx-auto w-fit">
                    <Lock size={12} /> Données chiffrées de bout en bout (Zero-Knowledge).
                </div>
            </div>
        </div>
      );
  }

  // --- ÉCRAN FORMULAIRE ---
  return (
    <div className="min-h-screen bg-[var(--app-bg)] pb-24 font-sans">
        
        {/* BANDEAU SÉCURITÉ */}
        <div className="bg-[var(--secondary)] text-white px-4 py-2 text-center text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
            <ShieldCheck size={14} className="text-[#81B29A]" /> Connexion Sécurisée Chiffrée
        </div>

        <header className="bg-[var(--card-bg)]/80 backdrop-blur-md border-b border-[var(--border-color)] sticky top-0 z-40">
            <div className="max-w-4xl mx-auto px-6 h-20 flex justify-between items-center">
                <div className="flex items-center gap-3 font-serif text-lg text-[var(--text-heading)] font-bold">
                    <div className="w-8 h-8 bg-[var(--primary)] text-white rounded-lg flex items-center justify-center">
                        <Sparkles size={16} />
                    </div>
                    Espace Famille
                </div>
                <button onClick={() => { setEncryptionKey(null); setLoadingStep('idle'); }} className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] uppercase tracking-wider">
                    Déconnexion
                </button>
            </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
            
            <div className="animate-in slide-in-from-bottom-4 fade-in duration-500">
                <div className="bg-[var(--card-bg)] p-8 rounded-[32px] mb-8 shadow-xl shadow-black/20 border border-[var(--border-color)]">
                    <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)] mb-2">Préparation du Bilan</h2>
                    <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                        Merci de compléter ce questionnaire pour préparer la consultation. Vos réponses sont chiffrées avant envoi.
                    </p>
                </div>

                <SharedQuestionnaire 
                    data={localPatient} 
                    onChange={(newData) => setLocalPatient(prev => ({ ...prev, ...newData }))} 
                    mode="family" 
                />

                {/* NOTE: RAPPEL DOCUMENTS */}
                <div className="mt-8 mb-6 p-5 bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-2xl flex gap-4 items-start shadow-sm">
                    <div className="p-2 bg-[var(--card-bg)] rounded-lg text-[var(--text-heading)] shadow-sm">
                        <FileText size={20} />
                    </div>
                    <div>
                        <h4 className="font-bold text-[var(--text-heading)] text-sm mb-1">Documents à apporter</h4>
                        <p className="text-[var(--text-main)] text-xs leading-relaxed">
                            Veuillez penser à apporter <strong>l'ordonnance médicale</strong>, les <strong>bilans précédents</strong> et les <strong>cahiers scolaires</strong> lors du premier rendez-vous.
                        </p>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button 
                        onClick={handleSaveData} 
                        disabled={!isAdministrativeReady}
                        className="bg-[var(--primary)] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 dark:shadow-black/30 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center gap-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--primary)] disabled:hover:translate-y-0"
                    >
                        <Send size={20} /> 
                        Chiffrer et Envoyer
                    </button>
                </div>
                {!isAdministrativeReady && (
                    <p className="mt-3 text-right text-xs font-medium text-[var(--text-secondary)]">
                        Partie administrative obligatoire avant envoi: identité, responsables, médical, motif.
                    </p>
                )}
            </div>

        </main>
    </div>
  );
};

