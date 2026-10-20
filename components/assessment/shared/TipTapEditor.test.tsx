// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TipTapEditor } from './TipTapEditor';

const LIST_LAST = '<p>Adaptations :</p><ul><li><p>Temps majoré.</p></li></ul>';

describe('TipTapEditor', () => {
  // The recette saw the « Recommandations » section one line taller every other
  // run: an empty paragraph was appended after its final list, after the first
  // transaction (setContent).
  it("en lecture seule, n'ajoute pas de paragraphe vide après une liste finale", async () => {
    const { container, rerender } = render(<TipTapEditor content="<p>Avant</p>" onChange={() => {}} readOnly />);
    rerender(<TipTapEditor content={LIST_LAST} onChange={() => {}} readOnly />);
    const doc = () => container.querySelector('.ProseMirror')!;
    await waitFor(() => expect(doc().querySelector('ul')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(doc().lastElementChild?.tagName).toBe('UL');
  });

  // #134: the hint of the Relecture and Visualisation steps promises red underlines
  // while editing; they come from the browser's French spell checker.
  it('en édition, laisse le navigateur souligner les fautes en français', async () => {
    const { container } = render(<TipTapEditor content="<p>Texte</p>" onChange={() => {}} inline />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    const doc = container.querySelector('.ProseMirror')!;
    expect(doc.getAttribute('spellcheck')).toBe('true');
    expect(doc.getAttribute('lang')).toBe('fr');
    expect(doc.getAttribute('contenteditable')).toBe('true');
  });
});
