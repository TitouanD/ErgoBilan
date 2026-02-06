
import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssessmentProvider, useAssessment } from './contexts/AssessmentContext';
import { CatalogProvider, useCatalog } from './contexts/CatalogContext'; 
import { ToastProvider, useToast } from './contexts/ToastContext';
import { Dashboard } from './components/dashboard/Dashboard';
import { PatientPortal } from './components/portal/PatientPortal';
import { AuthWizard } from './components/auth/AuthWizard';
import { PinUnlock } from './components/auth/PinUnlock';
// Step 1 reste statique pour un démarrage rapide du bilan
import { Step1Admin } from './components/assessment/Step1Admin';
import { GenerationLoader } from './components/shared/GenerationLoader';
import { supabase } from './services/db';
import { StorageService } from './services/storage';
import { AIService, GenerationPayload } from './services/ai';
import { anonymizeData } from './utils/anonymizer';
import { PatientFile, PendingQuestionnaire, ScoreResult, TestSession, ReportMetadata } from './types'; 
import { Sparkles, ArrowRight, LogOut, FilePlus, Crown, ShieldCheck, Link as LinkIcon, Copy, X, User, Loader2, PlayCircle, Eye, Rocket, Info, Save, RotateCcw, CheckCircle2, AlertTriangle, RefreshCw, FileText } from 'lucide-react';
import { decryptData, generateQuestionnaireKey, encryptData, importQuestionnaireKey } from './utils/crypto';
import { Logger } from './utils/logger';
import { RealtimeChannel } from '@supabase/supabase-js';
import { GlobalErrorBoundary } from './components/shared/GlobalErrorBoundary';
import { OfflineIndicator } from './components/shared/OfflineIndicator';
import { DEMO_PATIENTS } from './data/demoData';

// --- LAZY IMPORTS ---
const Step2Tests = React.lazy(() => import('./components/assessment/Step2Tests').then(module => ({ default: module.Step2Tests })));
const Step3Observations = React.lazy(() => import('./components/assessment/Step3Observations').then(module => ({ default: module.Step3Observations })));
const Step3BisDiagnostic = React.lazy(() => import('./components/assessment/Step3BisDiagnostic').then(module => ({ default: module.Step3BisDiagnostic }))); // NOUVEAU
const Step4Validation = React.lazy(() => import('./components/assessment/Step4Validation').then(module => ({ default: module.Step4Validation })));
const Step5Export = React.lazy(() => import('./components/assessment/Step5Export').then(module => ({ default: module.Step5Export })));

const AdminPanel = React.lazy(() => import('./components/admin/AdminPanel').then(module => ({ default: module.AdminPanel })));
const ContributionStudio = React.lazy(() => import('./components/admin/ContributionStudio').then(module => ({ default: module.ContributionStudio })));
const OnboardingExperience = React.lazy(() => import('./components/auth/OnboardingExperience').then(module => ({ default: module.OnboardingExperience })));

const PatientDetail = React.lazy(() => import('./components/dashboard/PatientDetail').then(module => ({ default: module.PatientDetail })));
const PricingModal = React.lazy(() => import('./components/shared/PricingModal').then(module => ({ default: module.PricingModal })));
const QuickEntryModal = React.lazy(() => import('./components/dashboard/QuickEntryModal').then(module => ({ default: module.QuickEntryModal })));

// --- LOADER LÉGER ---
const AppLoader = () => (
    <div className="flex h-[50vh] w-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
            <Loader2 size={40} className="animate-spin text-[#E07A5F]" />
            <p className="text-stone-400 font-bold text-xs uppercase tracking-widest animate-pulse">Chargement...</p>
        </div>
    </div>
);

// --- MODALES (Inchangées : DemoConversion, CriticalError) ---
const DemoConversionModal: React.FC<{ action: string; onClose: () => void; onConvert: () => void; }> = ({ action, onClose, onConvert }) => {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white max-w-md w-full rounded-[32px] p-8 shadow-2xl text-center relative">
                <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-stone-100 text-stone-400 transition-colors"><X size={20}/></button>
                <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]"><Rocket size={40} /></div>
                <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Convaincu(e) ?</h3>
                <p className="text-stone-500 text-sm mb-6 leading-relaxed">La fonctionnalité <strong>{action}</strong> nécessite un compte sécurisé.</p>
                <div className="space-y-3">
                    <button onClick={onConvert} className="w-full py-4 bg-[#E07A5F] text-white rounded-xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center justify-center gap-2">Créer mon compte gratuit <ArrowRight size={18} /></button>
                    <button onClick={onClose} className="w-full py-3 text-stone-400 font-bold hover:text-stone-600 transition-colors text-xs uppercase tracking-wider">Continuer à explorer</button>
                </div>
            </div>
        </div>
    );
};

const CriticalErrorModal: React.FC<{ error: string; onRetry: () => void; onClose: () => void; }> = ({ error, onRetry, onClose }) => {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/90 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white max-w-md w-full rounded-[32px] p-8 shadow-2xl text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-rose-500"></div>
                <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6 text-rose-500 animate-pulse"><AlertTriangle size={40} /></div>
                <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Interruption IA</h3>
                <p className="text-stone-500 text-sm mb-6 leading-relaxed">Le moteur IA n'a pas pu terminer.<br/><span className="font-bold text-rose-500 mt-2 block">{error}</span></p>
                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 py-3 text-stone-400 font-bold hover:bg-stone-50 rounded-xl transition-colors text-sm uppercase tracking-wider">Abandonner</button>
                    <button onClick={onRetry} className="flex-1 py-4 bg-[#3D405B] text-white rounded-xl font-bold shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-2"><RefreshCw size={18} /> Réessayer</button>
                </div>
            </div>
        </div>
    );
};

// --- ROUTEUR INTERNE ---
const AppRouter = () => {
    const { userProfile, practitioner, authState, sessionKey, orgKey, setSessionKey, unlockSession, logout, updateUserProfile, refreshProfile, tempEmail, startDemo, isDemoMode } = useAuth();
    const { catalog } = useCatalog(); 
    const assessment = useAssessment();
    const toast = useToast();
    
    const [mode, setMode] = useState<'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'contribution' | 'detail'>('landing');
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    
    const [pricingModalMode, setPricingModalMode] = useState<'plans' | 'paywall' | null>(null);
    const [showConfirmGeneration, setShowConfirmGeneration] = useState(false);
    const [showQuickEntry, setShowQuickEntry] = useState(false);
    
    const [createdLink, setCreatedLink] = useState<string | null>(null);
    const [linkCopiedConfirmed, setLinkCopiedConfirmed] = useState(false);
    const [demoConversion, setDemoConversion] = useState<{ show: boolean, action: string }>({ show: false, action: '' });

    const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
    const [pendingQuestionnaires, setPendingQuestionnaires] = useState<PendingQuestionnaire[]>([]);
    const [selectedFile, setSelectedFile] = useState<PatientFile | null>(null);
    const [draftsIndex, setDraftsIndex] = useState<Record<string, string>>({});
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);

    useEffect(() => { const init = async () => { const params = new URLSearchParams(window.location.search); if (params.get('q_id') && window.location.hash.includes('key=')) { Logger.info('UI', 'Redirecting to Family Portal via URL'); setMode('portal'); return; } }; init(); }, []);
    useEffect(() => { if (authState === 'unauthenticated') { setMode('landing'); setIsLoggingIn(false); } else if (authState === 'locked') { setShowAuthModal(false); setIsLoggingIn(false); } else if (authState === 'authenticated') { setMode('dashboard'); setShowAuthModal(false); setIsLoggingIn(false); } else if (authState === 'registering') { setMode('landing'); setShowAuthModal(true); setIsLoggingIn(false); } else if (authState === 'subscription_locked') { setIsLoggingIn(false); setShowAuthModal(false); setPricingModalMode('paywall'); } else if (authState === 'error') { setIsLoggingIn(false); toast.error("Problème de connexion."); } }, [authState]);
    const loadData = useCallback(async () => { if ((sessionKey && orgKey && authState === 'authenticated') || isDemoMode) { Logger.info('DB', 'Refreshing user data...'); const files = await StorageService.loadPatientList(orgKey!); setPatientFiles(files); const draftsMap = await StorageService.getDraftsMetadata(); setDraftsIndex(draftsMap); if (practitioner && !isDemoMode) { const { data } = await supabase.from('pending_questionnaires').select('*').eq('practitioner_id', practitioner.id).order('created_at', { ascending: false }); if (data) setPendingQuestionnaires(data.map((p: any) => ({ ...p, createdAt: p.created_at, practitionerEncryptedKey: p.practitioner_encrypted_key }))); } else if (isDemoMode) { setPendingQuestionnaires([{ id: 'demo-q1', label: 'Famille MARTIN (En attente)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' }, { id: 'demo-leo', label: 'Famille MARTIN (Dossier complet)', status: 'completed', createdAt: new Date(Date.now() - 86400000).toISOString(), practitionerEncryptedKey: '' }]); } } }, [sessionKey, orgKey, authState, practitioner, isDemoMode]);
    useEffect(() => { loadData(); }, [loadData]);
    const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => { if (!sessionKey || !orgKey || isDemoMode || authState !== 'authenticated') return; const handleRealtimeUpdate = (payload: any) => { if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current); refreshTimeoutRef.current = setTimeout(() => { loadData(); }, 1000); }; const channel = supabase.channel('dashboard-updates').on('postgres_changes', { event: '*', schema: 'public', table: 'pending_questionnaires' }, handleRealtimeUpdate).on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, handleRealtimeUpdate).subscribe(); return () => { supabase.removeChannel(channel); if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current); }; }, [sessionKey, orgKey, authState, isDemoMode, loadData]);

    const handleLogin = async (email: string, pass: string) => { setIsLoggingIn(true); const { error } = await supabase.auth.signInWithPassword({ email, password: pass }); if (error) { toast.error(error.message); setIsLoggingIn(false); } };
    const handleUnlock = (key: CryptoKey) => { unlockSession(key); setMode('dashboard'); };
    
    // NOUVEAU : Wrapper pour démarrer la démo avec Onboarding
    const handleStartDemo = async () => {
        await startDemo();
        setShowOnboarding(true);
    };

    const handleGenerateLink = async () => { if (isDemoMode) { setCreatedLink(`${window.location.origin}/?q_id=demo-q1#key=demo-key`); setPendingQuestionnaires(prev => [{ id: 'demo-new', label: 'Nouveau Dossier (Simulé)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' }, ...prev]); toast.success("Lien sécurisé généré"); return; } if (!practitioner || !sessionKey) return; const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', practitioner.id).maybeSingle(); if (!member?.organization_id) { toast.error("Erreur critique: Organisation introuvable."); return; } const { keyString } = await generateQuestionnaireKey(); const enc = await encryptData(keyString, sessionKey); const label = `Dossier #${pendingQuestionnaires.length + 1} (${new Date().toLocaleDateString()})`; const { data, error } = await supabase.from('pending_questionnaires').insert({ practitioner_id: practitioner.id, organization_id: member.organization_id, label, status: 'pending', practitioner_encrypted_key: `${enc.iv}:${enc.content}` }).select().single(); if (error) { toast.error("Impossible de créer le lien."); return; } if (data) { setCreatedLink(`${window.location.origin}/?q_id=${data.id}#key=${keyString}`); setLinkCopiedConfirmed(false); setPendingQuestionnaires(prev => [{ id: data.id, label: data.label, status: 'pending', createdAt: data.created_at, practitionerEncryptedKey: data.practitioner_encrypted_key }, ...prev]); toast.success("Lien sécurisé généré"); } };
    const handleCopyLink = async (q: PendingQuestionnaire) => { if (isDemoMode) { navigator.clipboard.writeText(`${window.location.origin}/?q_id=${q.id}#key=demo-key`); toast.success("Lien copié !"); return; } if (!sessionKey || !q.practitionerEncryptedKey) return; try { const [iv, content] = q.practitionerEncryptedKey.split(':'); const keyString = await decryptData({ iv, content }, sessionKey); await navigator.clipboard.writeText(`${window.location.origin}/?q_id=${q.id}#key=${keyString}`); toast.success("Lien copié"); } catch (e) { toast.error("Erreur déchiffrement lien"); } };
    const handleSaveAndQuit = async () => { if (sessionKey && assessment.patient.id) { try { const draftData = { patient: assessment.patient, tests: assessment.tests, observations: assessment.observations, synthesis: assessment.synthesis, sections: assessment.sections, step: assessment.step, timestamp: new Date().toISOString() }; await StorageService.saveDraft(draftData, sessionKey); toast.success("Brouillon sauvegardé"); } catch(e) { Logger.error('DB', "Save error", e); } } assessment.resetAssessment(); setMode('dashboard'); };
    const handleResumeDraft = async (patientId?: string) => { if (!sessionKey && !isDemoMode) return; const draftContent = await StorageService.getDraft(sessionKey!, patientId); if (draftContent) { assessment.resetAssessment(); assessment.loadFromDraft(draftContent); setMode('assessment'); } else if (isDemoMode) { toast.info("Brouillons désactivés en démo."); } else { toast.error("Impossible de charger ce brouillon."); } };
    
    // PROCESS PENDING (DEMO VS REAL)
    const handleProcessPending = async (q: PendingQuestionnaire) => { 
        if (isDemoMode) { 
            setProcessingQueueId(q.id); 
            setTimeout(async () => { 
                // Chargement des données LEO pour la démo
                // IMPORTANT: On utilise l'ID exact 'demo-leo' pour activer le Beacon
                const newId = 'demo-leo'; 
                // On utilise les données de Léo Martin pour le scénario "Wow"
                const newPatient = { ...DEMO_PATIENTS.LEO.patient, id: newId }; 
                const newTests = { ...DEMO_PATIENTS.LEO.tests };
                const newObs = { ...DEMO_PATIENTS.LEO.observations };

                setPatientFiles(prev => [{ id: newId, patient: newPatient, reports: [], sessions: [], lastInteraction: new Date().toISOString() }, ...prev]); 
                setPendingQuestionnaires(prev => prev.filter(i => i.id !== q.id)); 
                
                assessment.resetAssessment(); 
                assessment.setPatient(newPatient); 
                // On pré-remplit les tests et observations pour le scénario
                assessment.setTests(newTests);
                assessment.setObservations(newObs);
                
                setMode('assessment'); 
                setProcessingQueueId(null); 
                toast.success("Dossier importé et déchiffré"); 
            }, 1500); 
            return; 
        } 
        
        if (!sessionKey || !orgKey) return; 
        setProcessingQueueId(q.id); 
        try { 
            const { data } = await supabase.from('pending_questionnaires').select('family_encrypted_data, practitioner_encrypted_key').eq('id', q.id).single(); 
            if (!data?.family_encrypted_data) return; 
            const [kIv, kContent] = data.practitioner_encrypted_key.split(':'); 
            const keyStr = await decryptData({ iv: kIv, content: kContent }, sessionKey); 
            const qKey = await importQuestionnaireKey(keyStr); 
            const [dIv, dContent] = data.family_encrypted_data.split(':'); 
            const payload = await decryptData({ iv: dIv, content: dContent }, qKey); 
            if (payload?.patient) { 
                const newId = crypto.randomUUID(); 
                const newPatient = { ...payload.patient, id: newId }; 
                const newFile: PatientFile = { id: newId, patient: newPatient, reports: [], sessions: [], lastInteraction: new Date().toISOString() }; 
                await StorageService.saveFile(newFile, orgKey); 
                const initialDraft = { patient: newPatient, tests: {}, observations: { anamnese: '', motricite: '', coordination: '', spatial: '', graphique: '' }, synthesis: { diagnosticInput: '', recommendationsInput: '' }, sections: [], step: 1, timestamp: new Date().toISOString() }; 
                await StorageService.saveDraft(initialDraft, sessionKey); 
                loadData(); 
                await supabase.from('pending_questionnaires').delete().eq('id', q.id); 
                assessment.resetAssessment(); 
                assessment.loadFromDraft(initialDraft); 
                setMode('assessment'); 
                toast.success("Dossier importé"); 
            } 
        } catch (e) { 
            Logger.error('CRYPTO', "Import Error", e); 
            toast.error("Erreur importation."); 
        } finally { 
            setProcessingQueueId(null); 
        } 
    };

    // --- MODIFICATION MAJEURE DU WORKFLOW ---
    
    // Le bouton "Générer" se trouve désormais sur Step 3.5 (Step 4 logique)
    const handleGenerateReport = async () => {
        if (isDemoMode) {
            setShowConfirmGeneration(false);
            setIsGenerating(true);
            setTimeout(async () => {
                // Simulation d'une réponse IA riche (Markdown) mais avec LES BONS IDS
                // IDs attendus par ReportView : mandat_ref, mandat_eval, profil, diagnostic, objectifs, recommandations
                const sections = [ 
                    { 
                        id: 'mandat_ref', 
                        title: 'Mandat de référencement', 
                        content: "**Motif de la demande**\nL'évaluation a été sollicitée par Mme Martin et l'équipe enseignante de l'école Jules Ferry suite à des difficultés persistantes dans le domaine scolaire, notamment concernant l'écriture manuscrite et une fatigabilité importante l'après-midi.", 
                        status: 'draft', 
                        isAiGenerated: true 
                    },
                    { 
                        id: 'mandat_eval', 
                        title: "Motif de l'évaluation", 
                        content: "**Contexte**\nLéo, 9 ans, est scolarisé en CM1. Il bénéficie actuellement d'un PAP. Le bilan vise à objectiver les difficultés graphiques et à proposer des adaptations pour la suite de la scolarité.", 
                        status: 'draft', 
                        isAiGenerated: true 
                    },
                    { 
                        id: 'profil', 
                        title: "Profil occupationnel", 
                        content: "**Habitudes de vie**\nLéo est un enfant volontaire mais qui exprime une frustration face à ses échecs scolaires. À la maison, l'autonomie est acquise pour l'habillage mais les gestes fins (boutons, lacets) restent coûteux.", 
                        status: 'draft', 
                        isAiGenerated: true 
                    },
                    { 
                        id: 'diagnostic', 
                        title: 'Synthèse Clinique', 
                        content: "### Analyse du profil\nL'évaluation met en évidence un **Trouble Développemental de la Coordination (TDC)** affectant de manière significative la sphère graphique.\n\n### Points clés\n- **Dysgraphie mixte** : Les scores au BHK (Vitesse à -1.2 ET et Qualité à -2.1 ET) confirment une écriture à la fois lente et coûteuse sur le plan cognitif.\n- **Fatigabilité** : Lenteur d'exécution motrice généralisée, impactant la double tâche (écouter et écrire).\n- **Impact Psychologique** : On note une anxiété de performance importante, majorant les symptômes en situation de classe.", 
                        status: 'draft', 
                        isAiGenerated: true 
                    },
                    { 
                        id: 'objectifs', 
                        title: "Projet d'Intervention", 
                        content: "### Objectifs à court terme\n- Améliorer le confort graphique pour réduire les douleurs au poignet.\n- Mettre en place l'outil informatique (Clavier caché).\n\n### Objectifs à moyen terme\n- Restaurer l'estime de soi scolaire.\n- Autonomie complète dans la prise de cours informatisée.", 
                        status: 'draft', 
                        isAiGenerated: true 
                    },
                    { 
                        id: 'recommandations', 
                        title: 'Préconisations', 
                        content: "### À l'école\n- **Allègement de la trace écrite** : Fournir des photocopies de cours ou permettre l'utilisation d'une tablette/ordinateur (GEVA-Sco).\n- **Tiers-temps** : À envisager pour les évaluations longues.\n\n### Suivi thérapeutique\n- Poursuite du suivi en ergothérapie axé sur :\n  - L'apprentissage du clavier caché.\n  - La gestion de la fatigue et l'ergonomie posturale.", 
                        status: 'draft', 
                        isAiGenerated: true 
                    }
                ] as any;
                assessment.setSections(sections);
                assessment.setStep(5); // Vers Validation
                setIsGenerating(false);
                toast.success("Rapport généré (Simulation)");
            }, 3000); // 3s pour l'effet Wow
            return;
        }

        setShowConfirmGeneration(false);
        setGenerationError(null);
        setIsGenerating(true); 
        try {
            const p = assessment.patient;
            const genderString = p.gender === 'F' ? 'une fille' : 'un garçon';
            const rawQ = `Motif: ${p.reason}\nScolarité: ${p.school} ${p.classLevel}\nVie: ${p.meals} ${p.dressing}`;
            const rawObs = `Anamnèse: ${assessment.observations.anamnese}\nMotricité: ${assessment.observations.motricite}`;
            const payload: GenerationPayload = {
                safeQuestionnaire: anonymizeData(rawQ, p).text,
                safeObservations: anonymizeData(rawObs, p).text,
                scoresRaw: JSON.stringify(assessment.tests, null, 2),
                childContext: `L'enfant est ${genderString} de ${p.age}.`,
                synthesis: assessment.synthesis // NOUVEAU: Injection du diagnostic
            };
            const sections = await AIService.generateFullReport(payload, assessment.patient);
            assessment.setSections(sections);
            assessment.setStep(5); // Vers Validation (Step 4 -> 5)
            refreshProfile(); 
            toast.success("Rapport généré avec succès");
        } catch (e: any) {
            Logger.error('AI', "Generation Error", e);
            if (e.message === "CREDIT_INSUFFICIENT") setPricingModalMode('paywall');
            else if (e.message === "TIMEOUT_AI") setGenerationError("Le serveur IA ne répond pas.");
            else setGenerationError(e.message || "Erreur inconnue.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFinalize = async () => {
        if (isDemoMode) { setMode('dashboard'); toast.success("Bilan validé"); return; }
        if (!sessionKey || !orgKey) return;
        const patientId = assessment.patient.id;
        if (!patientId) { toast.error("Erreur ID Patient."); return; }
        setIsGenerating(true); 
        try {
            const flatResults: Record<string, ScoreResult> = {};
            const testNames: string[] = [];
            Object.entries(assessment.tests).forEach(([tId, subtests]) => {
                const catalogDef = catalog.flatMap(c => c.tests).find(t => t.id === tId);
                testNames.push(catalogDef ? catalogDef.name : tId);
                Object.entries(subtests).forEach(([sId, res]) => flatResults[sId] = res);
            });
            const newSession: TestSession = { id: crypto.randomUUID(), date: new Date().toISOString(), testId: 'multi', testName: testNames.join(', ') || `Bilan`, results: flatResults };
            const newReport: ReportMetadata = { id: crypto.randomUUID(), date: new Date().toISOString(), type: 'initial', status: 'completed', patientName: `${assessment.patient.firstName} ${assessment.patient.lastName}`, sections: assessment.sections };
            
            const currentFileIndex = patientFiles.findIndex(f => f.id === patientId);
            let currentFile = currentFileIndex === -1 ? { id: patientId, patient: assessment.patient, reports: [], sessions: [], lastInteraction: new Date().toISOString(), archived: false } : patientFiles[currentFileIndex];
            const updatedFile: PatientFile = { ...currentFile, lastInteraction: new Date().toISOString(), sessions: [newSession, ...(currentFile.sessions || [])], reports: [newReport, ...(currentFile.reports || [])] };
            
            await StorageService.saveFile(updatedFile, orgKey);
            await StorageService.deleteDraft(patientId);
            loadData();
            assessment.resetAssessment();
            setMode('dashboard');
            toast.success("Bilan sauvegardé.");
        } catch (e: any) {
            Logger.error('DB', "Erreur Finalisation", e);
            toast.error("Erreur sauvegarde.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleContributionAccess = () => { if (isDemoMode) { setDemoConversion({ show: true, action: "La contribution" }); return; } if (userProfile.subscriptionPlan === 'free') { setPricingModalMode('plans'); return; } setMode('contribution'); };

    // --- RENDUS ---
    if (authState === 'locked' && practitioner && !isDemoMode) return <PinUnlock practitioner={practitioner} onUnlock={handleUnlock} onLogout={logout} />;
    
    // LANDING (Simplified for XML brevity - assuming original landing logic)
    if (mode === 'landing') {
        // ... (Code identique au fichier original pour le landing) ...
        return (
            <div className="min-h-screen bg-[#F9F9F9] flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
                {/* ... (Contenu Landing identique) ... */}
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
                    <div className="mt-8 animate-in slide-in-from-bottom-8 fade-in duration-700 delay-500">
                        {/* UPDATE : Appel du nouveau handler handleStartDemo */}
                        <p className="text-stone-400 text-sm">Pas encore de compte ? <button onClick={handleStartDemo} className="font-bold text-[#3D405B] hover:text-[#E07A5F] underline underline-offset-2 transition-colors cursor-pointer">Explorer l'interface sans inscription</button></p>
                    </div>
                </div>
                {showAuthModal && (
                    <div className="fixed inset-0 z-50 bg-[#3D405B]/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                        {authMode === 'login' && authState !== 'registering' ? (
                            <div className="bg-white p-10 rounded-[40px] w-full max-w-md relative shadow-2xl border border-white/20 animate-in zoom-in-95 duration-300">
                                <button onClick={() => setShowAuthModal(false)} className="absolute top-6 right-6 p-2 bg-stone-50 rounded-full hover:bg-stone-100 text-stone-400 transition-colors"><X size={20}/></button>
                                <div className="text-center mb-8"><h2 className="text-3xl font-serif font-bold text-[#3D405B]">Connexion</h2><p className="text-stone-400 text-sm font-medium mt-1">Heureux de vous revoir.</p></div>
                                <form onSubmit={(e: any) => { e.preventDefault(); handleLogin(e.target.email.value, e.target.pass.value); }} className="space-y-5">
                                    <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-2">Email</label><input name="email" type="email" placeholder="votre@email.com" className="w-full p-4 bg-stone-50 border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[#3D405B] transition-all" required /></div>
                                    <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-2">Mot de passe</label><input name="pass" type="password" placeholder="••••••••" className="w-full p-4 bg-stone-50 border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[#3D405B] transition-all" required /></div>
                                    <button type="submit" disabled={isLoggingIn} className="w-full py-4 bg-[#3D405B] text-white rounded-2xl font-bold text-lg shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] hover:shadow-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-4">{isLoggingIn ? <Loader2 size={24} className="animate-spin" /> : "Se connecter"}</button>
                                </form>
                                <div className="mt-8 text-center pt-6 border-t border-stone-100"><p className="text-xs text-stone-400 font-medium mb-2">Pas encore de compte ?</p><button onClick={() => setAuthMode('register')} className="text-[#E07A5F] font-bold hover:underline">Créer un compte praticien</button></div>
                            </div>
                        ) : (
                            <AuthWizard onCancel={() => { setShowAuthModal(false); setAuthMode('login'); }} onComplete={(p, k) => { setSessionKey(k); setShowOnboarding(true); setMode('dashboard'); setShowAuthModal(false); }} isProfileCompletion={authState === 'registering'} initialEmail={tempEmail || ''} />
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F9F9F9] pb-20 font-sans">
            <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-stone-100 px-6 h-20 flex items-center justify-between no-print shadow-sm">
                <div className="font-serif font-bold text-xl text-[#3D405B] cursor-pointer flex items-center gap-2" onClick={() => { if(mode !== 'assessment') setMode('dashboard'); }}>
                    <Sparkles size={18} className="text-[#E07A5F]" /> AutoBilan.
                </div>
                <div className="flex items-center gap-3">
                    {mode === 'assessment' ? (
                        <>
                            {assessment.isAutoSaving && <div className="text-xs text-amber-600 font-bold flex gap-1 items-center bg-amber-50 px-2 py-1 rounded-lg mr-2"><Loader2 size={12} className="animate-spin"/> Sauvegarde...</div>}
                            <button onClick={handleSaveAndQuit} className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-rose-50 text-stone-600 hover:text-rose-600 rounded-xl font-bold text-xs uppercase tracking-wider transition-all border border-stone-200 hover:border-rose-200"><Save size={16} /> <span className="hidden md:inline">Sauvegarder & Quitter</span></button>
                        </>
                    ) : (
                        <>
                            <button onClick={handleContributionAccess} className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full border border-stone-200 text-xs font-bold text-[#3D405B] hover:bg-stone-50 hover:border-[#3D405B] transition-all"><FilePlus size={14}/> Créer un Test</button>
                            <button onClick={() => setPricingModalMode('plans')} className="flex items-center gap-2 bg-[#F2CC8F]/20 text-[#d97706] px-4 py-2 rounded-full text-xs font-bold border border-[#F2CC8F]/50 hover:bg-[#F2CC8F]/30 transition-all"><Crown size={14}/> {userProfile.credits} Crédits</button>
                            <div className="h-8 w-px bg-stone-200 mx-1"></div>
                            <button onClick={logout} className="p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all" title="Déconnexion"><LogOut size={20}/></button>
                        </>
                    )}
                </div>
            </header>

            {isDemoMode && <div className="bg-[#F2CC8F] text-[#78350f] py-2 px-6 sticky top-20 z-30 shadow-lg flex justify-center items-center gap-4 animate-in slide-in-from-top-2"><div className="flex items-center gap-2 text-sm"><Info size={16} strokeWidth={3} /><span className="font-bold uppercase tracking-widest">MODE DÉMONSTRATION - Aucune donnée ne sera sauvegardée</span></div><button onClick={() => logout()} className="bg-[#3D405B] text-white px-4 py-1.5 rounded-full text-[10px] font-bold uppercase hover:bg-[#2c2e42] transition-colors flex items-center gap-2 shadow-md">S'inscrire gratuitement <ArrowRight size={12} /></button></div>}

            <GlobalErrorBoundary>
                <OfflineIndicator />
                <Suspense fallback={<AppLoader />}>
                    {mode === 'dashboard' && <Dashboard userProfile={userProfile} pendingQuestionnaires={pendingQuestionnaires} patientFiles={patientFiles} onCreateNew={() => { assessment.resetAssessment(); setMode('assessment'); }} onGenerateLink={handleGenerateLink} onShowPricing={() => setPricingModalMode('plans')} onOpenPatient={async (id) => { try { const details = await StorageService.loadPatientDetails(id, orgKey!); const baseFile = patientFiles.find(f => f.id === id); if (baseFile) { setSelectedFile({ ...baseFile, ...details, patient: details.patient }); setMode('detail'); } } catch (e) { toast.error("Impossible d'ouvrir ce dossier."); } }} onProcessPending={handleProcessPending} processingQueueId={processingQueueId} draftsIndex={draftsIndex} onResumeDraft={handleResumeDraft} onContribute={handleContributionAccess} isDemoMode={isDemoMode} onCopyLink={handleCopyLink} />}
                    {mode === 'detail' && selectedFile && <PatientDetail file={selectedFile} onBack={() => setMode('dashboard')} onQuickEntry={() => setShowQuickEntry(true)} onNewBilan={() => { assessment.resetAssessment(); assessment.setPatient(selectedFile.patient); setMode('assessment'); }} onOpenReport={() => {}} draftAvailable={!!draftsIndex[selectedFile.id]} onResumeDraft={() => handleResumeDraft(selectedFile.id)} />}
                    {showOnboarding && <OnboardingExperience onComplete={() => setShowOnboarding(false)} />}
                    {mode === 'portal' && <PatientPortal onBack={() => setMode('landing')} />}
                    {mode === 'contribution' && <ContributionStudio onClose={() => setMode('dashboard')} onSubmit={() => {}} />}
                    {mode === 'admin' && <AdminPanel userProfile={userProfile} onClose={() => setMode('dashboard')} />}

                    {/* --- WORKFLOW ASSESSMENT MISE À JOUR --- */}
                    {mode === 'assessment' && (
                        <div className="max-w-7xl mx-auto p-6">
                            {/* Step 1: Admin */}
                            {assessment.step === 1 && <Step1Admin data={assessment.patient} updateData={assessment.updatePatient} onNext={() => assessment.setStep(2)} onPatientCreated={loadData} />}
                            
                            {/* Step 2: Tests */}
                            {assessment.step === 2 && <Step2Tests patient={assessment.patient} tests={assessment.tests} updateTests={assessment.updateTests} onNext={() => assessment.setStep(3)} onBack={() => assessment.setStep(1)} onAcceptResponsibility={() => updateUserProfile({ hasAcceptedResponsibility: true })} onContribute={handleContributionAccess} userProfile={userProfile} />}
                            
                            {/* Step 3: Observations */}
                            {assessment.step === 3 && <Step3Observations obs={assessment.observations} updateObs={assessment.updateObservations} tests={assessment.tests} onNext={() => assessment.setStep(4)} onBack={() => assessment.setStep(2)} isGenerating={false} />}
                            
                            {/* Step 4 (NEW): Synthèse & Projet - C'est ici qu'on déclenche l'IA */}
                            {assessment.step === 4 && <Step3BisDiagnostic synthesis={assessment.synthesis} updateSynthesis={assessment.updateSynthesis} tests={assessment.tests} onNext={() => { if(userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert' || isDemoMode) setShowConfirmGeneration(true); else setPricingModalMode('paywall'); }} onBack={() => assessment.setStep(3)} isGenerating={isGenerating} />}
                            
                            {/* Step 5 (Ex Step 4): Validation */}
                            {assessment.step === 5 && <Step4Validation sections={assessment.sections} patient={assessment.patient} onValidateSection={(id, c) => assessment.updateSection(id, { status: 'validated', ...(c !== undefined ? { content: c } : {}) })} onNext={() => assessment.setStep(6)} onBack={() => assessment.setStep(4)} />}
                            
                            {/* Step 6 (Ex Step 5): Export */}
                            {assessment.step === 6 && <Step5Export patient={assessment.patient} sections={assessment.sections} tests={assessment.tests} onValidate={handleFinalize} onUpdateSection={assessment.updateSection} branding={userProfile.branding} onUpdateBranding={(b) => updateUserProfile({ branding: b })} isPremium={userProfile.subscriptionPlan !== 'free'} onShowPricing={() => setPricingModalMode('plans')} onBack={() => assessment.setStep(5)} />}
                        </div>
                    )}

                    {pricingModalMode && <PricingModal onClose={() => { if (pricingModalMode === 'paywall' && authState === 'subscription_locked') { logout(); } else { setPricingModalMode(null); } }} onSelectPlan={() => toast.info("Stripe à venir")} onUnlockOneOff={() => toast.info("Stripe à venir")} isPaywallMode={pricingModalMode === 'paywall'} />}
                    {showQuickEntry && <QuickEntryModal onClose={() => setShowQuickEntry(false)} onSave={async (sess) => { if(selectedFile && orgKey) { await StorageService.saveFile({ ...selectedFile, sessions: [sess, ...(selectedFile.sessions||[])] }, orgKey); setShowQuickEntry(false); } else if (isDemoMode) { setShowQuickEntry(false); } }} />}
                </Suspense>
            </GlobalErrorBoundary>
            
            {createdLink && <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200"><div className="bg-white p-8 rounded-[32px] text-center max-w-lg shadow-2xl relative"><div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><LinkIcon size={32}/></div><h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Lien d'accès créé</h2><p className="text-stone-500 text-sm mb-6">Attention : Ce lien n'est affiché qu'une seule fois ici.</p><div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl font-mono text-xs mb-6 flex items-center gap-3 text-[#3D405B]"><div className="truncate flex-1 font-bold">{createdLink}</div><button onClick={() => { navigator.clipboard.writeText(createdLink); toast.success("Lien copié !"); }} className="hover:text-[#E07A5F] transition-colors"><Copy size={18}/></button></div><div className="flex items-center justify-center gap-3 mb-6 p-3 rounded-xl hover:bg-stone-50 cursor-pointer" onClick={() => setLinkCopiedConfirmed(!linkCopiedConfirmed)}><div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${linkCopiedConfirmed ? 'bg-[#E07A5F] border-[#E07A5F] text-white' : 'border-stone-300 bg-white'}`}>{linkCopiedConfirmed && <CheckCircle2 size={14} strokeWidth={3} />}</div><span className="text-xs font-bold text-stone-600 select-none">J'ai bien copié le lien et je l'ai sécurisé.</span></div><button onClick={() => setCreatedLink(null)} disabled={!linkCopiedConfirmed} className={`w-full py-3 rounded-xl font-bold shadow-lg transition-all ${linkCopiedConfirmed ? 'bg-[#3D405B] text-white hover:bg-[#2c2e42]' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>Terminer</button></div></div>}
            <GenerationLoader isVisible={isGenerating} onCancel={() => setIsGenerating(false)} />
            {generationError && <CriticalErrorModal error={generationError} onRetry={() => { setGenerationError(null); handleGenerateReport(); }} onClose={() => setGenerationError(null)} />}
            
            {/* POPUP CONFIRMATION IA (Déplacé ici pour être déclenché depuis Step 3.5) */}
            {showConfirmGeneration && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-8 rounded-[32px] max-w-md text-center shadow-2xl">
                        <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]"><FileText size={40} /></div>
                        <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Vérification avant analyse</h3>
                        <p className="text-stone-500 text-sm mb-4 font-medium leading-relaxed">
                            La qualité du rapport dépend de la précision de vos observations et du diagnostic posé. Avez-vous tout relu ?
                        </p>
                        <div className="bg-stone-50 p-3 rounded-xl mb-8 border border-stone-100 flex gap-2 text-left">
                            <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
                            <div className="space-y-1"><p className="text-[10px] text-stone-500 leading-relaxed"><strong>Confidentialité :</strong> Les données sont anonymisées automatiquement avant l'envoi.</p></div>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowConfirmGeneration(false)} className="flex-1 py-3 text-stone-400 font-bold hover:bg-stone-50 rounded-xl transition-colors text-xs uppercase tracking-wider">Retourner ajouter des détails</button>
                            <button id="demo-btn-generate" onClick={handleGenerateReport} className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">
                                {isDemoMode ? "Générer" : "Générer (1 crédit)"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {demoConversion.show && <DemoConversionModal action={demoConversion.action} onClose={() => setDemoConversion({ show: false, action: '' })} onConvert={() => { setDemoConversion({ show: false, action: '' }); logout(); }} />}
        </div>
    );
};

// --- ROOT COMPONENT ---
const App = () => {
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
};

export default App;
