import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Crédits et abonnement (#107, ADR 0002) : la migration est exécutée dans un vrai
// Postgres en mémoire (PGlite), sur un schéma réduit aux tables qu'elle touche. Les
// dépendances Supabase (auth, cron, PIN, admin) sont remplacées par des bouchons.
// Démarrer Postgres (WASM) prend plusieurs secondes quand toute la suite tourne en parallèle.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const MIGRATIONS = [
  '20261012100000_abonnement_stripe.sql',
  '20261012200000_formule_solo_essai_unique.sql',
  '20261013100000_stripe_robustesse.sql',
].map((file) => readFileSync(join(__dirname, 'migrations', file), 'utf8'));

const FIXTURE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role', true) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA cron;
CREATE TABLE cron.jobs (name text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.jobs VALUES (n, s, c) ON CONFLICT (name) DO UPDATE SET schedule = EXCLUDED.schedule; SELECT 1::bigint $$;

CREATE TABLE public.practitioners (
  id uuid PRIMARY KEY, email text NOT NULL, first_name text, last_name text,
  encryption_salt text DEFAULT 'pending' NOT NULL, encryption_validator text DEFAULT 'pending' NOT NULL,
  credits integer DEFAULT 3 NOT NULL CHECK (credits >= 0), is_admin boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES public.practitioners(id),
  plan_id text DEFAULT 'free' NOT NULL, status text DEFAULT 'trialing' NOT NULL,
  trial_ends_at timestamptz DEFAULT (now() + interval '30 days'), created_at timestamptz DEFAULT now(),
  current_period_end timestamptz, monthly_extraction_quota integer DEFAULT 100 NOT NULL
);
CREATE TABLE public.generation_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, status text DEFAULT 'pending' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL, refunded_at timestamptz, error_code text, kind text
);
CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text);
CREATE TABLE public.organization_members (organization_id uuid, user_id uuid, role text);

CREATE FUNCTION public.is_practitioner_pin_configured(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.check_is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.is_admin', true) = 'true' $$;
CREATE FUNCTION public.enforce_subscription_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.plan_id := 'free'; NEW.status := 'trialing';
  NEW.trial_ends_at := now() + interval '30 days'; NEW.current_period_end := now() + interval '30 days';
  RETURN NEW;
END $$;
`;

// Triggers posés en production avant la migration (elle ne remplace que leurs fonctions).
const TRIGGERS = `
CREATE TRIGGER on_practitioner_save BEFORE INSERT OR UPDATE ON public.practitioners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_practitioner_defaults();
CREATE TRIGGER on_subscription_insert BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_defaults();
`;

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';

type Balances = { credits: number; monthly_credits: number };
type Sub = { plan_id: string; status: string; billing_source: string | null; current_period_end: string | null };

let db: PGliteInterface;
// Base migrée sans données, préparée une fois et clonée pour chaque test.
let template: Promise<PGliteInterface> | null = null;

const balances = async (id: string): Promise<Balances> =>
  (await db.query<Balances>('SELECT credits, monthly_credits FROM practitioners WHERE id = $1', [id])).rows[0];
const sub = async (id: string): Promise<Sub> =>
  (await db.query<Sub>('SELECT plan_id, status, billing_source, current_period_end::text FROM subscriptions WHERE user_id = $1', [id]))
    .rows[0];
const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await db.query<Record<string, T>>(sql, params);
  return Object.values(rows[0])[0];
};
const consume = (id: string) => scalar<string | null>('SELECT consume_credit_for_user($1, $2)', [id, 'report_bio']);
const fail = (gen: string, id: string) => scalar<boolean>('SELECT finalize_generation_internal($1, $2, false, $3)', [gen, id, 'X']);
const applySub = (event: string, customer: string, plan: string, status: string) =>
  scalar<string>("SELECT billing_apply_subscription($1, $2, 'sub_1', $3, $4, now() + interval '1 month')", [event, customer, plan, status]);
const renew = (event: string, customer: string, plan: string) =>
  scalar<string>("SELECT billing_renew_credits($1, $2, 'sub_1', $3, now() + interval '1 month')", [event, customer, plan]);

/** Nouveau compte après la migration : soldes et essai imposés par les triggers. */
const signUp = async (id: string, customer?: string) => {
  await db.query('INSERT INTO practitioners (id, email) VALUES ($1, $2)', [id, `${id}@test.fr`]);
  await db.query('INSERT INTO subscriptions (user_id) VALUES ($1)', [id]);
  if (customer) await db.query('SELECT billing_set_customer($1, $2)', [id, customer]);
};

const build = async (seed = ''): Promise<PGliteInterface> => {
  const pg = new PGlite();
  await pg.exec(FIXTURE);
  if (seed) await pg.exec(seed);
  for (const migration of MIGRATIONS) await pg.exec(migration);
  await pg.exec(TRIGGERS);
  return pg;
};

const migrateWith = (seed: string) => migrate(seed);

const migrate = async (seed = '') => {
  if (seed) {
    db = await build(seed);
    return;
  }
  template ??= build();
  db = await (await template).clone();
};

describe('migration abonnement Stripe : comptes existants', () => {
  it('garde les soldes en crédits achetés, renouvelle les formules attribuées et clôt les essais expirés', async () => {
    await migrate(`
      INSERT INTO practitioners (id, email, credits, is_admin) VALUES
        ('${ALICE}', 'a@t.fr', 4, false), ('${BOB}', 'b@t.fr', 10, false), ('${ADMIN}', 'ad@t.fr', 3, true);
      INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at) VALUES
        ('${ALICE}', 'free', 'trialing', now() - interval '1 day'),
        ('${BOB}', 'expert', 'active', now() - interval '60 days'),
        ('${ADMIN}', 'free', 'trialing', now() + interval '5 days');
    `);
    // Essai expiré : sans formule, ses crédits (achetés) restent.
    expect(await balances(ALICE)).toEqual({ credits: 4, monthly_credits: 0 });
    expect(await sub(ALICE)).toMatchObject({ plan_id: 'free', status: 'inactive', billing_source: null });
    // Expert attribué à la main : Solo offerte, 30 crédits du mois, échéance dans un mois.
    expect(await balances(BOB)).toEqual({ credits: 10, monthly_credits: 30 });
    expect(await sub(BOB)).toMatchObject({ plan_id: 'solo', status: 'active', billing_source: 'offerte' });
    expect(new Date((await sub(BOB)).current_period_end!).getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    // Essai en cours : inchangé.
    expect(await sub(ADMIN)).toMatchObject({ status: 'trialing' });
    expect(await scalar<string>("SELECT schedule FROM cron.jobs WHERE name = 'billing_renew_and_expire'")).toBe('5 * * * *');
  });
});

describe('crédits', () => {
  beforeEach(() => migrate());

  it("donne 3 crédits d'essai en crédits du mois à l'inscription", async () => {
    await signUp(ALICE);
    expect(await balances(ALICE)).toEqual({ credits: 0, monthly_credits: 3 });
  });

  it("consomme les crédits du mois d'abord, puis les crédits achetés, puis refuse", async () => {
    await signUp(ALICE);
    await db.exec(`SET app.internal_operation = 'true'; UPDATE practitioners SET monthly_credits = 1, credits = 1 WHERE id = '${ALICE}';`);
    expect(await consume(ALICE)).not.toBeNull();
    expect(await balances(ALICE)).toEqual({ credits: 1, monthly_credits: 0 });
    expect(await consume(ALICE)).not.toBeNull();
    expect(await balances(ALICE)).toEqual({ credits: 0, monthly_credits: 0 });
    expect(await consume(ALICE)).toBeNull();
  });

  it('rend le crédit au solde qui a été débité', async () => {
    await signUp(ALICE);
    await db.exec(`SET app.internal_operation = 'true'; UPDATE practitioners SET monthly_credits = 1, credits = 1 WHERE id = '${ALICE}';`);
    const monthly = (await consume(ALICE))!;
    const purchased = (await consume(ALICE))!;
    await fail(purchased, ALICE);
    expect(await balances(ALICE)).toEqual({ credits: 1, monthly_credits: 0 });
    await fail(monthly, ALICE);
    expect(await balances(ALICE)).toEqual({ credits: 1, monthly_credits: 1 });
  });

  it("n'accorde plus d'illimité à Expert : seul l'admin génère sans crédit", async () => {
    await signUp(ALICE);
    await db.exec(`SET app.internal_operation = 'true';
      UPDATE practitioners SET monthly_credits = 0, credits = 0 WHERE id = '${ALICE}';
      UPDATE subscriptions SET plan_id = 'expert', status = 'active' WHERE user_id = '${ALICE}';`);
    expect(await consume(ALICE)).toBeNull();

    await signUp(ADMIN);
    await db.exec(
      `SET app.internal_operation = 'true'; UPDATE practitioners SET is_admin = true, monthly_credits = 0 WHERE id = '${ADMIN}';`,
    );
    const gen = (await consume(ADMIN))!;
    expect(gen).not.toBeNull();
    await fail(gen, ADMIN);
    expect(await balances(ADMIN)).toEqual({ credits: 0, monthly_credits: 0 });
  });

  it("autorise la génération sans formule tant qu'il reste des crédits achetés", async () => {
    await signUp(ALICE);
    await db.exec(`SET app.internal_operation = 'true';
      UPDATE practitioners SET monthly_credits = 0, credits = 2 WHERE id = '${ALICE}';
      UPDATE subscriptions SET status = 'inactive' WHERE user_id = '${ALICE}';`);
    expect(await consume(ALICE)).not.toBeNull();
  });

  it("ignore une modification des soldes faite par l'utilisateur", async () => {
    await signUp(ALICE);
    await db.exec(`SET test.role = 'authenticated'; SET app.internal_operation = 'false';
      UPDATE practitioners SET monthly_credits = 50, credits = 50, is_admin = true WHERE id = '${ALICE}';
      SET test.role = '';`);
    expect(await balances(ALICE)).toEqual({ credits: 0, monthly_credits: 3 });
  });
});

describe('webhook Stripe', () => {
  beforeEach(() => migrate());

  it("à la première formule payée, garde les crédits d'essai restants en crédits achetés", async () => {
    await signUp(ALICE, 'cus_a');
    await consume(ALICE); // 2 crédits d'essai restants
    expect(await applySub('evt_1', 'cus_a', 'performance', 'active')).toBe('applied');
    expect(await renew('evt_2', 'cus_a', 'performance')).toBe('applied');
    expect(await balances(ALICE)).toEqual({ credits: 2, monthly_credits: 6 });
    expect(await sub(ALICE)).toMatchObject({ plan_id: 'performance', status: 'active', billing_source: 'stripe' });
  });

  it("donne le même résultat si la facture arrive avant l'abonnement", async () => {
    await signUp(ALICE, 'cus_a');
    await renew('evt_2', 'cus_a', 'essential');
    await applySub('evt_1', 'cus_a', 'essential', 'active');
    expect(await balances(ALICE)).toEqual({ credits: 3, monthly_credits: 2 });
  });

  it("n'applique qu'une fois un événement renvoyé par Stripe", async () => {
    await signUp(ALICE, 'cus_a');
    await applySub('evt_1', 'cus_a', 'essential', 'active');
    expect(await scalar<string>("SELECT billing_add_credits('evt_9', 'cus_a', 2)")).toBe('applied');
    expect(await scalar<string>("SELECT billing_add_credits('evt_9', 'cus_a', 2)")).toBe('duplicate');
    expect(await balances(ALICE)).toEqual({ credits: 5, monthly_credits: 2 });
  });

  it('remet les crédits du mois au quota au renouvellement, sans report', async () => {
    await signUp(ALICE, 'cus_a');
    await applySub('evt_1', 'cus_a', 'performance', 'active');
    await renew('evt_2', 'cus_a', 'performance');
    await consume(ALICE);
    await renew('evt_3', 'cus_a', 'performance');
    expect((await balances(ALICE)).monthly_credits).toBe(6);
  });

  it('donne la différence de crédits au passage à une formule supérieure, rien à la baisse', async () => {
    await signUp(ALICE, 'cus_a');
    await applySub('evt_1', 'cus_a', 'essential', 'active');
    await renew('evt_2', 'cus_a', 'essential');
    await consume(ALICE); // 1 crédit du mois restant
    await applySub('evt_3', 'cus_a', 'performance', 'active');
    expect((await balances(ALICE)).monthly_credits).toBe(5);
    await applySub('evt_4', 'cus_a', 'essential', 'active');
    expect((await balances(ALICE)).monthly_credits).toBe(5);
  });

  it('ne redonne pas de crédits quand un paiement en retard est régularisé', async () => {
    await signUp(ALICE, 'cus_a');
    await applySub('evt_1', 'cus_a', 'essential', 'active');
    await renew('evt_2', 'cus_a', 'essential');
    await applySub('evt_3', 'cus_a', 'essential', 'past_due');
    expect(await sub(ALICE)).toMatchObject({ status: 'past_due' });
    await renew('evt_4', 'cus_a', 'essential');
    await applySub('evt_5', 'cus_a', 'essential', 'active');
    expect((await balances(ALICE)).monthly_credits).toBe(2);
  });

  it('à la résiliation, retire les crédits du mois et garde les crédits achetés', async () => {
    await signUp(ALICE, 'cus_a');
    await applySub('evt_1', 'cus_a', 'expert', 'active');
    await scalar("SELECT billing_add_credits('evt_2', 'cus_a', 4)");
    expect(await applySub('evt_3', 'cus_a', 'expert', 'canceled')).toBe('applied');
    expect(await balances(ALICE)).toEqual({ credits: 7, monthly_credits: 0 });
    expect(await sub(ALICE)).toMatchObject({ plan_id: 'free', status: 'canceled', billing_source: null });
  });

  it('signale un client Stripe inconnu sans rien modifier', async () => {
    await signUp(ALICE, 'cus_a');
    expect(await applySub('evt_1', 'cus_x', 'expert', 'active')).toBe('unknown_customer');
    expect(await balances(ALICE)).toEqual({ credits: 0, monthly_credits: 3 });
  });
});

describe('fin d’essai et formules offertes', () => {
  beforeEach(() => migrate());

  it("retire les crédits d'essai à la fin de l'essai, pas les crédits achetés", async () => {
    await signUp(ALICE, 'cus_a');
    await scalar("SELECT billing_add_credits('evt_1', 'cus_a', 2)");
    await db.exec(`UPDATE subscriptions SET trial_ends_at = now() - interval '1 minute' WHERE user_id = '${ALICE}'`);
    await db.query('SELECT billing_renew_and_expire()');
    expect(await balances(ALICE)).toEqual({ credits: 2, monthly_credits: 0 });
    expect(await sub(ALICE)).toMatchObject({ status: 'inactive', plan_id: 'free' });
  });

  it("renouvelle une formule offerte par l'admin chaque mois", async () => {
    await signUp(ALICE);
    await db.exec(`SET test.is_admin = 'true'`);
    await db.query(`SELECT admin_update_user($1, p_plan_id => 'performance', p_status => 'active')`, [ALICE]);
    expect(await balances(ALICE)).toEqual({ credits: 0, monthly_credits: 6 });
    expect(await sub(ALICE)).toMatchObject({ billing_source: 'offerte', status: 'active' });

    await consume(ALICE);
    await db.exec(`UPDATE subscriptions SET current_period_end = now() - interval '1 hour' WHERE user_id = '${ALICE}'`);
    await db.query('SELECT billing_renew_and_expire()');
    expect((await balances(ALICE)).monthly_credits).toBe(6);
    expect(new Date((await sub(ALICE)).current_period_end!).getTime()).toBeGreaterThan(Date.now());
  });

  it("ne transforme pas une formule payée en formule offerte quand l'admin la modifie", async () => {
    await signUp(ALICE, 'cus_a');
    await applySub('evt_1', 'cus_a', 'essential', 'active');
    await db.exec(`SET test.is_admin = 'true'`);
    await db.query(`SELECT admin_update_user($1, p_credits => 5)`, [ALICE]);
    await db.query(`SELECT admin_update_user($1, p_plan_id => 'expert')`, [ALICE]);
    expect(await sub(ALICE)).toMatchObject({ billing_source: 'stripe', plan_id: 'expert' });
    expect((await balances(ALICE)).credits).toBe(5);
  });

  it("retire la formule offerte quand l'admin la désactive", async () => {
    await signUp(ALICE);
    await db.exec(`SET test.is_admin = 'true'`);
    await db.query(`SELECT admin_update_user($1, p_plan_id => 'expert', p_status => 'active')`, [ALICE]);
    await db.query(`SELECT admin_update_user($1, p_plan_id => 'free', p_status => 'inactive', p_monthly_credits => 0)`, [ALICE]);
    expect(await sub(ALICE)).toMatchObject({ billing_source: null, status: 'inactive' });
    expect((await balances(ALICE)).monthly_credits).toBe(0);
  });
});

describe('formule Solo et essai unique (#107)', () => {
  beforeEach(() => migrate());

  it('donne 30 crédits du mois à la formule Solo, sans report', async () => {
    await signUp(ALICE, 'cus_a');
    expect(await applySub('evt_1', 'cus_a', 'solo', 'active')).toBe('applied');
    await renew('evt_2', 'cus_a', 'solo');
    await consume(ALICE);
    await renew('evt_3', 'cus_a', 'solo');
    expect(await balances(ALICE)).toEqual({ credits: 3, monthly_credits: 30 });
    expect(await sub(ALICE)).toMatchObject({ plan_id: 'solo', billing_source: 'stripe' });
  });

  it('refuse un second essai à la même adresse réelle (+étiquette, points Gmail, majuscules)', async () => {
    const trial = async (id: string, email: string) => {
      await db.query('INSERT INTO practitioners (id, email) VALUES ($1, $2)', [id, email]);
      return (
        await db.query<{ monthly_credits: number; trial_denied: boolean }>(
          'SELECT monthly_credits, trial_denied FROM practitioners WHERE id = $1',
          [id],
        )
      ).rows[0];
    };
    expect(await trial(ALICE, 'marie.dupont@gmail.com')).toEqual({ monthly_credits: 3, trial_denied: false });
    expect(await trial(BOB, 'Marie.Dupont+essai2@googlemail.com')).toEqual({ monthly_credits: 0, trial_denied: true });
    expect(await trial(ADMIN, 'marie.dupont@cabinet.fr')).toEqual({ monthly_credits: 3, trial_denied: false });
    // Hors Gmail, les points comptent : une autre personne du même domaine garde son essai.
    expect(await scalar<string>("SELECT email_trial_key('Jean.Martin+x@Cabinet.fr')")).toBe('jean.martin@cabinet.fr');
  });

  it("garde l'essai refusé même si le compte d'origine est supprimé", async () => {
    await db.query("INSERT INTO practitioners (id, email) VALUES ($1, 'a@test.fr')", [ALICE]);
    await db.query('DELETE FROM practitioners WHERE id = $1', [ALICE]);
    await db.query("INSERT INTO practitioners (id, email) VALUES ($1, 'a+bis@test.fr')", [BOB]);
    expect((await balances(BOB)).monthly_credits).toBe(0);
  });

  it("inscrit les adresses des comptes existants : un nouveau compte à la même adresse n'a pas d'essai", async () => {
    await migrateWith(`INSERT INTO practitioners (id, email, credits) VALUES ('${ALICE}', 'ancienne@gmail.com', 2);`);
    await db.query("INSERT INTO practitioners (id, email) VALUES ($1, 'an.cienne@gmail.com')", [BOB]);
    expect(await balances(BOB)).toEqual({ credits: 0, monthly_credits: 0 });
  });

  it("signale à l'admin les comptes qui partagent une adresse réelle", async () => {
    await db.query("INSERT INTO practitioners (id, email) VALUES ($1, 'x@gmail.com'), ($2, 'x+2@gmail.com')", [ALICE, BOB]);
    await db.exec(`SET test.is_admin = 'true'`);
    const { rows } = await db.query<{ trial_denied: boolean; accounts_with_same_key: number }>(
      'SELECT trial_denied, accounts_with_same_key FROM admin_list_trial_flags() ORDER BY trial_denied',
    );
    expect(rows).toEqual([
      { trial_denied: false, accounts_with_same_key: 2 },
      { trial_denied: true, accounts_with_same_key: 2 },
    ]);
  });
});

describe('robustesse du webhook Stripe (#111)', () => {
  beforeEach(() => migrate());

  const apply = (event: string, customer: string, subscription: string, status: string, userId: string | null = null) =>
    scalar<string>("SELECT billing_apply_subscription($1, $2, $3, 'solo', $4, now() + interval '1 month', $5)", [
      event,
      customer,
      subscription,
      status,
      userId,
    ]);
  const renewSub = (event: string, customer: string, subscription: string, userId: string | null = null) =>
    scalar<string>("SELECT billing_renew_credits($1, $2, $3, 'solo', now() + interval '1 month', $4)", [
      event,
      customer,
      subscription,
      userId,
    ]);
  const retained = (id: string) => scalar<string | null>('SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1', [id]);
  const customerOf = (id: string) => scalar<string | null>('SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1', [id]);

  it('ignore un second abonnement tant que celui retenu est actif', async () => {
    await signUp(ALICE, 'cus_a');
    await apply('evt_1', 'cus_a', 'sub_A', 'active');
    expect(await apply('evt_2', 'cus_a', 'sub_B', 'active')).toBe('ignored');
    expect(await retained(ALICE)).toBe('sub_A');
    expect(await renewSub('evt_3', 'cus_a', 'sub_B')).toBe('ignored');
    expect(await retained(ALICE)).toBe('sub_A');
  });

  it("retient l'autre abonnement une fois le premier résilié", async () => {
    await signUp(ALICE, 'cus_a');
    await apply('evt_1', 'cus_a', 'sub_A', 'active');
    await apply('evt_2', 'cus_a', 'sub_A', 'canceled');
    expect(await apply('evt_3', 'cus_a', 'sub_B', 'active')).toBe('applied');
    expect(await retained(ALICE)).toBe('sub_B');
    expect(await sub(ALICE)).toMatchObject({ status: 'active', billing_source: 'stripe' });
  });

  it("n'écrase pas le client Stripe déjà rattaché, sauf remplacement explicite", async () => {
    await signUp(ALICE, 'cus_1');
    expect(await scalar<boolean>("SELECT billing_set_customer($1, 'cus_2')", [ALICE])).toBe(false);
    expect(await customerOf(ALICE)).toBe('cus_1');
    expect(await scalar<boolean>("SELECT billing_set_customer($1, 'cus_1')", [ALICE])).toBe(true);
    expect(await scalar<boolean>("SELECT billing_set_customer($1, 'cus_3', 'cus_1')", [ALICE])).toBe(true);
    expect(await customerOf(ALICE)).toBe('cus_3');
  });

  it("retrouve le compte par l'identifiant de l'utilisateur quand le client Stripe n'est pas le sien", async () => {
    await signUp(ALICE, 'cus_1');
    expect(await apply('evt_1', 'cus_2', 'sub_A', 'active', ALICE)).toBe('applied');
    expect(await customerOf(ALICE)).toBe('cus_2');
    expect(await sub(ALICE)).toMatchObject({ plan_id: 'solo', status: 'active', billing_source: 'stripe' });
    expect(await scalar<string>("SELECT billing_add_credits('chk_1', 'cus_9', 2, $1)", [ALICE])).toBe('applied');
    expect((await balances(ALICE)).credits).toBe(5);
  });

  it("n'enregistre pas l'événement d'un client inconnu : un rejeu l'applique une fois le compte rattaché", async () => {
    await signUp(ALICE);
    expect(await scalar<string>("SELECT billing_add_credits('chk_1', 'cus_a', 2)")).toBe('unknown_customer');
    await db.query("SELECT billing_set_customer($1, 'cus_a')", [ALICE]);
    expect(await scalar<string>("SELECT billing_add_credits('chk_1', 'cus_a', 2)")).toBe('applied');
    expect(await scalar<string>("SELECT billing_add_credits('chk_1', 'cus_a', 2)")).toBe('duplicate');
    expect(await renewSub('in_1', 'cus_x', 'sub_A')).toBe('unknown_customer');
    expect(await apply('evt_1', 'cus_x', 'sub_A', 'active')).toBe('unknown_customer');
  });

  it("ne double pas les crédits du mois en passant d'une formule offerte à Solo payée", async () => {
    await signUp(ALICE, 'cus_a');
    await db.query("SET test.is_admin = 'true'");
    await db.query("SELECT admin_update_user($1, p_plan_id => 'solo', p_status => 'active')", [ALICE]);
    expect((await balances(ALICE)).monthly_credits).toBe(30);
    await apply('evt_1', 'cus_a', 'sub_A', 'active');
    expect((await balances(ALICE)).monthly_credits).toBe(30);
  });

  it('ne rend pas un crédit du mois au-delà du quota après un renouvellement', async () => {
    await signUp(ALICE, 'cus_a');
    await apply('evt_1', 'cus_a', 'sub_A', 'active');
    await renewSub('in_1', 'cus_a', 'sub_A');
    const gen = (await consume(ALICE))!;
    await renewSub('in_2', 'cus_a', 'sub_A');
    expect(await fail(gen, ALICE)).toBe(true);
    expect((await balances(ALICE)).monthly_credits).toBe(30);
  });

  it("ne rend pas un crédit d'essai après la fin de l'essai", async () => {
    await signUp(ALICE);
    const gen = (await consume(ALICE))!;
    await db.query("UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE user_id = $1", [ALICE]);
    await db.query('SELECT billing_renew_and_expire()');
    expect(await fail(gen, ALICE)).toBe(true);
    expect(await balances(ALICE)).toEqual({ credits: 0, monthly_credits: 0 });
  });

  it("rend toujours le crédit pendant l'essai et la formule", async () => {
    await signUp(ALICE);
    const gen = (await consume(ALICE))!;
    await fail(gen, ALICE);
    expect((await balances(ALICE)).monthly_credits).toBe(3);
  });
});
