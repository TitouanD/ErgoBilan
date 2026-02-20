import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Search, ShieldAlert, Wrench } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type { AdminIssueBacklogItem } from '../../types';

interface Props {
  onOpenTest: (testId: string) => void;
}

export const AdminIssuesBoard: React.FC<Props> = ({ onOpenTest }) => {
  const toast = useToast();
  const [issues, setIssues] = useState<AdminIssueBacklogItem[]>([]);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'public' | 'private'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [dedupingTestId, setDedupingTestId] = useState<string | null>(null);

  const loadIssues = async () => {
    setIsLoading(true);
    try {
      const rows = await AdminService.listIssueBacklog();
      setIssues(rows);
    } catch (e) {
      Logger.error('DB', 'Failed to load global issues backlog', e);
      toast.error("Impossible de charger l'onglet Issues.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadIssues();
  }, []);

  const visibleIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((row) => {
      if (scope === 'public' && row.organization_id !== null) return false;
      if (scope === 'private' && row.organization_id === null) return false;
      if (!q) return true;
      return row.test_name.toLowerCase().includes(q) || row.test_id.toLowerCase().includes(q);
    });
  }, [issues, scope, search]);

  const summary = useMemo(() => (
    visibleIssues.reduce((acc, row) => {
      acc.tests += 1;
      acc.total += row.total_issues || 0;
      acc.missingTags += row.missing_ambiguous_tags || 0;
      acc.dupSubtests += row.duplicate_subtest_excess || 0;
      acc.dupNorms += row.duplicate_norm_excess || 0;
      acc.quality += row.quality_flag_count || 0;
      return acc;
    }, { tests: 0, total: 0, missingTags: 0, dupSubtests: 0, dupNorms: 0, quality: 0 })
  ), [visibleIssues]);

  const handleDeduplicateNorms = async (testId: string) => {
    setDedupingTestId(testId);
    try {
      const result = await AdminService.deduplicateNorms({ testId });
      toast.success(`${result.deleted} norme(s) dédupliquée(s).`);
      await loadIssues();
    } catch (e) {
      Logger.error('DB', 'Global deduplicate norms failed', e);
      toast.error('Erreur pendant la déduplication.');
    } finally {
      setDedupingTestId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-white text-base font-bold flex items-center gap-2">
              <ShieldAlert size={16} className="text-amber-400" /> Backlog global des issues
            </h3>
            <p className="text-[11px] text-stone-500 mt-1">
              Vue cross-tests: tags manquants, doublons et qualité des normes.
            </p>
          </div>
          <button
            onClick={() => void loadIssues()}
            disabled={isLoading}
            className="text-xs text-amber-300 hover:text-amber-200 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 rounded-lg disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Actualiser
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-6 gap-2">
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-[10px] uppercase text-stone-500 font-bold">Tests</div>
            <div className="text-lg text-white font-bold">{summary.tests}</div>
          </div>
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-rose-300 font-bold">Issues</div>
            <div className="text-lg text-white font-bold">{summary.total}</div>
          </div>
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-rose-300 font-bold">Tags manquants</div>
            <div className="text-lg text-white font-bold">{summary.missingTags}</div>
          </div>
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-violet-300 font-bold">Dup sous-tests</div>
            <div className="text-lg text-white font-bold">{summary.dupSubtests}</div>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-emerald-300 font-bold">Dup normes</div>
            <div className="text-lg text-white font-bold">{summary.dupNorms}</div>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-amber-300 font-bold">Qualité</div>
            <div className="text-lg text-white font-bold">{summary.quality}</div>
          </div>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search size={14} className="absolute left-3 top-2.5 text-stone-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer par nom ou ID test..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[#E07A5F]"
            />
          </div>
          {(['all', 'public', 'private'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${
                scope === value
                  ? 'bg-[#E07A5F]/20 text-[#ffd7ca] border-[#E07A5F]/40'
                  : 'bg-white/5 text-stone-400 border-white/10 hover:text-white'
              }`}
            >
              {value === 'all' ? 'Tous' : value === 'public' ? 'Public' : 'Privé'}
            </button>
          ))}
        </div>

        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-black/20 text-stone-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Test</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Tags</th>
                <th className="text-right px-3 py-2">Dup ST</th>
                <th className="text-right px-3 py-2">Dup Normes</th>
                <th className="text-right px-3 py-2">Qualité</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleIssues.map((row) => (
                <tr key={row.test_id} className="border-t border-white/5">
                  <td className="px-3 py-2">
                    <div className="font-bold text-white">{row.test_name}</div>
                    <div className="text-[10px] text-stone-500 flex items-center gap-2">
                      <span>{row.test_id}</span>
                      <span className={`px-1.5 py-0.5 rounded ${row.organization_id ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                        {row.organization_id ? 'privé' : 'public'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-white font-bold">{row.total_issues}</td>
                  <td className="px-3 py-2 text-right text-rose-300">{row.missing_ambiguous_tags}</td>
                  <td className="px-3 py-2 text-right text-violet-300">{row.duplicate_subtest_excess}</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{row.duplicate_norm_excess}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{row.quality_flag_count}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {row.duplicate_norm_excess > 0 && (
                        <button
                          onClick={() => void handleDeduplicateNorms(row.test_id)}
                          disabled={dedupingTestId === row.test_id}
                          className="text-[10px] text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 px-2 py-1 rounded disabled:opacity-50 flex items-center gap-1"
                        >
                          {dedupingTestId === row.test_id ? <Loader2 size={10} className="animate-spin" /> : <Wrench size={10} />}
                          Dédupliquer
                        </button>
                      )}
                      <button
                        onClick={() => onOpenTest(row.test_id)}
                        className="text-[10px] text-amber-300 hover:text-amber-200 bg-amber-500/10 px-2 py-1 rounded flex items-center gap-1"
                      >
                        Ouvrir <ArrowRight size={10} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!isLoading && visibleIssues.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-stone-500">
                    <AlertTriangle size={18} className="mx-auto mb-2 opacity-60" />
                    Aucune issue pour ce filtre.
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
