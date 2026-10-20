import React, { useState } from 'react';
import { Check, Clock, ArrowRight, ShieldCheck, FileText, Sparkles, Lock, Key, Share2, Database, Gift } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext'; // Import du contexte Auth

interface Props {
  onComplete: () => void;
  /** Step shown first (dev scenario `accueil` opens the last one). */
  initialStep?: 1 | 2 | 3 | 4;
  /** Trial refused for this e-mail address; defaults to the profile (the dev scenario sets it). */
  trialDenied?: boolean;
}

export const OnboardingExperience: React.FC<Props> = ({ onComplete, initialStep = 1, trialDenied: trialDeniedProp }) => {
  const { isDemoMode, userProfile } = useAuth(); // Hook pour détecter le mode démo
  /** Adresse déjà utilisée pour un essai : compte créé sans crédit d'essai (#113). */
  const trialDenied = trialDeniedProp ?? userProfile.trialDenied;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep);

  // Si on est en mode démo, on n'a que 3 étapes (Pas de cadeau de crédits)
  const maxSteps = isDemoMode ? 3 : 4;

  const handleNext = () => {
    if (step < maxSteps) {
      setStep((prev) => (prev + 1) as any);
    } else {
      onComplete();
    }
  };

  return (
    // Scrolls when a step is taller than the window (laptop screens); `my-auto` still centers it otherwise.
    <div className="fixed inset-0 z-[200] bg-[var(--card-bg)] flex flex-col items-center overflow-y-auto animate-in fade-in duration-500 font-sans text-[var(--text-main)]">
      {/* PROGRESS BAR */}
      <div className="fixed top-0 left-0 w-full h-2 z-10 bg-[var(--progress-bg)]">
        <div
          className="h-full bg-[var(--primary)] transition-all duration-700 ease-out"
          style={{ width: `${(step / maxSteps) * 100}%` }}
        ></div>
      </div>

      <div className="w-full max-w-6xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center my-auto py-10">
        {/* PARTIE VISUELLE (GAUCHE) */}
        <div className="hidden lg:flex flex-col items-center justify-center h-[600px] bg-[var(--card-bg-raised)] rounded-[40px] p-10 relative overflow-hidden shadow-inner order-2 lg:order-1">
          <div className="absolute top-[-20%] left-[-20%] w-96 h-96 bg-[var(--primary)]/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-[-20%] right-[-20%] w-96 h-96 bg-[var(--secondary)]/10 rounded-full blur-3xl"></div>

          {/* VISUEL ÉTAPE 1 : PROMESSE (Transformation) */}
          {step === 1 && (
            <div className="relative animate-in zoom-in-95 duration-700 flex flex-col items-center">
              <div className="relative w-64 h-80">
                {/* Carte Arrière (Scores) qui s'en va */}
                <div className="absolute inset-0 bg-[var(--card-bg)] border border-[var(--border-color)] shadow-lg rounded-2xl p-6 transform -rotate-6 opacity-60 scale-95 origin-bottom-left flex flex-col gap-3">
                  <div className="flex justify-between">
                    <div className="w-8 h-8 bg-[var(--hover-bg)] rounded"></div>
                    <div className="w-16 h-4 bg-[var(--hover-bg)] rounded"></div>
                  </div>
                  <div className="space-y-2 mt-4">
                    <div className="w-full h-2 bg-[var(--hover-bg)] rounded"></div>
                    <div className="w-3/4 h-2 bg-[var(--hover-bg)] rounded"></div>
                    <div className="w-1/2 h-2 bg-[var(--hover-bg)] rounded"></div>
                  </div>
                  <div className="mt-auto flex gap-2">
                    <div className="w-8 h-8 bg-rose-100 rounded-full"></div>
                    <div className="w-8 h-8 bg-amber-100 rounded-full"></div>
                  </div>
                </div>

                {/* Carte Avant (Rédigée) qui arrive */}
                <div className="absolute inset-0 bg-[var(--card-bg)] border border-[var(--border-color)] shadow-2xl rounded-2xl p-6 transform rotate-3 flex flex-col z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-[var(--primary)] text-white rounded-lg shadow-md shadow-orange-200 dark:shadow-black/30">
                      <Sparkles size={20} />
                    </div>
                    <div className="text-xs font-bold text-[var(--text-main)]">Rédaction IA</div>
                  </div>
                  <div className="space-y-3 flex-1">
                    <div className="w-full h-2 bg-[var(--progress-bg)] rounded"></div>
                    <div className="w-full h-2 bg-[var(--progress-bg)] rounded"></div>
                    <div className="w-full h-2 bg-[var(--progress-bg)] rounded"></div>
                    <div className="w-2/3 h-2 bg-[var(--progress-bg)] rounded"></div>
                    <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg mt-2">
                      <div className="w-full h-1.5 bg-emerald-200 rounded mb-1"></div>
                      <div className="w-1/2 h-1.5 bg-emerald-200 rounded"></div>
                    </div>
                  </div>
                </div>

                {/* Flèche de transformation */}
                <div className="absolute top-1/2 -right-12 transform -translate-y-1/2 translate-x-1/2 z-20 bg-[var(--secondary)] text-white p-3 rounded-full shadow-xl">
                  <ArrowRight size={24} />
                </div>
              </div>
            </div>
          )}

          {/* VISUEL ÉTAPE 2 : SÉCURITÉ (Coffre-fort) */}
          {step === 2 && (
            <div className="relative animate-in slide-in-from-right duration-500 flex flex-col items-center">
              <div className="w-64 h-64 bg-[var(--secondary)] rounded-[40px] shadow-2xl flex items-center justify-center relative border-4 border-[#4a4e69]">
                <ShieldCheck size={100} className="text-[#81B29A]" />
                <div className="absolute -bottom-6 -right-6 bg-[var(--card-bg)] p-4 rounded-2xl shadow-lg border border-[var(--border-color)]">
                  <Lock size={32} className="text-[var(--primary)]" />
                </div>
              </div>
              <div className="mt-8 flex items-center gap-3 bg-[var(--card-bg)] px-4 py-2 rounded-full shadow-sm border border-[var(--border-color)]">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">
                  Données stockées sur votre poste
                </span>
              </div>
            </div>
          )}

          {/* VISUEL ÉTAPE 3 : COMMUNAUTÉ (Data) */}
          {step === 3 && (
            <div className="relative animate-in slide-in-from-right duration-500">
              <div className="relative w-80 h-80">
                {/* Central Node */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-white rounded-full shadow-xl flex items-center justify-center z-20 border-4 border-[var(--primary)]">
                  <Database size={40} className="text-[var(--secondary)]" />
                </div>

                {/* Satellites */}
                {[0, 72, 144, 216, 288].map((deg, i) => (
                  <div
                    key={i}
                    className="absolute w-12 h-12 bg-[var(--card-bg)] rounded-full shadow-md flex items-center justify-center text-[var(--text-secondary)] border border-[var(--border-color)]"
                    style={{
                      top: '50%',
                      left: '50%',
                      transform: `translate(-50%, -50%) rotate(${deg}deg) translate(120px) rotate(-${deg}deg)`,
                    }}
                  >
                    <FileText size={16} />
                  </div>
                ))}

                {/* Connections */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 opacity-20">
                  <circle cx="50%" cy="50%" r="120" stroke="#3D405B" strokeWidth="2" strokeDasharray="4 4" className="animate-spin-slow" />
                </svg>
              </div>
              <div className="text-center mt-4">
                <div className="inline-block bg-[var(--primary)] text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-orange-200 dark:shadow-black/30">
                  Données vérifiées
                </div>
              </div>
            </div>
          )}

          {/* VISUEL ÉTAPE 4, ESSAI REFUSÉ (#113) : pas de cadeau, l'espace reste ouvert */}
          {step === 4 && trialDenied && (
            <div className="relative animate-in slide-in-from-right duration-500 w-full max-w-md flex flex-col items-center">
              <div className="bg-[var(--card-bg)] rounded-[32px] p-8 shadow-2xl border border-[var(--border-color)] relative z-10 w-80 text-center">
                <div className="w-20 h-20 bg-[var(--secondary)] text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                  <Sparkles size={40} />
                </div>
                <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-6">Votre espace est prêt</h3>
                <div className="space-y-3 text-left">
                  <div className="flex items-center gap-3 p-3 bg-[var(--hover-bg)] rounded-xl">
                    <div className="p-1.5 bg-[var(--card-bg)] rounded-full shadow-sm text-[var(--primary)]">
                      <Check size={14} strokeWidth={3} />
                    </div>
                    <span className="text-sm font-bold text-[var(--text-main)]">Toute l'application accessible</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-[var(--hover-bg)] rounded-xl">
                    <div className="p-1.5 bg-[var(--card-bg)] rounded-full shadow-sm text-[var(--primary)]">
                      <Sparkles size={14} strokeWidth={3} />
                    </div>
                    <span className="text-sm font-bold text-[var(--text-main)]">Rédaction par l'IA : 1 crédit par bilan</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VISUEL ÉTAPE 4 : LE CADEAU (3 Crédits) - SEULEMENT PROD */}
          {step === 4 && !trialDenied && (
            <div className="relative animate-in slide-in-from-right duration-500 w-full max-w-md flex flex-col items-center">
              <div className="relative">
                {/* Effet de lueur */}
                <div className="absolute inset-0 bg-[var(--primary)]/20 blur-2xl rounded-full"></div>
                {/* Carte Cadeau */}
                <div className="bg-[var(--card-bg)] rounded-[32px] p-8 shadow-2xl border border-[var(--border-color)] relative z-10 w-80 text-center">
                  <div className="w-20 h-20 bg-[var(--primary)] text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-orange-200 dark:shadow-black/30 transform -rotate-6">
                    <Gift size={40} />
                  </div>
                  <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Offre de Bienvenue</h3>
                  <div className="inline-block px-4 py-1 bg-[var(--hover-bg)] rounded-full text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-6">
                    Essai Gratuit
                  </div>
                  <div className="space-y-3 text-left">
                    <div className="flex items-center gap-3 p-3 bg-[var(--hover-bg)] rounded-xl">
                      <div className="p-1.5 bg-[var(--card-bg)] rounded-full shadow-sm text-[var(--primary)]">
                        <Check size={14} strokeWidth={3} />
                      </div>
                      <span className="text-sm font-bold text-[var(--text-main)]">3 Crédits Offerts</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-[var(--hover-bg)] rounded-xl">
                      <div className="p-1.5 bg-[var(--card-bg)] rounded-full shadow-sm text-[var(--primary)]">
                        <Check size={14} strokeWidth={3} />
                      </div>
                      <span className="text-sm font-bold text-[var(--text-main)]">Valable 30 jours</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* PARTIE TEXTE & ACTIONS (DROITE) */}
        <div className="flex flex-col justify-center h-full order-1 lg:order-2">
          {/* --- ÉTAPE 1 : PROMESSE --- */}
          {step === 1 && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-[var(--secondary)] text-white rounded-2xl flex items-center justify-center shadow-xl shadow-[#3D405B]/20 mb-6">
                <Sparkles size={32} />
              </div>

              <h1 className="font-serif text-4xl md:text-5xl font-bold text-[var(--secondary)] leading-tight">
                Votre demo clinique, en 3 minutes.
              </h1>

              <p className="text-lg text-stone-500 leading-relaxed">
                Importez un questionnaire, saisissez les tests, puis générez un bilan clair et structuré. Vous voyez tout, du calcul
                automatique au PDF final.
              </p>

              <div className="space-y-4 pt-4">
                <div className="flex items-center gap-4 p-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl shadow-sm">
                  <Clock className="text-[#81B29A]" size={24} />
                  <div>
                    <h4 className="font-bold text-[var(--text-heading)]">Zero friction</h4>
                    <p className="text-xs text-[var(--text-secondary)]">Vous suivez un scenario complet, de l'anamnese au PDF.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleNext}
                className="w-full md:w-auto px-10 py-4 bg-[var(--secondary)] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-3 mt-4 group"
              >
                C'est parti <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          )}

          {/* --- ÉTAPE 2 : SÉCURITÉ --- */}
          {step === 2 && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-[#81B29A] text-white rounded-2xl flex items-center justify-center shadow-xl shadow-[#81B29A]/20 mb-6">
                <Lock size={32} />
              </div>

              <h2 className="font-serif text-3xl md:text-4xl font-bold text-[var(--secondary)]">Vous seul maîtrisez vos données.</h2>

              <p className="text-stone-500 leading-relaxed">
                Vos données patients ne quittent jamais votre navigateur.{' '}
                <strong className="text-[var(--secondary)]">Elles sont stockées localement sur votre poste</strong>, pas sur nos serveurs —
                nous n'y avons pas accès.
              </p>

              <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-6 rounded-2xl shadow-inner">
                <p className="text-sm font-medium text-[var(--text-main)] mb-2">
                  <Key size={16} className="inline mr-2 text-[var(--primary)]" />
                  Comment ça fonctionne :
                </p>
                <ul className="text-xs text-[var(--text-secondary)] space-y-2 ml-6 list-disc">
                  <li>Votre mot de passe sert à vous connecter (compte en ligne).</li>
                  <li>Votre PIN verrouille l'écran après 15 min d'inactivité.</li>
                  <li>Les questionnaires envoyés aux familles sont chiffrés de bout en bout.</li>
                </ul>
              </div>

              {/* Backup reminder — framed as a strength */}
              <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl">
                <ShieldCheck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300 mb-1">Votre liberté, votre responsabilité</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                    Contrairement aux logiciels cloud, personne d'autre ne peut accéder à vos bilans — ni ErgoBilan, ni un serveur tiers. En
                    contrepartie, <strong>exportez régulièrement un backup</strong> depuis votre profil (bouton avatar en haut à droite)
                    pour ne rien perdre en cas de changement d'appareil ou de navigateur.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
                <span className="text-amber-500 mt-0.5 shrink-0">⚠️</span>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <strong>Utilisez toujours le même navigateur sur ce poste.</strong> Les données ne se synchronisent pas entre Chrome,
                  Firefox ou Safari.
                </p>
              </div>

              <button
                onClick={handleNext}
                className="w-full px-8 py-4 bg-[var(--secondary)] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-3"
              >
                <ShieldCheck size={20} /> J'ai compris
              </button>
            </div>
          )}

          {/* --- ÉTAPE 3 : COMMUNAUTÉ / BASE DE DONNÉES (Adapté Demo) --- */}
          {step === 3 && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-[#F2CC8F] text-white rounded-2xl flex items-center justify-center shadow-xl shadow-[#F2CC8F]/20 mb-6">
                <Share2 size={32} />
              </div>

              <h2 className="font-serif text-3xl md:text-4xl font-bold text-[var(--secondary)]">Des normes prêtes à l'emploi</h2>

              <p className="text-stone-500 leading-relaxed">
                Les conversions s'appliquent instantanément. Vous voyez l'impact des scores sur la synthèse et les recommandations.
              </p>

              <div className="space-y-3">
                <div className="flex items-start gap-4 p-4 bg-[var(--hover-bg)] rounded-xl">
                  <Database size={20} className="text-[var(--primary)] mt-1 shrink-0" />
                  <div>
                    <h4 className="font-bold text-[var(--text-heading)] text-sm">Données à jour</h4>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      Plus besoin de chercher dans vos manuels. Les conversions sont intégrées.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleNext}
                className="w-full px-8 py-4 bg-[var(--secondary)] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-3"
              >
                {isDemoMode ? "Accéder à l'espace démo" : 'Suivant'} <ArrowRight size={20} />
              </button>
            </div>
          )}

          {/* --- ÉTAPE 4 : OFFRE DE BIENVENUE (3 CREDITS) - PROD SEULEMENT --- */}
          {step === 4 && !isDemoMode && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500 w-full">
              <div className="mb-4">
                <h2 className="font-serif text-3xl md:text-4xl font-bold text-[var(--secondary)] mb-4">
                  Démarrez maintenant <br /> sans contrainte.
                </h2>
                {trialDenied ? (
                  <p className="text-lg text-stone-500 leading-relaxed">
                    L'essai gratuit a déjà été utilisé avec cette adresse e-mail : ce compte n'a pas de bilans offerts. Toute l'application
                    reste accessible ; seule la rédaction par l'IA demande un crédit.
                  </p>
                ) : (
                  <p className="text-lg text-stone-500 leading-relaxed">
                    Nous avons crédité votre compte de <strong className="text-[var(--primary)]">3 bilans offerts</strong>. Aucun
                    engagement, aucune carte bancaire requise.
                  </p>
                )}
              </div>

              {!trialDenied && (
                <div className="bg-amber-50 rounded-2xl p-6 border-l-4 border-amber-400 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-white rounded-full shadow-sm text-amber-500 mt-1">
                      <Clock size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-amber-900 text-lg mb-1">Durée Limitée</h4>
                      <p className="text-amber-800 leading-relaxed">
                        Votre période d'essai est valable <strong>30 jours</strong>. <br />
                        Passé ce délai, les crédits d'essai non utilisés sont perdus. Toute l'application reste accessible ; seule la
                        rédaction par l'IA demande un crédit.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <button
                  onClick={onComplete}
                  className="w-full px-8 py-4 bg-[var(--secondary)] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] hover:scale-[1.01] transition-all flex items-center justify-center gap-3 group"
                >
                  Accéder à mon espace <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <div className="mt-4 flex justify-between items-center px-2">
                  <p className="text-xs text-stone-400 font-medium">Inscription en 2 minutes.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
