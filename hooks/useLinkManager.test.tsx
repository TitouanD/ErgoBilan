// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PractitionerProfile } from '../types';
import { decryptEnvelope, importQuestionnaireKey } from '../utils/crypto';
import { useLinkManager } from './useLinkManager';

const inserted: Record<string, unknown>[] = [];
vi.mock('../services/db', () => ({
  supabase: {
    rpc: async () => ({ data: 'org-1', error: null }),
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { ...row, id: 'q-1', created_at: '2026-10-20' }, error: null }) }) };
      },
    }),
  },
}));

const practitioner = { id: 'p-1', firstName: 'Sophie', lastName: 'FICTIF' } as PractitionerProfile;
const toast = { success: vi.fn(), error: vi.fn() };

const generate = async (practitionerName: string) => {
  inserted.length = 0;
  const sessionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (copied = t) }, configurable: true });
  const { result } = renderHook(() =>
    useLinkManager({
      sessionKey,
      practitioner,
      practitionerName,
      isDemoMode: false,
      pendingQuestionnaires: [],
      setPendingQuestionnaires: () => {},
      toast,
    }),
  );
  await act(() => result.current.handleGenerateLink());
  const linkKey = await importQuestionnaireKey(copied.split('key=')[1]);
  return { row: inserted[0], linkKey };
};

describe('useLinkManager : nom du praticien pour signer le portail (#149)', () => {
  it('transmet le nom chiffré avec la clé du lien, jamais en clair', async () => {
    const { row, linkKey } = await generate('Sophie FICTIF');
    const data = String(row.family_encrypted_data);
    expect(data).not.toContain('Sophie');
    expect(await decryptEnvelope(data, linkKey)).toEqual({ practitioner: { name: 'Sophie FICTIF' } });
    expect(row.status).toBe('pending');
  });

  it('sans nom, ne transmet rien (signature générique)', async () => {
    const { row } = await generate('  ');
    expect(row.family_encrypted_data).toBeNull();
  });
});
