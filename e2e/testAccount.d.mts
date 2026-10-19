import type { Session } from '@supabase/supabase-js';

export declare const AUTH_KEY: string;
export declare const ENV_FILE: string;
export declare const readTestAccount: () => { secretKey: string; email: string; pin: string };
export declare const supabaseConfig: (root?: string) => { url: string; key: string };
export declare const lockTestAccount: () => void;
export declare const unlockTestAccount: () => void;
export declare const sessionInitScript: (session: Session) => {
  script: (arg: { key: string; value: string }) => void;
  arg: { key: string; value: string };
};
export declare const typePin: (page: import('@playwright/test').Page, pin: string) => Promise<void>;
