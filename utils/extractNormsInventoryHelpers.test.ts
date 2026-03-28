import { describe, expect, it } from 'vitest';
import {
  chunkInventoryColumns,
  decideExtractionRouting,
  matchRepairColumns,
  sortTablesByInventoryOrder,
  summarizeInventoryCompleteness,
  type ExtractionLikeResult,
  type InventoryColumnDescriptor,
} from '../supabase/functions/extract-norms/extractionUtils';

describe('extract-norms inventory helpers', () => {
  it('routes inverted or dense lookup pages to chunked mode', () => {
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
    expect(denseDecision.mode).toBe('lookup-chunked');
    expect(denseDecision.isInverted).toBe(true);

    const simpleDecision = decideExtractionRouting(
      {
        st: 'LOOKUP',
        columns: denseColumns.slice(0, 4).map((column) => ({ ...column, isInverted: false })),
      },
      8,
    );
    expect(simpleDecision.mode).toBe('lookup-full');
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
});
