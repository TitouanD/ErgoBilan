/**
 * testCatalog.ts — types of the test catalogue (the data itself is loaded
 * from Supabase by contexts/CatalogContext.tsx) and the category icon map.
 */

import { Brain, PenTool, Eye, Hand, Focus, Home, Activity, Box, Sparkles, User, type LucideIcon } from 'lucide-react';

/** Lucide icon for each `official_categories.icon_key`. */
export const ICON_MAP: Record<string, LucideIcon> = {
  Brain,
  PenTool,
  Pencil: PenTool,
  Eye,
  Hand,
  Focus,
  Home,
  Activity,
  Box,
  Sparkles,
  User,
};

/**
 * Scale of a subtest's standardized score (`official_subtests.score_type`). 'none' = unknown scale.
 * `*-inverse`: same scale, but a high score signals a difficulty (BRIEF-2, SPM, Vineland-3 maladaptive, #122).
 */
export type ScoreType =
  | 'standard'
  | 'scaled'
  | 't-score'
  | 't-score-inverse'
  | 'v-scale'
  | 'v-scale-inverse'
  | 'scaled-15'
  | 'percentile'
  | 'sten'
  | 'stanine'
  | 'none';

/**
 * How a subtest is entered in the score table:
 * - numeric_4mode        : standardized score typed as NS, ET or %
 * - qualitative_category : one of the options of `input_config.options`
 * - custom_text          : free observation with a title (bilan écologique)
 */
export type SubtestInputModel = 'numeric_4mode' | 'qualitative_category' | 'custom_text';

export interface SubtestInputOption {
  code: string;
  label: string;
  order: number;
  /** Interpretation printed in the report next to the chosen category. */
  reportText?: string;
}

export interface SubtestInputConfig {
  /** qualitative_category: selectable options. */
  options?: SubtestInputOption[];
  /** Subtests sharing a groupKey are shown under a common header. */
  groupKey?: string;
  /** Header label of the group (falls back to groupKey). */
  groupHeaderLabel?: string;
  /** Group ordering (lower first). */
  groupOrder?: number;
  /** Ordering inside the group (lower first). */
  orderIndex?: number;
}

export interface SubtestDef {
  id: string;
  name: string;
  displayGroupOrder?: number;
  displayOrder?: number;
  unit: string;
  scoreType: ScoreType;
  inputModel: SubtestInputModel;
  inputConfig?: SubtestInputConfig;
}

export interface TestDef {
  id: string;
  name: string;
  subtests: SubtestDef[];
}

export interface CategoryDef {
  id: string;
  /** Display label (e.g. "Motricité Globale"). */
  name: string;
  /** Key of ICON_MAP. */
  iconKey: string;
  sortOrder: number;
  tests: TestDef[];
}
