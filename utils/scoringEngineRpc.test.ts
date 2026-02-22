import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('../services/db', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock('../utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ScoringEngine } from '../services/scoringEngine';

describe('ScoringEngine RPC helpers', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('maps checkNormsStatus response rows', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          subtest_id: 'sub_a',
          has_norms: true,
          has_applicable_norms: false,
          status_code: 'no_applicable_age_gender',
        },
      ],
      error: null,
    });

    const rows = await ScoringEngine.checkNormsStatus(['sub_a'], 95, 'F');

    expect(rpcMock).toHaveBeenCalledWith('check_norms_status', {
      p_subtest_ids: ['sub_a'],
      p_age_months: 95,
      p_gender: 'F',
    });
    expect(rows).toEqual([
      {
        subtestId: 'sub_a',
        hasNorms: true,
        hasApplicableNorms: false,
        statusCode: 'no_applicable_age_gender',
      },
    ]);
  });

  it('returns null when checkNormsStatus RPC fails', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const rows = await ScoringEngine.checkNormsStatus(['sub_a'], 95, 'M');
    expect(rows).toBeNull();
  });

  it('maps override clone RPC payload', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          effective_subtest_id: 'sub_a__ovr',
          created: true,
          updated_norms_count: 42,
        },
      ],
      error: null,
    });

    const result = await ScoringEngine.upsertRawDirectionOverrideClone('sub_a', 'lower_better', 'test');

    expect(rpcMock).toHaveBeenCalledWith('admin_create_or_update_subtest_override_clone', {
      p_source_subtest_id: 'sub_a',
      p_raw_direction: 'lower_better',
      p_reason: 'test',
    });
    expect(result).toEqual({
      effectiveSubtestId: 'sub_a__ovr',
      created: true,
      updatedNormsCount: 42,
    });
  });

  it('returns null when override clone RPC fails', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'forbidden' } });
    const result = await ScoringEngine.upsertRawDirectionOverrideClone('sub_a', 'higher_better');
    expect(result).toBeNull();
  });
});
