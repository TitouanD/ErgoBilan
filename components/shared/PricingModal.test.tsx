// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PricingModal } from './PricingModal';

describe('PricingModal : plans sur un écran de portable (#103)', () => {
  it('borne la modale à la hauteur visible, sans carte agrandie qui déborderait', () => {
    render(<PricingModal onClose={vi.fn()} onSelectPlan={vi.fn()} onUnlockOneOff={vi.fn()} />);
    const modal = screen.getByTestId('pricing-plans');
    expect(modal.className).toContain('max-h-[calc(100dvh-2rem)]');
    // La carte Performance n'est plus agrandie (lg:scale-105 la faisait sortir de la modale).
    expect(modal.querySelector('[class*="scale-105"]')).toBeNull();
    // Les trois cartes ont la même hauteur : les boutons sont alignés en bas.
    expect(screen.getByText('Activer Performance').closest('.lg\\:items-stretch')).not.toBeNull();
  });
});
