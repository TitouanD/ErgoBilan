
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

export type ScoreType = 'standard' | 'scaled' | 't-score' | 'percentile' | 'sten' | 'none';
export type ComputationMode = 'LOOKUP' | 'PARAMETRIC' | 'NONE';
export type SubtestInputModel = 'numeric_4mode' | 'qualitative_category' | 'raw_only';

export interface SubtestInputOption {
  code: string;
  label: string;
  order: number;
  reportText?: string;
}

export interface SubtestInputConfig {
  options?: SubtestInputOption[];
  defaultMetric?: 'raw' | 'standard' | 'z' | 'percentile';
}

export interface SubtestDef {
  id: string;
  name: string;
  unit: string; 
  lowerIsBetter?: boolean;
  scoreType: ScoreType;
  computationMode?: ComputationMode;
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
