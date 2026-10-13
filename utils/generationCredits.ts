import type { UserProfile } from '../types';

type CreditProfile = Pick<UserProfile, 'credits' | 'isAdmin'>;

/** Same rule as consume_credit_for_user: monthly + purchased credits; the admin generates without credit. */
export const canGenerate = (profile: CreditProfile): boolean => profile.isAdmin || profile.credits > 0;

/**
 * Credits for a generation: the profile in memory, else the profile read again. A renewal
 * (cron or Stripe), an admin grant or a purchase in another tab is not in memory, and the
 * credit wall must not show a stale balance (#112). `refresh` resolves null when it fails.
 */
export const confirmGenerationCredits = async (profile: CreditProfile, refresh: () => Promise<CreditProfile | null>): Promise<boolean> => {
  if (canGenerate(profile)) return true;
  const fresh = await refresh();
  return !!fresh && canGenerate(fresh);
};
