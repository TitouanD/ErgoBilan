// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
