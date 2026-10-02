import type { Session } from '@supabase/supabase-js';

export declare const mintTestSession: (config: {
  url: string;
  publishableKey: string;
  secretKey?: string;
  email?: string;
}) => Promise<Session>;
