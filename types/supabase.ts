/**
 * Supabase database types for the browser client.
 *
 * Generated from the live schema (`npx supabase gen types typescript --project-id hxlsjpkwrqunuqpaukmg`
 * or the Supabase MCP `generate_typescript_types` tool), then trimmed:
 *  - `Functions` only lists RPCs the browser is allowed to call. Service-role RPCs used by edge
 *    functions (consume_credit_for_user, finalize_generation_internal, …) are intentionally absent
 *    so the client cannot reference them.
 *  - `Relationships` are omitted (the app never uses embedded selects).
 * Regenerate and re-apply the same trimming after any schema change.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      ai_request_log: {
        Row: { created_at: string; id: number; user_id: string };
        Insert: { created_at?: string; id?: number; user_id: string };
        Update: { created_at?: string; id?: number; user_id?: string };
        Relationships: [];
      };
      generation_log: {
        Row: {
          created_at: string;
          error_code: string | null;
          id: string;
          kind: string | null;
          refunded_at: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          error_code?: string | null;
          id?: string;
          kind?: string | null;
          refunded_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          id?: string;
          kind?: string | null;
          refunded_at?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      official_categories: {
        Row: {
          description: string | null;
          icon_key: string;
          id: string;
          label: string;
          sort_order: number | null;
        };
        Insert: {
          description?: string | null;
          icon_key?: string;
          id: string;
          label: string;
          sort_order?: number | null;
        };
        Update: {
          description?: string | null;
          icon_key?: string;
          id?: string;
          label?: string;
          sort_order?: number | null;
        };
        Relationships: [];
      };
      official_subtests: {
        Row: {
          created_at: string | null;
          display_group_order: number | null;
          display_order: number | null;
          id: string;
          input_config: Json;
          input_model: string;
          name: string;
          organization_id: string | null;
          score_type: string;
          test_id: string;
          unit: string | null;
        };
        Insert: {
          created_at?: string | null;
          display_group_order?: number | null;
          display_order?: number | null;
          id: string;
          input_config?: Json;
          input_model?: string;
          name: string;
          organization_id?: string | null;
          score_type?: string;
          test_id: string;
          unit?: string | null;
        };
        Update: {
          created_at?: string | null;
          display_group_order?: number | null;
          display_order?: number | null;
          id?: string;
          input_config?: Json;
          input_model?: string;
          name?: string;
          organization_id?: string | null;
          score_type?: string;
          test_id?: string;
          unit?: string | null;
        };
        Relationships: [];
      };
      official_tests: {
        Row: {
          author: string | null;
          category_id: string;
          created_at: string | null;
          id: string;
          name: string;
          organization_id: string | null;
          version: string | null;
        };
        Insert: {
          author?: string | null;
          category_id: string;
          created_at?: string | null;
          id: string;
          name: string;
          organization_id?: string | null;
          version?: string | null;
        };
        Update: {
          author?: string | null;
          category_id?: string;
          created_at?: string | null;
          id?: string;
          name?: string;
          organization_id?: string | null;
          version?: string | null;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          joined_at: string | null;
          organization_id: string;
          role: string | null;
          user_id: string;
        };
        Insert: {
          joined_at?: string | null;
          organization_id: string;
          role?: string | null;
          user_id: string;
        };
        Update: {
          joined_at?: string | null;
          organization_id?: string;
          role?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: { created_at: string | null; id: string; name: string };
        Insert: { created_at?: string | null; id?: string; name?: string };
        Update: { created_at?: string | null; id?: string; name?: string };
        Relationships: [];
      };
      pending_questionnaires: {
        Row: {
          access_token: string | null;
          created_at: string | null;
          family_encrypted_data: string | null;
          id: string;
          label: string | null;
          organization_id: string | null;
          practitioner_encrypted_key: string;
          practitioner_id: string;
          status: string | null;
        };
        Insert: {
          access_token?: string | null;
          created_at?: string | null;
          family_encrypted_data?: string | null;
          id?: string;
          label?: string | null;
          organization_id?: string | null;
          practitioner_encrypted_key: string;
          practitioner_id: string;
          status?: string | null;
        };
        Update: {
          access_token?: string | null;
          created_at?: string | null;
          family_encrypted_data?: string | null;
          id?: string;
          label?: string | null;
          organization_id?: string | null;
          practitioner_encrypted_key?: string;
          practitioner_id?: string;
          status?: string | null;
        };
        Relationships: [];
      };
      practitioners: {
        Row: {
          address_pro: string | null;
          ai_style_preferences: string | null;
          branding_config: Json | null;
          created_at: string | null;
          credits: number;
          email: string;
          encryption_salt: string;
          encryption_validator: string;
          first_name: string | null;
          id: string;
          is_admin: boolean;
          last_name: string | null;
          phone_pro: string | null;
          siret: string | null;
        };
        Insert: {
          address_pro?: string | null;
          ai_style_preferences?: string | null;
          branding_config?: Json | null;
          created_at?: string | null;
          credits?: number;
          email: string;
          encryption_salt?: string;
          encryption_validator?: string;
          first_name?: string | null;
          id: string;
          is_admin?: boolean;
          last_name?: string | null;
          phone_pro?: string | null;
          siret?: string | null;
        };
        Update: {
          address_pro?: string | null;
          ai_style_preferences?: string | null;
          branding_config?: Json | null;
          created_at?: string | null;
          credits?: number;
          email?: string;
          encryption_salt?: string;
          encryption_validator?: string;
          first_name?: string | null;
          id?: string;
          is_admin?: boolean;
          last_name?: string | null;
          phone_pro?: string | null;
          siret?: string | null;
        };
        Relationships: [];
      };
      signup_rate_limit_log: {
        Row: { created_at: string; email_hash: string | null; id: number; ip_hash: string };
        Insert: { created_at?: string; email_hash?: string | null; id?: number; ip_hash: string };
        Update: { created_at?: string; email_hash?: string | null; id?: number; ip_hash?: string };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string | null;
          current_period_end: string | null;
          id: string;
          monthly_extraction_quota: number;
          plan_id: string;
          status: string;
          trial_ends_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          current_period_end?: string | null;
          id?: string;
          monthly_extraction_quota?: number;
          plan_id?: string;
          status?: string;
          trial_ends_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          current_period_end?: string | null;
          id?: string;
          monthly_extraction_quota?: number;
          plan_id?: string;
          status?: string;
          trial_ends_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      view_unified_catalog: {
        Row: {
          category_id: string | null;
          category_label: string | null;
          icon_key: string | null;
          id: string | null;
          label: string | null;
          sort_order: number | null;
          subtests_count: number | null;
        };
        Relationships: [];
      };
      view_unified_subtests: {
        Row: {
          display_group_order: number | null;
          display_order: number | null;
          id: string | null;
          input_config: Json | null;
          input_model: string | null;
          name: string | null;
          score_type: string | null;
          test_id: string | null;
          unit: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      admin_check: { Args: Record<PropertyKey, never>; Returns: boolean };
      admin_delete_subtest: { Args: { p_subtest_id: string }; Returns: undefined };
      admin_delete_test: { Args: { p_test_id: string }; Returns: undefined };
      admin_get_ai_health_stats: { Args: Record<PropertyKey, never>; Returns: Json };
      admin_get_test_detail: { Args: { p_test_id: string }; Returns: Json };
      admin_list_tests: {
        Args: { p_scope?: string };
        Returns: {
          category_id: string;
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
          pending_norms_count: number;
          subtest_count: number;
        }[];
      };
      admin_list_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_at: string;
          credits: number;
          current_period_end: string;
          email: string;
          first_name: string;
          is_admin: boolean;
          last_name: string;
          monthly_extraction_quota: number;
          organization_id: string;
          organization_name: string;
          organization_role: string;
          subscription_plan: string;
          subscription_status: string;
          trial_ends_at: string;
          user_id: string;
        }[];
      };
      admin_save_test_detail: {
        Args: {
          p_deleted_subtest_ids?: string[];
          p_subtests: Json;
          p_test_data: Json;
          p_test_id: string;
        };
        Returns: undefined;
      };
      admin_update_user: {
        Args: {
          p_credits?: number;
          p_current_period_end?: string;
          p_is_admin?: boolean;
          p_monthly_extraction_quota?: number;
          p_plan_id?: string;
          p_status?: string;
          p_trial_ends_at?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      bootstrap_org_for_user: { Args: { p_org_name?: string; p_user_id: string }; Returns: string };
      bootstrap_practitioner_for_user: { Args: { p_email: string; p_user_id: string }; Returns: boolean };
      check_is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      check_is_member_of: { Args: { org_id: string }; Returns: boolean };
      is_current_user_onboarded: { Args: Record<PropertyKey, never>; Returns: boolean };
      practitioner_save_custom_test: { Args: { payload: Json }; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];

/** Row type of a table or view: `Tables<'practitioners'>`. */
export type Tables<T extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])> = (PublicSchema['Tables'] &
  PublicSchema['Views'])[T] extends { Row: infer R }
  ? R
  : never;

export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
