
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useAssessment } from './AssessmentContext';

export type DemoStep = 
    | 'IDLE'
    | 'DASHBOARD_LINK'      // 1. Créer lien
    | 'DASHBOARD_IMPORT'    // 2. Importer le dossier reçu
    | 'STEP1_REVIEW'        // 3. Revue admin & Suivant
    | 'STEP2_ADD_TEST'      // 4. Ouvrir catalogue
    | 'CATALOG_SELECTION'   // 4b. Sélectionner un test (Intra-modale)
    | 'CATALOG_VALIDATE'    // 4c. Valider sélection (Intra-modale)
    | 'STEP2_NEXT'          // 5. Valider tests
    | 'STEP3_GENERATE'      // 6. Lancer génération IA
    | 'STEP4_VALIDATE'      // 7. Validation finale
    | 'DASHBOARD_REOPEN'    // 8. Rouvrir le dossier archivé
    | 'DETAIL_REEVAL'       // 9. Lancer réévaluation
    | 'COMPLETED';

interface TutorialContextType {
    currentStep: DemoStep;
    advanceStep: (fromStep: DemoStep) => void;
    forceStep: (step: DemoStep) => void;
    isVisible: boolean;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isDemoMode } = useAuth();
    const { step: assessmentStep } = useAssessment();
    const [currentStep, setCurrentStep] = useState<DemoStep>('IDLE');

    // Reset du scénario quand on quitte/entre en mode démo
    useEffect(() => {
        if (isDemoMode) {
            // Si on active le mode démo, on reset au début
            if (currentStep === 'IDLE') setCurrentStep('DASHBOARD_LINK');
        } else {
            setCurrentStep('IDLE');
        }
    }, [isDemoMode]);

    // Synchronisation automatique basée sur l'étape du bilan (Fail-safe)
    useEffect(() => {
        if (!isDemoMode) return;

        // Si l'utilisateur navigue manuellement, on rattrape le scénario
        if (assessmentStep === 1 && currentStep === 'DASHBOARD_IMPORT') setCurrentStep('STEP1_REVIEW');
        // Le catalogue est géré finement via advanceStep, pas de saut auto ici pour éviter de casser la séquence intra-modale
        if (assessmentStep === 3 && (currentStep === 'STEP2_NEXT')) setCurrentStep('STEP3_GENERATE');
        if (assessmentStep === 4 && currentStep === 'STEP3_GENERATE') setCurrentStep('STEP4_VALIDATE');
    }, [assessmentStep, isDemoMode, currentStep]);

    const advanceStep = (fromStep: DemoStep) => {
        if (currentStep !== fromStep) return; // Prevent skipping

        switch (fromStep) {
            case 'DASHBOARD_LINK': setCurrentStep('DASHBOARD_IMPORT'); break;
            case 'DASHBOARD_IMPORT': setCurrentStep('STEP1_REVIEW'); break;
            case 'STEP1_REVIEW': setCurrentStep('STEP2_ADD_TEST'); break;
            
            // Séquence Catalogue
            case 'STEP2_ADD_TEST': setCurrentStep('CATALOG_SELECTION'); break;
            case 'CATALOG_SELECTION': setCurrentStep('CATALOG_VALIDATE'); break;
            case 'CATALOG_VALIDATE': setCurrentStep('STEP2_NEXT'); break;
            
            case 'STEP2_NEXT': setCurrentStep('STEP3_GENERATE'); break;
            case 'STEP3_GENERATE': setCurrentStep('STEP4_VALIDATE'); break;
            case 'STEP4_VALIDATE': setCurrentStep('DASHBOARD_REOPEN'); break; // Retour dashboard
            case 'DASHBOARD_REOPEN': setCurrentStep('DETAIL_REEVAL'); break; // Vue détail
            case 'DETAIL_REEVAL': setCurrentStep('COMPLETED'); break;
            default: break;
        }
    };

    return (
        <TutorialContext.Provider value={{ 
            currentStep, 
            advanceStep, 
            forceStep: setCurrentStep,
            isVisible: isDemoMode 
        }}>
            {children}
        </TutorialContext.Provider>
    );
};

export const useTutorial = () => {
    const context = useContext(TutorialContext);
    if (context === undefined) throw new Error('useTutorial must be used within a TutorialProvider');
    return context;
};
