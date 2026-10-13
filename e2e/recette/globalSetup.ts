/**
 * Before the recette: the test account is configured, nobody else uses it
 * (shared lock), and one session is opened for all the workers. A single one:
 * opening another session of the account leaves the previous ones without their
 * scenarios. Its access token lasts an hour, longer than the recette. The
 * session file is deleted at the end.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { lockTestAccount, readTestAccount, supabaseConfig, unlockTestAccount } from '../testAccount.mjs';
import { mintTestSession } from '../testSession.mjs';

export const SESSION_FILE = '.recette/session.json';

export default async function globalSetup() {
  const account = readTestAccount();
  lockTestAccount();
  const cleanup = () => {
    rmSync(SESSION_FILE, { force: true });
    unlockTestAccount();
  };
  try {
    const { url, key } = supabaseConfig();
    const session = await mintTestSession({ url, publishableKey: key, secretKey: account.secretKey, email: account.email });
    mkdirSync(dirname(SESSION_FILE), { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(session));
  } catch (e) {
    cleanup();
    throw e;
  }
  return cleanup;
}
