// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PricingModal } from './PricingModal';

const handlers = () => ({ onClose: vi.fn(), onSelectPlan: vi.fn(), onBuyCredits: vi.fn(), onManageSubscription: vi.fn() });

describe('PricingModal : plans sur un écran de portable (#103)', () => {
  it('borne la modale à la hauteur visible, sans carte agrandie qui déborderait', () => {
    render(<PricingModal {...handlers()} />);
    const modal = screen.getByTestId('pricing-plans');
    expect(modal.className).toContain('max-h-[calc(100dvh-2rem)]');
    // La carte Performance n'est plus agrandie (lg:scale-105 la faisait sortir de la modale).
    expect(modal.querySelector('[class*="scale-105"]')).toBeNull();
    // Les trois cartes ont la même hauteur : les boutons sont alignés en bas.
    expect(screen.getByText('Activer Performance').closest('.lg\\:items-stretch')).not.toBeNull();
  });
});

describe('PricingModal : paiement Stripe (#107)', () => {
  it('ne promet ni réduction ni report de crédits, ni bilans illimités', () => {
    render(<PricingModal {...handlers()} />);
    expect(document.body.textContent).not.toMatch(/-50|reports? de crédits|illimit|prioritaire/i);
    expect(screen.getByText(/bilans inclus se renouvellent chaque mois, sans report/)).toBeTruthy();
  });

  it('souscrit à la formule choisie', () => {
    const h = handlers();
    render(<PricingModal {...h} />);
    fireEvent.click(screen.getByText('Choisir Expert'));
    expect(h.onSelectPlan).toHaveBeenCalledWith('expert');
  });

  it("propose l'achat à l'unité au prix de la formule, et 15 € sans formule", () => {
    const { unmount } = render(<PricingModal {...handlers()} isPaywallMode />);
    expect(screen.getByText('15 € le bilan, sans engagement')).toBeTruthy();
    expect(screen.queryByText(/Offre Spéciale/)).toBeNull();
    unmount();

    const h = handlers();
    render(<PricingModal {...h} isPaywallMode currentPlan="performance" hasPaidPlan />);
    fireEvent.click(screen.getByText("Acheter des bilans à l'unité"));
    expect(h.onBuyCredits).toHaveBeenCalled();
    expect(screen.getByText('8 € le bilan, sans engagement')).toBeTruthy();
    expect(screen.getByText('Changer de formule')).toBeTruthy();
  });

  it('avec une formule payée : formule actuelle désactivée, changement et factures par le portail', () => {
    const h = handlers();
    render(<PricingModal {...h} currentPlan="performance" hasPaidPlan />);
    expect((screen.getByText('Formule actuelle') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Passer à Expert'));
    expect(h.onSelectPlan).toHaveBeenCalledWith('expert');
    fireEvent.click(screen.getByText(/Factures, carte bancaire et résiliation/));
    expect(h.onManageSubscription).toHaveBeenCalled();
  });

  it("sans formule payée, n'affiche pas l'accès au portail", () => {
    render(<PricingModal {...handlers()} currentPlan="expert" />);
    expect(screen.queryByText(/Factures, carte bancaire/)).toBeNull();
  });
});
