/**
 * Test environment access (dev.ergobilan.com).
 *
 * `VITE_TEST_ACCESS_EMAILS` (comma-separated, set on Vercel for the `dev`
 * branch only) restricts the signed-in app to the listed accounts. Unset or
 * empty: no restriction (production, local). This is not a security boundary —
 * dev shares the production Supabase, so a bypass grants nothing more than
 * production does — it only keeps real users out of unfinished builds.
 * Demo mode is never restricted.
 */

declare const __APP_ENV__: string;

export const parseAccessList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

/** True when `email` may use the app; an empty list allows everyone. */
export const isEmailAllowed = (email: string | null | undefined, accessList: string[]): boolean =>
  accessList.length === 0 || (!!email && accessList.includes(email.trim().toLowerCase()));

export const TEST_ACCESS_LIST = parseAccessList(import.meta.env.VITE_TEST_ACCESS_EMAILS);

/** Vercel preview builds (dev branch): show the "test version" badge. */
export const IS_TEST_BUILD = __APP_ENV__ === 'preview';
