
import React, { useState } from 'react';
import { X, Check, Zap, Crown, Lock, ArrowRight, Sparkles, Coins, Info, Rocket, Palette } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSelectPlan: (plan: string) => void;
  onUnlockOneOff: () => void;
  isPaywallMode?: boolean;
}

// Composant Helper pour les Tooltips
const FeatureWithTooltip: React.FC<{ 
    icon: any; 
    children: React.ReactNode; 
    tooltip: React.ReactNode; 
    highlightColor?: string;
    bgColor?: string;
    borderColor?: string;
}> = ({ icon: Icon, children, tooltip, highlightColor = "text-[#81B29A]", bgColor, borderColor }) => {
    return (
        <li className={`group relative flex gap-3 items-center cursor-help transition-all ${bgColor ? `p-2 rounded-lg border ${bgColor} ${borderColor}` : ''}`}>
            <Icon size={18} className={`${highlightColor} shrink-0`} /> 
            <div className="flex-1">{children}</div>

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-64 p-4 bg-[var(--secondary)] text-white text-xs rounded-xl shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-300 z-50 text-center leading-relaxed transform translate-y-2 group-hover:translate-y-0">
                <div className="font-bold mb-1 flex justify-center"><Info size={12} className="mb-1" /></div>
                {tooltip}
                {/* Arrow */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-8 border-transparent border-t-[#3D405B]"></div>
            </div>
        </li>
    );
};

export const PricingModal: React.FC<Props> = ({ onClose, onSelectPlan, onUnlockOneOff, isPaywallMode = false }) => {
  const [view, setView] = useState<'paywall' | 'plans'>(isPaywallMode ? 'paywall' : 'plans');

  // --- VUE 1 : LE PAYWALL (COMPARATEUR CHOC) ---
  if (view === 'paywall') {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--secondary)]/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-[var(--card-bg)] w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden relative p-8">
                <button onClick={onClose} className="absolute top-4 right-4 text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"><X size={24} /></button>
                
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-500">
                        <Lock size={32} />
                    </div>
                    <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)]">Plus de crédits disponibles.</h2>
                    <p className="text-[var(--text-secondary)] mt-2 text-sm">Pour exporter ce bilan, choisissez une option.</p>
                </div>

                {/* Options d'Action */}
                <div className="grid grid-cols-1 gap-4 mb-6">
                    
                    {/* Option A : Upgrade (Promo) */}
                    <div 
                        onClick={() => setView('plans')}
                        className="bg-[#fff5f2] rounded-2xl p-5 border-2 border-[var(--primary)] relative shadow-lg cursor-pointer hover:scale-[1.02] transition-transform group"
                    >
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--primary)] text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase whitespace-nowrap shadow-sm">
                            Offre Spéciale -50%
                        </div>
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[var(--primary)] text-white rounded-lg"><Zap size={20} fill="currentColor"/></div>
                                <div>
                                    <h3 className="font-bold text-[var(--secondary)] text-sm">Passer en Abonnement</h3>
                                    <p className="text-xs text-[var(--primary)] font-bold">Dès 19€ / mois</p>
                                </div>
                            </div>
                            <ArrowRight size={20} className="text-[var(--primary)] group-hover:translate-x-1 transition-transform"/>
                        </div>
                    </div>

                    {/* Option B : One-Off */}
                    <div 
                        onClick={onUnlockOneOff}
                        className="bg-[var(--hover-bg)] rounded-2xl p-5 border border-[var(--border-color)] hover:bg-[var(--border-color)] transition-colors cursor-pointer group"
                    >
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[var(--card-bg)] text-[var(--text-secondary)] rounded-lg border border-[var(--border-color)]"><Coins size={20}/></div>
                                <div>
                                    <h3 className="font-bold text-[var(--text-heading)] text-sm">Achat unique (Hors-forfait)</h3>
                                    <p className="text-xs text-[var(--text-secondary)] font-medium">Débloquer ce bilan pour 15€</p>
                                </div>
                            </div>
                            <ArrowRight size={20} className="text-[var(--text-disabled)] group-hover:translate-x-1 transition-transform"/>
                        </div>
                    </div>
                </div>

                <p className="text-center text-[10px] text-[var(--text-disabled)]">
                    Paiement sécurisé via Stripe. Facture disponible immédiatement.
                </p>
            </div>
        </div>
      );
  }

  // --- VUE 2 : LES PLANS (Pricing Table Responsive) ---
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--secondary)]/60 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="bg-[var(--card-bg)] backdrop-blur-xl w-full max-w-7xl rounded-[32px] shadow-2xl relative flex flex-col h-auto max-h-[95vh]">
            
            {/* Header Sticky Mobile */}
            <div className="p-6 pb-2 md:p-8 flex justify-between items-start shrink-0 border-b border-[var(--border-color)] md:border-none">
                <div>
                     <h2 className="font-serif text-2xl md:text-3xl font-bold text-[var(--text-heading)]">Votre abonnement</h2>
                     <p className="text-sm text-[var(--text-secondary)] hidden md:block">Changez de plan à tout moment. Sans engagement.</p>
                </div>
                <button onClick={onClose} className="p-2 bg-[var(--hover-bg)] rounded-full text-[var(--text-secondary)] hover:text-[var(--text-heading)]">
                    <X size={20} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="overflow-y-auto p-4 md:p-8">
                {/* Layout ajusté : Align center pour que la carte centrale puisse être plus grande sans overflow hidden */}
                <div className="flex flex-col lg:flex-row gap-6 items-center justify-center lg:items-stretch xl:items-center">

                    {/* COLONNE 1: ESSENTIEL */}
                    <div className="w-full max-w-md lg:max-w-none lg:flex-1 p-6 rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] flex flex-col items-center text-center hover:border-[var(--text-secondary)] transition-colors shadow-sm order-2 lg:order-1">
                        <h3 className="font-bold text-lg text-[var(--text-heading)]">Essentiel</h3>
                        <div className="my-2">
                            <span className="text-4xl font-serif font-bold text-[var(--text-heading)]">19€</span><span className="text-[var(--text-secondary)] text-sm">/mois</span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] font-medium mb-6">Pour débuter ou compléter</p>
                        
                        <ul className="space-y-4 text-sm text-[var(--text-main)] mb-8 text-left w-full px-2">
                            <FeatureWithTooltip 
                                icon={Check} 
                                tooltip="2 dossiers complets inclus chaque mois. Idéal pour une activité complémentaire."
                            >
                                <span><strong>2 bilans</strong> inclus / mois</span>
                            </FeatureWithTooltip>
                            
                            <FeatureWithTooltip 
                                icon={Sparkles} 
                                highlightColor="text-amber-500"
                                bgColor="bg-amber-50"
                                borderColor="border-amber-100"
                                tooltip="Vos crédits non utilisés ne sont jamais perdus ! Ils sont stockés pour le mois suivant (limite de 6)."
                            >
                                <span className="text-xs text-amber-800 font-bold leading-tight">Reports crédits inclus</span>
                            </FeatureWithTooltip>

                            <li className="flex gap-3"><Coins size={18} className="text-[var(--text-secondary)] shrink-0"/> <span>Hors-forfait : <strong>15€</strong> / bilan</span></li>
                            
                            <div className="w-full h-px bg-[var(--border-color)] my-2"></div>

                            <FeatureWithTooltip 
                                icon={Check} 
                                highlightColor="text-[var(--text-main)]"
                                tooltip="Fini les prises de tête avec les manuels. Saisissez le score brut, obtenez instantanément la Note Standard et le Percentile."
                            >
                                <span>Calculs automatiques inclus</span>
                            </FeatureWithTooltip>

                            <FeatureWithTooltip 
                                icon={Zap} 
                                highlightColor="text-[var(--text-main)]"
                                tooltip="L'IA génère les paragraphes rédactionnels basés sur vos observations."
                            >
                                <span>Aide à la rédaction (IA)</span>
                            </FeatureWithTooltip>
                            
                            <li className="flex gap-3 text-[var(--text-disabled)] line-through decoration-[var(--text-disabled)]"><Palette size={18} className="shrink-0"/> <span>Personnalisation (Logo...)</span></li>
                        </ul>
                        <button onClick={() => onSelectPlan('essential')} className="mt-auto w-full py-3 border-2 border-[var(--text-heading)] text-[var(--text-heading)] font-bold rounded-xl hover:bg-[var(--text-heading)] hover:text-white transition-all text-sm">Choisir Essentiel</button>
                    </div>

                    {/* COLONNE 2: PERFORMANCE (LE BEST-SELLER) */}
                    <div className="w-full max-w-md lg:max-w-none lg:flex-1 p-8 rounded-[32px] bg-[#fff5f2] border-2 border-[var(--primary)] shadow-2xl relative flex flex-col items-center text-center transform lg:scale-105 z-10 order-1 lg:order-2">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-[var(--primary)] text-white text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-b-xl whitespace-nowrap shadow-md">
                            Le Choix Malin
                        </div>
                        
                        <div className="mb-3 p-4 bg-[var(--primary)] text-white rounded-3xl shadow-lg shadow-orange-200 dark:shadow-black/30 mt-2">
                            <Rocket size={32} />
                        </div>
                        
                        <h3 className="font-bold text-3xl text-[var(--primary)]">Performance</h3>
                        <div className="my-3">
                            <span className="text-6xl font-serif font-bold text-[var(--secondary)]">34€</span><span className="text-stone-400 text-sm">/mois</span>
                        </div>
                        <p className="text-xs font-bold text-[var(--primary)] mb-8 bg-[var(--primary)]/10 px-3 py-1 rounded-full">
                            Rentabilité maximale
                        </p>
                        
                        <ul className="space-y-5 text-sm text-[var(--secondary)] mb-10 text-left w-full px-2 font-medium">
                            <FeatureWithTooltip 
                                icon={Check} 
                                highlightColor="text-[var(--primary)]"
                                tooltip="Couvre la majorité des activités libérales. Coût par bilan : seulement 5,60€ (remboursé x10 par le patient)."
                            >
                                <span className="text-lg"><strong>6 bilans</strong> inclus / mois</span>
                            </FeatureWithTooltip>

                            <FeatureWithTooltip 
                                icon={Sparkles} 
                                highlightColor="text-[var(--primary)]"
                                bgColor="bg-white/60"
                                borderColor="border-[var(--primary)]/20"
                                tooltip={<span><strong>Droit à la flexibilité :</strong> Vos crédits non utilisés sont reportés. Vacances, maladie, mois creux... vous ne perdez rien.</span>}
                            >
                                <span className="font-bold text-[var(--primary)]">Reports de crédits inclus</span>
                            </FeatureWithTooltip>

                            <li className="flex gap-3"><Coins size={20} className="text-[var(--primary)] shrink-0"/> <span>Hors-forfait : <strong>8€</strong> / bilan</span></li>
                            
                            <div className="w-full h-px bg-[var(--primary)]/20 my-2"></div>
                            
                            <FeatureWithTooltip 
                                icon={Palette} 
                                highlightColor="text-[var(--primary)]"
                                tooltip="Ajoutez votre Logo, vos couleurs et choisissez la police. Votre image de marque est essentielle."
                            >
                                <span><strong>Personnalisation Complète</strong> (Logo, Couleurs...)</span>
                            </FeatureWithTooltip>

                            {/* THE SEXY FEATURE */}
                            <FeatureWithTooltip 
                                icon={Zap} 
                                highlightColor="text-[var(--primary)]"
                                tooltip={<span>Rangez vos manuels et vos tableaux Excel. <br/>Saisissez le score brut, le système vous donne <strong>instantanément</strong> la Note Standard, le Percentile et l'interprétation.</span>}
                            >
                                <span className="text-base"><strong>Finie la corvée des normes</strong></span>
                            </FeatureWithTooltip>
                        </ul>
                        <button onClick={() => onSelectPlan('performance')} className="mt-auto w-full py-5 bg-[var(--primary)] text-white font-bold text-lg rounded-xl shadow-xl shadow-orange-200 dark:shadow-black/30 hover:bg-[#d0694e] hover:shadow-orange-300 dark:hover:shadow-black/40 transition-all hover:scale-[1.02]">
                            Activer Performance
                        </button>
                    </div>

                    {/* COLONNE 3: EXPERT (Ex-Premium Illimité, maintenant 20 crédits) */}
                    <div className="w-full max-w-md lg:max-w-none lg:flex-1 p-6 rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] flex flex-col items-center text-center hover:border-[var(--text-secondary)] transition-colors shadow-sm order-3">
                        <div className="mb-2 p-2 bg-[var(--hover-bg)] text-[var(--text-secondary)] rounded-xl"><Crown size={20}/></div>
                        <h3 className="font-bold text-lg text-[var(--text-heading)]">Expert</h3>
                        <div className="my-2">
                            <span className="text-4xl font-serif font-bold text-[var(--text-heading)]">89€</span><span className="text-[var(--text-secondary)] text-sm">/mois</span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] font-medium mb-6">Pour les cabinets intensifs</p>
                        <ul className="space-y-4 text-sm text-[var(--text-main)] mb-8 text-left w-full px-2">
                            <FeatureWithTooltip 
                                icon={Check} 
                                highlightColor="text-[#81B29A]"
                                tooltip="Un volume énorme pour les spécialistes. Coût par bilan : 4,45€. Le tarif le plus bas du marché."
                            >
                                <span className="text-lg font-bold text-[var(--text-heading)]">20 bilans / mois</span>
                            </FeatureWithTooltip>

                            <li className="flex gap-3"><Check size={18} className="text-[#81B29A] shrink-0"/> <span>Gros volume d'activité</span></li>
                            
                            <FeatureWithTooltip 
                                icon={Palette} 
                                highlightColor="text-[#81B29A]"
                                tooltip="Un rendu 100% à votre image."
                            >
                                <span>Personnalisation Avancée</span>
                            </FeatureWithTooltip>

                            <li className="flex gap-3"><Sparkles size={18} className="text-[#81B29A] shrink-0"/> <span>Accès Prioritaire IA</span></li>
                            <li className="flex gap-3"><Coins size={18} className="text-[#81B29A] shrink-0"/> <span>Hors-forfait : <strong>5€</strong> / bilan</span></li>
                        </ul>
                        <button onClick={() => onSelectPlan('expert')} className="mt-auto w-full py-3 border-2 border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl hover:border-[var(--text-heading)] hover:text-[var(--text-heading)] transition-all text-sm">Choisir Expert</button>
                    </div>

                </div>
            </div>
        </div>
    </div>
    );
};
