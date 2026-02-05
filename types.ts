
export interface Sibling {
  firstName: string;
  age: string;
  relation: string;
  livesWithChild: boolean;
}

// ... (Autres interfaces inchangées : Sibling, SharedDocument...)

export interface Organization {
  id: string;
  name: string;
  stripeCustomerId?: string;
  createdAt: string;
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: 'owner' | 'member';
  encryptedOrgKey: string | null; // Null avant l'initialisation crypto
  joinedAt: string;
}

export interface Patient {
  // Identité
  id?: string; 
  organizationId?: string; // NOUVEAU : Lien Cabinet
  firstName: string;
  lastName: string;
  dob: string;
  age: string;
  gender: 'M' | 'F' | '';
  address: string;

  // Famille
  parentNames: string;
  parentPhone: string;
  parentEmail: string;
  guardArrangement: string; 
  siblings: Sibling[];

  // Scolarité
  school: string;
  classLevel: string; 
  teacher: string;
  carePlan: string; 
  avs: 'OUI' | 'NON' | 'EN_COURS' | '';
  avsDetails: string;

  // Médical
  prescribingDoctor: string;
  medicalDiagnosis: string;
  medicalTreatments: string;
  medicalFollowup: string;

  // Motif & Attentes
  reason: string; 
  familyExpectations: string;

  // Développement
  pregnancyBirth: string;
  developmentMotor: string;
  developmentLanguage: string;
  sleep: string;
  sensory: string;

  // Vie Quotidienne
  meals: string;
  dressing: string;
  continence: string;
  timeSpace: string;

  // Vie Scolaire (Observations)
  schoolAttention: string;
  writingIssues: string;
  toolUsage: string;
  schoolAccommodations: string;

  // Divers & Privé Praticien
  remarks: string;
  priorities: string;
  interviewNotes?: string; 
}

export interface SharedDocument {
    id: string;
    title: string;
    type: 'bilan' | 'compte-rendu' | 'courrier';
    date: string;
    size: string;
    isDownloaded: boolean;
}

export interface BrandingConfig {
    isEnabled: boolean;
    logoUrl?: string;
    primaryColor: string;
    secondaryColor: string;
    fontFamily: 'Merriweather' | 'Quicksand' | 'Roboto' | 'Playfair Display' | 'Open Sans' | 'Lato';
    
    // NOUVEAU : Templating avancé
    headerTemplate: 'classic' | 'corporate' | 'centered' | 'minimal';
    titleStyle: 'simple' | 'underline' | 'icon-house' | 'icon-star' | 'icon-sparkle' | 'filled-shape';
    
    // Legacy Layout (gardé pour compatibilité mais surchargé par headerTemplate)
    headerLayout: 'row' | 'column'; 
    headerAlignment: 'left' | 'center' | 'right'; 
    
    logoSize: 'small' | 'medium' | 'large'; 
    cornerStyle: 'rounded' | 'sharp' | 'soft';
    
    // Données Contenu (Source de vérité)
    cabinetName: string; // Titre Principal (ex: Pauline Méloni)
    brandSubtitle?: string; // Sous-titre (ex: Ergothérapeute D.E)
    
    practitionerName: string;
    address: string;
    siret?: string;
    email?: string;
    phone?: string;
    footerText?: string;
    showPageNumbers: boolean;

    // NOUVEAUX CHAMPS
    documentTitle?: string; // ex: "Bilan d'Ergothérapie"
    patientBlockStyle?: 'modern' | 'minimal';
}

export interface PractitionerProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phonePro?: string;
  siret?: string;
  addressPro?: string;
  encryptionSalt: string;
  encryptionValidator: string;
  
  // Organization Context (Loaded after login)
  organizationId?: string;
  organizationRole?: 'owner' | 'member';
}

export interface UserProfile {
  id: string; // Lien avec auth.users
  email: string;
  credits: number;
  // Le plan vient de la table 'subscriptions'
  subscriptionPlan: 'free' | 'essential' | 'performance' | 'expert';
  status: 'active' | 'trialing' | 'canceled' | 'past_due';
  
  // Stats
  totalBilansGenerated: number; // Pas stocké en DB pour l'instant, calculé ou mocké
  
  // Flags locaux ou DB
  hasAcceptedResponsibility: boolean; // Local session state
  isAdmin: boolean; // DB field
  
  // Calculé depuis trial_ends_at
  isTrial: boolean;
  trialDaysRemaining: number;
  
  // Branding (Stocké en local storage ou JSONB plus tard, pour l'instant on garde la compatibilité)
  branding: BrandingConfig;
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
  isAiGenerated: boolean;
  attachments?: ReportAttachment[];
}

export interface ReportMetadata {
  id: string;
  date: string;
  type: 'initial' | 'reevaluation' | 'final';
  status: 'draft' | 'completed';
  patientName: string;
  sections?: ReportSection[]; // Ajout pour stocker le contenu
}

export interface TestSession {
  id: string;
  date: string;
  testId: string;
  testName: string;
  results: Record<string, ScoreResult>;
}

export interface PatientFile {
  id: string;
  patient: Patient;
  reports: ReportMetadata[];
  sessions: TestSession[];
  lastInteraction: string;
  archived?: boolean; 
  
  // Crypto Metadata
  encryptedFileKey?: string; // NOUVEAU: Clé du dossier (chiffrée avec OrgKey)
}

export interface AnonymousTestContribution {
  testId: string;
  subtestId: string;
  ageInMonths: number;
  gender: 'M' | 'F' | 'Other';
  rawScore: number;
  standardScore: number;
  percentile: number;
  zScore: number;
  tags?: string[];
  timestamp: string;
}

export interface ExtractedRow {
    id: string;
    subtest: string;
    label: string;
    
    // Champs Lookup
    raw: string;      // Score brut ou Intervalle (ex: "0-5")
    standard: string; // Note Standard
    
    // Champs Paramétriques (Nouveaux)
    mean?: string;    // Moyenne
    sd?: string;      // Ecart-Type
    
    // Champs Calculés/Communs
    zScore: string;
    percentile: string;
}

export interface Contribution {
    id: string;
    userId: string;
    userName: string;
    testName: string;
    docType: 'image' | 'pdf' | 'excel';
    status: 'pending' | 'validated' | 'rejected';
    vigilanceScore: 'pass' | 'fail' | 'partial';
    submittedAt: string;
    structureType?: 'PARAMETRIC' | 'LOOKUP' | 'UNKNOWN'; // NOUVEAU : Type structurel explicite
    rows: ExtractedRow[];
}

export interface ScoreResult {
  raw: string; 
  standard: string; 
  percentile: string;
  zScore: number;
  status: 'empty' | 'estimated' | 'validated';
  validatedAt?: string;
  observation?: string; 
}

export type TestData = Record<string, Record<string, ScoreResult>>;
export type SectionStatus = 'draft' | 'validated';

export interface Observations {
  anamnese: string;
  motricite: string;
  coordination: string;
  spatial: string;
  graphique: string;
}

export interface PendingQuestionnaire {
  id: string;
  // Label visible par le praticien (ex: "Dossier Octobre #12")
  label: string; 
  status: 'pending' | 'completed';
  createdAt: string;
  
  // Champs techniques pour le déchiffrement côté praticien
  practitionerEncryptedKey: string; // Stocke la clé du questionnaire chiffrée avec la clé du praticien
}
