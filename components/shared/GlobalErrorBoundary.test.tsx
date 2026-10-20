// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const reloadForNewVersion = vi.fn();
vi.mock('../../utils/newVersionReload', async (original) => ({
  ...(await original<typeof import('../../utils/newVersionReload')>()),
  reloadForNewVersion: () => reloadForNewVersion(),
}));
vi.mock('../../services/sentryService', () => ({ isFeedbackAvailable: () => false, recordAppLog: () => {} }));

const { GlobalErrorBoundary } = await import('./GlobalErrorBoundary');

const Throws: React.FC<{ error: Error }> = ({ error }) => {
  throw error;
};
const chunkError = () =>
  new TypeError('Failed to fetch dynamically imported module: https://dev.ergobilan.com/assets/ExportPage-CXEWCkKs.js');

describe('GlobalErrorBoundary : module de l’ancienne version (#124)', () => {
  it('recharge la page au lieu d’afficher l’écran d’erreur', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reloadForNewVersion.mockReturnValue(true);
    render(
      <GlobalErrorBoundary>
        <Throws error={chunkError()} />
      </GlobalErrorBoundary>,
    );
    expect(reloadForNewVersion).toHaveBeenCalled();
    expect(screen.getByText(/Nouvelle version de l'application, rechargement/)).toBeInTheDocument();
    expect(screen.queryByText('Une erreur est survenue')).toBeNull();
  });

  it('affiche l’écran d’erreur si la page vient déjà d’être rechargée', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reloadForNewVersion.mockReturnValue(false);
    render(
      <GlobalErrorBoundary>
        <Throws error={chunkError()} />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument();
  });

  it('une autre erreur affiche l’écran d’erreur sans recharger', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reloadForNewVersion.mockClear();
    render(
      <GlobalErrorBoundary>
        <Throws error={new Error('boom')} />
      </GlobalErrorBoundary>,
    );
    expect(reloadForNewVersion).not.toHaveBeenCalled();
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument();
  });
});
