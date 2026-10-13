// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PricingModal } from './PricingModal';

const handlers = () => ({ onClose: vi.fn(), onSubscribe: vi.fn(), onBuyCredits: vi.fn(), onManageSubscription: vi.fn() });

describe('PricingModal : écran de portable (#103)', () => {
  it('borne la modale à la hauteur visible', () => {
    render(<PricingModal {...handlers()} />);
    expect(screen.getByTestId('pricing-plans').className).toContain('max-h-[calc(100dvh-2rem)]');
  });
});

describe('PricingModal : formule Solo (#107)', () => {
  it('présente une seule formule, illimitée avec la limite d’usage raisonnable en note', () => {
    render(<PricingModal {...handlers()} />);
    expect(screen.getByText('Solo')).toBeTruthy();
    expect(screen.getByText('21,99 €')).toBeTruthy();
    expect(screen.getByText(/illimités\*/)).toBeTruthy();
    expect(screen.getByText(/\*Dans la limite d'un usage raisonnable de 30 bilans par mois/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/-50|Essentiel|Performance|Expert|report/i);
  });

  it('souscrit à Solo, ou propose le bilan à 9 € sans abonnement', () => {
    const h = handlers();
    render(<PricingModal {...h} />);
    fireEvent.click(screen.getByText('Choisir Solo'));
    expect(h.onSubscribe).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Sans abonnement : 9 € le bilan/));
    expect(h.onBuyCredits).toHaveBeenCalled();
  });

  it("avec une formule payée : formule actuelle, pas d'achat à l'unité, factures par le portail", () => {
    const h = handlers();
    render(<PricingModal {...h} hasActivePlan hasPaidPlan />);
    expect((screen.getByText('Formule actuelle') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/le bilan/)).toBeNull();
    fireEvent.click(screen.getByText(/Factures, carte bancaire et résiliation/));
    expect(h.onManageSubscription).toHaveBeenCalled();
  });

  it('sans formule, le mur de crédits propose Solo et le bilan à l’unité', () => {
    const h = handlers();
    render(<PricingModal {...h} isPaywallMode />);
    expect(screen.getByText('Plus de crédits disponibles.')).toBeTruthy();
    expect(screen.getByText('9 € le bilan, sans engagement')).toBeTruthy();
    fireEvent.click(screen.getByText("Acheter des bilans à l'unité"));
    expect(h.onBuyCredits).toHaveBeenCalled();
  });

  it('pendant un paiement en attente, invite à mettre à jour la carte plutôt qu’à attendre', () => {
    const h = handlers();
    render(<PricingModal {...h} isPaywallMode hasActivePlan hasPaidPlan isPaymentPending />);
    expect(screen.getByText('Paiement en attente.')).toBeTruthy();
    fireEvent.click(screen.getByText('Mettre à jour ma carte bancaire'));
    expect(h.onManageSubscription).toHaveBeenCalled();
  });

  it('avec une formule dont les 30 bilans du mois sont utilisés, annonce leur retour sans proposer d’achat', () => {
    render(<PricingModal {...handlers()} isPaywallMode hasActivePlan renewalDate="2026-11-12T20:09:41Z" />);
    expect(screen.getByText('Limite du mois atteinte.')).toBeTruthy();
    expect(screen.getByText(/Ils reviennent le 12 novembre/)).toBeTruthy();
    expect(screen.queryByText(/le bilan/)).toBeNull();
  });

  it('annonce le quota réel de la formule, pas 30 en dur (#112)', () => {
    render(<PricingModal {...handlers()} isPaywallMode hasActivePlan monthlyQuota={20} />);
    expect(screen.getByText(/Vous avez rédigé les 20 bilans de votre formule ce mois-ci/)).toBeTruthy();
  });
});

describe('PricingModal : paiement pas encore ouvert (#110)', () => {
  it('remplace les boutons de paiement par « Paiement bientôt disponible »', () => {
    const h = handlers();
    render(<PricingModal {...h} isPaymentOpen={false} />);
    const subscribe = screen.getByText('Paiement bientôt disponible') as HTMLButtonElement;
    expect(subscribe.disabled).toBe(true);
    expect(screen.queryByText(/Sans abonnement/)).toBeNull();
    expect(screen.getByText(/Le paiement en ligne arrive très bientôt/)).toBeTruthy();
  });

  it("sans crédit, n'offre ni formule ni achat à l'unité", () => {
    render(<PricingModal {...handlers()} isPaywallMode isPaymentOpen={false} />);
    expect(screen.queryByText(/Passer à la formule Solo/)).toBeNull();
    expect(screen.queryByText(/Acheter des bilans à l'unité/)).toBeNull();
    expect(screen.getByText(/Le paiement en ligne arrive très bientôt/)).toBeTruthy();
  });
});
