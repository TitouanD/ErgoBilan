
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

export interface SubtestDef {
  id: string;
  name: string;
  unit: string; 
  lowerIsBetter?: boolean;
  scoreType: 'standard' | 'scaled' | 't-score' | 'percentile';
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