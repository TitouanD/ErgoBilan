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
});
