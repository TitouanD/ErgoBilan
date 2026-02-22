export type EffectiveDirection = 'higher_better' | 'lower_better';
export type RawDirectionHint = 'auto' | 'higher_better' | 'lower_better' | undefined;
export type NormsStatusCode = 'ok' | 'no_norms' | 'no_applicable_age_gender' | 'onboarding_required' | 'access_restricted';

const AUTO_LOWER_DIRECTION_PATTERN = /(temps|latence|erreur|fautes|qualite|qualité|duree|durée|delai|délai)/i;

export const inferAutoDirection = (subtestName?: string): EffectiveDirection => (
  AUTO_LOWER_DIRECTION_PATTERN.test(String(subtestName || '')) ? 'lower_better' : 'higher_better'
);

export const resolveEffectiveDirection = (
  rawDirection: RawDirectionHint,
  subtestName?: string,
  pendingDirection?: EffectiveDirection,
): EffectiveDirection => {
  if (pendingDirection) return pendingDirection;
  if (rawDirection === 'higher_better') return 'higher_better';
  if (rawDirection === 'lower_better') return 'lower_better';
  return inferAutoDirection(subtestName);
};

export const getNormStatusMessage = (status?: NormsStatusCode): string | null => {
  if (!status) return null;
  if (status === 'no_norms') return 'Aucune norme importée pour ce sous-test. Saisie manuelle NS/ET/%.';
  if (status === 'no_applicable_age_gender') return "Normes présentes mais non applicables à l'âge/genre. Saisie manuelle NS/ET/%.";
  if (status === 'onboarding_required') return "Onboarding requis avant l'accès aux normes.";
  if (status === 'access_restricted') return 'Accès restreint aux normes de ce sous-test.';
  return null;
};

