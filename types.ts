
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
}

export interface ScoreResult {
    raw: string;
    standard: string;
    percentile: string;
    zScore: number;
    status: 'empty' | 'draft' | 'validated';
    observation?: string;
}

export interface TestData {
    [testId: string]: {
        [subtestId: string]: ScoreResult;
    };
}

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
    status: 'active' | 'trialing' | 'canceled' | 'past_due';
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

export interface TestSession {
    id: string;
    date: string;
    testId: string;
    testName: string;
    results: Record<string, ScoreResult>;
}

export interface ReportMetadata {
    id: string;
    date: string;
    type: 'initial' | 'reevaluation';
    status: 'completed';
    patientName: string;
    sections: ReportSection[];
}

export interface PatientFile {
    id: string;
    patient: Patient;
    reports: ReportMetadata[];
    sessions: TestSession[];
    lastInteraction: string;
    archived?: boolean;
    encryptedFileKey?: string;
}

export interface PendingQuestionnaire {
    id: string;
    label: string;
    status: 'pending' | 'completed';
    createdAt: string;
    practitionerEncryptedKey: string;
    familyEncryptedData?: string;
    practitioner_id?: string;
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
