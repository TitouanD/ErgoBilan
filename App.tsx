
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssessmentProvider, useAssessment } from './contexts/AssessmentContext';
import { CatalogProvider, useCatalog } from './contexts/CatalogContext'; // Ajout useCatalog
import { ToastProvider, useToast } from './contexts/ToastContext';
import { Dashboard } from './components/dashboard/Dashboard';
import { PatientPortal } from './components/portal/PatientPortal';
import { AuthWizard } from './components/auth/AuthWizard';
import { PinUnlock } from './components/auth/PinUnlock';
import { OnboardingExperience } from './components/auth/OnboardingExperience';
import { AdminPanel } from './components/admin/AdminPanel';
import { ContributionStudio } from './components/admin/ContributionStudio';
import { Step1Admin } from './components/assessment/Step1Admin';
import { Step2Tests } from './components/assessment/Step2Tests';
import { Step3Observations } from './components/assessment/Step3Observations';
import { Step4Validation } from './components/assessment/Step4Validation';
import { Step5Export } from './components/assessment/Step5Export';
import { PricingModal } from './components/shared/PricingModal';
import { PatientDetail } from './components/dashboard/PatientDetail';
import { QuickEntryModal } from './components/dashboard/QuickEntryModal';
import { GenerationLoader } from './components/shared/GenerationLoader';
import { supabase } from './services/db';
import { StorageService } from './services/storage';
import { AIService, GenerationPayload } from './services/ai';
import { anonymizeData } from './utils/anonymizer';
import { PatientFile, PendingQuestionnaire, ScoreResult, TestSession, ReportMetadata } from './types'; // Ajout imports
import { Sparkles, ArrowRight, LogOut, FilePlus, Crown, ShieldCheck, Link as LinkIcon, Copy, X, User, Loader2 } from 'lucide-react';
import { decryptData, generateQuestionnaireKey, encryptData } from './utils/crypto';
import { Logger } from './utils/logger';

// --- ROUTEUR INTERNE ---
const AppRouter = () => {
    const { userProfile, practitioner, authState, sessionKey, orgKey, setSessionKey, unlockSession, logout, updateUserProfile, refreshProfile, tempEmail } = useAuth();
    const { catalog } = useCatalog(); // Accès au catalogue pour les noms de tests
    const assessment = useAssessment();
    const toast = useToast();
    
    // UI State local (Navigation)
    const [mode, setMode] = useState<'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'contribution' | 'detail'>('landing');
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    
    // Modals
    const [pricingModalMode, setPricingModalMode] = useState<'plans' | 'paywall' | null>(null);
    const [showConfirmGeneration, setShowConfirmGeneration] = useState(false);
    const [showQuickEntry, setShowQuickEntry] = useState(false);
    const [createdLink, setCreatedLink] = useState<string | null>(null);
    
    // Data Lists (Loaded on Dashboard)
    const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
    const [pendingQuestionnaires, setPendingQuestionnaires] = useState<PendingQuestionnaire[]>([]);
    const [selectedFile, setSelectedFile] = useState<PatientFile | null>(null);
    
    // NOUVEAU : Map des brouillons disponibles { patientId: timestamp }
    const [draftsIndex, setDraftsIndex] = useState<Record<string, string>>({});
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);

    // Initialisation
    useEffect(() => {
        const init = async () => {
            const params = new URLSearchParams(window.location.search);
            if (params.get('q_id') && window.location.hash.includes('key=')) {
                Logger.info('UI', 'Redirecting to Family Portal via URL');
                setMode('portal');
                return;
            }
        };
        init();
    }, []);

    // Routing Logic basés sur authState
    useEffect(() => {
        Logger.debug('UI', `AppRouter authState changed: ${authState}`);
        
        if (authState === 'unauthenticated') {
            setMode('landing');
            setIsLoggingIn(false);
        } else if (authState === 'locked') {
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'authenticated') {
            setMode('dashboard');
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'registering') {
            Logger.info('AUTH', "Redirecting to Wizard for profile completion");
            setMode('landing');
            setShowAuthModal(true); 
            setIsLoggingIn(false);
        } else if (authState === 'subscription_locked') {
            // Nouvel état : Paywall Bloquant
            setIsLoggingIn(false);
            setShowAuthModal(false);
            setPricingModalMode('paywall');
        }
    }, [authState]);

    // Chargement des données chiffrées (UTILISE MAINTENANT ORG_KEY POUR LES PATIENTS)
    useEffect(() => {
        if (sessionKey && orgKey && authState === 'authenticated') {
            const loadData = async () => {
                Logger.info('DB', 'Loading encrypted user data...');
                // Chargement des patients avec OrgKey (Partageable)
                const files = await StorageService.loadPatientList(orgKey);
                setPatientFiles(files);
                
                // Charger l'index des brouillons (léger)
                const draftsMap = await StorageService.getDraftsMetadata();
                setDraftsIndex(draftsMap);
                
                if (practitioner) {
                    const { data } = await supabase.from('pending_questionnaires').select('*').eq('practitioner_id', practitioner.id).order('created_at', { ascending: false });
                    if (data) setPendingQuestionnaires(data.map((p: any) => ({ ...p, createdAt: p.created_at, practitionerEncryptedKey: p.practitioner_encrypted_key })));
                }
            };
            loadData();
        }
    }, [sessionKey, orgKey, authState, practitioner]);

    // Handlers
    const handleLogin = async (email: string, pass: string) => {
        setIsLoggingIn(true);
        Logger.info('AUTH', "Attempting login for:", email);
        
        // Timeout de sécurité : si pas de réponse dans 10s, on débloque le bouton
        const timer = setTimeout(() => {
            if (isLoggingIn) {
                Logger.warn('AUTH', "Login took too long - releasing UI lock");
                setIsLoggingIn(false);
            }
        }, 10000);

        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        
        clearTimeout(timer);
        
        if (error) { 
            Logger.error('AUTH', "Login failed", error.message);
            toast.error(error.message); 
            setIsLoggingIn(false);
        } 
        // Succès : Le listener onAuthStateChange dans AuthContext va prendre le relais et changer authState, ce qui déclenchera le useEffect ci-dessus pour fermer le modal.
    };

    const handleUnlock = (key: CryptoKey) => {
        unlockSession(key);
        setMode('dashboard');
        toast.success("Session déverrouillée");
    };

    const handleGenerateLink = async () => {
        if (!practitioner || !sessionKey) return;
        const { keyString } = await generateQuestionnaireKey();
        const enc = await encryptData(keyString, sessionKey);
        const label = `Dossier #${pendingQuestionnaires.length + 1} (${new Date().toLocaleDateString()})`;
        const { data } = await supabase.from('pending_questionnaires').insert({
            practitioner_id: practitioner.id, label, status: 'pending', practitioner_encrypted_key: `${enc.iv}:${enc.content}`
        }).select().single();
        if (data) {
            setCreatedLink(`${window.location.origin}/?q_id=${data.id}#key=${keyString}`);
            setPendingQuestionnaires(prev => [{ id: data.id, label: data.label, status: 'pending', createdAt: data.created_at, practitionerEncryptedKey: data.practitioner_encrypted_key }, ...prev]);
            toast.success("Lien sécurisé généré");
        }
    };

    // Gestion centralisée de la reprise de brouillon
    const handleResumeDraft = async (patientId?: string) => {
        if (!sessionKey) return;
        
        // Charger le brouillon spécifique (Privé -> sessionKey)
        const draftContent = await StorageService.getDraft(sessionKey, patientId);
        
        if (draftContent) {
            assessment.resetAssessment();
            assessment.loadFromDraft(draftContent);
            setMode('assessment');
            toast.info("Brouillon chargé");
        } else {
            toast.error("Impossible de charger ce brouillon.");
        }
    };

    const handleProcessPending = async (q: PendingQuestionnaire) => {
        if (!sessionKey || !orgKey) return;
        setProcessingQueueId(q.id);
        try {
            const { data } = await supabase.from('pending_questionnaires').select('family_encrypted_data, practitioner_encrypted_key').eq('id', q.id).single();
            if (!data?.family_encrypted_data) return;
            
            // 1. Déchiffrement de la clé du questionnaire
            const [kIv, kContent] = data.practitioner_encrypted_key.split(':');
            const keyStr = await decryptData({ iv: kIv, content: kContent }, sessionKey);
            const jwk = JSON.parse(atob(keyStr));
            const qKey = await window.crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
            
            // 2. Déchiffrement des données famille
            const [dIv, dContent] = data.family_encrypted_data.split(':');
            const payload = await decryptData({ iv: dIv, content: dContent }, qKey);
            
            if (payload?.patient) {
                const newId = crypto.randomUUID();
                const newPatient = { ...payload.patient, id: newId };
                
                // 3. Création du dossier Patient (AVEC ORG_KEY)
                const newFile: PatientFile = { id: newId, patient: newPatient, reports: [], sessions: [], lastInteraction: new Date().toISOString() };
                await StorageService.saveFile(newFile, orgKey);
                
                // 4. Création Brouillon Initial (Privé -> sessionKey)
                const initialDraft = {
                    patient: newPatient,
                    tests: {},
                    observations: { anamnese: '', motricite: '', coordination: '', spatial: '', graphique: '' },
                    sections: [],
                    step: 1,
                    timestamp: new Date().toISOString()
                };
                
                // Sauvegarde avec l'ID du patient pour le lier
                await StorageService.saveDraft(initialDraft, sessionKey);
                
                // 5. Mise à jour des états UI
                // On ajoute ce patient à l'index des brouillons
                setDraftsIndex(prev => ({ ...prev, [newId]: initialDraft.timestamp }));
                setPatientFiles(prev => [newFile, ...prev]);
                setPendingQuestionnaires(prev => prev.filter(i => i.id !== q.id));
                
                // 6. Nettoyage
                await supabase.from('pending_questionnaires').delete().eq('id', q.id);
                
                // 7. Transition
                assessment.resetAssessment();
                assessment.loadFromDraft(initialDraft);
                setMode('assessment');
                toast.success("Dossier importé avec succès");
            }
        } catch (e) {
            Logger.error('CRYPTO', "Error importing pending questionnaire", e);
            toast.error("Erreur lors de l'importation du dossier.");
        } finally {
            setProcessingQueueId(null);
        }
    };

    /**
     * Helper to compute SHA-256 hash of a string (for anonymous source_hash)
     */
    const computeSourceHash = async (input: string): Promise<string> => {
        const msgBuffer = new TextEncoder().encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    };

    /**
     * Génère le rapport directement (Flux sans friction).
     * Inclut l'anonymisation et l'appel IA.
     */
    const handleGenerateReport = async () => {
        setShowConfirmGeneration(false);
        setIsGenerating(true); // Active le GenerationLoader
        
        try {
            // 1. Préparation & Anonymisation (Silent Process)
            const p = assessment.patient;
            const genderString = p.gender === 'F' ? 'une fille' : 'un garçon';
            
            // Construction des blocs de texte bruts
            const rawQ = `Motif: ${p.reason}\nScolarité: ${p.school} ${p.classLevel}\nVie: ${p.meals} ${p.dressing}`;
            const rawObs = `Anamnèse: ${assessment.observations.anamnese}\nMotricité: ${assessment.observations.motricite}`;
            
            // Anonymisation via l'utilitaire sécurisé
            const payload: GenerationPayload = {
                safeQuestionnaire: anonymizeData(rawQ, p).text,
                safeObservations: anonymizeData(rawObs, p).text,
                scoresRaw: JSON.stringify(assessment.tests, null, 2),
                childContext: `L'enfant est ${genderString} de ${p.age}.`
            };

            // 2. Appel IA (Consommation de crédit via Service)
            // Le AIService gère maintenant le Timeout
            const sections = await AIService.generateFullReport(payload, assessment.patient);
            
            // 3. CROWDSOURCING ANONYME (Privacy-Preserving)
            // On envoie les données statistiques seulement si la génération (donc paiement) a réussi
            if (practitioner && practitioner.organizationRole !== 'member') { // Basic check
                // Récupération de l'Org ID pour le hash
                const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', practitioner.id).maybeSingle();
                if (member?.organization_id) {
                    const sourceHash = await computeSourceHash(member.organization_id);
                    const insightsPayload: any[] = [];
                    
                    // Parsing simplifié de l'âge en mois
                    const ageMatches = p.age.match(/(\d+)\s*ans?\s*(\d+)?/);
                    let ageInMonths = 0;
                    if (ageMatches) {
                        ageInMonths = (parseInt(ageMatches[1]) * 12) + (parseInt(ageMatches[2] || '0'));
                    }

                    Object.entries(assessment.tests).forEach(([testId, subtests]) => {
                        Object.entries(subtests).forEach(([subId, score]) => {
                            if (score.status === 'validated' && score.raw !== '') {
                                // --- TEMPORAL FUZZING (JITTER) ---
                                // On génère un timestamp aléatoire dans le mois courant pour éviter la corrélation temporelle
                                // Cela satisfait "Mois/Année suffisants" tout en brisant le lien entre les scores d'une même session.
                                const now = new Date();
                                const randomDay = Math.floor(Math.random() * 28) + 1; // 1-28 pour éviter les débordements
                                const randomHour = Math.floor(Math.random() * 24);
                                const randomMin = Math.floor(Math.random() * 60);
                                const fuzzedDate = new Date(now.getFullYear(), now.getMonth(), randomDay, randomHour, randomMin);

                                insightsPayload.push({
                                    source_hash: sourceHash,
                                    age_months: ageInMonths,
                                    gender: p.gender === 'F' ? 'F' : 'M',
                                    is_clinical: true, // Par défaut car c'est un patient
                                    diagnostic_tag: 'Inconnu', // Pourrait être inféré
                                    test_id: testId,
                                    subtest_id: subId,
                                    raw_score: parseFloat(score.raw),
                                    computed_standard: parseFloat(score.standard) || null,
                                    computed_percentile: parseFloat(score.percentile) || null,
                                    created_at: fuzzedDate.toISOString() // Insertion explicite de la date bruitée
                                });
                            }
                        });
                    });

                    if (insightsPayload.length > 0) {
                        // Insert asynchrone sans await bloquant
                        supabase.from('contribution_insights').insert(insightsPayload).then(({ error }) => {
                            if (error) Logger.warn('DB', 'Failed to save anonymous insights', error);
                            else Logger.info('DB', 'Anonymous insights saved (Privacy-Preserved).');
                        });
                    }
                }
            }

            // 4. Mise à jour UI
            assessment.setSections(sections);
            assessment.setStep(4);
            refreshProfile(); // Actualise le solde de crédits
            toast.success("Rapport généré avec succès");

        } catch (e: any) {
            Logger.error('AI', "Generation Error in UI", e);
            if (e.message === "CREDIT_INSUFFICIENT") {
                setPricingModalMode('paywall');
            } else if (e.message === "TIMEOUT_AI") {
                toast.error("Le serveur IA est surchargé. Vos crédits n'ont pas été débités. Veuillez réessayer.");
            } else {
                toast.error("Une erreur est survenue lors de la génération : " + e.message);
            }
        } finally {
            setIsGenerating(false); // Désactive le GenerationLoader
        }
    };

    /**
     * FINALISATION ET PERSISTANCE (FIX CRITIQUE)
     * Convertit les données de travail en objets permanents, chiffre et stocke en DB.
     */
    const handleFinalize = async () => {
        if (!sessionKey || !orgKey) return;

        // 1. Sécurisation : On vérifie qu'on a un patient ID
        const patientId = assessment.patient.id;
        if (!patientId) {
            toast.error("Erreur critique : ID Patient manquant.");
            return;
        }

        setIsGenerating(true); // Show loader during encryption/save

        try {
            // 2. Construction de la Session de Tests (Flattening)
            const flatResults: Record<string, ScoreResult> = {};
            const testNames: string[] = [];

            Object.entries(assessment.tests).forEach(([tId, subtests]) => {
                // Récupération du nom depuis le catalogue
                const catalogDef = catalog.flatMap(c => c.tests).find(t => t.id === tId);
                const prettyName = catalogDef ? catalogDef.name : tId;
                testNames.push(prettyName);
                
                Object.entries(subtests).forEach(([sId, res]) => {
                    flatResults[sId] = res;
                });
            });

            const newSession: TestSession = {
                id: crypto.randomUUID(),
                date: new Date().toISOString(),
                testId: 'multi', // On marque comme multi-test ou le test principal
                testName: testNames.join(', ') || `Bilan du ${new Date().toLocaleDateString()}`,
                results: flatResults
            };

            // 3. Construction du Rapport (Contenu complet)
            // Note: On injecte 'sections' qui sera chiffré dans le blob JSON
            const newReport: ReportMetadata = {
                id: crypto.randomUUID(),
                date: new Date().toISOString(),
                type: 'initial', // Pourrait être dynamique
                status: 'completed',
                patientName: `${assessment.patient.firstName} ${assessment.patient.lastName}`,
                sections: assessment.sections // <--- PERSISTANCE DU CONTENU
            };

            // 4. Récupération du dossier existant pour mise à jour
            // On cherche dans la liste chargée localement
            const currentFileIndex = patientFiles.findIndex(f => f.id === patientId);
            if (currentFileIndex === -1) throw new Error("Dossier local introuvable");

            const currentFile = patientFiles[currentFileIndex];

            const updatedFile: PatientFile = {
                ...currentFile,
                lastInteraction: new Date().toISOString(),
                sessions: [newSession, ...(currentFile.sessions || [])],
                reports: [newReport, ...(currentFile.reports || [])]
            };

            // 5. SAUVEGARDE E2EE (Database) via StorageService qui gère le chiffrement
            await StorageService.saveFile(updatedFile, orgKey);

            // 6. Mise à jour State Local (Pour reflet immédiat dashboard)
            setPatientFiles(prev => {
                const newList = [...prev];
                newList[currentFileIndex] = updatedFile;
                return newList;
            });

            // 7. Nettoyage du Brouillon
            await StorageService.deleteDraft(patientId);
            setDraftsIndex(prev => {
                const newIndex = { ...prev };
                delete newIndex[patientId];
                return newIndex;
            });

            // 8. Sortie
            assessment.resetAssessment();
            setMode('dashboard');
            toast.success("Bilan sauvegardé et archivé avec succès.");

        } catch (e: any) {
            Logger.error('DB', "Erreur Finalisation", e);
            toast.error("Erreur lors de la sauvegarde : " + e.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleContributionAccess = () => {
        // Restriction : Accès réservé aux plans payants (pas de plan gratuit/essai)
        if (userProfile.subscriptionPlan === 'free') {
            setPricingModalMode('plans');
            return;
        }
        setMode('contribution');
    };

    // --- RENDUS ---

    // Écran de PIN (Déverrouillage)
    if (authState === 'locked' && practitioner) {
        return <PinUnlock practitioner={practitioner} onUnlock={handleUnlock} onLogout={logout} />;
    }

    // Écran Landing / Login
    if (mode === 'landing') {
        return (
            <div className="min-h-screen bg-[#F9F9F9] flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
                <div className="absolute inset-0 bg-gradient-to-br from-[#E07A5F]/5 to-[#3D405B]/5 pointer-events-none"></div>
                <div className="text-center space-y-8 z-10 animate-in fade-in zoom-in-95 duration-700">
                    <div className="flex justify-center">
                        <div className="w-24 h-24 bg-white rounded-[32px] shadow-xl shadow-[#3D405B]/10 flex items-center justify-center text-[#E07A5F] transform rotate-3 transition-transform hover:rotate-0">
                            <Sparkles size={48} fill="currentColor" className="text-[#E07A5F]/20" stroke="currentColor" />
                            <Sparkles size={48} className="absolute text-[#E07A5F]" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-5xl md:text-7xl font-serif font-bold text-[#3D405B] mb-2">AutoBilan<span className="text-[#E07A5F]">.</span></h1>
                        <p className="text-lg text-stone-500 font-medium">L'assistant clinique intelligent pour Ergothérapeutes.</p>
                    </div>
                    <div className="flex flex-col md:flex-row gap-4 mt-8 justify-center">
                        <button onClick={() => { if(authState==='locked') setMode('dashboard'); else setShowAuthModal(true); }} className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center justify-center gap-2 group">
                            Accès Praticien <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform"/>
                        </button>
                        <button onClick={() => setMode('portal')} className="bg-white text-[#3D405B] px-10 py-4 rounded-2xl font-bold shadow-md hover:shadow-lg border border-stone-100 hover:border-[#E07A5F]/30 transition-all flex items-center justify-center gap-2">
                            Espace Famille <User size={20}/>
                        </button>
                    </div>
                </div>
                {showAuthModal && (
                    <div className="fixed inset-0 z-50 bg-[#3D405B]/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                        {authMode === 'login' && authState !== 'registering' ? (
                            <div className="bg-white p-10 rounded-[40px] w-full max-w-md relative shadow-2xl border border-white/20 animate-in zoom-in-95 duration-300">
                                <button onClick={() => setShowAuthModal(false)} className="absolute top-6 right-6 p-2 bg-stone-50 rounded-full hover:bg-stone-100 text-stone-400 transition-colors"><X size={20}/></button>
                                
                                <div className="text-center mb-8">
                                    <h2 className="text-3xl font-serif font-bold text-[#3D405B]">Connexion</h2>
                                    <p className="text-stone-400 text-sm font-medium mt-1">Heureux de vous revoir.</p>
                                </div>

                                <form onSubmit={(e: any) => { e.preventDefault(); handleLogin(e.target.email.value, e.target.pass.value); }} className="space-y-5">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-2">Email</label>
                                        <input name="email" type="email" placeholder="votre@email.com" className="w-full p-4 bg-stone-50 border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[#3D405B] transition-all placeholder:text-stone-300 placeholder:font-normal" required />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-2">Mot de passe</label>
                                        <input name="pass" type="password" placeholder="••••••••" className="w-full p-4 bg-stone-50 border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[#3D405B] transition-all placeholder:text-stone-300 placeholder:font-normal" required />
                                    </div>
                                    
                                    <button 
                                        type="submit" 
                                        disabled={isLoggingIn}
                                        className="w-full py-4 bg-[#3D405B] text-white rounded-2xl font-bold text-lg shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] hover:shadow-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-4"
                                    >
                                        {isLoggingIn ? <Loader2 size={24} className="animate-spin" /> : "Se connecter"}
                                    </button>
                                </form>
                                <div className="mt-8 text-center pt-6 border-t border-stone-100">
                                    <p className="text-xs text-stone-400 font-medium mb-2">Pas encore de compte ?</p>
                                    <button onClick={() => setAuthMode('register')} className="text-[#E07A5F] font-bold hover:underline">Créer un compte praticien</button>
                                </div>
                            </div>
                        ) : (
                            <AuthWizard 
                                onCancel={() => { setShowAuthModal(false); setAuthMode('login'); }} 
                                onComplete={(p, k) => { setSessionKey(k); setShowOnboarding(true); setMode('dashboard'); setShowAuthModal(false); }} 
                                isProfileCompletion={authState === 'registering'}
                                initialEmail={tempEmail || ''}
                            />
                        )}
                    </div>
                )}
            </div>
        );
    }

    // Gestion des flux spéciaux (Onboarding, Portail, Admin)
    if (showOnboarding) return <OnboardingExperience onComplete={() => setShowOnboarding(false)} />;
    if (mode === 'portal') return <PatientPortal onBack={() => setMode('landing')} />;
    if (mode === 'contribution') return <ContributionStudio onClose={() => setMode('dashboard')} onSubmit={() => {}} />;
    if (mode === 'admin') return <AdminPanel userProfile={userProfile} onClose={() => setMode('dashboard')} />;

    // DASHBOARD & APPS
    return (
        <div className="min-h-screen bg-[#F9F9F9] pb-20 font-sans">
            {/* Header Commun */}
            <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-stone-100 px-6 h-20 flex items-center justify-between no-print shadow-sm">
                <div className="font-serif font-bold text-xl text-[#3D405B] cursor-pointer flex items-center gap-2" onClick={() => setMode('dashboard')}>
                    <Sparkles size={18} className="text-[#E07A5F]" /> AutoBilan.
                </div>
                <div className="flex items-center gap-3">
                    {mode === 'assessment' && assessment.isAutoSaving && <div className="text-xs text-amber-600 font-bold flex gap-1 items-center bg-amber-50 px-2 py-1 rounded-lg"><Loader2 size={12} className="animate-spin"/> Sauvegarde...</div>}
                    <button onClick={handleContributionAccess} className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full border border-stone-200 text-xs font-bold text-[#3D405B] hover:bg-stone-50 hover:border-[#3D405B] transition-all"><FilePlus size={14}/> Créer un Test</button>
                    <button onClick={() => setPricingModalMode('plans')} className="flex items-center gap-2 bg-[#F2CC8F]/20 text-[#d97706] px-4 py-2 rounded-full text-xs font-bold border border-[#F2CC8F]/50 hover:bg-[#F2CC8F]/30 transition-all"><Crown size={14}/> {userProfile.credits} Crédits</button>
                    <div className="h-8 w-px bg-stone-200 mx-1"></div>
                    <button onClick={logout} className="p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all" title="Déconnexion"><LogOut size={20}/></button>
                </div>
            </header>

            {mode === 'dashboard' && (
                <Dashboard 
                    userProfile={userProfile} pendingQuestionnaires={pendingQuestionnaires} patientFiles={patientFiles}
                    onCreateNew={() => { assessment.resetAssessment(); setMode('assessment'); }}
                    onGenerateLink={handleGenerateLink} onShowPricing={() => setPricingModalMode('plans')}
                    onOpenPatient={async (id) => { 
                        // Utilisation de orgKey pour charger les détails
                        const details = await StorageService.loadPatientDetails(id, orgKey!); 
                        setSelectedFile({ ...patientFiles.find(f => f.id === id)!, ...details }); 
                        setMode('detail'); 
                    }}
                    onProcessPending={handleProcessPending} processingQueueId={processingQueueId}
                    
                    draftsIndex={draftsIndex}
                    onResumeDraft={handleResumeDraft}
                    onContribute={handleContributionAccess}
                />
            )}

            {mode === 'detail' && selectedFile && (
                <PatientDetail 
                    file={selectedFile} onBack={() => setMode('dashboard')} 
                    onQuickEntry={() => setShowQuickEntry(true)} 
                    onNewBilan={() => { assessment.resetAssessment(); assessment.setPatient(selectedFile.patient); setMode('assessment'); }}
                    onOpenReport={() => {}}
                    
                    draftAvailable={!!draftsIndex[selectedFile.id]}
                    onResumeDraft={() => handleResumeDraft(selectedFile.id)}
                />
            )}

            {mode === 'assessment' && (
                <div className="max-w-7xl mx-auto p-6">
                    {assessment.step === 1 && <Step1Admin data={assessment.patient} updateData={assessment.updatePatient} onNext={() => assessment.setStep(2)} />}
                    {assessment.step === 2 && <Step2Tests patient={assessment.patient} tests={assessment.tests} updateTests={assessment.updateTests} onNext={() => assessment.setStep(3)} onBack={() => assessment.setStep(1)} onAcceptResponsibility={() => updateUserProfile({ hasAcceptedResponsibility: true })} onContribute={handleContributionAccess} userProfile={userProfile} />}
                    {assessment.step === 3 && <Step3Observations obs={assessment.observations} updateObs={assessment.updateObservations} tests={assessment.tests} onNext={() => { if(userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert') setShowConfirmGeneration(true); else setPricingModalMode('paywall'); }} onBack={() => assessment.setStep(2)} isGenerating={isGenerating} />}
                    
                    {/* FIX: Blindage contre undefined content */}
                    {assessment.step === 4 && <Step4Validation sections={assessment.sections} patient={assessment.patient} onValidateSection={(id, c) => assessment.updateSection(id, { status: 'validated', ...(c !== undefined ? { content: c } : {}) })} onNext={() => assessment.setStep(5)} onBack={() => setMode('dashboard')} />}
                    
                    {/* NOTE: handleFinalize est passé ici à onValidate */}
                    {assessment.step === 5 && <Step5Export patient={assessment.patient} sections={assessment.sections} tests={assessment.tests} onValidate={handleFinalize} onUpdateSection={assessment.updateSection} branding={userProfile.branding} onUpdateBranding={(b) => updateUserProfile({ branding: b })} isPremium={userProfile.subscriptionPlan !== 'free'} onShowPricing={() => setPricingModalMode('plans')} />}
                </div>
            )}

            {/* Modales Globales */}
            {pricingModalMode && (
                <PricingModal 
                    onClose={() => {
                        // Si le mode est "Paywall" (Abonnement expiré/invalide), la fermeture provoque la déconnexion
                        if (pricingModalMode === 'paywall' && authState === 'subscription_locked') {
                            logout();
                        } else {
                            setPricingModalMode(null);
                        }
                    }} 
                    onSelectPlan={() => toast.info("Intégration Stripe à venir")} 
                    onUnlockOneOff={() => toast.info("Intégration Stripe One-Off à venir")} 
                    isPaywallMode={pricingModalMode === 'paywall'} 
                />
            )}
            
            {createdLink && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-8 rounded-[32px] text-center max-w-lg shadow-2xl relative">
                        <button onClick={() => setCreatedLink(null)} className="absolute top-4 right-4 p-2 bg-stone-50 rounded-full text-stone-400 hover:text-[#3D405B]"><X size={20}/></button>
                        <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><LinkIcon size={32}/></div>
                        <h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Lien d'accès créé</h2>
                        <p className="text-stone-500 text-sm mb-6">Envoyez ce lien sécurisé à la famille.</p>
                        <div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl font-mono text-xs mb-6 flex items-center gap-3 text-[#3D405B]">
                            <div className="truncate flex-1 font-bold">{createdLink}</div>
                            <button onClick={() => { navigator.clipboard.writeText(createdLink); toast.success("Lien copié !"); }} className="hover:text-[#E07A5F] transition-colors"><Copy size={18}/></button>
                        </div>
                        <button onClick={() => setCreatedLink(null)} className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all">Terminer</button>
                    </div>
                </div>
            )}
            
            <GenerationLoader 
                isVisible={isGenerating} 
                onCancel={() => { setIsGenerating(false); toast.info("Génération annulée."); }} 
            />

            {showConfirmGeneration && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-8 rounded-[32px] max-w-md text-center shadow-2xl">
                        <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
                            <Sparkles size={40} />
                        </div>
                        <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Lancer l'analyse IA ?</h3>
                        <p className="text-stone-500 text-sm mb-4 font-medium">Cette action consommera <strong className="text-[#E07A5F]">1 crédit</strong>.</p>
                        
                        <div className="bg-stone-50 p-3 rounded-xl mb-8 border border-stone-100 flex gap-2 text-left">
                            <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-[10px] text-stone-500 leading-relaxed">
                                    <strong>Confidentialité :</strong> Les données sont anonymisées automatiquement avant l'envoi.
                                </p>
                                <p className="text-[10px] text-stone-500 leading-relaxed">
                                    <strong>Crowdsourcing :</strong> Les scores anonymes seront ajoutés à la base communautaire pour affiner les normes.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <button onClick={() => setShowConfirmGeneration(false)} className="flex-1 py-3 text-stone-400 font-bold hover:bg-stone-50 rounded-xl transition-colors">Annuler</button>
                            <button onClick={handleGenerateReport} className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">Confirmer</button>
                        </div>
                    </div>
                </div>
            )}
            {showQuickEntry && (
                <QuickEntryModal 
                    onClose={() => setShowQuickEntry(false)} 
                    onSave={async (sess) => { 
                        // Utilise orgKey car cela modifie un dossier patient
                        if(selectedFile && orgKey) { 
                            await StorageService.saveFile({ ...selectedFile, sessions: [sess, ...(selectedFile.sessions||[])] }, orgKey); 
                            setShowQuickEntry(false); 
                            toast.success("Séance ajoutée au dossier");
                        }
                    }} 
                />
            )}
        </div>
    );
};

export default function App() {
    return (
        <AuthProvider>
            <ToastProvider>
                <CatalogProvider>
                    <AssessmentProvider>
                        <AppRouter />
                    </AssessmentProvider>
                </CatalogProvider>
            </ToastProvider>
        </AuthProvider>
    );
}
