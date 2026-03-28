import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Search, ShieldAlert, Wrench, ArrowUpDown } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type { AdminIssueBacklogItem, SubtestDirectionIssue } from '../../types';
import { analyzeAdminNormFittingDataset, buildFittingIssueCountByTest } from '../../utils/adminNormFittingAudit';

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
  const [fittingIssueCountByTest, setFittingIssueCountByTest] = useState<Map<string, number>>(new Map());
  const [directionIssues, setDirectionIssues] = useState<SubtestDirectionIssue[]>([]);

  const loadIssues = async () => {
    setIsLoading(true);
    try {
      const [rows, dataset, overrides, dirIssues] = await Promise.all([
        AdminService.listIssueBacklog(),
        AdminService.listNormFittingDataset({ scope: 'all' }),
        AdminService.listNormFittingIssueOverrides(),
        AdminService.listDirectionIssues(),
      ]);
      const dismissedKeys = new Set(overrides.filter((row) => row.dismissed).map((row) => row.issue_key));
      const fittingAudits = analyzeAdminNormFittingDataset(dataset, dismissedKeys);
      setFittingIssueCountByTest(buildFittingIssueCountByTest(fittingAudits));
      setIssues(rows);
      setDirectionIssues(dirIssues);
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
    }).sort((a, b) => {
      const totalA = (a.total_issues || 0) + (fittingIssueCountByTest.get(a.test_id) || 0);
      const totalB = (b.total_issues || 0) + (fittingIssueCountByTest.get(b.test_id) || 0);
      if (totalB !== totalA) return totalB - totalA;
      return a.test_name.localeCompare(b.test_name);
    });
  }, [fittingIssueCountByTest, issues, scope, search]);

  const summary = useMemo(() => (
    visibleIssues.reduce((acc, row) => {
      const fitting = fittingIssueCountByTest.get(row.test_id) || 0;
      acc.tests += 1;
      acc.total += (row.total_issues || 0) + fitting;
      acc.missingTags += row.missing_ambiguous_tags || 0;
      acc.dupSubtests += row.duplicate_subtest_excess || 0;
      acc.dupNorms += row.duplicate_norm_excess || 0;
      acc.quality += row.quality_flag_count || 0;
      acc.zeroNorms += row.zero_norm_subtests_count || 0;
      acc.lowConfidence += row.low_confidence_score_type_count || 0;
      acc.fitting += fitting;
      return acc;
    }, { tests: 0, total: 0, missingTags: 0, dupSubtests: 0, dupNorms: 0, quality: 0, zeroNorms: 0, lowConfidence: 0, fitting: 0 })
  ), [fittingIssueCountByTest, visibleIssues]);

  const handleDeduplicateNorms = async (testId: string) => {
    setDedupingTestId(testId);
    try {
      const result = await AdminService.deduplicateNorms({ testId });
      toast.success(`${result.deleted} norme(s) dedupliquee(s).`);
      await loadIssues();
    } catch (e) {
      Logger.error('DB', 'Global deduplicate norms failed', e);
      toast.error('Erreur pendant la deduplication.');
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
              Vue cross-tests: tags manquants, doublons, qualite des normes et fitting.
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

        <div className="mt-4 grid grid-cols-1 md:grid-cols-9 gap-2">
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
            <div className="text-[10px] uppercase text-amber-300 font-bold">Qualite</div>
            <div className="text-lg text-white font-bold">{summary.quality}</div>
          </div>
          <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-sky-300 font-bold">0 normes</div>
            <div className="text-lg text-white font-bold">{summary.zeroNorms}</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-orange-300 font-bold">Type faible conf.</div>
            <div className="text-lg text-white font-bold">{summary.lowConfidence}</div>
          </div>
          <div className="bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-fuchsia-300 font-bold">Fitting</div>
            <div className="text-lg text-white font-bold">{summary.fitting}</div>
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
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[var(--primary)]"
            />
          </div>
          {(['all', 'public', 'private'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${
                scope === value
                  ? 'bg-[var(--primary)]/20 text-[#ffd7ca] border-[var(--primary)]/40'
                  : 'bg-white/5 text-stone-400 border-white/10 hover:text-white'
              }`}
            >
              {value === 'all' ? 'Tous' : value === 'public' ? 'Public' : 'Prive'}
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
                <th className="text-right px-3 py-2">Qualite</th>
                <th className="text-right px-3 py-2">0 Normes</th>
                <th className="text-right px-3 py-2">Type faible conf.</th>
                <th className="text-right px-3 py-2">Fitting</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleIssues.map((row) => {
                const fittingCount = fittingIssueCountByTest.get(row.test_id) || 0;
                const totalIssues = (row.total_issues || 0) + fittingCount;
                return (
                  <tr key={row.test_id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <div className="font-bold text-white">{row.test_name}</div>
                      <div className="text-[10px] text-stone-500 flex items-center gap-2">
                        <span>{row.test_id}</span>
                        <span className={`px-1.5 py-0.5 rounded ${row.organization_id ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                          {row.organization_id ? 'prive' : 'public'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-white font-bold">{totalIssues}</td>
                    <td className="px-3 py-2 text-right text-rose-300">{row.missing_ambiguous_tags}</td>
                    <td className="px-3 py-2 text-right text-violet-300">{row.duplicate_subtest_excess}</td>
                    <td className="px-3 py-2 text-right text-emerald-300">{row.duplicate_norm_excess}</td>
                    <td className="px-3 py-2 text-right text-amber-300">{row.quality_flag_count}</td>
                    <td className="px-3 py-2 text-right text-sky-300">{row.zero_norm_subtests_count}</td>
                    <td className="px-3 py-2 text-right text-orange-300">{row.low_confidence_score_type_count}</td>
                    <td className="px-3 py-2 text-right text-fuchsia-300">{fittingCount}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {row.duplicate_norm_excess > 0 && (
                          <button
                            onClick={() => void handleDeduplicateNorms(row.test_id)}
                            disabled={dedupingTestId === row.test_id}
                            className="text-[10px] text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 px-2 py-1 rounded disabled:opacity-50 flex items-center gap-1"
                          >
                            {dedupingTestId === row.test_id ? <Loader2 size={10} className="animate-spin" /> : <Wrench size={10} />}
                            Dedupliquer
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
                );
              })}

              {!isLoading && visibleIssues.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-stone-500">
                    <AlertTriangle size={18} className="mx-auto mb-2 opacity-60" />
                    Aucune issue pour ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Direction quality issues */}
      {(directionIssues.length > 0 || isLoading) && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <div>
            <h3 className="text-white text-base font-bold flex items-center gap-2">
              <ArrowUpDown size={16} className="text-cyan-400" /> Direction des sous-tests
            </h3>
            <p className="text-[11px] text-stone-500 mt-1">
              Sous-tests dont le sens de scoring (<em>higher/lower_better</em>) est indéfini ou suspect.
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-stone-500 text-xs py-4">
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : (
            <div className="overflow-auto rounded-xl border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-black/20 text-stone-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2">Sous-test</th>
                    <th className="text-left px-3 py-2">Test</th>
                    <th className="text-left px-3 py-2">Direction DB</th>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-left px-3 py-2">Détail</th>
                    <th className="text-right px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {directionIssues.map((row) => {
                    const isBlocking = row.issue_code === 'DIRECTION_AUTO_WITH_NORMS';
                    return (
                      <tr key={`${row.subtest_id}-${row.issue_code}`} className="border-t border-white/5">
                        <td className="px-3 py-2">
                          <div className="font-bold text-white">{row.subtest_name}</div>
                          <div className="text-[10px] text-stone-500">{row.subtest_id}</div>
                        </td>
                        <td className="px-3 py-2 text-stone-300">{row.test_name}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-stone-300">
                            {row.current_direction}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            isBlocking
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {isBlocking ? '⛔ BLOQUANT' : '⚠ WARNING'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-stone-400 max-w-xs">
                          <span className="line-clamp-2 text-[10px]">{row.details}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => onOpenTest(row.test_id)}
                            className="text-[10px] text-cyan-300 hover:text-cyan-200 bg-cyan-500/10 px-2 py-1 rounded flex items-center gap-1 ml-auto"
                          >
                            Ouvrir <ArrowRight size={10} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
