import { normalizeSubtestName } from '../utils';

export interface DisplayableSubtest {
  id: string;
  name: string;
  abbreviation?: string | null;
}

export interface SubtestDisplayMeta {
  id: string;
  normalizedNameKey: string;
  normalizedAbbreviation: string;
  cleanedName: string;
  displayName: string;
  isAmbiguous: boolean;
  isHiddenInvalidAmbiguous: boolean;
}

export const normalizeSubtestAbbreviationTag = (value?: string | null): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
};

export const splitTrailingTag = (name: string): { baseName: string; trailingTag?: string } => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { baseName: '' };
  const match = trimmed.match(/^(.*)\(([^()]{1,80})\)\s*$/u);
  if (!match) return { baseName: trimmed };
  return {
    baseName: match[1].trim(),
    trailingTag: match[2].trim(),
  };
};

export const hasEquivalentTrailingTag = (name: string, abbreviation?: string | null): boolean => {
  const parsed = splitTrailingTag(name);
  if (!parsed.trailingTag) return false;
  const fromName = normalizeSubtestAbbreviationTag(parsed.trailingTag);
  const fromAbbr = normalizeSubtestAbbreviationTag(abbreviation);
  if (!fromName || !fromAbbr) return false;
  return fromName === fromAbbr;
};

export const stripDuplicateTrailingTag = (name: string, abbreviation?: string | null): string => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  if (!hasEquivalentTrailingTag(trimmed, abbreviation)) return trimmed;
  return splitTrailingTag(trimmed).baseName || trimmed;
};

export const buildConditionalSubtestDisplayName = (
  name: string,
  abbreviation: string | null | undefined,
  isAmbiguous: boolean,
): string => {
  const normalizedAbbr = normalizeSubtestAbbreviationTag(abbreviation);
  const cleanedName = stripDuplicateTrailingTag(name, normalizedAbbr);
  if (!cleanedName) return '';
  if (!isAmbiguous || !normalizedAbbr) return cleanedName;
  return `${cleanedName} (${normalizedAbbr})`;
};

export const buildSubtestDisplayMetaMap = <T extends DisplayableSubtest>(subtests: T[]): Map<string, SubtestDisplayMeta> => {
  const prepared = subtests.map((subtest) => {
    const normalizedAbbreviation = normalizeSubtestAbbreviationTag(subtest.abbreviation);
    const cleanedName = stripDuplicateTrailingTag(subtest.name, normalizedAbbreviation);
    const normalizedNameKey = normalizeSubtestName(cleanedName || subtest.name);
    return {
      id: subtest.id,
      cleanedName: cleanedName || subtest.name,
      normalizedAbbreviation,
      normalizedNameKey,
    };
  });

  const counts = new Map<string, number>();
  prepared.forEach((entry) => {
    if (!entry.normalizedNameKey) return;
    counts.set(entry.normalizedNameKey, (counts.get(entry.normalizedNameKey) || 0) + 1);
  });

  const result = new Map<string, SubtestDisplayMeta>();
  prepared.forEach((entry) => {
    const isAmbiguous = !!entry.normalizedNameKey && (counts.get(entry.normalizedNameKey) || 0) > 1;
    const isHiddenInvalidAmbiguous = isAmbiguous && !entry.normalizedAbbreviation;
    result.set(entry.id, {
      id: entry.id,
      normalizedNameKey: entry.normalizedNameKey,
      normalizedAbbreviation: entry.normalizedAbbreviation,
      cleanedName: entry.cleanedName,
      displayName: buildConditionalSubtestDisplayName(entry.cleanedName, entry.normalizedAbbreviation, isAmbiguous),
      isAmbiguous,
      isHiddenInvalidAmbiguous,
    });
  });

  return result;
};
