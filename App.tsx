
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
import { Sparkles, ArrowRight, LogOut, FilePlus, Crown, ShieldCheck, Save, Loader2, Link as LinkIcon, Copy, X, User, Lock } from 'lucide-react';
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
    const [pricingModalMode, setPricingModalMode] = useState<'plans' | 'paywall' | null>(null);
    const [showConfirmGeneration, setShowConfirmGeneration] = useState(false);
    const [showPrivacyAirlock, setShowPrivacyAirlock] = useState(false);
    const [showQuickEntry, setShowQuickEntry] = useState(false);
    const [createdLink, setCreatedLink] = useState<string | null>(null);
    const [pendingPayload, setPendingPayload] = useState<GenerationPayload | null>(null);
    
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
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'authenticated') {
            setMode('dashboard');
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'registering') {
            Logger.info("Redirecting to Wizard for profile completion");
            setMode('landing');
            setShowAuthModal(true); 
            setIsLoggingIn(false);
        }
    }, [authState]);

    // Chargement des données chiffrées
    useEffect(() => {
        if (sessionKey && authState === 'authenticated') {
            const loadData = async () => {
                const files = await StorageService.loadPatientList(sessionKey);
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

    // Gestion centralisée de la reprise de brouillon
    const handleResumeDraft = async (patientId?: string) => {
        if (!sessionKey) return;
        
        // Charger le brouillon spécifique
        const draftContent = await StorageService.getDraft(sessionKey, patientId);
        
        if (draftContent) {
            assessment.resetAssessment();
            assessment.loadFromDraft(draftContent);
            setMode('assessment');
        } else {
            alert("Impossible de charger ce brouillon.");
        }
    };

    const handleProcessPending = async (q: PendingQuestionnaire) => {
        if (!sessionKey) return;
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
                
                // 3. Création du dossier Patient
                const newFile: PatientFile = { id: newId, patient: newPatient, reports: [], sessions: [], lastInteraction: new Date().toISOString() };
                await StorageService.saveFile(newFile, sessionKey);
                
                // 4. Création Brouillon Initial
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
            }
        } catch (e) {
            console.error(e);
            alert("Erreur lors de l'importation du dossier.");
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
            refreshProfile();
        } catch (e: any) {
            if (e.message === "CREDIT_INSUFFICIENT") setPricingModalMode('paywall');
            else alert("Erreur IA: " + e.message);
        } finally {
            setIsGenerating(false);
            setPendingPayload(null);
        }
    };

    const handleFinalize = async () => {
        if (!sessionKey) return;
        
        // Supprimer le brouillon de CE patient
        if (assessment.patient.id) {
            await StorageService.deleteDraft(assessment.patient.id);
            // Mettre à jour l'index local
            setDraftsIndex(prev => {
                const newIndex = { ...prev };
                delete newIndex[assessment.patient.id!];
                return newIndex;
            });
        }
        
        assessment.resetAssessment();
        setMode('dashboard');
    };

    // --- RENDUS ---

    if (authState === 'locked' && practitioner) {
        return <PinUnlock practitioner={practitioner} onUnlock={handleUnlock} onLogout={logout} />;
    }

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
                    <button onClick={() => setMode('contribution')} className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full border border-stone-200 text-xs font-bold text-[#3D405B] hover:bg-stone-50 hover:border-[#3D405B] transition-all"><FilePlus size={14}/> Contribuer</button>
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
                        const details = await StorageService.loadPatientDetails(id, sessionKey!); 
                        setSelectedFile({ ...patientFiles.find(f => f.id === id)!, ...details }); 
                        setMode('detail'); 
                    }}
                    onProcessPending={handleProcessPending} processingQueueId={processingQueueId}
                    
                    // Passage de l'index des brouillons (Map)
                    draftsIndex={draftsIndex}
                    onResumeDraft={handleResumeDraft}
                />
            )}

            {mode === 'detail' && selectedFile && (
                <PatientDetail 
                    file={selectedFile} onBack={() => setMode('dashboard')} 
                    onQuickEntry={() => setShowQuickEntry(true)} 
                    onNewBilan={() => { assessment.resetAssessment(); assessment.setPatient(selectedFile.patient); setMode('assessment'); }}
                    onOpenReport={() => {}}
                    
                    // Vérification simple : est-ce que cet ID est dans la map ?
                    draftAvailable={!!draftsIndex[selectedFile.id]}
                    onResumeDraft={() => handleResumeDraft(selectedFile.id)}
                />
            )}

            {mode === 'assessment' && (
                <div className="max-w-7xl mx-auto p-6">
                    {assessment.step === 1 && <Step1Admin data={assessment.patient} updateData={assessment.updatePatient} onNext={() => assessment.setStep(2)} />}
                    {assessment.step === 2 && <Step2Tests patient={assessment.patient} tests={assessment.tests} updateTests={assessment.updateTests} onNext={() => assessment.setStep(3)} onBack={() => assessment.setStep(1)} onAcceptResponsibility={() => updateUserProfile({ hasAcceptedResponsibility: true })} onContribute={() => setMode('contribution')} userProfile={userProfile} />}
                    {assessment.step === 3 && <Step3Observations obs={assessment.observations} updateObs={assessment.updateObservations} tests={assessment.tests} onNext={() => { if(userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert') setShowConfirmGeneration(true); else setPricingModalMode('paywall'); }} onBack={() => assessment.setStep(2)} isGenerating={isGenerating} />}
                    {assessment.step === 4 && <Step4Validation sections={assessment.sections} patient={assessment.patient} onValidateSection={(id, c) => assessment.updateSection(id, { status: 'validated', content: c })} onNext={() => assessment.setStep(5)} onBack={() => setMode('dashboard')} />}
                    {assessment.step === 5 && <Step5Export patient={assessment.patient} sections={assessment.sections} tests={assessment.tests} onValidate={handleFinalize} onUpdateSection={assessment.updateSection} branding={userProfile.branding} onUpdateBranding={(b) => updateUserProfile({ branding: b })} isPremium={userProfile.subscriptionPlan !== 'free'} onShowPricing={() => setPricingModalMode('plans')} />}
                </div>
            )}

            {/* Modales Globales */}
            {pricingModalMode && <PricingModal onClose={() => setPricingModalMode(null)} onSelectPlan={() => alert("Stripe Integration")} onUnlockOneOff={() => alert("Stripe One-Off")} isPaywallMode={pricingModalMode === 'paywall'} />}
            {createdLink && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-8 rounded-[32px] text-center max-w-lg shadow-2xl relative">
                        <button onClick={() => setCreatedLink(null)} className="absolute top-4 right-4 p-2 bg-stone-50 rounded-full text-stone-400 hover:text-[#3D405B]"><X size={20}/></button>
                        <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><LinkIcon size={32}/></div>
                        <h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Lien d'accès créé</h2>
                        <p className="text-stone-500 text-sm mb-6">Envoyez ce lien sécurisé à la famille.</p>
                        <div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl font-mono text-xs mb-6 flex items-center gap-3 text-[#3D405B]">
                            <div className="truncate flex-1 font-bold">{createdLink}</div>
                            <button onClick={() => navigator.clipboard.writeText(createdLink)} className="hover:text-[#E07A5F] transition-colors"><Copy size={18}/></button>
                        </div>
                        <button onClick={() => setCreatedLink(null)} className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all">Terminer</button>
                    </div>
                </div>
            )}
            {showConfirmGeneration && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-8 rounded-[32px] max-w-md text-center shadow-2xl">
                        <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
                            <Sparkles size={40} />
                        </div>
                        <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Lancer l'analyse IA ?</h3>
                        <p className="text-stone-500 text-sm mb-8 font-medium">Cette action consommera <strong className="text-[#E07A5F]">1 crédit</strong> de votre solde.</p>
                        <div className="flex gap-4">
                            <button onClick={() => setShowConfirmGeneration(false)} className="flex-1 py-3 text-stone-400 font-bold hover:bg-stone-50 rounded-xl transition-colors">Annuler</button>
                            <button onClick={prepareGeneration} className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">Confirmer</button>
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
