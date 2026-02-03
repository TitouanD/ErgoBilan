
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTutorial, DemoStep } from '../../contexts/TutorialContext';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X } from 'lucide-react';

// Configuration du scénario
const SCENARIO_CONFIG: Record<DemoStep, { targetId: string, message: string, placement: 'top' | 'bottom' | 'left' | 'right' }> = {
    'IDLE': { targetId: '', message: '', placement: 'bottom' },
    'DASHBOARD_LINK': { 
        targetId: 'demo-btn-link', 
        message: "Étape 1 : Envoyez un lien sécurisé aux parents pour qu'ils remplissent l'anamnèse à distance.", 
        placement: 'bottom' 
    },
    'DASHBOARD_IMPORT': { 
        targetId: 'demo-card-import', 
        message: "Étape 2 : La famille a répondu ! Cliquez pour importer et déchiffrer les données.", 
        placement: 'top' 
    },
    'STEP1_REVIEW': { 
        targetId: 'demo-btn-next-step1', 
        message: "Les données administratives sont pré-remplies. Passons aux tests.", 
        placement: 'top' 
    },
    'STEP2_ADD_TEST': { 
        targetId: 'demo-btn-add-test', 
        message: "Étape 3 : Ajoutez les tests réalisés (MABC-2, WISC-V, etc.) depuis le catalogue.", 
        placement: 'bottom' 
    },
    'CATALOG_SELECTION': { 
        targetId: 'demo-catalog-item-0', 
        message: "Sélectionnez ce test pour l'exemple.", 
        placement: 'right' 
    },
    'CATALOG_VALIDATE': { 
        targetId: 'demo-catalog-validate', 
        message: "Validez votre sélection pour l'ajouter au dossier.", 
        placement: 'top' 
    },
    'STEP2_NEXT': { 
        targetId: 'demo-btn-next-step2', 
        message: "Les scores (NS, ET, %) sont calculés automatiquement. Continuons.", 
        placement: 'top' 
    },
    'STEP3_GENERATE': { 
        targetId: 'demo-btn-generate', 
        message: "Étape 4 : L'IA va analyser vos observations et rédiger le bilan (Coût : 1 crédit).", 
        placement: 'top' 
    },
    'STEP4_VALIDATE': { 
        targetId: 'demo-btn-validate', 
        message: "Validez pour générer le PDF et archiver le dossier.", 
        placement: 'top' 
    },
    'DASHBOARD_REOPEN': { 
        targetId: 'demo-card-patient-reopen', 
        message: "Le bilan est archivé. Cliquez sur le dossier pour voir l'historique.", 
        placement: 'right' 
    },
    'DETAIL_REEVAL': { 
        targetId: 'demo-btn-reeval', 
        message: "Dernière étape : 6 mois plus tard, lancez une Réévaluation pour comparer les courbes.", 
        placement: 'bottom' 
    },
    'COMPLETED': { targetId: '', message: '', placement: 'bottom' }
};

export const TutorialLayer: React.FC = () => {
    const { currentStep, isVisible } = useTutorial();
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const [config, setConfig] = useState(SCENARIO_CONFIG['IDLE']);
    
    // Scan du DOM pour trouver la cible
    useEffect(() => {
        if (!isVisible || currentStep === 'IDLE' || currentStep === 'COMPLETED') {
            setTargetRect(null);
            return;
        }

        const stepConfig = SCENARIO_CONFIG[currentStep];
        setConfig(stepConfig);

        const findTarget = () => {
            const el = document.getElementById(stepConfig.targetId);
            if (el) {
                // Gestion spéciale pour les éléments dans des conteneurs scrollables ou modales
                const rect = el.getBoundingClientRect();
                // Vérifier si l'élément est visible dans le viewport
                if (rect.width > 0 && rect.height > 0) {
                    setTargetRect(rect);
                }
            } else {
                setTargetRect(null);
            }
        };

        // Polling rapide pour attendre que le composant cible soit monté
        const interval = setInterval(findTarget, 300);
        findTarget();

        // Listener resize/scroll
        window.addEventListener('resize', findTarget);
        window.addEventListener('scroll', findTarget, true); // Capture phase pour scroll dans div

        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', findTarget);
            window.removeEventListener('scroll', findTarget, true);
        };
    }, [currentStep, isVisible]);

    if (!isVisible || !targetRect || currentStep === 'IDLE' || currentStep === 'COMPLETED') return null;

    // Calcul de la position de la bulle
    const bubbleStyle: React.CSSProperties = { position: 'fixed', zIndex: 9999 };
    const gap = 20;

    if (config.placement === 'top') {
        bubbleStyle.top = targetRect.top - gap;
        bubbleStyle.left = targetRect.left + (targetRect.width / 2);
        bubbleStyle.transform = 'translate(-50%, -100%)';
    } else if (config.placement === 'bottom') {
        bubbleStyle.top = targetRect.bottom + gap;
        bubbleStyle.left = targetRect.left + (targetRect.width / 2);
        bubbleStyle.transform = 'translate(-50%, 0)';
    } else if (config.placement === 'left') {
        bubbleStyle.top = targetRect.top + (targetRect.height / 2);
        bubbleStyle.left = targetRect.left - gap;
        bubbleStyle.transform = 'translate(-100%, -50%)';
    } else {
        bubbleStyle.top = targetRect.top + (targetRect.height / 2);
        bubbleStyle.left = targetRect.right + gap;
        bubbleStyle.transform = 'translate(0, -50%)';
    }

    return createPortal(
        <>
            {/* Spotlight (Overlay sombre avec trou) - Optionnel, ici on fait juste un highlight pulsant */}
            <div 
                className="fixed z-[9998] pointer-events-none transition-all duration-300 rounded-xl border-4 border-[#E07A5F] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] animate-pulse"
                style={{
                    top: targetRect.top - 4,
                    left: targetRect.left - 4,
                    width: targetRect.width + 8,
                    height: targetRect.height + 8,
                }}
            />

            {/* Bulle d'instruction */}
            <div style={bubbleStyle} className="w-64 animate-in zoom-in-95 duration-300">
                <div className="bg-white p-4 rounded-2xl shadow-2xl border border-stone-100 relative">
                    {/* Flèche */}
                    <div 
                        className={`absolute w-4 h-4 bg-white transform rotate-45 border-r border-b border-stone-100
                        ${config.placement === 'top' ? 'bottom-[-8px] left-1/2 -translate-x-1/2 border-t-0 border-l-0 shadow-sm' : ''}
                        ${config.placement === 'bottom' ? 'top-[-8px] left-1/2 -translate-x-1/2 border-r-0 border-b-0 bg-white' : ''}
                        ${config.placement === 'left' ? 'right-[-8px] top-1/2 -translate-y-1/2 border-l-0 border-b-0 shadow-sm' : ''}
                        ${config.placement === 'right' ? 'left-[-8px] top-1/2 -translate-y-1/2 border-r-0 border-t-0 bg-white' : ''}
                        `} 
                    ></div>

                    <div className="relative z-10">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#E07A5F] text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-lg shadow-orange-200">
                                {['IDLE', 'DASHBOARD_LINK', 'DASHBOARD_IMPORT', 'STEP1_REVIEW', 'STEP2_ADD_TEST', 'CATALOG_SELECTION', 'CATALOG_VALIDATE', 'STEP2_NEXT', 'STEP3_GENERATE', 'STEP4_VALIDATE', 'DASHBOARD_REOPEN', 'DETAIL_REEVAL'].indexOf(currentStep)}
                            </div>
                            <p className="text-sm text-[#3D405B] font-medium leading-relaxed">
                                {config.message}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};
