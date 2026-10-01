// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sendAppFeedback = vi.fn();
vi.mock('../../services/sentryService', () => ({ sendAppFeedback: (...args: unknown[]) => sendAppFeedback(...args) }));

import { FeedbackModal } from './FeedbackModal';

describe('FeedbackModal', () => {
  beforeEach(() => sendAppFeedback.mockReset());

  it('envoie le message avec sa provenance, sans e-mail hors démo, et remercie', async () => {
    sendAppFeedback.mockReturnValue(true);
    render(<FeedbackModal isOpen onClose={() => {}} source="header" />);
    expect(screen.queryByLabelText(/Votre e-mail/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Votre message'), '  Le bouton Suivant ne répond plus  ');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(sendAppFeedback).toHaveBeenCalledWith('Le bouton Suivant ne répond plus', 'header', undefined);
    expect(screen.getByText('Merci !')).toBeInTheDocument();
  });

  it("en démo, propose un e-mail facultatif et l'envoie", async () => {
    sendAppFeedback.mockReturnValue(true);
    render(<FeedbackModal isOpen onClose={() => {}} source="header" askEmail />);
    await userEvent.type(screen.getByLabelText('Votre message'), 'Idée');
    await userEvent.type(screen.getByLabelText(/Votre e-mail/), 'prospect@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(sendAppFeedback).toHaveBeenCalledWith('Idée', 'header', 'prospect@example.com');
  });

  it("dit que l'envoi est indisponible quand Sentry est coupé, sans perdre le message", async () => {
    sendAppFeedback.mockReturnValue(false);
    render(<FeedbackModal isOpen onClose={() => {}} source="error_screen" />);
    await userEvent.type(screen.getByLabelText('Votre message'), 'Écran blanc');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(screen.getByText(/L'envoi n'est pas disponible ici/)).toBeInTheDocument();
    expect(screen.getByLabelText('Votre message')).toHaveValue('Écran blanc');
  });
});
