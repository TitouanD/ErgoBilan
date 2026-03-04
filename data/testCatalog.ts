
import React from 'react';
import { Brain, PenTool, Eye, Hand, Focus, Home, Activity, Box, Sparkles, User } from 'lucide-react';

// Mapping des icônes stockées en DB (string) vers composants Lucide
export const ICON_MAP: Record<string, any> = {
  'Brain': Brain,
  'PenTool': PenTool,
  'Pencil': PenTool, // Legacy fallback
  'Eye': Eye,
  'Hand': Hand,
  'Focus': Focus,
  'Home': Home,
  'Activity': Activity,
  'Box': Box,
  'Sparkles': Sparkles,
  'User': User
};

export type ScoreType = 'standard' | 'scaled' | 't-score' | 'percentile' | 'sten' | 'stanine' | 'none';
export type ComputationMode = 'LOOKUP' | 'PARAMETRIC' | 'NONE';
/**
 * Input model for a subtest:
 * - numeric_4mode      : standard 4-field input (brut / NS / ET / %)
 * - qualitative_category : button-grid of labelled options
 * - raw_only           : single raw score field, no standardization
 * - custom_text        : free-text observation (bilan écologique)
 * - computed_items     : sub-items whose values are aggregated into a brut score
 *                        before hitting the standard scoring pipeline
 */
export type SubtestInputModel = 'numeric_4mode' | 'qualitative_category' | 'raw_only' | 'custom_text' | 'computed_items';
export type RawDirection = 'auto' | 'higher_better' | 'lower_better';

/** How the sub-items of a computed_items subtest are combined into the raw score. */
export type ItemsAggregation =
  | 'sum'          // Σ of all items (e.g. FigRey: sum of 18 element scores)
  | 'best_of'      // best trial wins — max if higher_better, min if lower_better
  | 'mean'         // arithmetic mean
  | 'custom';      // formula defined in aggregationHint; brut editable manually

/** Visual layout for the sub-items form. */
export type ItemsDisplayGroup = 'column' | 'grid_2' | 'grid_3' | 'table';

/** One sub-item inside a computed_items subtest. */
export interface SubtestItem {
  /** Stable identifier (e.g. "trial_1", "element_7", "correct"). */
  id: string;
  /** Label shown to the practitioner. */
  label: string;
  /** Optional unit shown after the input (pts, sec, cm…). */
  unit?: string;
  /** Input type — numeric field (default), integer counter, or yes/no toggle. */
  type?: 'number' | 'count' | 'boolean';
  /** Minimum accepted value (for validation). */
  min?: number;
  /** Maximum accepted value (for validation). */
  max?: number;
  /** Decimal places for display/step (e.g. 1 for chrono). */
  decimals?: number;
  /**
   * When true, this item IS the brut score — no aggregation needed.
   * Used when only one significant item exists but we still want the
   * structured label+unit UI (e.g. BHK speed: a single derived value).
   */
  isMaster?: boolean;
  /** Visual weight: wide fields span the full row width. */
  wide?: boolean;
}

export interface SubtestInputOption {
  code: string;
  label: string;
  order: number;
  reportText?: string;
}

/**
 * One additive section within a raw score entry.
 * Used when a raw score is split across named sub-parts that sum to a total
 * (e.g. Purdue Pegboard: main droite, main gauche, deux mains, assemblage).
 */
export interface RawSection {
  /** Stable key (e.g. "right", "left", "bimanual"). */
  key: string;
  /** Label shown next to the input field. */
  label: string;
  /** Optional unit override (falls back to the subtest unit). */
  unit?: string;
  /** Maximum accepted value for this section. */
  max?: number;
}

export interface SubtestInputConfig {
  /** For qualitative_category: the list of selectable options. */
  options?: SubtestInputOption[];
  /** Preferred primary metric shown to the practitioner. */
  defaultMetric?: 'raw' | 'standard' | 'z' | 'percentile';
  /** @deprecated — use the `raw_direction` DB column instead. */
  rawDirectionHint?: RawDirection;
  /** For computed_items: the list of sub-items to present. */
  items?: SubtestItem[];
  /** For computed_items: how sub-items are combined into the raw score. */
  itemsAggregation?: ItemsAggregation;
  /**
   * Human-readable formula hint (displayed in the UI).
   * E.g. "chars × 300 / seconds" for BHK speed, "Σ(essais)", "meilleur de 3".
   */
  aggregationHint?: string;
  /** Visual layout for the sub-items grid. Default: 'column'. */
  displayGroup?: ItemsDisplayGroup;
  /**
   * Maximum possible raw score — enables fraction display "XX / maxRawScore".
   * E.g. 35 for Test des Cloches, 180 for EVIC caractères.
   */
  maxRawScore?: number;
  /**
   * Custom label replacing the default "BRUT" label in the raw score field.
   * E.g. "ERREURS", "CHAR.", "SEC.", "CLOCHES".
   */
  rawValueLabel?: string;
  /**
   * When true, shows the score as a fraction: "[input] / maxRawScore".
   * Requires maxRawScore to be set.
   */
  showRawFraction?: boolean;
  /**
   * Splits the raw entry into named additive sections that auto-sum to the total.
   * E.g. Purdue Pegboard: [main D, main G, deux mains, assemblage].
   */
  rawSections?: RawSection[];
  /**
   * Visual layout for qualitative_category options.
   * Default: 'radio' (vertical list). 'toggle' gives a pill-button grid.
   */
  qualitativeLayout?: 'radio' | 'select' | 'toggle';
}

export interface SubtestDef {
  id: string;
  name: string;
  displayName?: string;
  abbreviation?: string | null;
  isAmbiguous?: boolean;
  isHiddenInvalidAmbiguous?: boolean;
  unit: string;
  lowerIsBetter?: boolean;
  rawDirection?: RawDirection;
  sourceSubtestId?: string | null;
  isOverrideClone?: boolean;
  scoreType: ScoreType;
  computationMode?: ComputationMode;
  inputModel: SubtestInputModel;
  inputConfig?: SubtestInputConfig;
  /** Always show raw score input even when no norms are available (Regime B) */
  alwaysShowRaw?: boolean;
  /** Number of decimal places to display for raw score (e.g. 1 for BHK) */
  rawDisplayDecimals?: number;
}

export interface TestDef {
  id: string;
  name: string;
  subtests: SubtestDef[];
}

export interface CategoryDef {
  id: string;
  name: string; // Label affiché (ex: "Motricité Globale")
  iconKey: string; // Clé pour ICON_MAP (ex: "Brain")
  sortOrder: number;
  tests: TestDef[];
}

/**
 * Legacy static catalog — kept as empty array for backward compatibility.
 * Real catalog is loaded from Supabase via CatalogContext.
 */
export const TEST_CATALOG: CategoryDef[] = [];
