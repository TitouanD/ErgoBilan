
export interface ParamedicalTracking {
    id: string;
    type: string;
    name: string;
    frequency: string;
    since: string;
    contact: string;
    reason: string;
}

export interface Sibling {
    firstName: string;
    age: string;
    relation: string;
    livesWithChild: boolean;
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
    guardArrangement: string;
    guardMode?: string;
    siblings: Sibling[];
    school: string;
    classLevel: string;
    teacher: string;
    carePlan: string;
    avs: string;
    avsDetails: string;
    avsHours?: string;
    avsMissions?: string;
    prescribingDoctor: string;
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
    cleanliness?: string;
    languageStatus?: string;
    sleep?: string;
    sleepStatus?: string;
    sensory: string;
    meals: string;
    eatingHabits?: string;
    dressing: string;
    clothingButtons?: string;
    clothingLaces?: string;
    clothingZippers?: string;
    continence: string;
    timeSpace: string;
    schoolAttention: string;
    socialBehavior?: string;
    writingIssues: string;
    writingPain?: string;
    toolUsage: string;
    toolScissors?: string;
    handDominance?: string;
    schoolAccommodations: string;
    remarks: string;
    priorities: string;
    goals?: string[];
    interviewNotes?: string;
    screenTime?: string;
    emotionalRegulation?: string;
    organizationId?: string;
}

export interface ScoreResult {
    raw: string;
    standard: string;
    percentile: string;
    zScore?: number;
    status: 'empty' | 'draft' | 'validated' | 'estimated' | 'certified';
    observation?: string;
    validatedAt?: string;
    /** ISO timestamp when the practitioner certified this score */
    certifiedAt?: string;
    /** How the score was obtained: auto (norms table), manual_ns (practitioner edited NS), manual_et (practitioner edited ET) */
    scoreSource?: 'auto' | 'manual_ns' | 'manual_et';
    /** Input metric selected by practitioner for numeric entry */
    entryMetric?: 'raw' | 'standard' | 'z' | 'percentile';
    /** UI-only practitioner review state (non legal trace) */
    reviewState?: 'not_reviewed' | 'reviewed';
    /** ISO timestamp of the review action */
    reviewedAt?: string;
    /** Qualitative coded value for categorical tests */
    qualitativeCode?: string;
    /** Human-readable qualitative label */
    qualitativeLabel?: string;
    /** Optional derived values from assisted/automatic calculations */
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
    status: 'draft' | 'validated';
    isAiGenerated?: boolean;
    attachments?: ReportAttachment[];
}

export interface BrandingConfig {
    isEnabled: boolean;
    primaryColor: string;
    secondaryColor: string;
    fontFamily: 'Merriweather' | 'Quicksand' | 'Roboto' | 'Playfair Display' | 'Open Sans' | 'Lato';
    headerTemplate: 'classic' | 'corporate' | 'centered';
    titleStyle: 'simple' | 'underline' | 'filled-shape' | 'icon-star' | 'icon-sparkle' | 'icon-house';
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
}

export type PatientAssessmentKind = 'initial' | 'reevaluation' | 'mini_reevaluation';

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
    results?: Record<string, ScoreResult>;
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
    organizationId: string;
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

export interface ExtractedRow {
    id: string;
    subtest: string;
    label: string;
    raw: string;
    standard: string;
    zScore: string;
    percentile: string;
    mean?: string;
    sd?: string;
    // NOUVEAUX CHAMPS CALCULÉS (IA -> DB)
    hidden_age_min?: number;
    hidden_age_max?: number;
    hidden_raw_min?: number;
    hidden_raw_max?: number;
}

export interface Contribution {
    id: string;
    userId: string;
    userName: string;
    testName: string;
    docType: 'image' | 'pdf';
    status: 'pending' | 'validated' | 'rejected';
    vigilanceScore: 'pass' | 'flagged';
    submittedAt: string;
    structureType: 'PARAMETRIC' | 'LOOKUP' | 'UNKNOWN';
    rows: ExtractedRow[];
}

// --- Types ajoutés pour éliminer les `any` ---

/** Shape of a saved/restored assessment draft */
export interface DraftPayload {
    patient?: Patient;
    tests?: TestData;
    observations?: Observations;
    synthesis?: ClinicalSynthesis;
    sections?: ReportSection[];
    reportType?: 'initial' | 'reevaluation';
    step?: number;
}

/** Row from the admin_candidates_promotion SQL view */
export interface CandidateRow {
    id: string;
    name: string;
    author: string;
    created_at: string;
    subtest_count?: number;
    organization_id?: string;
}

/** Return shape of AdminService.getCandidateDetails */
export interface CandidateDetails {
    id: string;
    testName: string;
    author: string;
    submittedAt: string;
    rows: ExtractedRow[];
}

/** Admin library types */
export interface AdminTestSummary {
    id: string;
    name: string;
    category_id: string;
    organization_id?: string | null;
    created_at: string;
    subtest_count?: number;
    pending_norms_count?: number;
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
    computation_mode?: string;
    input_model?: 'numeric_4mode' | 'qualitative_category' | 'raw_only';
    input_config?: {
        options?: Array<{ code: string; label: string; order: number; reportText?: string }>;
        defaultMetric?: 'raw' | 'standard' | 'z' | 'percentile';
    };
    organization_id?: string | null;
}

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

export interface AdminTestBundle {
    test: AdminTestRecord;
    subtests: AdminSubtestRecord[];
    norms: AdminNormRecord[];
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
    status: 'draft';
    isAiGenerated: true;
}

/** AI extraction response from ContributionStudio image processing */
export interface AIExtractedNormRow {
    label?: string;
    raw_range?: string;
    standard?: string;
    mean?: string;
    sd?: string;
    z_score?: string;
    percentile?: string;
    age_min_months?: number | null;
    age_max_months?: number | null;
    raw_min?: number | null;
    raw_max?: number | null;
}

export interface AIExtractedTable {
    subtest_id?: string;
    rows: AIExtractedNormRow[];
}

export interface AIExtractionResult {
    test_context?: string;
    structure_type?: 'PARAMETRIC' | 'LOOKUP';
    tables?: AIExtractedTable[];
}

// ── Deduplication types ──

/** A similar test found by find_similar_tests RPC */
export interface SimilarTestMatch {
    id: string;
    name: string;
    organization_id: string | null;
    similarity_score: number;
    subtests_count: number;
}

/** A pair of duplicate tests detected by admin_find_duplicates */
export interface DuplicatePair {
    test_id_a: string;
    test_name_a: string;
    org_id_a: string | null;
    subtests_count_a: number;
    norms_count_a: number;
    test_id_b: string;
    test_name_b: string;
    org_id_b: string | null;
    subtests_count_b: number;
    norms_count_b: number;
    similarity_score: number;
}

/** Result of admin_merge_tests RPC */
export interface MergeResult {
    merged_tests: number;
    moved_subtests: number;
    migrated_norms: number;
    updated_sessions: number;
    target_name: string;
}

/** Result of attach_subtests_to_test RPC */
export interface AttachResult {
    new_subtests: number;
    new_norms: number;
    test_id: string;
}

/** A pair of duplicate subtests within a test */
export interface SubtestDuplicatePair {
    subtest_id_a: string;
    subtest_name_a: string;
    org_id_a: string | null;
    norms_count_a: number;
    subtest_id_b: string;
    subtest_name_b: string;
    org_id_b: string | null;
    norms_count_b: number;
    similarity_score: number;
}

/** Summary of duplicate norms for a subtest */
export interface NormDuplicateSummary {
    subtest_id: string;
    subtest_name: string;
    duplicate_group_count: number;
    total_excess_rows: number;
}

/** A flagged norm from quality check */
export interface NormQualityFlag {
    norm_id: string;
    subtest_id: string;
    subtest_name: string;
    flag_code: string;
    flag_label: string;
    details: string;
}
