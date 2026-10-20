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
  });

  it('la date, précédée de « Depuis le », n’apparaît qu’avec Oui (#93)', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SharedQuestionnaire data={patient({ pcoFollowup: 'non' })} onChange={onChange} mode="practitioner" />);
    await userEvent.click(screen.getByText('Suivi médical'));
    expect(screen.queryByLabelText('Suivi PCO depuis le (optionnel)')).toBeNull();

    rerender(<SharedQuestionnaire data={patient({ pcoFollowup: 'oui' })} onChange={onChange} mode="practitioner" />);
    expect(screen.getByText('Depuis le')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Suivi PCO depuis le (optionnel)'), { target: { value: '2026-03-01' } });
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

  it('ajoute un professionnel sans profession pré-remplie (#150)', async () => {
    const onChange = vi.fn();
    render(<SharedQuestionnaire data={patient()} onChange={onChange} mode="family" />);
    await userEvent.click(screen.getByText('Suivi médical'));
    await userEvent.click(screen.getByRole('button', { name: /Ajouter un pro/ }));
    const [added] = onChange.mock.calls.at(-1)![0].medicalTracking;
    expect(added.profession).toBe('');
    expect(added.type).toBe('');
  });

  it('une profession effacée reste vide, sans revenir à l’ancien type (#150)', () => {
    const track = { id: 't1', type: 'Orthophoniste', profession: '', name: '', frequency: '', since: '', contact: '', reason: '' };
    render(<SharedQuestionnaire data={patient({ medicalTracking: [track] })} onChange={() => {}} mode="practitioner" />);
    fireEvent.click(screen.getByText('Suivi médical'));
    expect(screen.getAllByPlaceholderText('Profession').at(-1)).toHaveValue('');
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

describe('SharedQuestionnaire : retours de la testeuse sur le questionnaire parents', () => {
  it('demande la classe redoublée quand le redoublement vaut Oui (#94)', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SharedQuestionnaire data={patient()} onChange={onChange} mode="family" />);
    await userEvent.click(screen.getByText('Vie scolaire'));
    expect(screen.queryByLabelText('Si oui, quelle classe ?')).toBeNull();

    rerender(<SharedQuestionnaire data={patient({ schoolRepeatYear: 'oui' })} onChange={onChange} mode="family" />);
    fireEvent.change(screen.getByLabelText('Si oui, quelle classe ?'), { target: { value: 'CE1' } });
    expect(onChange).toHaveBeenLastCalledWith({ schoolRepeatClass: 'CE1' });
  });

  it('pose des questions dans la case Grossesse & Naissance (#95)', async () => {
    render(<SharedQuestionnaire data={patient()} onChange={() => {}} mode="family" />);
    await userEvent.click(screen.getByText('Développement'));
    expect(screen.getByPlaceholderText(/La grossesse et l'accouchement se sont-ils bien passés \?/)).toBeInTheDocument();
  });

  it('ne propose plus « Réveil très matinal » dans le sommeil (#96)', async () => {
    render(<SharedQuestionnaire data={patient()} onChange={() => {}} mode="family" />);
    await userEvent.click(screen.getByText('Développement'));
    expect(screen.getByText('Terreurs nocturnes')).toBeInTheDocument();
    expect(screen.queryByText('Réveil très matinal')).toBeNull();
  });

  it('remplace ramper, 4 pattes et âge de la marche par le déroulé moteur et le sport (#97)', async () => {
    const onChange = vi.fn();
    render(<SharedQuestionnaire data={patient()} onChange={onChange} mode="family" />);
    await userEvent.click(screen.getByText('Développement'));
    expect(screen.getByText(/Comment s'est déroulé le développement moteur de votre enfant/)).toBeInTheDocument();
    expect(screen.queryByText('Ramper')).toBeNull();
    expect(screen.queryByText('4 pattes')).toBeNull();
    expect(screen.queryByText('Âge de la marche')).toBeNull();
    expect(screen.getByLabelText('Votre enfant fait-il une activité sportive extra-scolaire ?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Développement tardif' }));
    expect(onChange).toHaveBeenLastCalledWith({ motorDevelopmentTags: 'developpement_tardif' });
  });

  it('regroupe les apprentissages dans un bloc de la vie scolaire (#99)', async () => {
    render(<SharedQuestionnaire data={patient()} onChange={() => {}} mode="family" />);
    await userEvent.click(screen.getByText('Vie scolaire'));
    const block = screen.getByText('Apprentissages').closest('div')!;
    expect(within(block).getByLabelText('Comment se passent les apprentissages ?')).toBeInTheDocument();
    for (const label of ['Mémorisation', 'Organisation', 'Devoirs', 'Utilisation des outils scolaires']) {
      expect(within(block).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Utilisation des outils scolaires')).toHaveLength(1);
  });
});
