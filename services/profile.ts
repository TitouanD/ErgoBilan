/**
 * ProfileService — practitioner profile, subscription status and report branding (Supabase).
 */

import { supabase } from './db';
import type { BrandingConfig, UserProfile } from '../types';
import type { Json } from '../types/supabase';
import { DEFAULT_BRANDING, PROFILE_BRANDING_FIELDS } from '../data/brandingDefaults';
import { Logger } from '../utils/logger';

const PLANS: ReadonlyArray<UserProfile['subscriptionPlan']> = ['free', 'solo', 'essential', 'performance', 'expert'];
const STATUSES: ReadonlyArray<UserProfile['status']> = ['active', 'trialing', 'canceled', 'past_due', 'inactive'];

const asPlan = (value: string | null | undefined): UserProfile['subscriptionPlan'] =>
  PLANS.includes(value as UserProfile['subscriptionPlan']) ? (value as UserProfile['subscriptionPlan']) : 'free';
const asStatus = (value: string | null | undefined): UserProfile['status'] =>
  STATUSES.includes(value as UserProfile['status']) ? (value as UserProfile['status']) : 'inactive';

/** Saved branding (partial, without identity fields) merged over the defaults, identity taken from the profile. */
const buildBranding = (
  saved: Json | null,
  identity: { practitionerName: string; email: string; phone: string; address: string; siret: string },
): BrandingConfig => {
  const stored = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Partial<BrandingConfig>) : {};
  return { ...DEFAULT_BRANDING, ...stored, ...identity };
};

export const ProfileService = {
  /** Profile + subscription + branding. Returns null when the practitioner row cannot be read. */
  getUserProfile: async (userId: string): Promise<UserProfile | null> => {
    try {
      const { data: prac, error: pracError } = await supabase
        .from('practitioners')
        .select(
          'email, credits, monthly_credits, trial_denied, is_admin, first_name, last_name, phone_pro, siret, address_pro, branding_config',
        )
        .eq('id', userId)
        .single();
      if (pracError || !prac) throw pracError ?? new Error('Practitioner not found');

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan_id, status, trial_ends_at, current_period_end, billing_source')
        .eq('user_id', userId)
        .maybeSingle();

      let isTrial = false;
      let trialDaysRemaining = 0;
      // A refused trial (#107) keeps status 'trialing' with no trial credit: not a trial for the screens (#112).
      if (sub?.status === 'trialing' && sub.trial_ends_at && !prac.trial_denied) {
        const remainingMs = new Date(sub.trial_ends_at).getTime() - Date.now();
        if (remainingMs > 0) {
          isTrial = true;
          trialDaysRemaining = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
        }
      }

      return {
        id: userId,
        email: prac.email,
        credits: (prac.credits || 0) + (prac.monthly_credits || 0),
        monthlyCredits: prac.monthly_credits || 0,
        purchasedCredits: prac.credits || 0,
        isAdmin: prac.is_admin || false,
        subscriptionPlan: asPlan(sub?.plan_id),
        status: sub ? asStatus(sub.status) : 'inactive',
        billingSource: sub?.billing_source === 'stripe' || sub?.billing_source === 'offerte' ? sub.billing_source : null,
        currentPeriodEnd: sub?.current_period_end ?? null,
        trialDenied: prac.trial_denied ?? false,
        isTrial,
        trialDaysRemaining,
        totalBilansGenerated: 0,
        hasAcceptedResponsibility: false,
        branding: buildBranding(prac.branding_config, {
          practitionerName: `${prac.first_name || ''} ${prac.last_name || ''}`.trim(),
          email: prac.email,
          phone: prac.phone_pro || '',
          address: prac.address_pro || '',
          siret: prac.siret || '',
        }),
      };
    } catch (e) {
      Logger.error('DB', 'Erreur chargement profil:', e);
      return null;
    }
  },

  /** Persist the report branding (identity fields are stripped: they belong to the profile). */
  saveBranding: async (userId: string, branding: BrandingConfig): Promise<void> => {
    const toStore: Record<string, unknown> = { ...branding };
    for (const field of PROFILE_BRANDING_FIELDS) delete toStore[field];
    const { error } = await supabase
      .from('practitioners')
      .update({ branding_config: toStore as Json })
      .eq('id', userId);
    if (error) throw error;
  },

  /** Current AI style preferences (JSON string learned from the practitioner's corrections). */
  getAiStylePreferences: async (userId: string): Promise<string | undefined> => {
    const { data } = await supabase.from('practitioners').select('ai_style_preferences').eq('id', userId).maybeSingle();
    return data?.ai_style_preferences || undefined;
  },
};
