import React, { useState } from 'react';
import { X, Check, Zap, Lock, ArrowRight, Coins, Palette, Receipt, Rocket, CalendarClock } from 'lucide-react';
import { SOLO_FAIR_USE_PER_MONTH, SOLO_PRICE_EUR, UNIT_PRICE_EUR } from '../../services/billing';

interface Props {
  onClose: () => void;
  /** Checkout of the Solo plan (or, with a paid plan, the Stripe portal). */
  onSubscribe: () => void;
  /** Checkout of purchased credits; only offered without an active plan. */
  onBuyCredits: () => void;
  /** Stripe portal (invoices, card, cancellation); only with a paid plan. */
  onManageSubscription?: () => void;
  isPaywallMode?: boolean;
  /** A plan is active (paid or offered): its monthly credits cover the « illimité* ». */
  hasActivePlan?: boolean;
  /** The plan is paid through Stripe (managed in the portal). */
  hasPaidPlan?: boolean;
  /** The last payment of the plan failed (Stripe retries): no monthly credits until it is paid. */
  isPaymentPending?: boolean;
  /** Next renewal of the monthly credits (ISO), shown when the fair-use limit is reached. */
  renewalDate?: string | null;
  /** A Stripe page is being opened: buttons are disabled. */
  isBusy?: boolean;
  /** Online payment is offered (false in production while Stripe is in test mode, #110). */
  isPaymentOpen?: boolean;
}

const price = (eur: number) => eur.toLocaleString('fr-FR', { minimumFractionDigits: eur % 1 ? 2 : 0 });

const FAIR_USE_NOTE = `*Dans la limite d'un usage raisonnable de ${SOLO_FAIR_USE_PER_MONTH} bilans par mois.`;

const PaymentSoon: React.FC = () => (
  <p className="text-sm text-[var(--text-secondary)] text-center">
    Le paiement en ligne arrive très bientôt. En attendant, écrivez-nous à{' '}
    <a href="mailto:contact@ergobilan.com" className="text-[var(--primary)] font-semibold underline">
      contact@ergobilan.com
    </a>
    .
  </p>
);

const Feature: React.FC<{ icon: typeof Check; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <li className="flex gap-3 items-start">
    <Icon size={18} className="text-[var(--primary)] shrink-0 mt-0.5" />
    <span>{children}</span>
  </li>
);

export const PricingModal: React.FC<Props> = ({
  onClose,
  onSubscribe,
  onBuyCredits,
  onManageSubscription,
  isPaywallMode = false,
  hasActivePlan = false,
  hasPaidPlan = false,
  renewalDate = null,
  isPaymentPending = false,
  isBusy = false,
  isPaymentOpen = true,
}) => {
  const [view, setView] = useState<'paywall' | 'plans'>(isPaywallMode ? 'paywall' : 'plans');

  // --- VUE 1 : PLUS DE CRÉDITS ---
  if (view === 'paywall') {
    const renewal = renewalDate ? new Date(renewalDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--secondary)]/80 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-[var(--card-bg)] w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden relative p-8">
          <button onClick={onClose} className="absolute top-4 right-4 text-[var(--text-disabled)] hover:text-[var(--text-secondary)]">
            <X size={24} />
          </button>

          {hasActivePlan && isPaymentPending ? (
            // Failed renewal: the monthly credits come back once the invoice is paid.
            <div className="text-center">
              <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-500">
                <Receipt size={32} />
              </div>
              <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)]">Paiement en attente.</h2>
              <p className="text-[var(--text-secondary)] mt-3 text-sm leading-relaxed">
                Le dernier paiement de votre formule n'a pas abouti. Vos bilans du mois seront renouvelés dès qu'il sera réglé.
              </p>
              {onManageSubscription && (
                <button
                  type="button"
                  onClick={onManageSubscription}
                  disabled={isBusy}
                  className="mt-5 w-full py-3 bg-[var(--primary)] text-white font-bold rounded-xl hover:bg-[#d0694e] transition-all disabled:opacity-50"
                >
                  Mettre à jour ma carte bancaire
                </button>
              )}
            </div>
          ) : hasActivePlan ? (
            // Fair-use limit of the plan reached: no unit purchase, the credits come back at renewal.
            <div className="text-center">
              <div className="w-16 h-16 bg-[var(--primary)]/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-[var(--primary)]">
                <CalendarClock size={32} />
              </div>
              <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)]">Limite du mois atteinte.</h2>
              <p className="text-[var(--text-secondary)] mt-3 text-sm leading-relaxed">
                Vous avez rédigé les {SOLO_FAIR_USE_PER_MONTH} bilans de l'usage raisonnable de votre formule ce mois-ci.
                {renewal ? ` Ils reviennent le ${renewal}.` : ' Ils reviennent au renouvellement de votre formule.'}
              </p>
              <p className="text-[var(--text-secondary)] mt-3 text-sm">
                Besoin de plus ?{' '}
                <a href="mailto:contact@ergobilan.com" className="text-[var(--primary)] font-semibold underline">
                  contact@ergobilan.com
                </a>
              </p>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-500">
                  <Lock size={32} />
                </div>
                <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)]">Plus de crédits disponibles.</h2>
                <p className="text-[var(--text-secondary)] mt-2 text-sm">Pour rédiger ce bilan avec l'IA, choisissez une option.</p>
              </div>

              {!isPaymentOpen ? (
                <PaymentSoon />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 mb-6">
                    <button
                      type="button"
                      onClick={() => setView('plans')}
                      className="w-full text-left bg-[#fff5f2] rounded-2xl p-5 border-2 border-[var(--primary)] relative shadow-lg cursor-pointer hover:scale-[1.02] transition-transform group"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-[var(--primary)] text-white rounded-lg">
                            <Zap size={20} fill="currentColor" />
                          </div>
                          <div>
                            <h3 className="font-bold text-[var(--secondary)] text-sm">Passer à la formule Solo</h3>
                            <p className="text-xs text-[var(--primary)] font-bold">
                              Bilans illimités* pour {price(SOLO_PRICE_EUR)} € / mois
                            </p>
                          </div>
                        </div>
                        <ArrowRight size={20} className="text-[var(--primary)] group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={onBuyCredits}
                      disabled={isBusy}
                      className="w-full text-left bg-[var(--hover-bg)] rounded-2xl p-5 border border-[var(--border-color)] hover:bg-[var(--border-color)] transition-colors cursor-pointer group disabled:cursor-wait disabled:opacity-60"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-[var(--card-bg)] text-[var(--text-secondary)] rounded-lg border border-[var(--border-color)]">
                            <Coins size={20} />
                          </div>
                          <div>
                            <h3 className="font-bold text-[var(--text-heading)] text-sm">Acheter des bilans à l'unité</h3>
                            <p className="text-xs text-[var(--text-secondary)] font-medium">
                              {price(UNIT_PRICE_EUR)} € le bilan, sans engagement
                            </p>
                          </div>
                        </div>
                        <ArrowRight size={20} className="text-[var(--text-disabled)] group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  </div>

                  <p className="text-center text-[10px] text-[var(--text-disabled)]">
                    Paiement sécurisé par Stripe. Facture envoyée par e-mail. {FAIR_USE_NOTE}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // --- VUE 2 : LA FORMULE ---
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--secondary)]/60 backdrop-blur-sm animate-in fade-in duration-300">
      {/* Compact sizes so the modal fits a laptop screen (~700 px tall) without scrolling (#103). */}
      <div
        data-testid="pricing-plans"
        className="bg-[var(--card-bg)] backdrop-blur-xl w-full max-w-xl rounded-[32px] shadow-2xl relative flex flex-col h-auto max-h-[calc(100dvh-2rem)]"
      >
        <div className="p-6 pb-2 md:px-8 md:pt-6 flex justify-between items-start shrink-0">
          <div>
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-[var(--text-heading)]">Votre abonnement</h2>
            <p className="text-sm text-[var(--text-secondary)]">Une seule formule, sans engagement, résiliable à tout moment.</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-[var(--hover-bg)] rounded-full text-[var(--text-secondary)] hover:text-[var(--text-heading)]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 md:px-8 md:pt-4 md:pb-6">
          <div className="px-6 pt-7 pb-5 rounded-[32px] bg-[#fff5f2] border-2 border-[var(--primary)] shadow-xl flex flex-col items-center text-center">
            <div className="mb-2 p-2.5 bg-[var(--primary)] text-white rounded-2xl shadow-lg shadow-orange-200 dark:shadow-black/30">
              <Rocket size={24} />
            </div>
            <h3 className="font-bold text-2xl text-[var(--primary)]">Solo</h3>
            <div className="my-1">
              <span className="text-5xl font-serif font-bold text-[var(--secondary)]">{price(SOLO_PRICE_EUR)} €</span>
              <span className="text-stone-400 text-sm">/mois</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-4">TVA non applicable, art. 293 B du CGI</p>

            <ul className="space-y-2.5 text-sm text-[var(--secondary)] mb-5 text-left w-full px-2 font-medium">
              <Feature icon={Zap}>
                <strong>Bilans rédigés par l'IA illimités*</strong>
              </Feature>
              <Feature icon={Check}>Calcul automatique des notes standard et percentiles</Feature>
              <Feature icon={Palette}>Personnalisation complète du rapport (logo, couleurs)</Feature>
              <Feature icon={Check}>Sans engagement, résiliable à tout moment</Feature>
            </ul>

            <button
              onClick={onSubscribe}
              disabled={isBusy || hasActivePlan || !isPaymentOpen}
              className="w-full py-3.5 bg-[var(--primary)] text-white font-bold text-base rounded-xl shadow-xl shadow-orange-200 dark:shadow-black/30 hover:bg-[#d0694e] transition-all disabled:pointer-events-none disabled:opacity-50"
            >
              {hasActivePlan ? 'Formule actuelle' : isPaymentOpen ? 'Choisir Solo' : 'Paiement bientôt disponible'}
            </button>
            <p className="mt-3 text-[11px] text-[var(--text-secondary)]">{FAIR_USE_NOTE}</p>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            {!hasActivePlan && !isPaymentOpen && <PaymentSoon />}
            {!hasActivePlan && isPaymentOpen && (
              <button
                type="button"
                onClick={onBuyCredits}
                disabled={isBusy}
                className="flex items-center gap-2 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-heading)] disabled:opacity-50"
              >
                <Coins size={16} /> Sans abonnement : {price(UNIT_PRICE_EUR)} € le bilan
              </button>
            )}
            {hasPaidPlan && onManageSubscription && (
              <button
                type="button"
                onClick={onManageSubscription}
                disabled={isBusy}
                className="flex items-center gap-2 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-heading)] disabled:opacity-50"
              >
                <Receipt size={16} /> Factures, carte bancaire et résiliation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
