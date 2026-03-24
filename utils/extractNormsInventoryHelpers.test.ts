import { describe, expect, it } from 'vitest';
import {
  chunkInventoryColumns,
  compareVerificationResults,
  decideExtractionRouting,
  matchRepairColumns,
  sortTablesByInventoryOrder,
  summarizeInventoryCompleteness,
  type ExtractionLikeResult,
  type InventoryColumnDescriptor,
  type VerificationScanResult,
} from '../supabase/functions/extract-norms/extractionUtils';

describe('extract-norms inventory helpers', () => {
  it('routes inverted or dense lookup pages to chunked verified mode', () => {
    const denseColumns: InventoryColumnDescriptor[] = Array.from({ length: 9 }, (_, index) => ({
      sid: `Sous-test ${index + 1}`,
      ab: `S${index + 1}`,
      domain: 'Langage',
      columnOrder: index + 1,
      isInverted: index === 0,
    }));

    const denseDecision = decideExtractionRouting(
      { st: 'LOOKUP', isInverted: false, columns: denseColumns },
      8,
    );
    expect(denseDecision.mode).toBe('lookup-chunked-verified');
    expect(denseDecision.isInverted).toBe(true);

    const simpleDecision = decideExtractionRouting(
      {
        st: 'LOOKUP',
        columns: denseColumns.slice(0, 4).map((column) => ({ ...column, isInverted: false })),
      },
      8,
    );
    expect(simpleDecision.mode).toBe('lookup-full-verified');
  });

  it('chunks inventory columns by domain and max size while preserving order', () => {
    const columns: InventoryColumnDescriptor[] = [
      { sid: 'AA', ab: 'AA', domain: 'Attention', columnOrder: 1 },
      { sid: 'FD', ab: 'FD', domain: 'Attention', columnOrder: 2 },
      { sid: 'IND', ab: 'IND', domain: 'Attention', columnOrder: 3 },
      { sid: 'IP', ab: 'IP', domain: 'Fonctions sensori-motrices', columnOrder: 4 },
      { sid: 'PV', ab: 'PV', domain: 'Fonctions sensori-motrices', columnOrder: 5 },
    ];

    const chunks = chunkInventoryColumns(columns, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].columns.map((column) => column.ab)).toEqual(['AA', 'FD']);
    expect(chunks[1].columns.map((column) => column.ab)).toEqual(['IND']);
    expect(chunks[2].columns.map((column) => column.ab)).toEqual(['IP', 'PV']);
  });

  it('forces verification mismatch when adjacent columns duplicate each other', () => {
    const inventoryColumns: InventoryColumnDescriptor[] = [
      { sid: 'Attention Auditive', ab: 'AA', domain: 'Attention', columnOrder: 1, isInverted: true },
      { sid: 'Precision visuo-motrice', ab: 'PV', domain: 'Attention', columnOrder: 2, isInverted: true },
    ];
    const extraction: ExtractionLikeResult = {
      st: 'LOOKUP',
      tables: [
        { sid: 'Attention Auditive', ab: 'AA', rows: [{ r: '0-3', n: '1' }, { r: '4-5', n: '2' }] },
        { sid: 'Precision visuo-motrice', ab: 'PV', rows: [{ r: '0-3', n: '1' }, { r: '4-5', n: '2' }] },
      ],
    };
    const verification: VerificationScanResult = {
      verify: [
        { sid: 'Attention Auditive', ab: 'AA', columnOrder: 1, count: 2, min_n: 1, max_n: 2, min_r: '0-3', max_r: '4-5' },
        { sid: 'Precision visuo-motrice', ab: 'PV', columnOrder: 2, count: 2, min_n: 1, max_n: 2, min_r: '0-3', max_r: '4-5' },
      ],
    };

    const mismatches = compareVerificationResults(extraction, verification, inventoryColumns);
    expect(mismatches.some((entry) => entry.ab === 'PV' && entry.reason.startsWith('adjacent_duplicate'))).toBe(true);
  });

  it('matches repair targets by sid or abbreviation and includes same-domain neighbors when requested', () => {
    const inventoryColumns: InventoryColumnDescriptor[] = [
      { sid: 'Attention Auditive', ab: 'AA', domain: 'Attention', columnOrder: 1 },
      { sid: 'Flexibilite double', ab: 'FD', domain: 'Attention', columnOrder: 2 },
      { sid: 'Inhibition - Denomination (Temps)', ab: 'IND', domain: 'Attention', columnOrder: 3 },
      { sid: 'Precision visuo-motrice', ab: 'PV', domain: 'Moteur', columnOrder: 4 },
    ];

    const matched = matchRepairColumns(
      inventoryColumns,
      [{ sid: 'Flexibilite double', ab: 'FD' }],
      true,
    );

    expect(matched.map((column) => column.ab)).toEqual(['AA', 'FD', 'IND']);
  });

  it('sorts extracted tables back to physical inventory order', () => {
    const inventoryColumns: InventoryColumnDescriptor[] = [
      { sid: 'Attention Auditive', ab: 'AA', columnOrder: 1 },
      { sid: 'Flexibilite double', ab: 'FD', columnOrder: 2 },
      { sid: 'Inhibition - Denomination (Temps)', ab: 'IND', columnOrder: 3 },
    ];

    const sorted = sortTablesByInventoryOrder(
      [
        { sid: 'Inhibition - Denomination (Temps)', ab: 'IND', rows: [] },
        { sid: 'Attention Auditive', ab: 'AA', rows: [] },
        { sid: 'Flexibilite double', ab: 'FD', rows: [] },
      ],
      inventoryColumns,
    );

    expect(sorted.map((table) => table.ab)).toEqual(['AA', 'FD', 'IND']);
  });

  it('summarizes missing inventory columns for dense lookup pages', () => {
    const inventoryColumns: InventoryColumnDescriptor[] = [
      { sid: 'Attention Auditive', ab: 'AA', columnOrder: 1 },
      { sid: 'Flexibilite Denomination', ab: 'FD', columnOrder: 2 },
      { sid: 'Memoire Phrases et Memoire Phrases Differee', ab: 'MP & MPD', columnOrder: 3 },
    ];

    const extraction: ExtractionLikeResult = {
      st: 'LOOKUP',
      tables: [
        { sid: 'Attention Auditive', ab: 'AA', rows: [] },
        { sid: 'Flexibilite Denomination', ab: 'FD', rows: [] },
      ],
    };

    const summary = summarizeInventoryCompleteness(extraction, inventoryColumns);
    expect(summary.expectedSourceColumnCount).toBe(3);
    expect(summary.expectedSourceColumns).toEqual(['AA', 'FD', 'MP & MPD']);
    expect(summary.missingSourceColumns).toEqual(['MP & MPD']);
  });

  it('tracks missing columns by physical occurrence when sid+ab repeats', () => {
    const inventoryColumns: InventoryColumnDescriptor[] = [
      { sid: 'Attention Auditive', ab: 'AA', columnOrder: 1 },
      { sid: 'Attention Auditive', ab: 'AA', columnOrder: 2 },
      { sid: 'Flexibilite Denomination', ab: 'FD', columnOrder: 3 },
    ];

    const extraction: ExtractionLikeResult = {
      st: 'LOOKUP',
      tables: [
        { sid: 'Attention Auditive', ab: 'AA', rows: [{ r: '0-3', n: '1' }] },
        { sid: 'Flexibilite Denomination', ab: 'FD', rows: [{ r: '0-3', n: '1' }] },
      ],
    };

    const summary = summarizeInventoryCompleteness(extraction, inventoryColumns);
    expect(summary.expectedSourceColumnCount).toBe(3);
    expect(summary.missingSourceColumns).toEqual(['AA']);
  });

  it('flags duplicate inventory columns as missing when only one occurrence is extracted', () => {
    const inventoryColumns: InventoryColumnDescriptor[] = [
      { sid: 'Attention Auditive', ab: 'AA', domain: 'Attention', columnOrder: 1, isInverted: true },
      { sid: 'Attention Auditive', ab: 'AA', domain: 'Attention', columnOrder: 2, isInverted: true },
    ];

    const extraction: ExtractionLikeResult = {
      st: 'LOOKUP',
      tables: [
        { sid: 'Attention Auditive', ab: 'AA', rows: [{ r: '0-3', n: '1' }, { r: '4-5', n: '2' }] },
      ],
    };

    const verification: VerificationScanResult = {
      verify: [
        { sid: 'Attention Auditive', ab: 'AA', columnOrder: 1, count: 2, min_n: 1, max_n: 2, min_r: '0-3', max_r: '4-5' },
      ],
    };

    const mismatches = compareVerificationResults(extraction, verification, inventoryColumns);
    expect(mismatches.some((entry) => entry.reason === 'missing_table')).toBe(true);
  });
});
