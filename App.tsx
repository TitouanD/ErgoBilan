/**
 * App — providers + internal router.
 *
 * There is no URL router: `mode` selects the screen (landing, dashboard,
 * patient detail, assessment, family portal, admin, profile). The family portal
 * link (`?q_id=...#key=...`) is detected before authentication.
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowRight, Info, Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssessmentProvider, useAssessment, type ReportType } from './contexts/AssessmentContext';
import { CatalogProvider, useCatalog } from './contexts/CatalogContext';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import type { PatientAssessment, PatientFile, PatientFollowup, PractitionerProfile } from './types';
import { StorageService } from './services/storage';
import { Logger } from './utils/logger';
import { setAppTag, setAppUser } from './services/sentryService';
import { getDaysSinceBackup } from './utils/backupTracking';
import { useDataLoader } from './hooks/useDataLoader';
import { useAssessmentFlow } from './hooks/useAssessmentFlow';
import { useAssessmentLauncher } from './hooks/useAssessmentLauncher';
import { derivePatientStatus } from './utils/patientStatus';
import { useLinkManager } from './hooks/useLinkManager';
import { usePendingProcessor } from './hooks/usePendingProcessor';
import { Dashboard } from './components/dashboard/Dashboard';
import { PatientPortal } from './components/portal/PatientPortal';
import { PinUnlock } from './components/auth/PinUnlock';
import { NetworkErrorScreen } from './components/auth/NetworkErrorScreen';
import { DemoConversionModal } from './components/shared/DemoConversionModal';
import { GlobalErrorBoundary } from './components/shared/GlobalErrorBoundary';
import { OfflineIndicator } from './components/shared/OfflineIndicator';
import { LandingPage } from './components/app/LandingPage';
import { AppHeader } from './components/app/AppHeader';
import { ReportViewerOverlay } from './components/app/ReportViewerOverlay';
import { AssessmentWorkspace } from './components/assessment/AssessmentWorkspace';

const AdminPanel = React.lazy(() => import('./components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const ProfileEditor = React.lazy(() => import('./components/dashboard/ProfileEditor').then((m) => ({ default: m.ProfileEditor })));
const OnboardingExperience = React.lazy(() => import('./components/auth/OnboardingExperience').then((m) => ({ default: m.OnboardingExperience })));
const PatientDetail = React.lazy(() => import('./components/dashboard/PatientDetail').then((m) => ({ default: m.PatientDetail })));
const PricingModal = React.lazy(() => import('./components/shared/PricingModal').then((m) => ({ default: m.PricingModal })));

type Mode = 'landing' | 'dashboard' | 'assessment' | 'portal' | 'admin' | 'detail' | 'profile';

/** Backup reminder thresholds (days since the last `.ergobilan` export). */
const BACKUP_REMINDER_DAYS = 180;

const AppLoader = () => (
  <div className="flex h-[50vh] w-full items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <Loader2 size={40} className="animate-spin text-[#E07A5F]" />
      <p className="text-stone-400 font-bold text-xs uppercase tracking-widest animate-pulse">Chargement...</p>
    </div>
  </div>
);

/** Full URL when the page was opened from a family questionnaire link, captured before any param stripping. */
const detectPortalUrl = (): string | undefined => {
  const params = new URLSearchParams(window.location.search);
  return params.get('q_id') && window.location.hash.includes('key=') ? window.location.href : undefined;
};

const AppRouter = () => {
  const {
    userProfile,
    practitioner,
    authState,
    sessionKey,
    setSessionKey,
    unlockSession,
    logout,
    refreshProfile,
    reloadUserFromSession,
    tempEmail,
    startDemo,
    isDemoMode,
    verifyAdminAccess,
    isLoading,
  } = useAuth();
  const { index: catalogIndex, hasLoaded: hasCatalogLoaded, ensureCatalogLoaded } = useCatalog();
  const assessment = useAssessment();
  const toast = useToast();

  const [portalInitialUrl, setPortalInitialUrl] = useState(detectPortalUrl);
  const [mode, setMode] = useState<Mode>(portalInitialUrl ? 'portal' : 'landing');
  const [previousMode, setPreviousMode] = useState<Mode>('dashboard');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pricingModalMode, setPricingModalMode] = useState<'plans' | 'paywall' | null>(null);
  const [selectedFile, setSelectedFile] = useState<PatientFile | null>(null);
  const [viewingReport, setViewingReport] = useState<PatientAssessment | null>(null);
  const [detailPaging, setDetailPaging] = useState({ hasMoreAssessments: false, nextAssessmentOffset: 0, isLoadingMore: false });
  const [demoConversionAction, setDemoConversionAction] = useState<string | null>(null);

  const {
    patientFiles,
    setPatientFiles,
    pendingQuestionnaires,
    setPendingQuestionnaires,
    draftsIndex,
    setDraftsIndex,
    loadData,
    hasMorePatients,
    isLoadingMorePatients,
    loadMorePatients,
  } = useDataLoader({ sessionKey, authState, practitioner, isDemoMode });

  const flow = useAssessmentFlow({ assessment, sessionKey, isDemoMode, catalogIndex, practitioner, refreshProfile, loadData, toast });
  const launcher = useAssessmentLauncher({ assessment, patientFiles, draftsIndex, toast });
  const { handleGenerateLink, handleCopyLink, handleDeletePending } = useLinkManager({
    sessionKey,
    practitioner,
    isDemoMode,
    pendingQuestionnaires,
    setPendingQuestionnaires,
    toast,
  });
  const { processingQueueId, handleProcessPending } = usePendingProcessor({
    sessionKey,
    isDemoMode,
    assessment,
    setPatientFiles,
    setPendingQuestionnaires,
    loadData,
    toast,
  });

  // ─── Auth state → screen ────────────────────────────────────────────────
  useEffect(() => {
    if (authState === 'unauthenticated' && !portalInitialUrl) setMode('landing');
    else if (authState === 'authenticated') setMode((prev) => (prev === 'landing' ? 'dashboard' : prev));
    else if (authState === 'registering') setMode('landing');
    else if (authState === 'subscription_locked') {
      setMode('dashboard');
      setPricingModalMode('paywall');
    } else if (authState === 'error') toast.error('Problème de connexion.');
  }, [authState]);

  // ─── Sentry: who (pseudonymous id) and where, attached to every event ─────
  useEffect(() => {
    setAppUser(isDemoMode ? null : userProfile?.id || null);
    setAppTag('demo_mode', isDemoMode);
  }, [userProfile?.id, isDemoMode]);

  useEffect(() => {
    setAppTag('auth_state', authState);
    Logger.info('AUTH', `Auth state: ${authState}`);
  }, [authState]);

  useEffect(() => {
    setAppTag('app_mode', mode);
    Logger.info('UI', `Screen: ${mode}`);
  }, [mode]);

  const { reportType, step } = assessment;
  useEffect(() => {
    const inAssessment = mode === 'assessment';
    setAppTag('report_type', inAssessment ? reportType : null);
    setAppTag('assessment_step', inAssessment ? step : null);
    if (inAssessment) Logger.info('UI', `Assessment ${reportType} — step ${step}`);
  }, [mode, reportType, step]);

  // Backup reminder, once per browser session
  useEffect(() => {
    if (!practitioner?.id || isDemoMode || authState !== 'authenticated') return;
    if (sessionStorage.getItem('ergo_backup_reminder_shown')) return;
    const days = getDaysSinceBackup(practitioner.id);
    if (days === null || days > BACKUP_REMINDER_DAYS) {
      toast.warning(
        days === null
          ? 'Aucun backup détecté — exportez vos données depuis le menu du compte pour ne rien perdre.'
          : 'Votre dernier backup date de plus de 6 mois — pensez à exporter vos données.',
      );
      sessionStorage.setItem('ergo_backup_reminder_shown', '1');
    }
  }, [practitioner?.id, authState, isDemoMode]);

  // Preload the catalogue shortly after entering the app
  useEffect(() => {
    if (authState !== 'authenticated' || hasCatalogLoaded || !['dashboard', 'detail', 'assessment'].includes(mode)) return;
    const timer = window.setTimeout(() => void ensureCatalogLoaded(), 1200);
    return () => window.clearTimeout(timer);
  }, [authState, hasCatalogLoaded, mode, ensureCatalogLoaded]);

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleWizardComplete = async (_profile: PractitionerProfile, key: CryptoKey) => {
    setShowOnboarding(true);
    setSessionKey(key);
    if ((await reloadUserFromSession()) === 'locked') await unlockSession(key);
  };

  const openProfile = () => {
    setPreviousMode(mode);
    setMode('profile');
  };

  const openAdmin = async () => {
    if (await verifyAdminAccess()) setMode('admin');
    else toast.error('Accès refusé par le serveur.');
  };

  const saveAndQuit = async () => {
    if (await flow.saveAndQuit()) setMode('dashboard');
  };

  const startAssessment = async (type: ReportType, file?: PatientFile) => {
    const patient = file ? { ...file.patient, id: file.id } : undefined;
    if (await launcher.startAssessment(type, patient, file?.assessments)) setMode('assessment');
  };

  const resumeDraft = async (patientId: string) => {
    if (await launcher.resumeDraft(patientId)) setMode('assessment');
  };

  const openPatient = async (id: string) => {
    try {
      const details = await StorageService.loadPatientDetails(id);
      const baseFile = patientFiles.find((f) => f.id === id);
      if (!baseFile) return;
      setSelectedFile({ ...baseFile, assessments: details.assessments, followup: details.followup, patient: details.patient });
      setDetailPaging({ hasMoreAssessments: details.hasMoreAssessments, nextAssessmentOffset: details.nextAssessmentOffset, isLoadingMore: false });
      setMode('detail');
    } catch (e) {
      Logger.error('DB', 'Failed to open patient file', e);
      toast.error("Impossible d'ouvrir ce dossier.");
    }
  };

  const loadMoreHistory = useCallback(async () => {
    if (!selectedFile || detailPaging.isLoadingMore) return;
    setDetailPaging((prev) => ({ ...prev, isLoadingMore: true }));
    try {
      const history = await StorageService.loadPatientHistoryPage(selectedFile.id, { assessmentOffset: detailPaging.nextAssessmentOffset });
      setSelectedFile((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.assessments.map((a) => [a.id, a]));
        history.assessments.forEach((a) => byId.set(a.id, a));
        return { ...prev, assessments: [...byId.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) };
      });
      setDetailPaging({ hasMoreAssessments: history.hasMoreAssessments, nextAssessmentOffset: history.nextAssessmentOffset, isLoadingMore: false });
    } catch (e) {
      Logger.warn('DB', 'Failed to load more history', e);
      toast.error("Impossible de charger plus d'historique.");
      setDetailPaging((prev) => ({ ...prev, isLoadingMore: false }));
    }
  }, [selectedFile, detailPaging, toast]);

  const removePatientFromLists = (patientId: string) => {
    setPatientFiles((prev) => prev.filter((f) => f.id !== patientId));
    setDraftsIndex((prev) => {
      const { [patientId]: _removed, ...rest } = prev;
      return rest;
    });
    setSelectedFile(null);
  };

  const updateFollowup = (followup: PatientFollowup | null) => {
    if (!selectedFile) return;
    setSelectedFile((prev) => (prev ? { ...prev, followup } : prev));
    setPatientFiles((prev) => prev.map((f) => (f.id === selectedFile.id ? { ...f, followup } : f)));
  };

  const processPending = async (q: Parameters<typeof handleProcessPending>[0]) => {
    if ((await handleProcessPending(q)) === 'assessment') setMode('assessment');
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  // Family portal: public and standalone (no practitioner header), bypasses loading/PIN screens.
  if (portalInitialUrl || mode === 'portal') {
    const leavePortal = () => {
      if (portalInitialUrl) {
        // Drop ?q_id=…#key=… so the key does not linger in the address bar.
        window.history.replaceState(null, '', window.location.pathname);
        setPortalInitialUrl(undefined);
      }
      setMode('landing');
    };
    return <PatientPortal onBack={leavePortal} initialUrl={portalInitialUrl} />;
  }
  if (isLoading || authState === 'authenticating') return <AppLoader />;
  if (authState === 'network_error') return <NetworkErrorScreen onRetry={reloadUserFromSession} onLogout={logout} />;
  if (authState === 'locked' && practitioner && !isDemoMode) return <PinUnlock practitioner={practitioner} onUnlock={unlockSession} onLogout={logout} />;

  if (mode === 'landing') {
    return (
      <LandingPage
        authState={authState}
        tempEmail={tempEmail}
        onEnterApp={() => setMode('dashboard')}
        onOpenPortal={() => setMode('portal')}
        onStartDemo={async () => {
          await startDemo();
          setShowOnboarding(true);
        }}
        onWizardComplete={handleWizardComplete}
      />
    );
  }

  if (mode === 'admin') {
    return (
      <Suspense fallback={<AppLoader />}>
        <AdminPanel userProfile={userProfile} onClose={() => setMode('dashboard')} />
      </Suspense>
    );
  }

  const selectedDraft = selectedFile ? derivePatientStatus(selectedFile, draftsIndex[selectedFile.id], new Date()).draft : null;

  return (
    <div className="min-h-screen bg-[var(--app-bg)] pb-20 font-sans">
      <AppHeader
        isAssessment={mode === 'assessment'}
        isAutoSaving={assessment.isAutoSaving}
        onSaveAndQuit={saveAndQuit}
        userProfile={userProfile}
        practitioner={practitioner}
        isDemoMode={isDemoMode}
        onHome={() => setMode('dashboard')}
        onShowPricing={() => setPricingModalMode('plans')}
        onOpenProfile={openProfile}
        onOpenAdmin={openAdmin}
        onLogout={logout}
        onImported={() => void loadData()}
      />

      {isDemoMode && (
        <div className="bg-[#F2CC8F] text-[#78350f] min-h-11 py-2 px-6 sticky top-0 z-30 shadow-lg flex justify-center items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Info size={16} strokeWidth={3} />
            <span className="font-bold uppercase tracking-widest">Mode démonstration — aucune donnée n'est sauvegardée</span>
          </div>
          <button
            onClick={() => void logout()}
            className="bg-[#3D405B] text-white px-4 py-1.5 rounded-full text-[10px] font-bold uppercase hover:bg-[#2c2e42] transition-colors flex items-center gap-2 shadow-md"
          >
            S'inscrire gratuitement <ArrowRight size={12} />
          </button>
        </div>
      )}

      <GlobalErrorBoundary>
        <OfflineIndicator />
        <Suspense fallback={<AppLoader />}>
          {mode === 'dashboard' && (
            <Dashboard
              userProfile={userProfile}
              pendingQuestionnaires={pendingQuestionnaires}
              patientFiles={patientFiles}
              onCreateNew={() => void startAssessment('initial')}
              onCreateHistorical={() => void startAssessment('historique')}
              onGenerateLink={handleGenerateLink}
              onShowPricing={() => setPricingModalMode('plans')}
              onOpenPatient={openPatient}
              onProcessPending={processPending}
              processingQueueId={processingQueueId}
              draftsIndex={draftsIndex}
              onResumeDraft={resumeDraft}
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
              onDelete={removePatientFromLists}
              onNewBilan={(type) => void startAssessment(type, selectedFile)}
              onOpenReport={(reportId) => {
                const target = selectedFile.assessments.find((a) => a.id === reportId && a.hasFormalReport);
                if (target) setViewingReport(target);
                else toast.info('Document introuvable.');
              }}
              draftAvailable={selectedDraft?.stale === false}
              draftReportType={selectedDraft?.meta.reportType ?? null}
              onResumeDraft={() => void resumeDraft(selectedFile.id)}
              hasMoreHistory={detailPaging.hasMoreAssessments}
              isLoadingMoreHistory={detailPaging.isLoadingMore}
              onLoadMoreHistory={loadMoreHistory}
              onFollowupChange={updateFollowup}
            />
          )}
          {mode === 'profile' && <ProfileEditor onClose={() => setMode(previousMode)} />}
          {mode === 'assessment' && (
            <AssessmentWorkspace
              flow={flow}
              onExit={() => setMode('dashboard')}
              onOpenProfile={openProfile}
              onShowPricing={setPricingModalMode}
              onDemoConvert={setDemoConversionAction}
              loadData={loadData}
            />
          )}
          {showOnboarding && <OnboardingExperience onComplete={() => setShowOnboarding(false)} />}
          {pricingModalMode && (
            <PricingModal
              isPaywallMode={pricingModalMode === 'paywall'}
              onClose={() => setPricingModalMode(null)}
              // No online payment yet: plan changes are handled manually by the team.
              onSelectPlan={() => toast.info("Le paiement en ligne n'est pas encore disponible : contactez-nous pour changer d'offre.")}
              onUnlockOneOff={() => toast.info("L'achat à l'unité n'est pas encore disponible : contactez-nous pour obtenir des crédits.")}
            />
          )}
        </Suspense>

        {viewingReport && selectedFile && (
          <ReportViewerOverlay
            assessment={viewingReport}
            patientName={`${selectedFile.patient.firstName} ${selectedFile.patient.lastName}`}
            onClose={() => setViewingReport(null)}
          />
        )}

        {demoConversionAction && (
          <DemoConversionModal
            action={demoConversionAction}
            onClose={() => setDemoConversionAction(null)}
            onConvert={() => {
              setDemoConversionAction(null);
              void logout();
            }}
          />
        )}
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
