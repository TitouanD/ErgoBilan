
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssessmentProvider, useAssessment } from './contexts/AssessmentContext';
import { CatalogProvider, useCatalog } from './contexts/CatalogContext'; 
import { ToastProvider, useToast } from './contexts/ToastContext';
import { Dashboard } from './components/dashboard/Dashboard';
import { PatientPortal } from './components/portal/PatientPortal';
import { AuthWizard } from './components/auth/AuthWizard';
import { PinUnlock } from './components/auth/PinUnlock';
import { Step1Admin } from './components/assessment/Step1Admin';
import { GenerationLoader } from './components/shared/GenerationLoader';
import { AssessmentStepper } from './components/assessment/AssessmentStepper';
import { DemoConversionModal } from './components/shared/DemoConversionModal';
import { CriticalErrorModal } from './components/shared/CriticalErrorModal';
import { supabase } from './services/db';
import { StorageService } from './services/storage';
import type { PatientFile } from './types'; 
import { Sparkles, ArrowRight, LogOut, FilePlus, Crown, ShieldCheck, Link as LinkIcon, Copy, X, User, Loader2, Info, Save, CheckCircle2, FileText, ShieldAlert } from 'lucide-react';
import { Logger } from './utils/logger';
import { GlobalErrorBoundary } from './components/shared/GlobalErrorBoundary';
import { OfflineIndicator } from './components/shared/OfflineIndicator';

// Hooks extracted from the former monolithic AppRouter
import { useDataLoader } from './hooks/useDataLoader';
import { useAssessmentFlow } from './hooks/useAssessmentFlow';
import { useLinkManager } from './hooks/useLinkManager';
import { usePendingProcessor } from './hooks/usePendingProcessor';

// --- LAZY IMPORTS ---
const Step2Tests = React.lazy(() => import('./components/assessment/Step2Tests').then(module => ({ default: module.Step2Tests })));
// Step 3 Observations est supprimé du flux principal (fusionné dans Step 2)
const Step3BisDiagnostic = React.lazy(() => import('./components/assessment/Step3BisDiagnostic').then(module => ({ default: module.Step3BisDiagnostic }))); 
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

// --- MODALS extracted to components/shared/DemoConversionModal.tsx & CriticalErrorModal.tsx ---

// --- ROUTEUR INTERNE ---
const AppRouter = () => {
    const { userProfile, practitioner, authState, sessionKey, orgKey, setSessionKey, unlockSession, logout, updateUserProfile, refreshProfile, tempEmail, startDemo, isDemoMode, verifyAdminAccess } = useAuth();
    const { catalog } = useCatalog(); 
    const assessment = useAssessment();
    const toast = useToast();
    
    // --- UI mode / navigation ---
    const [mode, setMode] = useState<'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'contribution' | 'detail'>('landing');
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [pricingModalMode, setPricingModalMode] = useState<'plans' | 'paywall' | null>(null);
    const [showConfirmGeneration, setShowConfirmGeneration] = useState(false);
    const [showQuickEntry, setShowQuickEntry] = useState(false);
    const [selectedFile, setSelectedFile] = useState<PatientFile | null>(null);
    const [demoConversion, setDemoConversion] = useState<{ show: boolean; action: string }>({ show: false, action: '' });

    // --- Extracted domain hooks ---
    const { patientFiles, setPatientFiles, pendingQuestionnaires, setPendingQuestionnaires, draftsIndex, loadData } = useDataLoader({ sessionKey, orgKey, authState, practitioner, isDemoMode });

    const { isGenerating, setIsGenerating, generationError, setGenerationError, handleGenerateReport, handleFinalize, handleSaveAndQuit, handleResumeDraft } = useAssessmentFlow({
        assessment, sessionKey, orgKey, isDemoMode, catalog, refreshProfile, patientFiles, loadData, toast,
    });

    const { createdLink, setCreatedLink, linkCopiedConfirmed, setLinkCopiedConfirmed, handleGenerateLink, handleCopyLink } = useLinkManager({
        sessionKey, practitioner, isDemoMode, pendingQuestionnaires, setPendingQuestionnaires, toast,
    });

    const { processingQueueId, handleProcessPending } = usePendingProcessor({
        sessionKey, orgKey, isDemoMode, assessment, setPatientFiles, setPendingQuestionnaires, loadData, toast,
    });

    // --- Auth state → mode sync ---
    useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get('q_id') && window.location.hash.includes('key=')) { Logger.info('UI', 'Redirecting to Family Portal via URL'); setMode('portal'); } }, []);
    useEffect(() => {
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
            setMode('landing');
            setShowAuthModal(true);
            setIsLoggingIn(false);
        } else if (authState === 'subscription_locked') {
            // Keep user inside the app view, but block with paywall
            setMode('dashboard');
            setIsLoggingIn(false);
            setShowAuthModal(false);
            setPricingModalMode('paywall');
        } else if (authState === 'error') {
            setIsLoggingIn(false);
            toast.error("Problème de connexion.");
        }
    }, [authState]);

    // Bridge generation error → paywall
    useEffect(() => { if (generationError === 'CREDIT_INSUFFICIENT') { setPricingModalMode('paywall'); setGenerationError(null); } }, [generationError, setGenerationError]);

    // --- Simple action handlers ---
    const handleLogin = async (email: string, pass: string) => { setIsLoggingIn(true); const { error } = await supabase.auth.signInWithPassword({ email, password: pass }); if (error) { toast.error(error.message); setIsLoggingIn(false); } };
    const handleUnlock = (key: CryptoKey) => { unlockSession(key); setMode('dashboard'); };
    const handleStartDemo = async () => { await startDemo(); setShowOnboarding(true); };
    const handleAdminAccess = async () => { const allowed = await verifyAdminAccess(); if (allowed) setMode('admin'); else toast.error("Accès refusé par le serveur."); };
    const handleContributionAccess = () => { if (isDemoMode) { setDemoConversion({ show: true, action: "La contribution" }); return; } if (userProfile.subscriptionPlan === 'free') { setPricingModalMode('plans'); return; } setMode('contribution'); };

    const onTriggerGeneration = useCallback(async () => { setShowConfirmGeneration(false); await handleGenerateReport(); }, [handleGenerateReport]);

    const onFinalize = useCallback(async () => {
        if (isDemoMode) { setMode('dashboard'); toast.success("Bilan validé"); return; }
        const result = await handleFinalize();
        if (result === 'dashboard') setMode('dashboard');
    }, [isDemoMode, handleFinalize, toast]);

    const onSaveAndQuit = useCallback(async () => { await handleSaveAndQuit(); setMode('dashboard'); }, [handleSaveAndQuit]);

    const onResumeDraft = useCallback(async (patientId?: string) => { const ok = await handleResumeDraft(patientId); if (ok) setMode('assessment'); }, [handleResumeDraft]);

    const onProcessPending = useCallback(async (q: Parameters<typeof handleProcessPending>[0]) => { const result = await handleProcessPending(q); if (result === 'assessment') setMode('assessment'); }, [handleProcessPending]);

    // --- RENDUS ---
    if (authState === 'locked' && practitioner && !isDemoMode) return <PinUnlock practitioner={practitioner} onUnlock={handleUnlock} onLogout={logout} />;
    
    // LANDING
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
                                <form onSubmit={(e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleLogin(fd.get('email') as string, fd.get('pass') as string); }} className="space-y-5">
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

    // MODE ADMIN ISOLÉ (Full Screen)
    if (mode === 'admin') {
        return (
            <Suspense fallback={<AppLoader />}>
                <AdminPanel userProfile={userProfile} onClose={() => setMode('dashboard')} />
            </Suspense>
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
                            <button onClick={onSaveAndQuit} className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-rose-50 text-stone-600 hover:text-rose-600 rounded-xl font-bold text-xs uppercase tracking-wider transition-all border border-stone-200 hover:border-rose-200"><Save size={16} /> <span className="hidden md:inline">Sauvegarder & Quitter</span></button>
                        </>
                    ) : (
                        <>
                            {userProfile.isAdmin && (
                                <button 
                                    onClick={handleAdminAccess}
                                    className="hidden md:flex items-center gap-2 px-4 py-2 bg-rose-950/10 hover:bg-rose-950 hover:text-white text-rose-800 rounded-full text-xs font-bold transition-all"
                                >
                                    <ShieldAlert size={14} /> Admin
                                </button>
                            )}
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
                    {mode === 'dashboard' && <Dashboard userProfile={userProfile} pendingQuestionnaires={pendingQuestionnaires} patientFiles={patientFiles} onCreateNew={() => { assessment.resetAssessment(); setMode('assessment'); }} onGenerateLink={handleGenerateLink} onShowPricing={() => setPricingModalMode('plans')} onOpenPatient={async (id) => { try { const details = await StorageService.loadPatientDetails(id, orgKey!); const baseFile = patientFiles.find(f => f.id === id); if (baseFile) { setSelectedFile({ ...baseFile, ...details, patient: details.patient }); setMode('detail'); } } catch { toast.error("Impossible d'ouvrir ce dossier."); } }} onProcessPending={onProcessPending} processingQueueId={processingQueueId} draftsIndex={draftsIndex} onResumeDraft={onResumeDraft} onContribute={handleContributionAccess} isDemoMode={isDemoMode} onCopyLink={handleCopyLink} />}
                    {mode === 'detail' && selectedFile && <PatientDetail file={selectedFile} onBack={() => setMode('dashboard')} onQuickEntry={() => setShowQuickEntry(true)} onNewBilan={() => { assessment.resetAssessment(); assessment.setPatient(selectedFile.patient); setMode('assessment'); }} onOpenReport={() => {}} draftAvailable={!!draftsIndex[selectedFile.id]} onResumeDraft={() => onResumeDraft(selectedFile.id)} />}
                    {showOnboarding && <OnboardingExperience onComplete={() => setShowOnboarding(false)} />}
                    {mode === 'portal' && <PatientPortal onBack={() => setMode('landing')} />}
                    {mode === 'contribution' && <ContributionStudio onClose={() => setMode('dashboard')} onSubmit={() => {}} />}
                    
                    {/* --- WORKFLOW ASSESSMENT MISE À JOUR (FLUID FLOW 5 ÉTAPES) --- */}
                    {mode === 'assessment' && (
                        <div className="max-w-7xl mx-auto p-6">
                            {/* Navigation Stepper */}
                            <AssessmentStepper currentStep={assessment.step} onStepClick={(s) => assessment.setStep(s)} />

                            {/* Step 1: Admin */}
                            {assessment.step === 1 && <Step1Admin data={assessment.patient} updateData={assessment.updatePatient} onNext={() => assessment.setStep(2)} onPatientCreated={loadData} />}
                            
                            {/* Step 2: Tests & Observations (FUSIONNÉ) */}
                            {assessment.step === 2 && (
                                <Step2Tests 
                                    patient={assessment.patient} 
                                    tests={assessment.tests} 
                                    updateTests={assessment.updateTests} 
                                    observations={assessment.observations} 
                                    updateObservations={assessment.updateObservations} 
                                    onNext={() => assessment.setStep(3)} // Vers Diagnostic
                                    onBack={() => assessment.setStep(1)} 
                                    onAcceptResponsibility={() => updateUserProfile({ hasAcceptedResponsibility: true })} 
                                    onContribute={handleContributionAccess} 
                                    userProfile={userProfile} 
                                />
                            )}
                            
                            {/* Step 3: Synthèse & Projet (Ex Step 4) */}
                            {assessment.step === 3 && (
                                <Step3BisDiagnostic 
                                    synthesis={assessment.synthesis} 
                                    updateSynthesis={assessment.updateSynthesis} 
                                    tests={assessment.tests} 
                                    observations={assessment.observations}
                                    patient={assessment.patient}
                                    onNext={() => { if(userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert' || isDemoMode) setShowConfirmGeneration(true); else setPricingModalMode('paywall'); }} 
                                    onBack={() => assessment.setStep(2)} 
                                    isGenerating={isGenerating} 
                                />
                            )}
                            
                            {/* Step 4: Validation */}
                            {assessment.step === 4 && <Step4Validation sections={assessment.sections} patient={assessment.patient} onValidateSection={(id, c) => assessment.updateSection(id, { status: 'validated', ...(c !== undefined ? { content: c } : {}) })} onNext={() => assessment.setStep(5)} onBack={() => assessment.setStep(3)} />}
                            
                            {/* Step 5: Export */}
                            {assessment.step === 5 && <Step5Export patient={assessment.patient} sections={assessment.sections} tests={assessment.tests} onValidate={onFinalize} onUpdateSection={assessment.updateSection} branding={userProfile.branding} onUpdateBranding={(b) => updateUserProfile({ branding: b })} isPremium={userProfile.subscriptionPlan !== 'free'} onShowPricing={() => setPricingModalMode('plans')} onBack={() => assessment.setStep(4)} />}
                        </div>
                    )}

                    {pricingModalMode && <PricingModal onClose={() => { if (pricingModalMode === 'paywall' && authState === 'subscription_locked') { logout(); } else { setPricingModalMode(null); } }} onSelectPlan={() => toast.info("Stripe à venir")} onUnlockOneOff={() => toast.info("Stripe à venir")} isPaywallMode={pricingModalMode === 'paywall'} />}
                    {showQuickEntry && <QuickEntryModal onClose={() => setShowQuickEntry(false)} onSave={async (sess) => { if(selectedFile && orgKey) { await StorageService.saveFile({ ...selectedFile, sessions: [sess, ...(selectedFile.sessions||[])] }, orgKey); setShowQuickEntry(false); } else if (isDemoMode) { setShowQuickEntry(false); } }} />}
                </Suspense>
            </GlobalErrorBoundary>
            
            {createdLink && <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200"><div className="bg-white p-8 rounded-[32px] text-center max-w-lg shadow-2xl relative"><div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><LinkIcon size={32}/></div><h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Lien d'accès créé</h2><p className="text-stone-500 text-sm mb-6">Attention : Ce lien n'est affiché qu'une seule fois ici.</p><div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl font-mono text-xs mb-6 flex items-center gap-3 text-[#3D405B]"><div className="truncate flex-1 font-bold">{createdLink}</div><button onClick={() => { navigator.clipboard.writeText(createdLink); toast.success("Lien copié !"); }} className="hover:text-[#E07A5F] transition-colors"><Copy size={18}/></button></div><div className="flex items-center justify-center gap-3 mb-6 p-3 rounded-xl hover:bg-stone-50 cursor-pointer" onClick={() => setLinkCopiedConfirmed(!linkCopiedConfirmed)}><div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${linkCopiedConfirmed ? 'bg-[#E07A5F] border-[#E07A5F] text-white' : 'border-stone-300 bg-white'}`}>{linkCopiedConfirmed && <CheckCircle2 size={14} strokeWidth={3} />}</div><span className="text-xs font-bold text-stone-600 select-none">J'ai bien copié le lien et je l'ai sécurisé.</span></div><button onClick={() => setCreatedLink(null)} disabled={!linkCopiedConfirmed} className={`w-full py-3 rounded-xl font-bold shadow-lg transition-all ${linkCopiedConfirmed ? 'bg-[#3D405B] text-white hover:bg-[#2c2e42]' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>Terminer</button></div></div>}
            <GenerationLoader isVisible={isGenerating} onCancel={() => setIsGenerating(false)} />
            {generationError && generationError !== 'CREDIT_INSUFFICIENT' && <CriticalErrorModal error={generationError} onRetry={() => { setGenerationError(null); onTriggerGeneration(); }} onClose={() => setGenerationError(null)} />}
            
            {/* POPUP CONFIRMATION IA */}
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
                            <button id="demo-btn-generate" onClick={onTriggerGeneration} className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">
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

const App = () => (
    <AuthProvider>
        <CatalogProvider>
            <ToastProvider>
                <AssessmentProvider>
                    <AppRouter />
                </AssessmentProvider>
            </ToastProvider>
        </CatalogProvider>
    </AuthProvider>
);

export default App;
