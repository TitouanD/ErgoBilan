import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, Search, Shield, Users2 } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type { AdminUserRow } from '../../types';

type PlanId = 'free' | 'solo' | 'essential' | 'performance' | 'expert';
type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'past_due' | 'inactive';

interface UserDraft {
  isAdmin: boolean;
  /** Crédits achetés */
  credits: number;
  /** Crédits du mois */
  monthlyCredits: number;
  planId: PlanId;
  status: SubscriptionStatus;
}

const PLAN_OPTIONS: PlanId[] = ['free', 'solo', 'essential', 'performance', 'expert'];
const STATUS_OPTIONS: SubscriptionStatus[] = ['active', 'trialing', 'canceled', 'past_due', 'inactive'];

const normalizePlan = (value: string): PlanId => (PLAN_OPTIONS.includes(value as PlanId) ? (value as PlanId) : 'free');

const normalizeStatus = (value: string): SubscriptionStatus =>
  STATUS_OPTIONS.includes(value as SubscriptionStatus) ? (value as SubscriptionStatus) : 'inactive';

const toDraft = (row: AdminUserRow): UserDraft => ({
  isAdmin: !!row.is_admin,
  credits: Number.isFinite(row.credits) ? row.credits : 0,
  monthlyCredits: Number.isFinite(row.monthly_credits) ? row.monthly_credits : 0,
  planId: normalizePlan(row.subscription_plan || 'free'),
  status: normalizeStatus(row.subscription_status || 'inactive'),
});

/** Who pays the plan: Stripe (changed by the practitioner in the portal) or nobody (granted here). */
const SOURCE_LABELS: Record<string, string> = { stripe: 'payée (Stripe)', offerte: 'offerte' };

export const AdminUsers: React.FC = () => {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const rows = await AdminService.listUsers();
      setUsers(rows);
      setDrafts(
        rows.reduce<Record<string, UserDraft>>((acc, row) => {
          acc[row.user_id] = toDraft(row);
          return acc;
        }, {}),
      );
    } catch (e) {
      Logger.error('DB', 'Failed to load admin users', e);
      toast.error('Impossible de charger les utilisateurs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((row) => {
      const fullName = `${row.first_name || ''} ${row.last_name || ''}`.trim().toLowerCase();
      return (
        row.email.toLowerCase().includes(q) ||
        row.user_id.toLowerCase().includes(q) ||
        fullName.includes(q) ||
        (row.organization_name || '').toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  const updateDraft = (userId: string, patch: Partial<UserDraft>) => {
    setDrafts((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  };

  const hasChanges = (row: AdminUserRow): boolean => {
    const draft = drafts[row.user_id];
    if (!draft) return false;
    const base = toDraft(row);
    return (
      draft.isAdmin !== base.isAdmin ||
      draft.credits !== base.credits ||
      draft.monthlyCredits !== base.monthlyCredits ||
      draft.planId !== base.planId ||
      draft.status !== base.status
    );
  };

  const handleSaveUser = async (row: AdminUserRow) => {
    const draft = drafts[row.user_id];
    if (!draft) return;
    const base = toDraft(row);
    setSavingUserId(row.user_id);
    try {
      // Only the changed fields: an active paid plan given here becomes an « offerte » plan,
      // with its monthly credits granted at once unless they were edited too.
      await AdminService.updateUser({
        userId: row.user_id,
        isAdmin: draft.isAdmin,
        credits: Math.max(0, Math.trunc(draft.credits)),
        ...(draft.monthlyCredits !== base.monthlyCredits ? { monthlyCredits: Math.max(0, Math.trunc(draft.monthlyCredits)) } : {}),
        ...(draft.planId !== base.planId ? { planId: draft.planId } : {}),
        ...(draft.status !== base.status ? { status: draft.status } : {}),
      });
      toast.success('Utilisateur mis à jour.');
      await loadUsers();
    } catch (e) {
      Logger.error('DB', 'Failed to update user settings', e);
      toast.error("Erreur lors de l'enregistrement utilisateur.");
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-white text-base font-bold flex items-center gap-2">
              <Users2 size={16} className="text-cyan-300" /> Utilisateurs & abonnements
            </h3>
            <p className="text-[11px] text-stone-500 mt-1">
              Droits, crédits et formule. Une formule active donnée ici est offerte : ses crédits du mois se renouvellent chaque mois. Une
              formule payée se change par la cliente dans son espace Stripe.
            </p>
          </div>
          <button
            onClick={() => void loadUsers()}
            disabled={isLoading}
            className="text-xs text-cyan-300 hover:text-cyan-200 flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 rounded-lg disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Actualiser
          </button>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-stone-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un utilisateur..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-black/20 text-stone-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Utilisateur</th>
                <th className="text-left px-3 py-2">Organisation</th>
                <th className="text-center px-3 py-2">Admin</th>
                <th className="text-center px-3 py-2">Crédits achetés</th>
                <th className="text-center px-3 py-2">Crédits du mois</th>
                <th className="text-center px-3 py-2">Formule</th>
                <th className="text-center px-3 py-2">Statut</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((row) => {
                const draft = drafts[row.user_id] || toDraft(row);
                const dirty = hasChanges(row);
                return (
                  <tr key={row.user_id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <div className="font-bold text-white">{`${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email}</div>
                      <div className="text-[10px] text-stone-500">{row.email}</div>
                      {(row.trial_denied || (row.accounts_with_same_key ?? 1) > 1) && (
                        <div className="text-[10px] font-bold text-amber-400">
                          {row.trial_denied ? 'Essai refusé (adresse déjà utilisée)' : ''}
                          {row.trial_denied && (row.accounts_with_same_key ?? 1) > 1 ? ' · ' : ''}
                          {(row.accounts_with_same_key ?? 1) > 1 ? `${row.accounts_with_same_key} comptes, même adresse réelle` : ''}
                        </div>
                      )}
                      <div className="text-[10px] text-stone-600">{row.user_id}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-stone-300">{row.organization_name || '—'}</div>
                      <div className="text-[10px] text-stone-500">{row.organization_role || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <label className="inline-flex items-center gap-1.5 text-[10px] text-stone-400">
                        <input
                          type="checkbox"
                          checked={draft.isAdmin}
                          onChange={(e) => updateDraft(row.user_id, { isAdmin: e.target.checked })}
                          className="accent-cyan-400"
                        />
                        <Shield size={10} className={draft.isAdmin ? 'text-cyan-300' : 'text-stone-600'} />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        value={draft.credits}
                        onChange={(e) => updateDraft(row.user_id, { credits: Number(e.target.value || 0) })}
                        className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-center text-white"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        aria-label="Crédits du mois"
                        value={draft.monthlyCredits}
                        onChange={(e) => updateDraft(row.user_id, { monthlyCredits: Number(e.target.value || 0) })}
                        className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-center text-white"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select
                        value={draft.planId}
                        onChange={(e) => updateDraft(row.user_id, { planId: normalizePlan(e.target.value) })}
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white"
                      >
                        {PLAN_OPTIONS.map((plan) => (
                          <option key={plan} value={plan} className="bg-[#23252F] text-stone-200">
                            {plan}
                          </option>
                        ))}
                      </select>
                      {row.billing_source && (
                        <div className="mt-1 text-[10px] text-stone-500">{SOURCE_LABELS[row.billing_source] ?? row.billing_source}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select
                        value={draft.status}
                        onChange={(e) => updateDraft(row.user_id, { status: normalizeStatus(e.target.value) })}
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status} className="bg-[#23252F] text-stone-200">
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => void handleSaveUser(row)}
                        disabled={!dirty || savingUserId === row.user_id}
                        className="text-[10px] text-cyan-300 hover:text-cyan-200 bg-cyan-500/10 px-2 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 ml-auto"
                      >
                        {savingUserId === row.user_id ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                        Enregistrer
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!isLoading && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-stone-500">
                    Aucun utilisateur trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
