import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, Search, Shield, Users2 } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type { AdminUserRow } from '../../types';

type PlanId = 'free' | 'essential' | 'performance' | 'expert';
type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'past_due' | 'inactive';

interface UserDraft {
  isAdmin: boolean;
  credits: number;
  planId: PlanId;
  status: SubscriptionStatus;
  monthlyExtractionQuota: number;
}

const PLAN_OPTIONS: PlanId[] = ['free', 'essential', 'performance', 'expert'];
const STATUS_OPTIONS: SubscriptionStatus[] = ['active', 'trialing', 'canceled', 'past_due', 'inactive'];

const normalizePlan = (value: string): PlanId => (
  PLAN_OPTIONS.includes(value as PlanId) ? (value as PlanId) : 'free'
);

const normalizeStatus = (value: string): SubscriptionStatus => (
  STATUS_OPTIONS.includes(value as SubscriptionStatus) ? (value as SubscriptionStatus) : 'inactive'
);

const toDraft = (row: AdminUserRow): UserDraft => ({
  isAdmin: !!row.is_admin,
  credits: Number.isFinite(row.credits) ? row.credits : 0,
  planId: normalizePlan(row.subscription_plan || 'free'),
  status: normalizeStatus(row.subscription_status || 'inactive'),
  monthlyExtractionQuota: Number.isFinite(row.monthly_extraction_quota) ? row.monthly_extraction_quota : 0,
});

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
      setDrafts(rows.reduce<Record<string, UserDraft>>((acc, row) => {
        acc[row.user_id] = toDraft(row);
        return acc;
      }, {}));
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
        row.email.toLowerCase().includes(q)
        || row.user_id.toLowerCase().includes(q)
        || fullName.includes(q)
        || (row.organization_name || '').toLowerCase().includes(q)
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
      draft.isAdmin !== base.isAdmin
      || draft.credits !== base.credits
      || draft.planId !== base.planId
      || draft.status !== base.status
      || draft.monthlyExtractionQuota !== base.monthlyExtractionQuota
    );
  };

  const handleSaveUser = async (row: AdminUserRow) => {
    const draft = drafts[row.user_id];
    if (!draft) return;
    setSavingUserId(row.user_id);
    try {
      await AdminService.updateUser({
        userId: row.user_id,
        isAdmin: draft.isAdmin,
        credits: Math.max(0, Math.trunc(draft.credits)),
        planId: draft.planId,
        status: draft.status,
        monthlyExtractionQuota: Math.max(0, Math.trunc(draft.monthlyExtractionQuota)),
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
              Gestion admin: droits, crédits, plan et statut de souscription.
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
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[#E07A5F]"
          />
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-black/20 text-stone-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Utilisateur</th>
                <th className="text-left px-3 py-2">Organisation</th>
                <th className="text-center px-3 py-2">Admin</th>
                <th className="text-center px-3 py-2">Crédits</th>
                <th className="text-center px-3 py-2">Plan</th>
                <th className="text-center px-3 py-2">Statut</th>
                <th className="text-center px-3 py-2">Quota OCR</th>
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
                      <div className="font-bold text-white">
                        {`${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email}
                      </div>
                      <div className="text-[10px] text-stone-500">{row.email}</div>
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
                      <select
                        value={draft.planId}
                        onChange={(e) => updateDraft(row.user_id, { planId: normalizePlan(e.target.value) })}
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white"
                      >
                        {PLAN_OPTIONS.map((plan) => (
                          <option key={plan} value={plan} className="bg-[#23252F] text-stone-200">{plan}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select
                        value={draft.status}
                        onChange={(e) => updateDraft(row.user_id, { status: normalizeStatus(e.target.value) })}
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status} className="bg-[#23252F] text-stone-200">{status}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        value={draft.monthlyExtractionQuota}
                        onChange={(e) => updateDraft(row.user_id, { monthlyExtractionQuota: Number(e.target.value || 0) })}
                        className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-center text-white"
                      />
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
