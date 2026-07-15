
import React, { useState, useEffect, useCallback, Suspense, useRef, useMemo } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssessmentProvider, useAssessment } from './contexts/AssessmentContext';
import { CatalogProvider, useCatalog } from './contexts/CatalogContext';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Dashboard } from './components/dashboard/Dashboard';
import { PatientPortal } from './components/portal/PatientPortal';
import { AuthWizard } from './components/auth/AuthWizard';
import { PinUnlock } from './components/auth/PinUnlock';
import { NetworkErrorScreen } from './components/auth/NetworkErrorScreen';
import { Step1Admin } from './components/assessment/initial/Step1Admin';
import { GenerationLoader } from './components/shared/GenerationLoader';
import { AssessmentStepper } from './components/assessment/shared/AssessmentStepper';
import { DemoConversionModal } from './components/shared/DemoConversionModal';
import { CriticalErrorModal } from './components/shared/CriticalErrorModal';
import { ConfirmModal } from './components/shared/ConfirmModal';
import { ThemeToggle } from './components/shared/ThemeToggle';
import { supabase } from './services/db';
import { StorageService } from './services/storage';
import type { PatientAssessment, PatientFile, PatientFollowup, PractitionerProfile, ReportSection, TestData } from './types';
import { Sparkles, ArrowRight, LogOut, FilePlus, Crown, ShieldCheck, X, User, Loader2, Info, Save, FileText, ShieldAlert, ChevronDown, Mail, Download, Upload } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { Logger } from './utils/logger';
import { decodeResidualEntities } from './utils/textSanitizer';
import { ExportService } from './services/exportService';
import { getDaysSinceBackup } from './utils/backupTracking';
import { formatScoreCompact, normalizeFlatResults } from './utils/scoring';
import { GlobalErrorBoundary } from './components/shared/GlobalErrorBoundary';
import { OfflineIndicator } from './components/shared/OfflineIndicator';

// Hooks extracted from the former monolithic AppRouter
import { useDataLoader } from './hooks/useDataLoader';
import { useAssessmentFlow } from './hooks/useAssessmentFlow';
import { useLinkManager } from './hooks/useLinkManager';
import { usePendingProcessor } from './hooks/usePendingProcessor';

// --- LAZY IMPORTS — pages (shared across flows) ---
const ScorePage = React.lazy(() => import('./components/assessment/pages/ScorePage').then(module => ({ default: module.ScorePage })));
const ValidationPage = React.lazy(() => import('./components/assessment/pages/ValidationPage').then(module => ({ default: module.Step4Validation })));
const ExportPage = React.lazy(() => import('./components/assessment/pages/ExportPage').then(module => ({ default: module.Step5Export })));

// --- LAZY IMPORTS — initial flow ---
const Step3BisDiagnostic = React.lazy(() => import('./components/assessment/initial/Step3Diagnostic').then(module => ({ default: module.Step3BisDiagnostic })));

// --- LAZY IMPORTS — reevaluation flow ---
const ReevStep1Scores = React.lazy(() => import('./components/assessment/reevaluation/Step1Scores').then(module => ({ default: module.Step1Scores })));
const ReevStep2Evolution = React.lazy(() => import('./components/assessment/reevaluation/Step2Evolution').then(module => ({ default: module.Step2Evolution })));
// Step3Synthesis removed — AI generation merged into Step2Evolution

// --- LAZY IMPORTS — historical flow ---
const HistoricalPatientForm = React.lazy(() => import('./components/assessment/historical/Step1Form').then(module => ({ default: module.HistoricalPatientForm })));
const HistoricalSectionsStep = React.lazy(() => import('./components/assessment/historical/Step3Report').then(module => ({ default: module.HistoricalSectionsStep })));

const AdminPanel = React.lazy(() => import('./components/admin/AdminPanel').then(module => ({ default: module.AdminPanel })));

const ProfileEditor = React.lazy(() => import('./components/dashboard/ProfileEditor').then(module => ({ default: module.ProfileEditor })));
const OnboardingExperience = React.lazy(() => import('./components/auth/OnboardingExperience').then(module => ({ default: module.OnboardingExperience })));

const PatientDetail = React.lazy(() => import('./components/dashboard/PatientDetail').then(module => ({ default: module.PatientDetail })));
const PricingModal = React.lazy(() => import('./components/shared/PricingModal').then(module => ({ default: module.PricingModal })));
const LegalModal = React.lazy(() => import('./components/shared/LegalModal').then(module => ({ default: module.LegalModal })));

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
    const { userProfile, practitioner, authState, sessionKey, setSessionKey, unlockSession, logout, updateUserProfile, refreshProfile, reloadUserFromSession, tempEmail, startDemo, isDemoMode, verifyAdminAccess, isLoading } = useAuth();
    const { catalog, hasLoaded: hasCatalogLoaded, ensureCatalogLoaded } = useCatalog();
    const assessment = useAssessment();
    const toast = useToast();

    // ── Catalog name resolution maps (for bilan viewer) ──────────────────────
    const subtestNameMap = useMemo(() =>
        new Map(catalog.flatMap(c => c.tests.flatMap(t =>
            t.subtests.map(s => [s.id, s.displayName ?? s.name])
        ))),
    [catalog]);
    const subtestToTestMap = useMemo(() => {
        const map = new Map<string, { testId: string; testName: string }>();
        catalog.forEach(cat => cat.tests.forEach(t => t.subtests.forEach(s => map.set(s.id, { testId: t.id, testName: t.name }))));
        return map;
    }, [catalog]);

    // --- UI mode / navigation ---
    const [mode, setMode] = useState<'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'detail' | 'profile'>('landing');
    const [previousMode, setPreviousMode] = useState<'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'detail'>('dashboard');
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register' | 'confirm_email'>('login');
    const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [pricingModalMode, setPricingModalMode] = useState<'plans' | 'paywall' | null>(null);
    const [legalModal, setLegalModal] = useState<{ open: boolean; tab: 'cgu' | 'privacy' }>({ open: false, tab: 'cgu' });
    const [showConfirmGeneration, setShowConfirmGeneration] = useState(false);
    const [selectedFile, setSelectedFile] = useState<PatientFile | null>(null);
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const menuImportRef = useRef<HTMLInputElement>(null);
    const [backupOverdue, setBackupOverdue] = useState(false);
    const [isExportingFromMenu, setIsExportingFromMenu] = useState(false);
    const [stepperConfirm, setStepperConfirm] = useState<{ target: number } | null>(null);
    const [showQuitConfirm, setShowQuitConfirm] = useState(false);
    const [viewingReport, setViewingReport] = useState<import('./types').PatientAssessment | null>(null);
    const [detailPaging, setDetailPaging] = useState({
        hasMoreAssessments: false,
        nextAssessmentOffset: 0,
        isLoadingMore: false
    });
    const [demoConversion, setDemoConversion] = useState<{ show: boolean; action: string }>({ show: false, action: '' });
    const [loginCaptchaToken, setLoginCaptchaToken] = useState('');
    const [loginCaptchaNonce, setLoginCaptchaNonce] = useState(0);
    const turnstileSiteKey = (import.meta.env.VITE_SUPABASE_TURNSTILE_SITE_KEY || import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
    const shouldUseCaptcha = turnstileSiteKey.length > 0;

    // --- Extracted domain hooks ---
    const { patientFiles, setPatientFiles, pendingQuestionnaires, setPendingQuestionnaires, draftsIndex, setDraftsIndex, loadData, hasMorePatients, isLoadingMorePatients, loadMorePatients } = useDataLoader({ sessionKey, authState, practitioner, isDemoMode });

    const { isGenerating, setIsGenerating, generationError, setGenerationError, handleGenerateReport, handleFinalize, handleSaveAndQuit, handleResumeDraft } = useAssessmentFlow({
        assessment, sessionKey, isDemoMode, catalog, refreshProfile, patientFiles, loadData, toast,
    });

    const { handleGenerateLink, handleCopyLink, handleDeletePending } = useLinkManager({
        sessionKey, practitioner, isDemoMode, pendingQuestionnaires, setPendingQuestionnaires, toast,
    });

    const { processingQueueId, handleProcessPending } = usePendingProcessor({
        sessionKey, isDemoMode, assessment, setPatientFiles, setPendingQuestionnaires, loadData, toast,
    });

    // --- Auth state → mode sync ---
    // Capture the full URL for auto-login in PatientPortal (before any hash/param stripping)
    const [portalInitialUrl] = useState<string | undefined>(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('q_id') && window.location.hash.includes('key=')) {
            return window.location.href;
        }
        return undefined;
    });
    useEffect(() => { if (portalInitialUrl) { Logger.info('UI', 'Redirecting to Family Portal via URL'); setMode('portal'); } }, []);
    useEffect(() => {
        if (authState === 'unauthenticated') {
            // Don't override mode='portal' if the user arrived via a family link
            if (!portalInitialUrl) setMode('landing');
            setIsLoggingIn(false);
        } else if (authState === 'locked') {
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'authenticated') {
            // Preserve in-app context if auth state briefly refreshes mid-workflow.
            setMode(prev => (prev === 'landing' ? 'dashboard' : prev));
            setShowAuthModal(false);
            setIsLoggingIn(false);
        } else if (authState === 'registering') {
            setMode('landing');
            // Seulement ouvrir le modal si pas déjà ouvert — évite de re-monter
            // un nouveau AuthWizard pendant que l'actuel est en train de travailler
            setShowAuthModal(prev => {
                if (prev) Logger.debug('UI', 'Auth modal already open, skipping re-open for registering state');
                return true;
            });
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
        } else if (authState === 'network_error') {
            setIsLoggingIn(false);
        }
    }, [authState]);

    // Bridge generation error → paywall
    useEffect(() => { if (generationError === 'CREDIT_INSUFFICIENT') { setPricingModalMode('paywall'); setGenerationError(null); } }, [generationError, setGenerationError]);

    useEffect(() => {
        const onMouseDown = (event: MouseEvent) => {
            if (!accountMenuRef.current) return;
            if (!accountMenuRef.current.contains(event.target as Node)) {
                setShowAccountMenu(false);
            }
        };

        window.addEventListener('mousedown', onMouseDown);
        return () => window.removeEventListener('mousedown', onMouseDown);
    }, []);

    useEffect(() => {
        setShowAccountMenu(false);
    }, [mode]);

    // Compute backup overdue badge whenever the user changes
    useEffect(() => {
        if (!practitioner?.id || isDemoMode) { setBackupOverdue(false); return; }
        const days = getDaysSinceBackup(practitioner.id);
        setBackupOverdue(days === null || days > 30);
    }, [practitioner?.id, isDemoMode]);

    // Show a warning toast once per browser session if backup is missing or very old
    useEffect(() => {
        if (!practitioner?.id || isDemoMode || authState !== 'authenticated') return;
        if (sessionStorage.getItem('ergo_backup_reminder_shown')) return;
        const days = getDaysSinceBackup(practitioner.id);
        if (days === null) {
            toast.warning('Aucun backup détecté — exportez vos données depuis votre profil pour ne rien perdre.');
            sessionStorage.setItem('ergo_backup_reminder_shown', '1');
        } else if (days > 180) {
            toast.warning('Votre dernier backup date de plus de 6 mois — pensez à exporter vos données depuis votre profil.');
            sessionStorage.setItem('ergo_backup_reminder_shown', '1');
        }
    }, [practitioner?.id, authState, isDemoMode]);

    useEffect(() => {
        if (authState !== 'authenticated' || isDemoMode || hasCatalogLoaded) return;
        if (mode !== 'dashboard' && mode !== 'detail' && mode !== 'assessment') return;

        const timer = window.setTimeout(() => {
            void ensureCatalogLoaded();
        }, 1200);

        return () => window.clearTimeout(timer);
    }, [authState, isDemoMode, hasCatalogLoaded, mode, ensureCatalogLoaded]);

    // ── Retroactive previousTests reconstruction ───────────────────────────
    // If a reevaluation was started before the catalog finished loading,
    // previousAssessment.tests may be empty. Re-run the reconstruction once
    // the catalog (and subtestToTestMap) is ready — or whenever previousAssessment
    // changes (e.g., when reevaluation is started after catalog already loaded).
    useEffect(() => {
        if (!hasCatalogLoaded || subtestToTestMap.size === 0) return;
        if (assessment.reportType !== 'reevaluation') return;
        const prev = assessment.previousAssessment;
        if (!prev) return;
        const existingTests = prev.tests ?? {};
        if (Object.keys(existingTests).length > 0) return; // already fine
        if (!prev.results || Object.keys(prev.results).length === 0) return;

        const rebuilt: TestData = {};
        Object.entries(prev.results).forEach(([subtestId, score]) => {
            const info = subtestToTestMap.get(subtestId);
            if (info) {
                if (!rebuilt[info.testId]) rebuilt[info.testId] = {};
                rebuilt[info.testId][subtestId] = score as import('./types').ScoreResult;
            }
        });
        if (Object.keys(rebuilt).length === 0) return;

        assessment.setPreviousAssessment({ ...prev, tests: rebuilt });
        if (Object.keys(assessment.tests).length === 0) {
            assessment.updateTests(rebuilt);
        }
    }, [hasCatalogLoaded, subtestToTestMap, assessment.reportType, assessment.previousAssessment]);


    const handleLogin = async (email: string, pass: string) => {
        if (shouldUseCaptcha && !loginCaptchaToken) {
            toast.error("Veuillez compléter le CAPTCHA.");
            return;
        }

        const normalizedEmail = email.trim().toLowerCase();
        setIsLoggingIn(true);

        const signInPayload = shouldUseCaptcha
            ? { email: normalizedEmail, password: pass, options: { captchaToken: loginCaptchaToken } }
            : { email: normalizedEmail, password: pass };

        const { error } = await supabase.auth.signInWithPassword(signInPayload);

        if (error) {
            if (/email not confirmed/i.test(error.message)) {
                setPendingConfirmationEmail(normalizedEmail);
                setAuthMode('confirm_email');
            } else {
                if (shouldUseCaptcha) {
                    setLoginCaptchaToken('');
                    setLoginCaptchaNonce(prev => prev + 1);
                }
                toast.error(error.message);
            }
            setIsLoggingIn(false);
        }
    };
    const handleUnlock = (key: CryptoKey) => { unlockSession(key); };
    const handleWizardComplete = async (_p: PractitionerProfile, key: CryptoKey) => {
        // Fermer le modal AVANT reload pour éviter le flash du AuthWizard
        // quand authState passe brièvement par 'authenticating'
        setShowAuthModal(false);
        setAuthMode('login');
        setPendingConfirmationEmail('');
        setShowOnboarding(true);
        setSessionKey(key);

        const nextState = await reloadUserFromSession();
        if (nextState === 'locked') {
            await unlockSession(key);
        }
    };
    const handleEmailConfirmationRequired = (email: string) => {
        setPendingConfirmationEmail(email.trim().toLowerCase());
        setAuthMode('confirm_email');
    };
    const handleStartDemo = async () => { await startDemo(); setShowOnboarding(true); };
    const handleAdminAccess = async () => { const allowed = await verifyAdminAccess(); if (allowed) setMode('admin'); else toast.error("Accès refusé par le serveur."); };

    const handleMenuExport = async () => {
        if (!practitioner) return;
        setShowAccountMenu(false);
        setIsExportingFromMenu(true);
        try {
            await ExportService.exportAll(practitioner.id);
            setBackupOverdue(false);
            toast.success('Backup sauvegardé — vos données restent sous votre seul contrôle.');
        } catch {
            toast.error("Erreur lors de l'export.");
        } finally {
            setIsExportingFromMenu(false);
        }
    };

    const handleMenuImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !practitioner) return;
        if (!file.name.endsWith('.ergobilan')) {
            toast.error('Fichier invalide. Choisissez un fichier .ergobilan');
            return;
        }
        setShowAccountMenu(false);
        try {
            const preview = await ExportService.peekBundle(file);
            const ok = window.confirm(
                `Importer ce backup ?\n` +
                `Date\u00a0: ${new Date(preview.exportedAt).toLocaleString()}\n` +
                `${preview.patients} patient(s) \u2022 ${preview.assessments} bilan(s) \u2022 ${preview.drafts} brouillon(s)\n\n` +
                `Les données existantes pour ces patients seront \u00e9crasées.`
            );
            if (!ok) return;
            const result = await ExportService.importFromFile(file, practitioner.id);
            toast.success(`Import réussi\u00a0: ${result.patients} patients, ${result.assessments} bilans`);
            void loadData();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erreur lors de l'import");
        } finally {
            if (menuImportRef.current) menuImportRef.current.value = '';
        }
    };


    const onTriggerGeneration = useCallback(async () => { setShowConfirmGeneration(false); await handleGenerateReport(); }, [handleGenerateReport]);

    const onFinalize = useCallback(async () => {
        if (isDemoMode) { setMode('dashboard'); toast.success("Bilan validé"); return; }
        const result = await handleFinalize();
        if (result === 'dashboard') setMode('dashboard');
    }, [isDemoMode, handleFinalize, toast]);

    const handleFinalizeHistorical = useCallback(async (sections: ReportSection[]) => {
        if (isDemoMode) { assessment.resetAssessment(); setMode('dashboard'); toast.success('Bilan de référence enregistré (démo).'); return; }
        const patientId = assessment.patient.id;
        if (!patientId) { toast.error('Identifiant patient manquant. Remplissez le dossier avant d\'enregistrer.'); return; }
        try {
            const details = await StorageService.loadPatientDetails(patientId);
            const testNames: string[] = [];
            const flatResults: Record<string, import('./types').ScoreResult> = {};
            Object.entries(assessment.tests).forEach(([tId, subtests]) => {
                const catalogDef = catalog.flatMap((c) => c.tests).find((t) => t.id === tId);
                testNames.push(catalogDef ? catalogDef.name : tId);
                Object.entries(subtests).forEach(([sId, res]) => { flatResults[sId] = res as import('./types').ScoreResult; });
            });
            const newAssessment: PatientAssessment = {
                id: crypto.randomUUID(),
                date: assessment.historicalDate || new Date().toISOString(),
                kind: 'initial',
                hasFormalReport: true,
                testName: testNames.join(', ') || 'Bilan initial (import)',
                results: flatResults,
                tests: assessment.tests,
                report: sections.length > 0 ? {
                    status: 'completed',
                    patientName: `${assessment.patient.firstName} ${assessment.patient.lastName}`.trim(),
                    sections,
                } : undefined,
            };
            const currentFileIndex = patientFiles.findIndex((f) => f.id === patientId);
            const currentFile: PatientFile = currentFileIndex === -1
                ? { id: patientId, patient: assessment.patient, assessments: [], lastInteraction: new Date().toISOString(), archived: false }
                : patientFiles[currentFileIndex];
            const updatedFile: PatientFile = {
                ...currentFile,
                lastInteraction: new Date().toISOString(),
                assessments: [newAssessment, ...(currentFile.assessments || [])],
            };
            await StorageService.saveFile(updatedFile);
            await StorageService.deleteDraft(patientId);
            assessment.resetAssessment();
            await loadData();
            toast.success('Bilan de référence enregistré. La réévaluation 1-clic est maintenant disponible.');
            setMode('dashboard');
        } catch (e) {
            Logger.error('DB', 'handleFinalizeHistorical failed', e);
            toast.error('Erreur lors de l\'enregistrement du bilan.');
        }
    }, [isDemoMode, assessment, patientFiles, catalog, loadData, toast]);

    const onSaveAndQuit = useCallback(async () => {
        const result = await handleSaveAndQuit();
        if (result === 'dashboard') setMode('dashboard');
    }, [handleSaveAndQuit]);

    const onResumeDraft = useCallback(async (patientId?: string) => {
        // If patient already has a completed formal assessment, the draft is stale.
        // Delete it and open reevaluation instead.
        // NOTE: file.assessments is [] from the list page; use previewMeta flags instead.
        const file = patientId ? patientFiles.find((f) => f.id === patientId) : null;
        const hasCompletedInitial = file?.previewMeta?.flags?.hasInitialReport ?? false;
        const draftMeta = patientId ? draftsIndex[patientId] : null;
        const isStale = hasCompletedInitial && (!draftMeta?.reportType || draftMeta?.reportType === 'initial' || draftMeta?.reportType === 'historique');
        if (isStale && file) {
            await StorageService.deleteDraft(patientId);
            // Load full patient details to get actual assessments (list page has assessments:[])
            const details = await StorageService.loadPatientDetails(patientId);
            const prevAssessment = details ? [...(details.assessments || [])].filter(a => a.hasFormalReport).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null : null;
            // Resolve tests: use stored field, or reconstruct from flat results (retroactive fix)
            let prevTests: TestData = prevAssessment?.tests ?? {};
            if (Object.keys(prevTests).length === 0 && prevAssessment?.results && Object.keys(prevAssessment.results).length > 0) {
                const rebuilt: TestData = {};
                Object.entries(prevAssessment.results).forEach(([subtestId, score]) => {
                    const info = subtestToTestMap.get(subtestId);
                    if (info) {
                        if (!rebuilt[info.testId]) rebuilt[info.testId] = {};
                        rebuilt[info.testId][subtestId] = score;
                    }
                });
                prevTests = rebuilt;
            }
            assessment.resetAssessment();
            assessment.setPatient(file.patient);
            assessment.setReportType('reevaluation');
            assessment.setPreviousAssessment(prevAssessment ? { ...prevAssessment, tests: prevTests } : null);
            if (Object.keys(prevTests).length > 0) {
                assessment.updateTests(prevTests);
            }
            assessment.setStep(1);
            setMode('assessment');
            return;
        }
        const resumedDraft = await handleResumeDraft(patientId);
        if (resumedDraft) {
            // DraftPayload has no previousAssessment field. For reevaluation drafts,
            // look up the most recent formal assessment and restore it.
            if (resumedDraft.reportType === 'reevaluation' && patientId) {
                try {
                    const details = await StorageService.loadPatientDetails(patientId);
                    const prevAssessment = details
                        ? [...(details.assessments || [])].filter(a => a.hasFormalReport).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null
                        : null;
                    if (prevAssessment) {
                        let prevTests: TestData = prevAssessment.tests ?? {};
                        if (Object.keys(prevTests).length === 0 && prevAssessment.results && Object.keys(prevAssessment.results).length > 0) {
                            const rebuilt: TestData = {};
                            Object.entries(prevAssessment.results).forEach(([subtestId, score]) => {
                                const info = subtestToTestMap.get(subtestId);
                                if (info) {
                                    if (!rebuilt[info.testId]) rebuilt[info.testId] = {};
                                    rebuilt[info.testId][subtestId] = score;
                                }
                            });
                            prevTests = rebuilt;
                        }
                        assessment.setPreviousAssessment({ ...prevAssessment, tests: prevTests });
                        // Pre-populate new tests only if the draft had none (first open)
                        if (Object.keys(resumedDraft.tests ?? {}).length === 0 && Object.keys(prevTests).length > 0) {
                            assessment.updateTests(prevTests);
                        }
                    }
                } catch (e) {
                    Logger.warn('App', 'Failed to restore previousAssessment on reevaluation resume', e);
                }
            }
            setMode('assessment');
        }
    }, [handleResumeDraft, patientFiles, draftsIndex, assessment]);

    // --- Guarded stepper navigation (A1): warn when going back before step 4 with existing sections ---
    const handleStepperClick = useCallback((targetStep: number) => {
        const currentStep = assessment.step;
        // Going backward to step ≤3 from step ≥4 when sections exist → warn about regeneration risk
        if (targetStep < currentStep && targetStep <= 3 && currentStep >= 4 && assessment.sections.length > 0) {
            setStepperConfirm({ target: targetStep });
            return;
        }
        assessment.setStep(targetStep);
    }, [assessment]);

    const confirmStepperNavigation = useCallback(() => {
        if (stepperConfirm) {
            assessment.setStep(stepperConfirm.target);
            setStepperConfirm(null);
        }
    }, [assessment, stepperConfirm]);

    // --- Quit handler (A4): save-or-discard when data exists ---
    const handleQuitAssessment = useCallback(() => {
        const hasData = !!(assessment.patient.firstName || assessment.patient.lastName || assessment.patient.dob);
        if (hasData) {
            setShowQuitConfirm(true);
        } else {
            assessment.resetAssessment();
            setMode('dashboard');
        }
    }, [assessment]);

    const handleQuitDiscard = useCallback(async () => {
        setShowQuitConfirm(false);
        const patientId = assessment.patient.id;
        if (patientId && !isDemoMode) {
            try {
                await StorageService.deleteDraft(patientId);
                setDraftsIndex(prev => {
                    const next = { ...prev };
                    delete next[patientId];
                    return next;
                });
            } catch { /* ignore — dashboard will refresh on next load */ }
        }
        assessment.resetAssessment();
        setMode('dashboard');
    }, [assessment, isDemoMode, setDraftsIndex]);

    const handleQuitSave = useCallback(async () => {
        setShowQuitConfirm(false);
        await onSaveAndQuit();
    }, [onSaveAndQuit]);

    const onProcessPending = useCallback(async (q: Parameters<typeof handleProcessPending>[0]) => { const result = await handleProcessPending(q); if (result === 'assessment') setMode('assessment'); }, [handleProcessPending]);

    const handleLoadMoreHistory = useCallback(async () => {
        if (!selectedFile) return;
        if (detailPaging.isLoadingMore) return;
        setDetailPaging(prev => ({ ...prev, isLoadingMore: true }));
        try {
            const history = await StorageService.loadPatientHistoryPage(selectedFile.id, {
                assessmentOffset: detailPaging.nextAssessmentOffset,
            });

            setSelectedFile(prev => {
                if (!prev) return prev;
                const assessmentMap = new Map<string, PatientAssessment>(prev.assessments.map((item) => [item.id, item]));
                history.assessments.forEach((item) => assessmentMap.set(item.id, item));
                const assessments = Array.from(assessmentMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                return { ...prev, assessments };
            });

            setDetailPaging(prev => ({
                ...prev,
                hasMoreAssessments: history.hasMoreAssessments,
                nextAssessmentOffset: history.nextAssessmentOffset,
                isLoadingMore: false
            }));
        } catch (e) {
            Logger.warn('DB', 'Failed to load more history', e);
            toast.error("Impossible de charger plus d'historique.");
            setDetailPaging(prev => ({ ...prev, isLoadingMore: false }));
        }
    }, [selectedFile, detailPaging.nextAssessmentOffset, detailPaging.isLoadingMore, toast]);

    const accountDisplayName = (
        userProfile.branding.practitionerName ||
        `${practitioner?.firstName || ''} ${practitioner?.lastName || ''}`.trim() ||
        userProfile.email.split('@')[0]
    ).trim();

    const accountInitials = accountDisplayName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((chunk) => chunk[0].toUpperCase())
        .join('') || 'AB';

    // --- RENDUS ---
    // Family portal links are public — bypass loading/PIN screens immediately.
    // portalInitialUrl is set synchronously (useState initializer), so this works on first render
    // before the mode='portal' effect has fired.
    if (portalInitialUrl) {
        return <PatientPortal onBack={() => setMode('landing')} initialUrl={portalInitialUrl} />;
    }
    if (isLoading || authState === 'authenticating') return <AppLoader />;
    if (authState === 'network_error') return <NetworkErrorScreen onRetry={reloadUserFromSession} onLogout={logout} />;
    if (authState === 'locked' && practitioner && !isDemoMode) return <PinUnlock practitioner={practitioner} onUnlock={handleUnlock} onLogout={logout} />;

    // LANDING
    if (mode === 'landing') {
        return (
            <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
                <div className="absolute top-6 right-6 z-10">
                    <ThemeToggle />
                </div>
                <div className="absolute inset-0 bg-gradient-to-br from-[#E07A5F]/5 to-[#3D405B]/5 pointer-events-none"></div>
                <div className="text-center space-y-8 z-10 animate-in fade-in zoom-in-95 duration-700">
                    <div className="flex justify-center">
                        <div className="w-24 h-24 bg-[var(--card-bg)] rounded-[32px] shadow-xl shadow-[var(--shadow)] flex items-center justify-center text-[#E07A5F] transform rotate-3 transition-transform hover:rotate-0">
                            <Sparkles size={48} fill="currentColor" className="text-[#E07A5F]/20" stroke="currentColor" />
                            <Sparkles size={48} className="absolute text-[#E07A5F]" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-5xl md:text-7xl font-serif font-bold text-[var(--text-main)] mb-2">ErgoBilan<span className="text-[#E07A5F]">.</span></h1>
                        <p className="text-lg text-[var(--text-light)] font-medium">L'assistant clinique intelligent pour Ergothérapeutes.</p>
                    </div>
                    <div className="flex flex-col md:flex-row gap-4 mt-8 justify-center">
                        <button onClick={() => {
                            if (authState === 'locked') {
                                setMode('dashboard');
                                return;
                            }
                            setAuthMode('login');
                            setPendingConfirmationEmail('');
                            setLoginCaptchaToken('');
                            setShowAuthModal(true);
                        }} className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center justify-center gap-2 group">
                            Accès Praticien <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                        <button onClick={() => setMode('portal')} className="bg-[var(--card-bg)] text-[var(--text-main)] px-10 py-4 rounded-2xl font-bold shadow-md hover:shadow-lg border border-[var(--border-color)] hover:border-[#E07A5F]/30 transition-all flex items-center justify-center gap-2">
                            Espace Famille <User size={20} />
                        </button>
                    </div>
                    <div className="mt-8 animate-in slide-in-from-bottom-8 fade-in duration-700 delay-500">
                        {/* UPDATE : Appel du nouveau handler handleStartDemo */}
                        <p className="text-[var(--text-light)] text-sm">Pas encore de compte ? <button onClick={handleStartDemo} className="font-bold text-[var(--text-main)] hover:text-[#E07A5F] underline underline-offset-2 transition-colors cursor-pointer">Explorer l'interface sans inscription</button></p>
                    </div>
                </div>
                {/* Legal footer */}
                <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 text-[10px] text-[var(--text-disabled)] z-10">
                    <button onClick={() => setLegalModal({ open: true, tab: 'cgu' })} className="hover:text-[var(--text-secondary)] transition-colors">Conditions Générales</button>
                    <span>·</span>
                    <button onClick={() => setLegalModal({ open: true, tab: 'privacy' })} className="hover:text-[var(--text-secondary)] transition-colors">Politique de Confidentialité</button>
                    <span>·</span>
                    <span>© {new Date().getFullYear()} ErgoBilan</span>
                </div>
                {legalModal.open && (
                    <Suspense fallback={null}>
                        <LegalModal initialTab={legalModal.tab} onClose={() => setLegalModal(prev => ({ ...prev, open: false }))} />
                    </Suspense>
                )}
                {showAuthModal && (
                    <div className="fixed inset-0 z-50 bg-[#3D405B]/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                        {authMode === 'login' && authState !== 'registering' ? (
                            <div className="bg-[var(--card-bg)] p-10 rounded-[40px] w-full max-w-md relative shadow-2xl border border-[var(--border-color)] animate-in zoom-in-95 duration-300">
                                <button onClick={() => { setShowAuthModal(false); setAuthMode('login'); setPendingConfirmationEmail(''); setLoginCaptchaToken(''); }} className="absolute top-6 right-6 p-2 bg-[var(--hover-bg)] rounded-full hover:bg-[var(--border-color)] text-[var(--text-light)] transition-colors"><X size={20} /></button>
                                <div className="text-center mb-8"><h2 className="text-3xl font-serif font-bold text-[var(--text-main)]">Connexion</h2><p className="text-[var(--text-light)] text-sm font-medium mt-1">Heureux de vous revoir.</p></div>
                                <form onSubmit={(e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleLogin(fd.get('email') as string, fd.get('pass') as string); }} className="space-y-5">
                                    <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--text-light)] uppercase tracking-wider ml-2">Email</label><input name="email" type="email" placeholder="votre@email.com" className="w-full p-4 bg-[var(--input-bg)] border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[var(--text-main)] transition-all" required /></div>
                                    <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--text-light)] uppercase tracking-wider ml-2">Mot de passe</label><input name="pass" type="password" placeholder="••••••••" className="w-full p-4 bg-[var(--input-bg)] border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[var(--text-main)] transition-all" required /></div>

                                    {shouldUseCaptcha && (
                                        <div className="mt-4 flex justify-center">
                                            <Turnstile
                                                key={`turnstile-${loginCaptchaNonce}`}
                                                siteKey={turnstileSiteKey}
                                                onSuccess={(token) => setLoginCaptchaToken(token)}
                                                onError={() => setLoginCaptchaToken('')}
                                                onExpire={() => setLoginCaptchaToken('')}
                                            />
                                        </div>
                                    )}

                                    <button type="submit" disabled={isLoggingIn} className="w-full py-4 bg-[#3D405B] text-white rounded-2xl font-bold text-lg shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] hover:shadow-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-4">{isLoggingIn ? <Loader2 size={24} className="animate-spin" /> : "Se connecter"}</button>
                                </form>
                                <div className="mt-8 text-center pt-6 border-t border-[var(--border-color)]"><p className="text-xs text-[var(--text-light)] font-medium mb-2">Pas encore de compte ?</p><button onClick={() => { setAuthMode('register'); setPendingConfirmationEmail(''); setLoginCaptchaToken(''); }} className="text-[#E07A5F] font-bold hover:underline">Créer un compte praticien</button></div>
                            </div>
                        ) : authMode === 'confirm_email' && authState !== 'registering' ? (
                            <div className="bg-[var(--card-bg)] p-10 rounded-[40px] w-full max-w-md relative shadow-2xl border border-[var(--border-color)] animate-in zoom-in-95 duration-300">
                                <button onClick={() => { setShowAuthModal(false); setAuthMode('login'); setPendingConfirmationEmail(''); }} className="absolute top-6 right-6 p-2 bg-[var(--hover-bg)] rounded-full hover:bg-[var(--border-color)] text-[var(--text-light)] transition-colors"><X size={20} /></button>
                                <div className="w-16 h-16 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center mx-auto mb-6">
                                    <Mail size={30} />
                                </div>
                                <div className="text-center space-y-3">
                                    <h2 className="text-3xl font-serif font-bold text-[var(--text-main)]">Confirmer le mail</h2>
                                    <p className="text-sm text-[var(--text-light)] font-medium">
                                        Confirmez votre adresse email puis reconnectez-vous.
                                    </p>
                                    {pendingConfirmationEmail && (
                                        <p className="text-xs text-[var(--text-secondary)] bg-[var(--card-bg-raised)] border border-[var(--border-color)] rounded-xl px-3 py-2">
                                            Adresse: <span className="font-bold text-[var(--text-main)]">{pendingConfirmationEmail}</span>
                                        </p>
                                    )}
                                </div>
                                <div className="mt-8 flex flex-col gap-3">
                                    <button onClick={() => setAuthMode('login')} className="w-full py-3 bg-[#3D405B] text-white rounded-2xl font-bold shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] transition-all">
                                        J'ai confirmé, me connecter
                                    </button>
                                    <button onClick={() => { setShowAuthModal(false); setAuthMode('login'); setPendingConfirmationEmail(''); }} className="w-full py-3 rounded-2xl font-bold text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-all">
                                        Retour à l'accueil
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <AuthWizard onCancel={() => { setShowAuthModal(false); setAuthMode('login'); setPendingConfirmationEmail(''); }} onComplete={handleWizardComplete} isProfileCompletion={authState === 'registering'} initialEmail={tempEmail || ''} onEmailConfirmationRequired={handleEmailConfirmationRequired} />
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
        <div className="min-h-screen bg-[var(--app-bg)] pb-20 font-sans">
            <header className="relative z-40 bg-[var(--card-bg)]/90 backdrop-blur-md border-b border-[var(--border-color)] px-6 h-20 flex items-center justify-between no-print shadow-sm">
                <div className="font-serif font-bold text-xl text-[var(--text-main)] cursor-pointer flex items-center gap-2" onClick={() => setMode('dashboard')}>
                    <Sparkles size={18} className="text-[#E07A5F]" /> ErgoBilan.
                </div>
                <div className="flex items-center gap-3">
                    <ThemeToggle />
                    {mode === 'assessment' ? (
                        <>
                            {assessment.isAutoSaving && <div className="text-xs text-amber-600 font-bold flex gap-1 items-center bg-amber-50 px-2 py-1 rounded-lg mr-2"><Loader2 size={12} className="animate-spin" /> Sauvegarde...</div>}
                            <button onClick={onSaveAndQuit} className="flex items-center gap-2 px-4 py-2 bg-[var(--btn-secondary-bg)] hover:bg-rose-50 text-[var(--btn-secondary-text)] hover:text-rose-600 rounded-xl font-bold text-xs uppercase tracking-wider transition-all border border-[var(--border-color)] hover:border-rose-200"><Save size={16} /> <span className="hidden md:inline">Sauvegarder &amp; Quitter</span></button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setPricingModalMode('plans')} className="flex items-center gap-2 bg-[#F2CC8F]/20 text-[#d97706] px-4 py-2 rounded-full text-xs font-bold border border-[#F2CC8F]/50 hover:bg-[#F2CC8F]/30 transition-all"><Crown size={14} /> {userProfile.credits} Crédits</button>
                            <div className="h-8 w-px bg-[var(--border-color)] mx-1"></div>

                            <div className="relative z-50" ref={accountMenuRef} onMouseDown={(event) => event.stopPropagation()}>
                                <button
                                    onClick={() => setShowAccountMenu((prev) => !prev)}
                                    className="flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1.5 transition-colors hover:border-[var(--text-main)]"
                                >
                                    <div className="relative h-8 w-8 flex-shrink-0">
                                        <div className="h-8 w-8 rounded-full bg-[#3D405B] text-white text-xs font-bold flex items-center justify-center">
                                            {accountInitials}
                                        </div>
                                        {backupOverdue && (
                                            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-[var(--card-bg)]" />
                                        )}
                                    </div>
                                    <ChevronDown size={14} className={`text-[var(--text-light)] transition-transform ${showAccountMenu ? 'rotate-180' : ''}`} />
                                </button>

                                {showAccountMenu && (
                                    <div className="absolute right-0 z-[60] mt-2 w-64 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-2 shadow-xl">
                                        <div className="px-3 py-2 border-b border-[var(--border-color)]">
                                            <p className="text-sm font-bold text-[var(--text-main)] truncate">{accountDisplayName}</p>
                                            <p className="text-xs text-[var(--text-light)] truncate">{userProfile.email}</p>
                                        </div>

                                        <div className="pt-1 pb-1">
                                            <button
                                                onClick={handleMenuExport}
                                                disabled={isExportingFromMenu}
                                                className={`w-full px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--hover-bg)] rounded-xl flex items-center gap-2 disabled:opacity-60 transition-colors ${backupOverdue ? 'text-amber-600' : 'text-[var(--text-main)]'}`}
                                            >
                                                {isExportingFromMenu ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                                Sauvegarder mes données
                                                {backupOverdue && <span className="ml-auto text-amber-500 text-xs font-bold">!</span>}
                                            </button>
                                            <label className="w-full px-3 py-2 text-left text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--hover-bg)] rounded-xl flex items-center gap-2 cursor-pointer transition-colors">
                                                <Upload size={14} /> Importer un backup
                                                <input ref={menuImportRef} type="file" accept=".ergobilan" className="hidden" onChange={handleMenuImport} />
                                            </label>
                                        </div>
                                        <div className="mx-2 h-px bg-[var(--border-color)]" />

                                        <button onClick={() => { setShowAccountMenu(false); setPreviousMode(mode as 'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'detail'); setMode('profile'); }} className="w-full px-3 py-2 text-left text-sm font-medium text-[var(--text-main)] hover:bg-[var(--hover-bg)] rounded-xl flex items-center gap-2">
                                            <User size={14} /> Mon Profil
                                        </button>
                                        <button onClick={() => { setShowAccountMenu(false); setPricingModalMode('plans'); }} className="w-full px-3 py-2 text-left text-sm font-medium text-[var(--text-main)] hover:bg-[var(--hover-bg)] rounded-xl flex items-center gap-2">
                                            <Crown size={14} /> Mon abonnement
                                        </button>
                                        {userProfile.isAdmin && (
                                            <button onClick={() => { setShowAccountMenu(false); handleAdminAccess(); }} className="w-full px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50 rounded-xl flex items-center gap-2">
                                                <ShieldAlert size={14} /> Admin
                                            </button>
                                        )}
                                        <button onClick={() => { setShowAccountMenu(false); logout(); }} className="w-full px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-xl flex items-center gap-2">
                                            <LogOut size={14} /> Déconnexion
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </header>

            {isDemoMode && <div className="bg-[#F2CC8F] text-[#78350f] min-h-11 py-2 px-6 sticky top-0 z-30 shadow-lg flex justify-center items-center gap-4"><div className="flex items-center gap-2 text-sm"><Info size={16} strokeWidth={3} /><span className="font-bold uppercase tracking-widest">MODE DÉMONSTRATION - Aucune donnée ne sera sauvegardée</span></div><button onClick={() => logout()} className="bg-[#3D405B] text-white px-4 py-1.5 rounded-full text-[10px] font-bold uppercase hover:bg-[#2c2e42] transition-colors flex items-center gap-2 shadow-md">S'inscrire gratuitement <ArrowRight size={12} /></button></div>}

            <GlobalErrorBoundary>
                <OfflineIndicator />
                <Suspense fallback={<AppLoader />}>
                    {mode === 'dashboard' && (
                        <Dashboard
                            userProfile={userProfile}
                            pendingQuestionnaires={pendingQuestionnaires}
                            patientFiles={patientFiles}
                            onCreateNew={() => { assessment.resetAssessment(); setMode('assessment'); }}
                            onCreateHistorical={() => { assessment.resetAssessment(); assessment.setReportType('historique'); setMode('assessment'); }}
                            onGenerateLink={handleGenerateLink}
                            onShowPricing={() => setPricingModalMode('plans')}
                            onOpenPatient={async (id) => {
                                try {
                                    const details = await StorageService.loadPatientDetails(id);
                                    const baseFile = patientFiles.find(f => f.id === id);
                                    if (baseFile) {
                                        setSelectedFile({
                                            ...baseFile,
                                            assessments: details.assessments,
                                            followup: details.followup,
                                            patient: details.patient
                                        });
                                        setDetailPaging({
                                            hasMoreAssessments: details.hasMoreAssessments,
                                            nextAssessmentOffset: details.nextAssessmentOffset,
                                            isLoadingMore: false
                                        });
                                        setMode('detail');
                                    }
                                } catch {
                                    toast.error("Impossible d'ouvrir ce dossier.");
                                }
                            }}
                            onProcessPending={onProcessPending}
                            processingQueueId={processingQueueId}
                            draftsIndex={draftsIndex}
                            onResumeDraft={onResumeDraft}
                            isDemoMode={isDemoMode}
                            onCopyLink={handleCopyLink}
                            onDeletePending={handleDeletePending}
                            hasMorePatients={hasMorePatients}
                            isLoadingMorePatients={isLoadingMorePatients}
                            onLoadMorePatients={loadMorePatients}
                        />
                    )}
                    {mode === 'detail' && selectedFile && (
                        <PatientDetail
                            file={selectedFile}
                            onBack={() => setMode('dashboard')}
                            onDelete={(patientId) => {
                                setPatientFiles((prev) => prev.filter((item) => item.id !== patientId));
                                setDraftsIndex((prev) => {
                                    if (!prev[patientId]) return prev;
                                    const next = { ...prev };
                                    delete next[patientId];
                                    return next;
                                });
                                setSelectedFile(null);
                            }}
                            onNewBilan={(type: 'initial' | 'reevaluation' | 'historique') => {
                                assessment.resetAssessment();
                                assessment.setPatient(selectedFile.patient);
                                assessment.setReportType(type);
                                if (type === 'reevaluation') {
                                    const prevAssessment = [...(selectedFile.assessments || [])]
                                        .filter(a => a.hasFormalReport)
                                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null;
                                    // Resolve tests: use stored tests field, or reconstruct from flat results
                                    // using the catalog map (retroactive fix for older assessments saved without tests).
                                    let prevTests = prevAssessment?.tests ?? {};
                                    if (Object.keys(prevTests).length === 0 && prevAssessment?.results && Object.keys(prevAssessment.results).length > 0) {
                                        const rebuilt: TestData = {};
                                        Object.entries(prevAssessment.results).forEach(([subtestId, score]) => {
                                            const info = subtestToTestMap.get(subtestId);
                                            if (info) {
                                                if (!rebuilt[info.testId]) rebuilt[info.testId] = {};
                                                rebuilt[info.testId][subtestId] = score;
                                            }
                                        });
                                        prevTests = rebuilt;
                                    }
                                    assessment.setPreviousAssessment(prevAssessment ? { ...prevAssessment, tests: prevTests } : null);
                                    if (Object.keys(prevTests).length > 0) {
                                        assessment.updateTests(prevTests);
                                    }
                                } else {
                                    assessment.setPreviousAssessment(null);
                                }
                                setMode('assessment');
                            }}
                            onOpenReport={(reportId) => {
                                const target = selectedFile.assessments.find((item) => item.id === reportId && item.hasFormalReport);
                                if (!target) { toast.info('Document introuvable.'); return; }
                                setViewingReport(target);
                            }}
                            draftAvailable={(() => {
                                const meta = draftsIndex[selectedFile.id];
                                if (!meta) return false;
                                const hasInitial = selectedFile.assessments?.some(a => a.hasFormalReport) ?? false;
                                // Stale check: initial or historique draft for patient who already has a formal report
                                if (hasInitial && (!meta.reportType || meta.reportType === 'initial' || meta.reportType === 'historique')) return false;
                                return true;
                            })()}
                            draftReportType={draftsIndex[selectedFile.id]?.reportType ?? null}
                            onResumeDraft={() => onResumeDraft(selectedFile.id)}
                            hasMoreHistory={detailPaging.hasMoreAssessments}
                            isLoadingMoreHistory={detailPaging.isLoadingMore}
                            onLoadMoreHistory={handleLoadMoreHistory}
                            onFollowupChange={(followup: PatientFollowup | null) => {
                                setSelectedFile((prev) => (prev ? { ...prev, followup } : prev));
                                setPatientFiles((prev) =>
                                    prev.map((item) => (item.id === selectedFile.id ? { ...item, followup } : item))
                                );
                            }}
                        />
                    )}
                    {showOnboarding && <OnboardingExperience onComplete={() => setShowOnboarding(false)} />}
                    {mode === 'portal' && <PatientPortal onBack={() => setMode('landing')} initialUrl={portalInitialUrl} />}


                    {mode === 'profile' && <ProfileEditor onClose={() => setMode(previousMode)} />}

                    {/* --- WORKFLOW ASSESSMENT MISE À JOUR (FLUID FLOW 5 ÉTAPES) --- */}
                    {mode === 'assessment' && (
                        <div className="max-w-7xl mx-auto p-6">
                            {/* Navigation Stepper */}
                            <AssessmentStepper currentStep={assessment.step} onStepClick={handleStepperClick} disabled={isGenerating} reportType={assessment.reportType} />

                            {/* ─── FLUX RÉÉVALUATION (5 étapes) ─── */}
                            {assessment.reportType === 'reevaluation' && (
                                <>
                                    {assessment.step === 1 && (
                                        <ReevStep1Scores
                                            patient={assessment.patient}
                                            tests={assessment.tests}
                                            updateTests={assessment.updateTests}
                                            observations={assessment.observations}
                                            updateObservations={assessment.updateObservations}
                                            onNext={() => assessment.setStep(2)}
                                            onBack={handleQuitAssessment}
                                            userProfile={userProfile}
                                            previousAssessmentDate={assessment.previousAssessment?.date}
                                            previousTests={assessment.previousAssessment?.tests ?? {}}
                                        />
                                    )}
                                    {assessment.step === 2 && (
                                        <ReevStep2Evolution
                                            patient={assessment.patient}
                                            previousAssessment={assessment.previousAssessment}
                                            newTests={assessment.tests}
                                            sections={assessment.sections}
                                            onSetSections={assessment.setSections}
                                            onNext={() => assessment.setStep(3)}
                                            onBack={() => assessment.setStep(1)}
                                        />
                                    )}
                                    {assessment.step === 3 && (
                                        <ValidationPage
                                            sections={assessment.sections}
                                            patient={assessment.patient}
                                            onValidateSection={(id, c, fmt) => assessment.updateSection(id, { status: 'validated', ...(c !== undefined ? { content: c } : {}), ...(fmt ? { contentFormat: fmt } : {}) })}
                                            onNext={() => assessment.setStep(4)}
                                            onBack={() => assessment.setStep(2)}
                                        />
                                    )}
                                    {assessment.step === 4 && (
                                        <ExportPage
                                            patient={assessment.patient}
                                            sections={assessment.sections}
                                            tests={assessment.tests}
                                            reportType="reevaluation"
                                            onValidate={onFinalize}
                                            onUpdateSection={assessment.updateSection}
                                            branding={userProfile.branding}
                                            onUpdateBranding={(newBranding) => updateUserProfile({ branding: newBranding })}
                                            isPremium={userProfile.subscriptionPlan !== 'free'}
                                            onShowPricing={() => setPricingModalMode('plans')}
                                            onBack={() => assessment.setStep(3)}
                                            isDemoMode={isDemoMode}
                                            onDemoConvert={(action) => setDemoConversion({ show: true, action })}
                                            onOpenProfile={() => { setPreviousMode(mode as 'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'detail'); setMode('profile'); }}
                                        />
                                    )}
                                </>
                            )}

                            {/* ─── FLUX IMPORT HISTORIQUE (3 étapes) ─── */}
                            {assessment.reportType === 'historique' && (
                                <>
                                    {assessment.step === 1 && (
                                        <HistoricalPatientForm
                                            data={assessment.patient}
                                            updateData={assessment.updatePatient}
                                            onNext={() => assessment.setStep(2)}
                                            onPatientCreated={loadData}
                                        />
                                    )}
                                    {assessment.step === 2 && (
                                        <ScorePage
                                            patient={assessment.patient}
                                            tests={assessment.tests}
                                            updateTests={assessment.updateTests}
                                            observations={assessment.observations}
                                            updateObservations={assessment.updateObservations}
                                            onNext={() => assessment.setStep(3)}
                                            onBack={() => assessment.setStep(1)}
                                            userProfile={userProfile}
                                        />
                                    )}
                                    {assessment.step === 3 && (
                                        <HistoricalSectionsStep
                                            patient={assessment.patient}
                                            historicalDate={assessment.historicalDate}
                                            onBack={() => assessment.setStep(2)}
                                            onSave={handleFinalizeHistorical}
                                        />
                                    )}
                                </>
                            )}

                            {/* ─── FLUX INITIAL 5 ÉTAPES ─── */}
                            {assessment.reportType === 'initial' && (
                                <>
                                    {/* Step 1: Admin */}
                                    {assessment.step === 1 && <Step1Admin data={assessment.patient} updateData={assessment.updatePatient} onQuit={handleQuitAssessment} onNext={() => assessment.setStep(2)} onPatientCreated={loadData} />}

                                    {/* Step 2: Tests & Observations (FUSIONNÉ) */}
                                    {assessment.step === 2 && (
                                        <ScorePage
                                            patient={assessment.patient}
                                            tests={assessment.tests}
                                            updateTests={assessment.updateTests}
                                            observations={assessment.observations}
                                            updateObservations={assessment.updateObservations}
                                            onNext={() => assessment.setStep(3)} // Vers Diagnostic
                                            onBack={() => assessment.setStep(1)}
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
                                            onNext={() => { if (userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert' || isDemoMode) setShowConfirmGeneration(true); else setPricingModalMode('paywall'); }}
                                            onBack={() => assessment.setStep(2)}
                                            isGenerating={isGenerating}
                                        />
                                    )}

                                    {/* Step 4: Validation */}
                                    {assessment.step === 4 && <ValidationPage sections={assessment.sections} patient={assessment.patient} onValidateSection={(id, c, fmt) => assessment.updateSection(id, { status: 'validated', ...(c !== undefined ? { content: c } : {}), ...(fmt ? { contentFormat: fmt } : {}) })} onNext={() => assessment.setStep(5)} onBack={() => assessment.setStep(3)} />}

                                    {/* Step 5: Export */}
                                    {assessment.step === 5 && (
                                        <ExportPage
                                            patient={assessment.patient}
                                            sections={assessment.sections}
                                            tests={assessment.tests}
                                            reportType="initial"
                                            onValidate={onFinalize}
                                            onUpdateSection={assessment.updateSection}
                                            branding={userProfile.branding}
                                            onUpdateBranding={(newBranding) => updateUserProfile({ branding: newBranding })}
                                            isPremium={userProfile.subscriptionPlan !== 'free'}
                                            onShowPricing={() => setPricingModalMode('plans')}
                                            onBack={() => assessment.setStep(4)}
                                            isDemoMode={isDemoMode}
                                            onDemoConvert={(action) => setDemoConversion({ show: true, action })}
                                            onOpenProfile={() => { setPreviousMode(mode as 'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'detail'); setMode('profile'); }}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    )}


            </Suspense>

            <GenerationLoader isVisible={isGenerating} onCancel={() => setIsGenerating(false)} />
            {generationError && generationError !== 'CREDIT_INSUFFICIENT' && <CriticalErrorModal error={generationError} onRetry={() => { setGenerationError(null); onTriggerGeneration(); }} onClose={() => setGenerationError(null)} />}

            {/* Stepper backward navigation guard (A1) */}
            <ConfirmModal
                isOpen={!!stepperConfirm}
                title="Retour en arrière"
                message={"Vous avez déjà un rapport généré. Si vous revenez en arrière et régénérez le bilan, vos modifications de relecture seront écrasées.\n\nContinuer ?"}
                confirmLabel="Continuer"
                cancelLabel="Annuler"
                variant="warning"
                onConfirm={confirmStepperNavigation}
                onCancel={() => setStepperConfirm(null)}
            />

            {/* Quit assessment guard (A4) */}
            <ConfirmModal
                isOpen={showQuitConfirm}
                title="Quitter le bilan"
                message="Souhaitez-vous sauvegarder un brouillon avant de quitter ?"
                confirmLabel="Quitter sans sauvegarder"
                cancelLabel="Annuler"
                variant="danger"
                secondaryAction={{ label: 'Sauvegarder le brouillon', onClick: handleQuitSave }}
                onConfirm={handleQuitDiscard}
                onCancel={() => setShowQuitConfirm(false)}
            />

            {/* POPUP CONFIRMATION IA */}
            {showConfirmGeneration && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] max-w-md text-center shadow-2xl border border-[var(--border-color)]">
                        <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]"><FileText size={40} /></div>
                        <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Vérification avant analyse</h3>
                        <p className="text-[var(--text-secondary)] text-sm mb-4 font-medium leading-relaxed">
                            La qualité du rapport dépend de la précision de vos observations et du diagnostic posé. Avez-vous tout relu ?
                        </p>
                        <div className="bg-[var(--card-bg-raised)] p-3 rounded-xl mb-8 border border-[var(--border-color)] flex gap-2 text-left">
                            <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
                            <div className="space-y-1"><p className="text-[10px] text-[var(--text-secondary)] leading-relaxed"><strong>Confidentialité :</strong> Les données sont anonymisées automatiquement avant l'envoi.</p></div>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowConfirmGeneration(false)} className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-xs uppercase tracking-wider">Retourner ajouter des détails</button>
                            <button id="demo-btn-generate" onClick={onTriggerGeneration} className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">
                                {isDemoMode ? "Générer" : "Générer (1 crédit)"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Read-only report viewer — full page overlay */}
            {viewingReport && selectedFile && (() => {
                // Group flat results by parent test for display
                const groups: Map<string, { testName: string; rows: Array<{ id: string; name: string; score: import('./types').ScoreResult }> }> = new Map();
                const normalizedResults = normalizeFlatResults(viewingReport.results);
                Object.entries(normalizedResults).forEach(([key, score]) => {
                    const testInfo = subtestToTestMap.get(key);
                    const groupKey = testInfo?.testId ?? '_custom';
                    const groupName = testInfo?.testName ?? 'Tests personnalisés';
                    if (!groups.has(groupKey)) groups.set(groupKey, { testName: groupName, rows: [] });
                    const name = score.customLabel || subtestNameMap.get(key) || key.replace(/_[a-f0-9]{8}$/i, '').replace(/[_-]/g, ' ');
                    groups.get(groupKey)!.rows.push({ id: key, name, score });
                });
                const scoreGroups = Array.from(groups.values());
                const fmtScore = formatScoreCompact;

                return (
                    <div className="fixed inset-0 z-[200] overflow-y-auto animate-in fade-in duration-200" style={{ backgroundColor: 'var(--card-bg, #fff)' }}>
                        {/* Sticky header bar */}
                        <div className="sticky top-0 z-10 border-b border-[var(--border-color)] px-6 py-4 flex items-center justify-between shadow-sm" style={{ backgroundColor: 'var(--card-bg, #fff)' }}>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                                    {viewingReport.kind === 'reevaluation' ? 'Réévaluation' : 'Bilan initial'}
                                    {' · '}
                                    {new Date(viewingReport.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </p>
                                <h2 className="font-serif text-xl font-bold text-[var(--text-heading)] mt-0.5">{viewingReport.report?.patientName ?? selectedFile.patient.firstName + ' ' + selectedFile.patient.lastName}</h2>
                            </div>
                            <button onClick={() => setViewingReport(null)} className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors">
                                <X size={14} /> Fermer
                            </button>
                        </div>

                        {/* Document body */}
                        <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

                            {/* Scores section */}
                            {scoreGroups.length > 0 && (
                                <section>
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-4">Scores</h3>
                                    <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden divide-y divide-[var(--border-color)]">
                                        {scoreGroups.map((group) => (
                                            <div key={group.testName}>
                                                <div className="px-5 py-3 bg-[var(--hover-bg)]">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">{group.testName}</p>
                                                </div>
                                                {group.rows.map((row) => (
                                                    <div key={row.id} className="flex items-center justify-between px-5 py-2.5 even:bg-[var(--hover-bg)]/40">
                                                        <span className="text-sm text-[var(--text-main)]">{row.name}</span>
                                                        <span className="font-mono text-xs font-bold text-[var(--text-secondary)] bg-[var(--hover-bg)] px-2 py-0.5 rounded-md">{fmtScore(row.score)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Rapport sections */}
                            {viewingReport.report?.sections && viewingReport.report.sections.length > 0 && (
                                <section>
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-4">Rapport</h3>
                                    <div className="space-y-6">
                                        {viewingReport.report.sections.map((section) => (
                                            <div key={section.id} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
                                                <div className="border-l-4 border-[var(--primary)] px-5 py-4 bg-[var(--hover-bg)]">
                                                    <h4 className="font-semibold text-base text-[var(--text-heading)]">{section.title}</h4>
                                                </div>
                                                <div className="px-5 py-4">
                                                    {section.content ? (
                                                        section.contentFormat === 'html' ? (
                                                            <div
                                                                className="text-sm text-[var(--text-main)] leading-relaxed prose-sm [&_strong]:font-bold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-semibold [&_h3]:text-sm [&_h3]:mt-2 [&_h3]:mb-0.5 [&_p]:mt-1"
                                                                dangerouslySetInnerHTML={{ __html: decodeResidualEntities(section.content) }}
                                                            />
                                                        ) : (
                                                            <p className="text-sm text-[var(--text-main)] leading-relaxed whitespace-pre-wrap">{section.content}</p>
                                                        )
                                                    ) : (
                                                        <p className="text-sm text-[var(--text-secondary)] italic">Section vide</p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {!scoreGroups.length && !viewingReport.report?.sections?.length && (
                                <div className="text-center py-16 text-[var(--text-secondary)] italic text-sm">Aucun contenu enregistré pour ce bilan.</div>
                            )}
                        </div>
                    </div>
                );
            })()}

            {demoConversion.show && <DemoConversionModal action={demoConversion.action} onClose={() => setDemoConversion({ show: false, action: '' })} onConvert={() => { setDemoConversion({ show: false, action: '' }); logout(); }} />}
            </GlobalErrorBoundary>
        </div>
    );
};

const App = () => (
    <ThemeProvider>
        <AuthProvider>
            <CatalogProvider>
                <ToastProvider>
                    <AssessmentProvider>
                        <AppRouter />
                    </AssessmentProvider>
                </ToastProvider>
            </CatalogProvider>
        </AuthProvider>
    </ThemeProvider>
);

export default App;

