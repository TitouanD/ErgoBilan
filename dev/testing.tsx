/**
 * testing.tsx — fixtures for the component tests (Testing Library), from the
 * same fictitious patients as the dev scenarios. See docs/VERIFICATION.md.
 *
 * The demo catalogue is the one available offline: a profile test absent from
 * it is simply left out (`fictiveTests`). Contexts that reach Supabase or
 * IndexedDB stay mocked in each test file with `vi.mock` (see
 * components/assessment/shared/ScoreTable.test.tsx); the toasts are real.
 */

import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { ToastProvider } from '../contexts/ToastContext';
import { DEMO_CATALOG } from '../data/demoCatalog';
import type { Patient, TestData } from '../types';
import { buildCatalogIndex } from '../utils/catalogIndex';
import { getFictiveProfile } from './fictivePatients';
import { buildFictiveTests, type ScoreFill } from './fictiveScores';

/** Index of the demo catalogue (BHK, MABC-2 composites, Test des Cloches). */
export const demoIndex = buildCatalogIndex(DEMO_CATALOG);

const profileOf = (id: string) => {
  const profile = getFictiveProfile(id);
  if (!profile) throw new Error(`Patient fictif inconnu : ${id}`);
  return profile;
};

/** A fictitious patient (dev/fictivePatients.ts), with a record id. */
export const fictivePatient = (id: string, overrides: Partial<Patient> = {}): Patient => ({
  ...profileOf(id).patient,
  id: `fictif-${id}`,
  ...overrides,
});

/** The profile's scores on the demo catalogue (`shift` > 0: progress, as in a re-evaluation). */
export const fictiveTests = (id: string, options: { fill?: ScoreFill; shift?: number } = {}): TestData => {
  const profile = profileOf(id);
  return buildFictiveTests(demoIndex, profile.tests, { level: profile.level, fill: options.fill ?? 'zones', shift: options.shift }).tests;
};

/** render() inside the real ToastProvider (components calling useToast). */
export const renderWithToast = (ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  render(ui, { wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>, ...options });
