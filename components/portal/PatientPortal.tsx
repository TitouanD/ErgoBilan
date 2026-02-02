
import React, { useState, useEffect } from 'react';
import { Patient } from '../../types';
import { Send, Lock, ArrowLeft, Sparkles, CheckCircle2, Loader2, ShieldCheck, AlertCircle, Key } from 'lucide-react';
import { SharedQuestionnaire } from '../shared/SharedQuestionnaire';
import { supabase } from '../../services/db';
import { importQuestionnaireKey, encryptData, decryptData } from '../../utils/crypto';

interface Props {
  onBack: () => void;
  initialUrl?: string; // Permet l'auto-login si l'URL est fournie
}

export const PatientPortal: React.FC<Props> = ({ onBack, initialUrl }) => {
  const [loadingStep, setLoadingStep] = useState<'idle' | 'validating' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // State pour le login manuel
  const [pastedLink, setPastedLink] = useState('');
  
  const [questionnaireId, setQuestionnaireId] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const [localPatient, setLocalPatient] = useState<Patient>({
      firstName: '', lastName: '', dob: '', age: '', gender: '', address: '',
      parentNames: '', parentPhone: '', parentEmail: '', guardArrangement: '', siblings: [],
      school: '', classLevel: '', teacher: '', carePlan: '', avs: '', avsDetails: '',
      prescribingDoctor: '', medicalDiagnosis: '', medicalTreatments: '', medicalFollowup: '',
      reason: '', familyExpectations: '',
      pregnancyBirth: '', developmentMotor: '', developmentLanguage: '', sleep: '', sensory: '',
      meals: '', dressing: '', continence: '', timeSpace: '',
      schoolAttention: '', writingIssues: '', toolUsage: '', schoolAccommodations: '',
      remarks: '', priorities: ''
  });

  // Fonction de connexion unifiée
  const attemptLogin = async (urlStr: string) => {
      setLoadingStep('validating');
      setErrorMessage('');
      
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
                  throw new Error("Format de lien invalide. Veuillez copier le lien complet.");
              }
          }

          const qId = fullUrl.searchParams.get('q_id');
          // Extraction clé: peut être dans hash (#key=...) ou query (si mal copié)
          let keyString = '';
          if (fullUrl.hash.includes('key=')) {
              keyString = fullUrl.hash.split('key=')[1];
          } else if (fullUrl.searchParams.get('key')) {
              keyString = fullUrl.searchParams.get('key') || '';
          }

          if (!qId || !keyString) {
              throw new Error("Lien incomplet. Vérifiez que vous avez copié tout le lien.");
          }

          // 1. Importation Clé
          const key = await importQuestionnaireKey(keyString);
          setEncryptionKey(key);
          setQuestionnaireId(qId);

          // 2. Récupération Supabase
          setLoadingStep('loading');
          const { data, error } = await supabase
              .from('pending_questionnaires')
              .select('status, family_encrypted_data')
              .eq('id', qId)
              .single();

          if (error) throw new Error("Dossier introuvable ou expiré.");

          if (data.status === 'completed') {
              setIsCompleted(true);
          }

          // 3. Déchiffrement si existant
          if (data.family_encrypted_data) {
              const [iv, content] = data.family_encrypted_data.split(':');
              if (iv && content) {
                  const decrypted = await decryptData({ iv, content }, key);
                  if (decrypted && decrypted.patient) {
                      setLocalPatient(prev => ({ ...prev, ...decrypted.patient }));
                  }
              }
          }

          setLoadingStep('ready');

      } catch (e: any) {
          console.error("Erreur Connexion:", e);
          setLoadingStep('idle'); // Retour au formulaire
          setErrorMessage(e.message || "Erreur de connexion.");
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
      if (!localPatient.lastName || !localPatient.firstName) {
          alert("Merci de renseigner au moins le nom et le prénom de l'enfant.");
          return;
      }
      if (!questionnaireId || !encryptionKey) return;

      setLoadingStep('loading');
      try {
          const payload = {
              patient: localPatient,
              timestamp: new Date().toISOString()
          };
          
          const encrypted = await encryptData(payload, encryptionKey);
          const encryptedString = `${encrypted.iv}:${encrypted.content}`;

          const { error } = await supabase
              .from('pending_questionnaires')
              .update({
                  family_encrypted_data: encryptedString,
                  status: 'completed'
              })
              .eq('id', questionnaireId);

          if (error) throw error;

          setIsCompleted(true);
          setLoadingStep('ready');
          window.scrollTo(0, 0);

      } catch (e) {
          console.error("Erreur sauvegarde", e);
          alert("Erreur lors de l'envoi sécurisé.");
          setLoadingStep('ready');
      }
  };

  // --- ÉCRAN LOGIN MANUEL ---
  if (loadingStep === 'idle' || (loadingStep === 'error' && !initialUrl)) {
      return (
          <div className="min-h-screen bg-[#fffbfb] flex flex-col items-center justify-center p-6 text-center relative">
              <button onClick={onBack} className="absolute top-6 left-6 text-stone-400 hover:text-[#3D405B] flex items-center gap-2 font-bold text-sm uppercase tracking-widest transition-colors z-50">
                  <ArrowLeft size={16} /> Retour
              </button>

              <div className="w-full max-w-md bg-white p-10 rounded-[32px] shadow-xl border border-stone-100">
                  <div className="w-16 h-16 bg-[#3D405B] text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#3D405B]/20">
                      <Key size={32} />
                  </div>
                  <h1 className="font-serif text-2xl font-bold text-[#3D405B] mb-2">Accès Sécurisé</h1>
                  <p className="text-stone-500 text-sm mb-8 leading-relaxed">
                      Collez le lien reçu par email pour déverrouiller votre dossier.
                  </p>

                  <form onSubmit={handleManualSubmit} className="space-y-4">
                      <div className="relative">
                          <input 
                              type="text" 
                              value={pastedLink}
                              onChange={(e) => { setPastedLink(e.target.value); setErrorMessage(''); }}
                              placeholder="https://app.com/?q_id=..."
                              className="w-full p-4 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] focus:bg-white transition-all text-sm font-medium text-[#3D405B]"
                          />
                      </div>
                      
                      {errorMessage && (
                          <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-xs font-bold flex items-center gap-2 justify-center">
                              <AlertCircle size={14}/> {errorMessage}
                          </div>
                      )}

                      <button type="submit" disabled={!pastedLink} className="w-full py-4 bg-[#3D405B] text-white rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all disabled:opacity-50">
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
          <div className="min-h-screen bg-[#fffbfb] flex flex-col items-center justify-center relative">
              {/* Bouton Annuler/Retour de secours si le chargement bloque */}
              <button onClick={onBack} className="absolute top-6 left-6 text-stone-400 hover:text-[#3D405B] flex items-center gap-2 font-bold text-sm uppercase tracking-widest transition-colors z-50">
                  <ArrowLeft size={16} /> Annuler
              </button>
              <Loader2 size={48} className="text-[#E07A5F] animate-spin mb-4" />
              <p className="text-stone-500 font-medium animate-pulse">Déchiffrement sécurisé...</p>
          </div>
      );
  }

  // --- ÉCRAN SUCCÈS ---
  if (isCompleted) {
      return (
        <div className="min-h-screen bg-[#fffbfb] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-700">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-emerald-100">
                <CheckCircle2 size={40} />
            </div>
            <h1 className="font-serif text-3xl font-bold text-[#3D405B] mb-4">Dossier Transmis !</h1>
            <p className="text-stone-500 max-w-md leading-relaxed mb-8">
                Les informations ont été chiffrées et envoyées à votre ergothérapeute. <br/>
                Vous pouvez fermer cette page en toute sécurité.
            </p>
            
            <div className="space-y-4">
                <button onClick={onBack} className="bg-white border border-stone-200 text-stone-500 hover:text-[#3D405B] hover:border-[#3D405B] px-6 py-3 rounded-xl text-sm font-bold transition-all">
                    Retour à l'accueil
                </button>
                <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 flex items-center gap-2 text-xs text-stone-400 mx-auto w-fit">
                    <Lock size={12} /> Données chiffrées de bout en bout (Zero-Knowledge).
                </div>
            </div>
        </div>
      );
  }

  // --- ÉCRAN FORMULAIRE ---
  return (
    <div className="min-h-screen bg-[#F9F9F9] pb-24 font-sans">
        
        {/* BANDEAU SÉCURITÉ */}
        <div className="bg-[#3D405B] text-white px-4 py-2 text-center text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
            <ShieldCheck size={14} className="text-[#81B29A]" /> Connexion Sécurisée Chiffrée
        </div>

        <header className="bg-white/80 backdrop-blur-md border-b border-stone-100 sticky top-0 z-40">
            <div className="max-w-4xl mx-auto px-6 h-20 flex justify-between items-center">
                <div className="flex items-center gap-3 font-serif text-lg text-[#3D405B] font-bold">
                    <div className="w-8 h-8 bg-[#E07A5F] text-white rounded-lg flex items-center justify-center">
                        <Sparkles size={16} />
                    </div>
                    Espace Famille
                </div>
                <button onClick={() => { setEncryptionKey(null); setLoadingStep('idle'); }} className="text-xs font-bold text-stone-400 hover:text-[#3D405B] uppercase tracking-wider">
                    Déconnexion
                </button>
            </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
            
            <div className="animate-in slide-in-from-bottom-4 fade-in duration-500">
                <div className="bg-white p-8 rounded-[32px] mb-8 shadow-xl shadow-stone-200/50 border border-stone-100">
                    <h2 className="font-serif text-2xl font-bold text-[#3D405B] mb-2">Préparation du Bilan</h2>
                    <p className="text-stone-500 text-sm leading-relaxed">
                        Merci de compléter ce questionnaire pour préparer la consultation. Vos réponses sont chiffrées avant envoi.
                    </p>
                </div>

                <SharedQuestionnaire 
                    data={localPatient} 
                    onChange={(newData) => setLocalPatient(prev => ({ ...prev, ...newData }))} 
                    mode="family" 
                />

                <div className="mt-8 flex justify-end">
                    <button 
                        onClick={handleSaveData} 
                        className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center gap-3 text-lg"
                    >
                        <Send size={20} /> 
                        Chiffrer et Envoyer
                    </button>
                </div>
            </div>

        </main>
    </div>
  );
};
