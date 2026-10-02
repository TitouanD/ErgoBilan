// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  // A parent with backdrop-filter (the app header) becomes the containing block of
  // `position: fixed`: the modal was centred on the 80px header and cut off (#86).
  it("s'affiche dans document.body, hors de l'élément qui l'ouvre", () => {
    render(
      <header data-testid="header" className="backdrop-blur-md">
        <Modal isOpen onClose={() => {}}>
          <p>Contenu</p>
        </Modal>
      </header>,
    );
    const content = screen.getByText('Contenu');
    expect(screen.getByTestId('header')).not.toContainElement(content);
    expect(document.body).toContainElement(content);
  });

  it('se ferme au clic sur le fond, pas sur le contenu', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose}>
        <p>Contenu</p>
      </Modal>,
    );
    await userEvent.click(screen.getByText('Contenu'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Contenu').parentElement!.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
