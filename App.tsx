
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssessmentProvider, useAssessment } from './contexts/AssessmentContext';
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
import { PrivacyAirlockModal } from './components/assessment/PrivacyAirlockModal';
import { PatientDetail } from './components/dashboard/PatientDetail';
import { QuickEntryModal } from './components/dashboard/QuickEntryModal';
import { supabase } from './services/db';
import { StorageService } from './services/storage';
import { AIService, GenerationPayload } from './services/ai';
import { anonymizeData } from './utils/anonymizer';
import { seedDatabaseFromCatalog } from './services/seedCatalog';
import { PatientFile, Contribution, TestSession, PendingQuestionnaire } from './types';
import { Sparkles, ArrowRight, LogOut, FilePlus, Crown, ShieldCheck, Save, Loader2, Link as LinkIcon, Copy, X, User } from 'lucide-react';
import { decryptData, generateQuestionnaireKey, encryptData } from './utils/crypto';
import { Logger } from './utils/logger';

// --- ROUTEUR INTERNE ---
const AppRouter = () => {
    const { userProfile, practitioner, authState, sessionKey, setSessionKey, unlockSession, logout, updateUserProfile, refreshProfile, tempEmail } = useAuth();
    const assessment = useAssessment();
    
    // UI State local (Navigation)
    const [mode, setMode] = useState<'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'contribution' | 'detail'>('landing');
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    
    // Modals
    const [showPaywall, setShowPaywall] = useState(false);
    const [showConfirmGeneration, setShowConfirmGeneration] = useState(false);
    const [showPrivacyAirlock, setShowPrivacyAirlock] = useState(false);
    const [showQuickEntry, setShowQuickEntry] = useState(false);
    const [createdLink, setCreatedLink] = useState<string | null>(null);
    const [pendingPayload, setPendingPayload] = useState<GenerationPayload | null>(null);
    
    // Data Lists (Loaded on Dashboard)
    const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
    const [pendingQuestionnaires, setPendingQuestionnaires] = useState<PendingQuestionnaire[]>([]);
    const [selectedFile, setSelectedFile] = useState<PatientFile | null>(null);
    const [availableDraft, setAvailableDraft] = useState<any | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);

    // Initialisation
    useEffect(() => {
        const init = async () => {
            const params = new URLSearchParams(window.location.search);
            if (params.get('q_id') && window.location.hash.includes('key=')) {
                setMode('portal');
                return;
            }
            await seedDatabaseFromCatalog();
        };
        init();
    }, []);

    // Routing Logic basés sur authState
    useEffect(() => {
        Logger.debug("AppRouter authState changed:", authState);
        
        if (authState === 'unauthenticated') {
            setMode('landing');
            setIsLoggingIn(false);
        } else if (authState === 'locked') {
            // Le composant PinUnlock prendra le relais via le return conditionnel principal
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'authenticated') {
            setMode('dashboard');
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'registering') {
            Logger.info("Redirecting to Wizard for profile completion");
            setMode('landing');
            setShowAuthModal(true); // Force l'ouverture pour complétion
            setIsLoggingIn(false);
        }
    }, [authState]);

    // Chargement des données chiffrées
    useEffect(() => {
        if (sessionKey && authState === 'authenticated') {
            const loadData = async () => {
                const files = await StorageService.loadPatientList(sessionKey);
                setPatientFiles(files);
                const draft = await StorageService.getDraft(sessionKey);
                if (draft) setAvailableDraft(draft);
                
                if (practitioner) {
                    const { data } = await supabase.from('pending_questionnaires').select('*').eq('practitioner_id', practitioner.id).order('created_at', { ascending: false });
                    if (data) setPendingQuestionnaires(data.map((p: any) => ({ ...p, createdAt: p.created_at, practitionerEncryptedKey: p.practitioner_encrypted_key })));
                }
            };
            loadData();
        }
    }, [sessionKey, authState, practitioner]);

    // Handlers
    const handleLogin = async (email: string, pass: string) => {
        setIsLoggingIn(true);
        Logger.info("Attempting login for:", email);
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) { 
            Logger.error("Login failed:", error.message);
            alert(error.message); 
            setIsLoggingIn(false);
        } 
        // Note: On ne ferme PAS la modale ici. 
        // On attend que le useEffect détecte le changement d'authState vers 'locked' ou 'registering'.
    };

    const handleUnlock = (key: CryptoKey) => {
        unlockSession(key);
        setMode('dashboard');
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
        }
    };

    const handleProcessPending = async (q: PendingQuestionnaire) => {
        if (!sessionKey) return;
        setProcessingQueueId(q.id);
        try {
            const { data } = await supabase.from('pending_questionnaires').select('family_encrypted_data, practitioner_encrypted_key').eq('id', q.id).single();
            if (!data?.family_encrypted_data) return;
            
            const [kIv, kContent] = data.practitioner_encrypted_key.split(':');
            const keyStr = await decryptData({ iv: kIv, content: kContent }, sessionKey);
            const jwk = JSON.parse(atob(keyStr));
            const qKey = await window.crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
            
            const [dIv, dContent] = data.family_encrypted_data.split(':');
            const payload = await decryptData({ iv: dIv, content: dContent }, qKey);
            
            if (payload?.patient) {
                const newId = crypto.randomUUID();
                const newPatient = { ...payload.patient, id: newId };
                const newFile: PatientFile = { id: newId, patient: newPatient, reports: [], sessions: [], lastInteraction: new Date().toISOString() };
                await StorageService.saveFile(newFile, sessionKey);
                
                // Set Context
                assessment.resetAssessment();
                assessment.setPatient(newPatient);
                
                await supabase.from('pending_questionnaires').delete().eq('id', q.id);
                setPatientFiles(prev => [newFile, ...prev]);
                setPendingQuestionnaires(prev => prev.filter(i => i.id !== q.id));
                setMode('assessment');
            }
        } catch (e) {
            alert("Erreur déchiffrement dossier.");
        } finally {
            setProcessingQueueId(null);
        }
    };

    const prepareGeneration = () => {
        const p = assessment.patient;
        const genderString = p.gender === 'F' ? 'une fille' : 'un garçon';
        const rawQ = `Motif: ${p.reason}\nScolarité: ${p.school} ${p.classLevel}\nVie: ${p.meals} ${p.dressing}`;
        const rawObs = `Anamnèse: ${assessment.observations.anamnese}\nMotricité: ${assessment.observations.motricite}`;
        
        setPendingPayload({
            safeQuestionnaire: anonymizeData(rawQ, p).text,
            safeObservations: anonymizeData(rawObs, p).text,
            scoresRaw: JSON.stringify(assessment.tests, null, 2),
            childContext: `L'enfant est ${genderString} de ${p.age}.`
        });
        setShowConfirmGeneration(false);
        setShowPrivacyAirlock(true);
    };

    const executeGeneration = async () => {
        setShowPrivacyAirlock(false);
        if (!pendingPayload) return;
        setIsGenerating(true);
        try {
            const sections = await AIService.generateFullReport(pendingPayload, assessment.patient);
            assessment.setSections(sections);
            assessment.setStep(4);
            // Refresh credits locally
            refreshProfile();
        } catch (e: any) {
            if (e.message === "CREDIT_INSUFFICIENT") setShowPaywall(true);
            else alert("Erreur IA: " + e.message);
        } finally {
            setIsGenerating(false);
            setPendingPayload(null);
        }
    };

    const handleFinalize = async () => {
        if (!sessionKey) return;
        assessment.resetAssessment();
        await StorageService.clearDraft();
        setAvailableDraft(null);
        setMode('dashboard');
    };

    // --- RENDUS ---

    if (mode === 'landing') {
        return (
            <div className="min-h-screen bg-[#F9F9F9] flex flex-col items-center justify-center p-6 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-[#E07A5F]/5 to-[#3D405B]/5 pointer-events-none"></div>
                <div className="text-center space-y-8 z-10">
                    <div className="flex justify-center"><div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center text-[#E07A5F]"><Sparkles size={48}/></div></div>
                    <h1 className="text-5xl md:text-7xl font-serif font-bold text-[#3D405B]">AutoBilan<span className="text-[#E07A5F]">.</span></h1>
                    <div className="flex flex-col md:flex-row gap-4 mt-8">
                        <button onClick={() => { if(authState==='locked') setMode('dashboard'); else setShowAuthModal(true); }} className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-lg hover:bg-[#d0694e] transition-all flex items-center gap-2">
                            Accès Praticien <ArrowRight size={20}/>
                        </button>
                        <button onClick={() => setMode('portal')} className="bg-white text-[#3D405B] px-10 py-4 rounded-2xl font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-2">
                            Espace Famille <User size={20}/>
                        </button>
                    </div>
                </div>
                {showAuthModal && (
                    <div className="fixed inset-0 z-50 bg-[#3D405B]/60 backdrop-blur-sm flex items-center justify-center p-4">
                        {authMode === 'login' && authState !== 'registering' ? (
                            <div className="bg-white p-8 rounded-[32px] w-full max-w-md relative shadow-2xl">
                                <button onClick={() => setShowAuthModal(false)} className="absolute top-4 right-4"><X/></button>
                                <h2 className="text-2xl font-serif font-bold text-[#3D405B] mb-6">Connexion</h2>
                                <form onSubmit={(e: any) => { e.preventDefault(); handleLogin(e.target.email.value, e.target.pass.value); }} className="space-y-4">
                                    <input name="email" type="email" placeholder="Email" className="w-full p-4 bg-stone-50 rounded-xl" required />
                                    <input name="pass" type="password" placeholder="Mot de passe" className="w-full p-4 bg-stone-50 rounded-xl" required />
                                    <button 
                                        type="submit" 
                                        disabled={isLoggingIn}
                                        className="w-full py-4 bg-[#3D405B] text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-70"
                                    >
                                        {isLoggingIn ? <Loader2 size={20} className="animate-spin" /> : "Se connecter"}
                                    </button>
                                </form>
                                <button onClick={() => setAuthMode('register')} className="w-full mt-4 text-sm text-stone-400 font-bold">Créer un compte</button>
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

    if (authState === 'locked' && practitioner) return <PinUnlock practitioner={practitioner} onUnlock={handleUnlock} onLogout={logout} />;
    if (showOnboarding) return <OnboardingExperience onComplete={() => setShowOnboarding(false)} />;
    if (mode === 'portal') return <PatientPortal onBack={() => setMode('landing')} />;
    if (mode === 'contribution') return <ContributionStudio onClose={() => setMode('dashboard')} onSubmit={() => {}} />;
    if (mode === 'admin') return <AdminPanel userProfile={userProfile} onClose={() => setMode('dashboard')} />;

    // DASHBOARD & APPS
    return (
        <div className="min-h-screen bg-[#F9F9F9] pb-20">
            {/* Header Commun */}
            <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-stone-100 px-6 h-20 flex items-center justify-between no-print">
                <div className="font-serif font-bold text-xl text-[#3D405B] cursor-pointer" onClick={() => setMode('dashboard')}>AutoBilan.</div>
                <div className="flex items-center gap-3">
                    {mode === 'assessment' && assessment.isAutoSaving && <div className="text-xs text-amber-600 font-bold flex gap-1"><Loader2 size={12} className="animate-spin"/> Sauvegarde...</div>}
                    <button onClick={() => setMode('contribution')} className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold text-[#3D405B] hover:bg-stone-50"><FilePlus size={14}/> Contribuer</button>
                    <button onClick={() => setShowPaywall(true)} className="flex items-center gap-2 bg-amber-50 text-amber-800 px-3 py-1.5 rounded-full text-xs font-bold border border-amber-200"><Crown size={14}/> {userProfile.credits} Crédits</button>
                    <button onClick={logout} className="p-2 text-stone-400 hover:text-stone-600"><LogOut size={18}/></button>
                </div>
            </header>

            {mode === 'dashboard' && (
                <Dashboard 
                    userProfile={userProfile} pendingQuestionnaires={pendingQuestionnaires} patientFiles={patientFiles}
                    onCreateNew={() => { assessment.resetAssessment(); setMode('assessment'); }}
                    onGenerateLink={handleGenerateLink} onShowPricing={() => setShowPaywall(true)}
                    onOpenPatient={async (id) => { 
                        const details = await StorageService.loadPatientDetails(id, sessionKey!); 
                        setSelectedFile({ ...patientFiles.find(f => f.id === id)!, ...details }); 
                        setMode('detail'); 
                    }}
                    onProcessPending={handleProcessPending} processingQueueId={processingQueueId}
                    availableDraft={availableDraft} onResumeDraft={() => { assessment.loadFromDraft(availableDraft); setMode('assessment'); }}
                />
            )}

            {mode === 'detail' && selectedFile && (
                <PatientDetail 
                    file={selectedFile} onBack={() => setMode('dashboard')} 
                    onQuickEntry={() => setShowQuickEntry(true)} 
                    onNewBilan={() => { assessment.resetAssessment(); assessment.setPatient(selectedFile.patient); setMode('assessment'); }}
                    onOpenReport={() => {}}
                    draftAvailable={availableDraft?.patient?.id === selectedFile.id}
                    onResumeDraft={() => { assessment.loadFromDraft(availableDraft); setMode('assessment'); }}
                />
            )}

            {mode === 'assessment' && (
                <div className="max-w-7xl mx-auto p-6">
                    {assessment.step === 1 && <Step1Admin data={assessment.patient} updateData={assessment.updatePatient} onNext={() => assessment.setStep(2)} />}
                    {assessment.step === 2 && <Step2Tests patient={assessment.patient} tests={assessment.tests} updateTests={assessment.updateTests} onNext={() => assessment.setStep(3)} onBack={() => assessment.setStep(1)} onAcceptResponsibility={() => updateUserProfile({ hasAcceptedResponsibility: true })} onContribute={() => setMode('contribution')} userProfile={userProfile} />}
                    {assessment.step === 3 && <Step3Observations obs={assessment.observations} updateObs={assessment.updateObservations} tests={assessment.tests} onNext={() => { if(userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert') setShowConfirmGeneration(true); else setShowPaywall(true); }} onBack={() => assessment.setStep(2)} isGenerating={isGenerating} />}
                    {assessment.step === 4 && <Step4Validation sections={assessment.sections} patient={assessment.patient} onValidateSection={(id, c) => assessment.updateSection(id, { status: 'validated', content: c })} onNext={() => assessment.setStep(5)} onBack={() => setMode('dashboard')} />}
                    {assessment.step === 5 && <Step5Export patient={assessment.patient} sections={assessment.sections} tests={assessment.tests} onValidate={handleFinalize} onUpdateSection={assessment.updateSection} branding={userProfile.branding} onUpdateBranding={(b) => updateUserProfile({ branding: b })} isPremium={userProfile.subscriptionPlan !== 'free'} onShowPricing={() => setShowPaywall(true)} />}
                </div>
            )}

            {/* Modales Globales */}
            {showPaywall && <PricingModal onClose={() => setShowPaywall(false)} onSelectPlan={() => alert("Stripe Integration")} onUnlockOneOff={() => alert("Stripe One-Off")} isPaywallMode={true} />}
            {createdLink && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm">
                    <div className="bg-white p-8 rounded-2xl text-center max-w-lg">
                        <h2 className="font-bold text-2xl text-[#3D405B] mb-2">Lien Généré</h2>
                        <div className="bg-stone-50 p-4 rounded-xl font-mono text-xs mb-4 flex items-center gap-2"><div className="truncate flex-1">{createdLink}</div><button onClick={() => navigator.clipboard.writeText(createdLink)}><Copy size={16}/></button></div>
                        <button onClick={() => setCreatedLink(null)} className="bg-[#3D405B] text-white px-6 py-2 rounded-xl font-bold">Fermer</button>
                    </div>
                </div>
            )}
            {showConfirmGeneration && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm">
                    <div className="bg-white p-8 rounded-2xl max-w-md text-center">
                        <Sparkles size={48} className="mx-auto text-[#E07A5F] mb-4"/>
                        <h3 className="font-bold text-xl mb-2">Lancer l'analyse IA ?</h3>
                        <p className="text-stone-500 text-sm mb-6">Cela consommera 1 crédit.</p>
                        <div className="flex gap-4">
                            <button onClick={() => setShowConfirmGeneration(false)} className="flex-1 py-3 text-stone-400 font-bold">Annuler</button>
                            <button onClick={prepareGeneration} className="flex-1 py-3 bg-[#3D405B] text-white rounded-xl font-bold">Confirmer</button>
                        </div>
                    </div>
                </div>
            )}
            {showPrivacyAirlock && pendingPayload && (
                <PrivacyAirlockModal anonymizedContent={pendingPayload.safeQuestionnaire + '\n\n' + pendingPayload.safeObservations} onConfirm={executeGeneration} onCancel={() => setShowPrivacyAirlock(false)} />
            )}
            {showQuickEntry && (
                <QuickEntryModal onClose={() => setShowQuickEntry(false)} onSave={async (sess) => { if(selectedFile && sessionKey) { await StorageService.saveFile({ ...selectedFile, sessions: [sess, ...(selectedFile.sessions||[])] }, sessionKey); setShowQuickEntry(false); }}} />
            )}
        </div>
    );
};

export default function App() {
    return (
        <AuthProvider>
            <AssessmentProvider>
                <AppRouter />
            </AssessmentProvider>
        </AuthProvider>
    );
}
