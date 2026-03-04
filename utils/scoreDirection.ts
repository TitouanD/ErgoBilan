export type EffectiveDirection = 'higher_better' | 'lower_better';
export type RawDirectionHint = 'auto' | 'higher_better' | 'lower_better' | undefined;
export type NormsStatusCode = 'ok' | 'no_norms' | 'no_applicable_age_gender' | 'onboarding_required' | 'access_restricted';

/**
 * LAST-RESORT fallback pattern for direction inference when `raw_direction = 'auto'`.
 *
 * Scope:
 *   - All official subtests have an explicit `raw_direction` (`higher_better` or
 *     `lower_better`) set by migration 20260302000001 (Part 7). They should NEVER
 *     reach this regex.
 *   - Private / contributed subtests default to `'auto'` in `official_subtests`
 *     until an admin reviews them. This regex is the safety net for those.
 *
 * Identical pattern present server-side:
 *   The same keyword list lives inside `compute_score_core` (DB function) as its own
 *   fallback. When triggered there, it appends `'direction_auto_applied'` to the
 *   score warnings array — that warning code is what `admin_list_direction_issues()`
 *   surfaces in the admin panel.
 *
 * Action required when triggered in production:
 *   Open the AdminLibrary > subtest editor and set an explicit `raw_direction`.
 *   Alternatively use the direction toggle in Step2 (creates an org-scoped clone).
 */
const AUTO_LOWER_DIRECTION_PATTERN = /(temps|latence|erreur|fautes|qualite|qualité|duree|durée|delai|délai)/i;

/**
 * Heuristic inference — called only when `raw_direction === 'auto'`.
 * Returns `'lower_better'` when the subtest name matches the pattern above,
 * `'higher_better'` otherwise (safe default).
 */
export const inferAutoDirection = (subtestName?: string): EffectiveDirection => (
  AUTO_LOWER_DIRECTION_PATTERN.test(String(subtestName || '')) ? 'lower_better' : 'higher_better'
);

/**
 * Resolves the effective scoring direction for a subtest.
 *
 * Priority:
 *   1. `pendingDirection` — user's in-session toggle (not yet persisted as clone)
 *   2. Explicit `raw_direction` from DB (`higher_better` | `lower_better`)
 *   3. `inferAutoDirection()` — name-based heuristic (last resort, `raw_direction === 'auto'`)
 */
export const resolveEffectiveDirection = (
  rawDirection: RawDirectionHint,
  subtestName?: string,
  pendingDirection?: EffectiveDirection,
): EffectiveDirection => {
  if (pendingDirection) return pendingDirection;
  if (rawDirection === 'higher_better') return 'higher_better';
  if (rawDirection === 'lower_better') return 'lower_better';
  return inferAutoDirection(subtestName); // only reached when rawDirection === 'auto'
};

export const getNormStatusMessage = (status?: NormsStatusCode): string | null => {
  if (!status) return null;
  if (status === 'no_norms') return 'Aucune norme importée pour ce sous-test. Saisie manuelle NS/ET/%.';
  if (status === 'no_applicable_age_gender') return "Normes présentes mais non applicables à l'âge/genre. Saisie manuelle NS/ET/%.";
  if (status === 'onboarding_required') return "Onboarding requis avant l'accès aux normes.";
  if (status === 'access_restricted') return 'Accès restreint aux normes de ce sous-test.';
  return null;
};

