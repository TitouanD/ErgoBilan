/**
 * testSession.mjs — a fresh session of the dedicated test account for every
 * run, shared by `npm run capture` (capture.mjs) and `npm run e2e:ai`
 * (liveEdge.ts). See docs/AI_PIPELINE.md §9.
 *
 * A Supabase secret key (`E2E_SECRET`, a key dedicated to these scripts and
 * revocable alone) asks the auth admin API for a magic link of `E2E_EMAIL`,
 * which is verified at once with the publishable key: no e-mail is sent, and
 * Turnstile, which only guards the password sign-in, is not involved. Nothing
 * is kept between runs, so no refresh token can be rotated away and lost.
 *
 * Both keys and the e-mail come from `.env.e2e.local` (main checkout, never
 * committed). The secret key never reaches the browser or the app code.
 */

import { createClient } from '@supabase/supabase-js';

const NO_STORAGE = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * @param {{ url: string; publishableKey: string; secretKey?: string; email?: string }} config
 * @returns {Promise<import('@supabase/supabase-js').Session>}
 */
export const mintTestSession = async ({ url, publishableKey, secretKey, email }) => {
  if (!secretKey || !email) {
    throw new Error('E2E_SECRET et E2E_EMAIL requis dans .env.e2e.local (docs/AI_PIPELINE.md §9).');
  }
  const admin = createClient(url, secretKey, NO_STORAGE);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new Error(
      `Lien de connexion du compte de test refusé (${linkError?.message ?? 'pas de jeton'}) : vérifier E2E_SECRET et E2E_EMAIL.`,
    );
  }
  const client = createClient(url, publishableKey, NO_STORAGE);
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data.session) {
    throw new Error(`Session du compte de test non ouverte (${error?.message ?? 'pas de session'}).`);
  }
  return data.session;
};
