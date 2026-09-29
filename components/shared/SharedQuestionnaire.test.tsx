// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharedQuestionnaire } from './SharedQuestionnaire';
import type { Patient } from '../../types';

const patient = (overrides: Partial<Patient> = {}) => ({ id: 'p1', firstName: 'Léa', lastName: 'Test', ...overrides }) as Patient;

describe('SharedQuestionnaire : un second clic décoche (#39)', () => {
  it('vide le genre quand on reclique sur le bouton radio coché', async () => {
    const onChange = vi.fn();
    render(<SharedQuestionnaire data={patient({ gender: 'F' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Fille' }));
    expect(onChange).toHaveBeenCalledWith({ gender: '' });
  });

  it('choisit la valeur quand le bouton radio n’est pas coché', async () => {
    const onChange = vi.fn();
    render(<SharedQuestionnaire data={patient({ gender: 'F' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Garçon' }));
    expect(onChange).toHaveBeenCalledWith({ gender: 'M' });
    expect(onChange).not.toHaveBeenCalledWith({ gender: '' });
  });

  it('décoche une carte « Mode de garde » au second clic', async () => {
    const onChange = vi.fn();
    render(<SharedQuestionnaire data={patient({ guardMode: 'commune' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(screen.getByText('Situation familiale'));
    await userEvent.click(screen.getByText('Garde Commune'));
    expect(onChange).toHaveBeenCalledWith({ guardMode: '' });
  });
});

describe('SharedQuestionnaire : Suivi par la PCO (#36)', () => {
  it('Oui puis Non se choisissent, un second clic décoche, la date se saisit', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SharedQuestionnaire data={patient()} onChange={onChange} mode="practitioner" />);
    await userEvent.click(screen.getByText('Suivi médical'));
    const pco = screen.getByText('Suivi par la PCO').parentElement!;
    await userEvent.click(within(pco).getByRole('button', { name: 'Oui' }));
    expect(onChange).toHaveBeenLastCalledWith({ pcoFollowup: 'oui' });

    rerender(<SharedQuestionnaire data={patient({ pcoFollowup: 'oui' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(within(pco).getByRole('button', { name: 'Non' }));
    expect(onChange).toHaveBeenLastCalledWith({ pcoFollowup: 'non' });

    rerender(<SharedQuestionnaire data={patient({ pcoFollowup: 'non' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(within(pco).getByRole('button', { name: 'Non' }));
    expect(onChange).toHaveBeenLastCalledWith({ pcoFollowup: '' });

    fireEvent.change(screen.getByLabelText('Date du suivi PCO (optionnelle)'), { target: { value: '2026-03-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ pcoFollowupDate: '2026-03-01' });
  });
});

describe('SharedQuestionnaire : bloc « Bilans et suivis extérieurs » (#37)', () => {
  it('porte le nouveau titre', async () => {
    render(<SharedQuestionnaire data={patient()} onChange={() => {}} mode="practitioner" />);
    await userEvent.click(screen.getByText('Suivi médical'));
    expect(screen.getByText('Bilans et suivis extérieurs')).toBeInTheDocument();
    expect(screen.queryByText(/Suivi Extérieur/i)).toBeNull();
  });
});

describe('SharedQuestionnaire : puce « Vocabulaire riche » (#38)', () => {
  it('existe dans Langage et s’ajoute aux observations', async () => {
    const onChange = vi.fn();
    render(<SharedQuestionnaire data={patient({ languageStatus: 'begaiement' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(screen.getByText('Développement'));
    await userEvent.click(screen.getByRole('button', { name: 'Vocabulaire riche' }));
    expect(onChange).toHaveBeenCalledWith({ languageStatus: 'begaiement,vocabulaire_riche' });
  });
});

describe('SharedQuestionnaire : l’en-tête d’une section ouverte reste visible (#47)', () => {
  const openWithHeaderAt = async (top: number) => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect);
    render(<SharedQuestionnaire data={patient()} onChange={() => {}} mode="practitioner" />);
    await userEvent.click(screen.getByText('Développement'));
    await new Promise((r) => setTimeout(r, 100));
    const calls = scrollTo.mock.calls.map(([arg]) => arg);
    rect.mockRestore();
    scrollTo.mockRestore();
    return calls;
  };

  it('remonte sur l’en-tête quand il est sorti de l’écran', async () => {
    const calls = await openWithHeaderAt(-600);
    expect(calls).toContainEqual(expect.objectContaining({ top: -600 + window.scrollY - 80 }));
  });

  it('ne bouge pas quand l’en-tête est déjà visible', async () => {
    const calls = await openWithHeaderAt(300);
    expect(calls).toEqual([]);
  });
});
