// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestAccessScreen } from './TestAccessScreen';

describe('TestAccessScreen', () => {
  it('nomme le compte refusé, renvoie vers la production et permet de se déconnecter', async () => {
    const onLogout = vi.fn();
    render(<TestAccessScreen email="autre@x.fr" onLogout={onLogout} />);
    expect(screen.getByText('autre@x.fr')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'app.ergobilan.com' })).toHaveAttribute('href', 'https://app.ergobilan.com');
    await userEvent.click(screen.getByRole('button', { name: /Se déconnecter/ }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
