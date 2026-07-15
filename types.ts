
export interface ParamedicalTracking {
    id: string;
    type: string;
    name: string;
    profession?: string;
    frequency: string;
    since: string;
    assessmentDate?: string;
    contact: string;
    reason: string;
    endDate?: string;
    sessionCount?: string;
}

export interface Sibling {
    firstName: string;
    age: string;
    relation: string;
    livesWithChild: boolean;
    livesPartially?: boolean;
    residenceStatus?: 'with' | 'partial' | 'away' | 'other';
    residenceOther?: string;
    notes?: string;
}

export interface Patient {
    id?: string;
    firstName: string;
    lastName: string;
    dob: string;
    age: string;
    gender: string;
    address: string;
    parentNames: string;
    parentPhone: string;
    parentEmail: string;
    parent1Name?: string;
    parent1Phone?: string;
    parent1Email?: string;
    parent1Address?: string;
    parent2Name?: string;
    parent2Phone?: string;
    parent2Email?: string;
    parent2Address?: string;
    guardArrangement: string;
    guardMode?: string;
    guardExclusiveOther?: string;
    siblings: Sibling[];
    school: string;
    classLevel: string;
    schoolType?: string;
    schoolTrack?: string;
    schoolRepeatYear?: string;
    teacher: string;
    carePlan: string;
    avs: string;
    avsDetails: string;
    avsHours?: string;
    avsMissions?: string;
    prescribingDoctor: string;
    treatingDoctor?: string;
    medicalDiagnosis: string;
    medicalTreatments: string;
    medicalFollowup: string;
    medicalTracking?: ParamedicalTracking[];
    reason: string;
    familyExpectations: string;
    pregnancyBirth: string;
    developmentMotor: string;
    developmentLanguage: string;
    walkingAge?: string;
    crawling?: string;
    crawlingFourPattes?: string;
    crawlingRamper?: string;
    cleanliness?: string;
    languageStatus?: string;
    sleep?: string;
    sleepStatus?: string;
    sensory: string;
    sensoryNotes?: string;
    meals: string;
    eatingHabits?: string;
    dressing: string;
    dressingAutonomy?: string;
    clothingButtons?: string;
    clothingLaces?: string;
    clothingZippers?: string;
    clothingPressureStuds?: string;
    dressingObservations?: string;
    continence: string;
    hygieneTeeth?: string;
    hygieneHands?: string;
    hygieneBath?: string;
    hygieneFace?: string;
    hygieneHair?: string;
    hygieneContinenceStatus?: string;
    hygieneObservations?: string;
    timeSpace: string;
    timeSpaceClockReading?: string;
    timeSpaceObservations?: string;
    schoolAttention: string;
    schoolFavoriteSubjects?: string;
    schoolDislikedSubjects?: string;
    classroomBehavior?: string;
    schoolOrganization?: string;
    schoolMemory?: string;
    schoolParticipation?: string;
    peerRelations?: string;
    homeworkHabits?: string;
    socialBehavior?: string;
    writingIssues: string;
    writingDifficultyTags?: string;
    writingPain?: string;
    toolUsage: string;
    toolScissors?: string;
    handDominance?: string;
    writingOther?: string;
    schoolAccommodations: string;
    schoolDifficulties?: string;
    schoolDifficultiesOther?: string;
    remarks: string;
    priorities: string;
    goals?: string[];
    interviewNotes?: string;
    screenTime?: string;
    emotionalRegulation?: string;
    emotionalGlobalTags?: string;
    emotionalReactionTags?: string;
    emotionalNotes?: string;
    prescribingDoctorProfession?: string;
    organizationId?: string;
    siblingNotes?: string;
    timeSpaceClockDigital?: string;
    schoolCity?: string;
    classLevelOther?: string;
    schoolTypeOther?: string;
    classroomBehaviorTags?: string;
    peerRelationTags?: string;
    behaviorOutdoors?: string;
    behaviorHome?: string;
    emotionManagement?: string;
}

/**
 * ScoreResult — minimal shape.
 *
 * A score is either: a single entered `value` + its `unit` (NS, ET, % for
 * quantitative tests; 'qualitative' for category tests; 'raw' for tests with
 * no standardized scale) — or it doesn't exist yet. Whichever metric the
 * practitioner last typed into ("last wins") is what gets persisted; the
 * other two (e.g. ET/% when NS was entered) are recomputed on the fly for
 * display and are never stored.
 *
 * Legacy fields below (raw/standard/percentile/zScore/status/entryMetric/
 * scoreSource/conversionMode/reviewState/...) are kept optional ONLY for
 * backward-compatible reads of older bilans saved before this simplification.
 * New code must not write them — use `utils/scoring.ts#normalizeScoreResult`
 * to convert legacy data to the new shape on load.
 */
export interface ScoreResult {
    /** The single entered value, as a string. */
    value?: string;
    /** Unit of `value`. */
    unit?: 'NS' | 'ET' | '%' | 'qualitative' | 'raw';
    observation?: string;
    /** Human-readable qualitative label cached alongside `value` when `unit === 'qualitative'` */
    qualitativeLabel?: string;
    /** Custom label for 'custom_text' input model (bilan écologique / observation personnalisée) */
    customLabel?: string;
    /**
     * Per-item raw values for 'computed_items' input model.
     * Key = SubtestItem.id, Value = the numeric value entered by the practitioner.
     */
    rawItems?: Record<string, number>;

    // ── Legacy fields — deprecated, optional, read-only (backward compatibility) ──
    /** @deprecated use `value` + `unit: 'raw'` */
    raw?: string;
    /** @deprecated use `value` + `unit: 'NS'` */
    standard?: string;
    /** @deprecated use `value` + `unit: '%'` */
    percentile?: string;
    /** @deprecated use `value` + `unit: 'ET'` */
    zScore?: number;
    /** @deprecated no longer used */
    status?: 'empty' | 'draft' | 'validated' | 'estimated' | 'certified';
    /** @deprecated no longer used */
    validatedAt?: string;
    /** @deprecated no longer used */
    certifiedAt?: string;
    /** @deprecated use `unit` */
    scoreSource?: 'auto' | 'manual_ns' | 'manual_et' | 'manual_pct' | 'manual_raw';
    /** @deprecated use `unit` */
    entryMetric?: 'raw' | 'standard' | 'z' | 'percentile';
    /** @deprecated no longer used */
    conversionMode?: 'auto' | 'manual';
    /** @deprecated no longer used */
    reviewState?: 'not_reviewed' | 'reviewed';
    /** @deprecated no longer used */
    reviewedAt?: string;
    /** @deprecated use `value` + `unit: 'qualitative'` */
    qualitativeCode?: string;
    /** @deprecated no longer used */
    derived?: {
        standard?: string;
        percentile?: string;
        zScore?: number;
        source: 'auto' | 'assisted' | 'manual';
    };
}

export interface TestData {
    [testId: string]: {
        [subtestId: string]: ScoreResult;
    };
}

/**
 * Observations type — kept for backward compatibility with saved drafts.
 * Legacy fields (motricite, coordination, spatial, graphique) are preserved
 * but no longer surfaced in the UI. The `anamnese` field is repurposed as
 * the primary "clinical notes" channel fed to the AI.
 */
export interface Observations {
    anamnese: string;
    motricite: string;
    coordination: string;
    spatial: string;
    graphique: string;
}

export interface ClinicalSynthesis {
    diagnosticInput: string;
    projectInput: string;
    recommendationsInput: string;
}

export interface ReportAttachment {
    id: string;
    type: 'image-full' | 'image-text';
    url: string;
    caption?: string;
    positionIndex: number;
}

export interface ReportSection {
    id: string;
    title: string;
    content: string;
    originalContent?: string;
    contentFormat?: 'plain' | 'html';
    status: 'draft' | 'validated';
    isAiGenerated?: boolean;
    attachments?: ReportAttachment[];
}

export interface InfoBlockExtraLine {
    id: string;
    text: string;
    after: 'top' | 'name' | 'phone' | 'email' | 'siret' | 'address';
}

export interface InfoBlock {
    position: 'left' | 'center' | 'right';
    size: 'S' | 'M' | 'L';
    bgColor: string;
    borderColor: string;
    extraLines: InfoBlockExtraLine[];
}

export interface ReportContentVisibility {
    showScoreChart: boolean;
    showScoreTables: boolean;
    showScoreGuide: boolean;
    showAssessmentDate: boolean;
    showConsentBlock: boolean;
}

export interface BrandingConfig {
    isEnabled: boolean;
    primaryColor: string;
    secondaryColor: string;
    fontFamily: 'Merriweather' | 'Quicksand' | 'Roboto' | 'Playfair Display' | 'Open Sans' | 'Lato';
    headerTemplate: 'classic' | 'corporate' | 'centered' | 'boxed';
    titleStyle: 'simple' | 'underline' | 'filled-shape' | 'icon-star' | 'icon-sparkle' | 'icon-house' | 'filled';
    headerLayout: 'row' | 'column';
    headerAlignment: 'left' | 'right' | 'center';
    logoSize: 'small' | 'medium' | 'large';
    cornerStyle: 'rounded' | 'sharp' | 'extra-rounded';
    cabinetName: string;
    brandSubtitle: string;
    documentTitle: string;
    patientBlockStyle: 'modern' | 'minimal';
    practitionerName: string;
    address: string;
    siret: string;
    email?: string;
    phone?: string;
    footerText: string;
    showPageNumbers: boolean;
    logoUrl?: string;
    infoBlock?: InfoBlock;
    /** Independent background color for boxes/cards (patient block, chart headers, etc.). Defaults to primaryColor+15 if not set. */
    boxBgColor?: string;
    /** Persisted chart type preference (defaults to 'bar') */
    chartType?: 'radar' | 'bar' | 'percentile';
    /** Persisted per-test score display mode */
    scoreDisplayModes?: Record<string, 'NS' | 'ET' | '%'>;
    /** Fine-grained visibility flags for report content blocks */
    contentVisibility?: ReportContentVisibility;
}

export interface UserProfile {
    id: string;
    email: string;
    credits: number;
    isAdmin: boolean;
    subscriptionPlan: 'free' | 'essential' | 'performance' | 'expert';
    status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'inactive';
    isTrial: boolean;
    trialDaysRemaining: number;
    totalBilansGenerated: number;
    hasAcceptedResponsibility: boolean;
    branding: BrandingConfig;
}

export interface PractitionerProfile {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phonePro: string;
    siret: string;
    addressPro: string;
    encryptionSalt: string;
    encryptionValidator: string;
    organizationRole?: string;
    aiStylePreferences?: string;
}

export type PatientAssessmentKind = 'initial' | 'reevaluation';

export interface PatientAssessmentReport {
    status: 'completed';
    patientName: string;
    sections: ReportSection[];
}

export interface PatientAssessment {
    id: string;
    date: string;
    kind: PatientAssessmentKind;
    hasFormalReport: boolean;
    testName?: string;
    previousAssessmentId?: string;
    results?: Record<string, ScoreResult>;
    tests?: TestData;
    report?: PatientAssessmentReport;
}

export type PatientDashboardProgressLabel = 'created' | 'infos_recues' | 'tests_saisis' | 'termine';
export type PatientDashboardStatusTone = 'neutral' | 'warning' | 'success';
export type PatientDashboardNextAction = 'complete_initial' | 'resume_draft' | 'open_patient' | 'reevaluation_candidate';

export interface PatientDashboardPreviewMeta {
    uiVersion: 2;
    workflow: {
        progressPercent: number;
        progressLabel: PatientDashboardProgressLabel;
        statusTone: PatientDashboardStatusTone;
        nextAction: PatientDashboardNextAction;
    };
    metrics: {
        assessmentsCount: number;
        formalReportsCount: number;
        lastAssessmentDate: string | null;
        lastFormalReportDate: string | null;
    };
    flags: {
        _archived: boolean;
        hasInitialReport: boolean;
        hasReevaluationOpportunity: boolean;
    };
}

export interface PatientEncryptedPreviewV2 {
    uiVersion: 2;
    identity: {
        firstName: string;
        lastName: string;
        age: string;
        classLevel: string;
        gender: string;
    };
    workflow: PatientDashboardPreviewMeta['workflow'];
    metrics: PatientDashboardPreviewMeta['metrics'];
    flags: PatientDashboardPreviewMeta['flags'];
}

export interface PatientFile {
    id: string;
    patient: Patient;
    assessments: PatientAssessment[];
    followup?: PatientFollowup | null;
    lastInteraction: string;
    archived?: boolean;
    encryptedFileKey?: string;
    previewMeta?: PatientDashboardPreviewMeta;
}

export type PatientFollowupStatus = 'upcoming' | 'due' | 'overdue' | 'scheduled' | 'completed' | 'snoozed';

export interface PatientFollowup {
    id: string;
    patientId: string;
    organizationId: string | null;
    status: PatientFollowupStatus;
    dueAt: string;
    snoozedUntil?: string | null;
    note?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PendingQuestionnaire {
    id: string;
    label: string;
    status: 'pending' | 'completed';
    createdAt: string;
    practitionerEncryptedKey: string;
    familyEncryptedData?: string;
    practitioner_id?: string;
    accessToken?: string;
}







// --- Types ajoutés pour éliminer les `any` ---

/** Shape of a saved/restored assessment draft */
export interface DraftPayload {
    patient?: Patient;
    tests?: TestData;
    observations?: Observations;
    synthesis?: ClinicalSynthesis;
    sections?: ReportSection[];
    reportType?: 'initial' | 'reevaluation' | 'historique';
    historicalDate?: string;
    step?: number;
}

export interface DashboardDraftMeta {
    updatedAt: string;
    step: number | null;
    reportType?: 'initial' | 'reevaluation' | 'historique';
}

/** Admin library types */
export interface AdminTestSummary {
    id: string;
    name: string;
    category_id: string;
    organization_id?: string | null;
    created_at: string;
    subtest_count?: number;
}

export interface AdminTestRecord {
    id: string;
    name: string;
    category_id: string;
    version?: string;
    author?: string;
    organization_id?: string | null;
    created_at?: string;
}

export interface AdminSubtestRecord {
    id: string;
    test_id: string;
    name: string;
    unit?: string;
    score_type?: string;
    input_model?: 'numeric_4mode' | 'qualitative_category' | 'raw_only';
    input_config?: {
        options?: Array<{ code: string; label: string; order: number; reportText?: string }>;
        score_type_detection_confidence?: number | string;
        score_type_detection_source?: string;
    };
    organization_id?: string | null;
    display_order?: number | null;
    display_group_order?: number | null;
}

/** @deprecated */
export interface AdminNormRecord {
    id?: string;
    subtest_id: string;
    organization_id?: string | null;
    age_min_months?: number | null;
    age_max_months?: number | null;
    gender?: string | null;
    raw_min?: number | null;
    raw_max?: number | null;
    mean?: number | null;
    sd?: number | null;
    standard_score?: number | null;
    percentile?: number | null;
}

/** AI monitoring types */
export interface AIUsageDay {
    date: string;
    tokens: number;
    cost: number;
    errors: number;
}

export interface AIFailure {
    id: string;
    date: string;
    type: string;
    context: string;
    user: string;
}

export interface AIHealthStats {
    daily: AIUsageDay[];
    totalCost: number;
    errorRate: number;
}

/** AI-generated report section (before hydration) */
export interface GeneratedReportSection {
    id: string;
    title: string;
    content: string;
    originalContent?: string;
    status: 'draft';
    isAiGenerated: true;
}




/** Admin user row enriched with org + subscription state */
export interface AdminUserRow {
    user_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_admin: boolean;
    credits: number;
    organization_id: string | null;
    organization_name: string | null;
    organization_role: string | null;
    subscription_plan: 'free' | 'essential' | 'performance' | 'expert' | string;
    subscription_status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'inactive' | string;
    trial_ends_at: string | null;
    current_period_end: string | null;
    monthly_extraction_quota: number;
    created_at: string;
}

/** Payload accepted by admin user update RPC */
export interface AdminUserUpdatePayload {
    userId: string;
    isAdmin?: boolean;
    credits?: number;
    planId?: 'free' | 'essential' | 'performance' | 'expert';
    status?: 'active' | 'trialing' | 'canceled' | 'past_due' | 'inactive';
    trialEndsAt?: string | null;
    currentPeriodEnd?: string | null;
    monthlyExtractionQuota?: number;
}
