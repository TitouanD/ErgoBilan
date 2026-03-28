import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, RefreshCw, Search } from 'lucide-react';
import { ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type {
  AdminNormFittingDatasetRow,
  AdminNormFittingIssueOverride,
  AdminNormFittingSubtestAudit,
  FittingScoreType,
} from '../../types';
import { analyzeAdminNormFittingDataset, buildAdminFittingIssueKey } from '../../utils/adminNormFittingAudit';

type CatalogValueFix = {
  normId: string;
  field: 'standard_score' | 'percentile' | 'mean' | 'sd';
  value: number;
  confidence: number;
  reason: string;
};

interface Props {
  onOpenInCatalog: (payload: {
    testId: string;
    subtestId: string;
    suggestedScoreType?: FittingScoreType | null;
    valueFixes?: CatalogValueFix[];
  }) => void;
}

const asScope = (value: 'all' | 'public' | 'private'): 'all' | 'public' | 'private' => value;

const getRawPoint = (row: AdminNormFittingDatasetRow, index: number): number => {
  if (typeof row.raw_min === 'number' && Number.isFinite(row.raw_min)) return row.raw_min;
  if (typeof row.raw_max === 'number' && Number.isFinite(row.raw_max)) return row.raw_max;
  return index;
};

const getScorePoint = (row: AdminNormFittingDatasetRow): number | null => {
  if (typeof row.standard_score === 'number' && Number.isFinite(row.standard_score)) return row.standard_score;
  if (typeof row.percentile === 'number' && Number.isFinite(row.percentile)) return row.percentile;
  return null;
};

export const AdminNormQualityBoard: React.FC<Props> = ({ onOpenInCatalog }) => {
  const toast = useToast();
  const [scope, setScope] = useState<'all' | 'public' | 'private'>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dataset, setDataset] = useState<AdminNormFittingDatasetRow[]>([]);
  const [overrides, setOverrides] = useState<AdminNormFittingIssueOverride[]>([]);
  const [selectedSubtestId, setSelectedSubtestId] = useState<string | null>(null);
  const [dismissingIssueKey, setDismissingIssueKey] = useState<string | null>(null);
  const [showOnlyProblematic, setShowOnlyProblematic] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [rows, overrideRows] = await Promise.all([
        AdminService.listNormFittingDataset({ scope: asScope(scope) }),
        AdminService.listNormFittingIssueOverrides(),
      ]);
      setDataset(rows);
      setOverrides(overrideRows);
    } catch (e) {
      Logger.error('DB', 'Failed to load norm fitting board', e);
      toast.error("Impossible de charger l'audit fitting.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [scope]);

  const dismissedKeys = useMemo(() => (
    new Set(overrides.filter((row) => row.dismissed).map((row) => row.issue_key))
  ), [overrides]);

  const audits = useMemo(
    () => analyzeAdminNormFittingDataset(dataset, dismissedKeys),
    [dataset, dismissedKeys],
  );

  const visibleAudits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audits.filter((audit) => {
      if (showOnlyProblematic && audit.issues.length === 0) return false;
      if (!q) return true;
      return (
        audit.testName.toLowerCase().includes(q)
        || audit.subtestName.toLowerCase().includes(q)
        || audit.testId.toLowerCase().includes(q)
        || audit.subtestId.toLowerCase().includes(q)
      );
    });
  }, [audits, search, showOnlyProblematic]);

  useEffect(() => {
    if (visibleAudits.length === 0) {
      setSelectedSubtestId(null);
      return;
    }
    if (!selectedSubtestId || !visibleAudits.some((audit) => audit.subtestId === selectedSubtestId)) {
      setSelectedSubtestId(visibleAudits[0].subtestId);
    }
  }, [visibleAudits, selectedSubtestId]);

  const selectedAudit = useMemo<AdminNormFittingSubtestAudit | null>(() => (
    visibleAudits.find((audit) => audit.subtestId === selectedSubtestId) || null
  ), [visibleAudits, selectedSubtestId]);

  const selectedRows = useMemo(() => {
    if (!selectedAudit) return [] as AdminNormFittingDatasetRow[];
    return dataset.filter((row) => row.subtest_id === selectedAudit.subtestId);
  }, [dataset, selectedAudit]);

  const chartData = useMemo(() => (
    selectedRows
      .map((row, index) => {
        const y = getScorePoint(row);
        if (y === null) return null;
        return {
          raw: getRawPoint(row, index),
          score: y,
          trend: y,
        };
      })
      .filter((item): item is { raw: number; score: number; trend: number } => item !== null)
      .sort((a, b) => a.raw - b.raw)
  ), [selectedRows]);

  const summary = useMemo(() => (
    visibleAudits.reduce((acc, audit) => {
      acc.subtests += 1;
      acc.issues += audit.issues.length;
      if (audit.suggestedScoreType && audit.suggestedScoreType !== audit.currentScoreType) {
        acc.mismatch += 1;
      }
      if (audit.riskScore >= 60) acc.highRisk += 1;
      return acc;
    }, { subtests: 0, issues: 0, mismatch: 0, highRisk: 0 })
  ), [visibleAudits]);

  const handleDismissIssue = async (audit: AdminNormFittingSubtestAudit, issueId: string) => {
    const issue = audit.issues.find((item) => item.id === issueId);
    if (!issue) return;
    const issueKey = buildAdminFittingIssueKey(audit.subtestId, issue);
    setDismissingIssueKey(issueKey);
    try {
      await AdminService.setNormFittingIssueDismissed({
        issueKey,
        testId: audit.testId,
        subtestId: audit.subtestId,
        issueCode: issue.code,
        dismissed: true,
      });
      setOverrides((prev) => {
        const next = prev.filter((row) => row.issue_key !== issueKey);
        next.push({
          issue_key: issueKey,
          test_id: audit.testId,
          subtest_id: audit.subtestId,
          issue_code: issue.code,
          dismissed: true,
          reason: null,
          dismissed_by: null,
          dismissed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return next;
      });
      toast.success('Issue fitting ignorée.');
    } catch (e) {
      Logger.error('DB', 'Dismiss fitting issue failed', e);
      toast.error("Impossible d'ignorer cette issue fitting.");
    } finally {
      setDismissingIssueKey(null);
    }
  };

  const openInCatalog = (audit: AdminNormFittingSubtestAudit) => {
    const valueFixes: CatalogValueFix[] = audit.suggestions
      .filter((suggestion) => (
        suggestion.kind === 'value_fix'
        && suggestion.normId
        && suggestion.field
        && typeof suggestion.value === 'number'
        && suggestion.confidence >= 0.9
      ))
      .map((suggestion) => ({
        normId: suggestion.normId as string,
        field: suggestion.field as 'standard_score' | 'percentile' | 'mean' | 'sd',
        value: suggestion.value as number,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
      }));

    onOpenInCatalog({
      testId: audit.testId,
      subtestId: audit.subtestId,
      suggestedScoreType: audit.suggestedScoreType,
      valueFixes,
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-white text-base font-bold flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" /> Audit fitting des normes
            </h3>
            <p className="text-[11px] text-stone-500 mt-1">
              Moteur partagé avec ContributionStudio: score_type, dispersion, cohérence des points.
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            disabled={isLoading}
            className="text-xs text-amber-300 hover:text-amber-200 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 rounded-lg disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Actualiser
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-[10px] uppercase text-stone-500 font-bold">Sous-tests</div>
            <div className="text-lg text-white font-bold">{summary.subtests}</div>
          </div>
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-rose-300 font-bold">Issues fitting</div>
            <div className="text-lg text-white font-bold">{summary.issues}</div>
          </div>
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-violet-300 font-bold">Mismatch type</div>
            <div className="text-lg text-white font-bold">{summary.mismatch}</div>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
            <div className="text-[10px] uppercase text-amber-300 font-bold">Risque élevé</div>
            <div className="text-lg text-white font-bold">{summary.highRisk}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="absolute left-3 top-2.5 text-stone-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer test/sous-test..."
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
                {value === 'all' ? 'Tous' : value === 'public' ? 'Public' : 'Privé'}
              </button>
            ))}
          </div>

          <label className="text-[11px] text-stone-400 inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showOnlyProblematic}
              onChange={(e) => setShowOnlyProblematic(e.target.checked)}
              className="rounded border-white/20 bg-white/5"
            />
            Afficher uniquement les sous-tests avec issues
          </label>

          <div className="max-h-[58vh] overflow-y-auto custom-scrollbar space-y-2 pr-1">
            {visibleAudits.map((audit) => (
              <button
                key={audit.subtestId}
                onClick={() => setSelectedSubtestId(audit.subtestId)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedSubtestId === audit.subtestId
                    ? 'bg-white/10 border-[var(--primary)]'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{audit.testName}</div>
                    <div className="text-[11px] text-stone-300 truncate">{audit.subtestName}</div>
                  </div>
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    audit.riskScore >= 70
                      ? 'bg-rose-500/20 text-rose-300'
                      : audit.riskScore >= 40
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {audit.riskScore}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-stone-500">
                  {audit.currentScoreType} {audit.suggestedScoreType ? `→ ${audit.suggestedScoreType}` : '→ ?'}
                  {' · '}
                  {audit.issues.length} issue(s)
                  {' · '}
                  conf {(audit.confidence * 100).toFixed(0)}%
                </div>
              </button>
            ))}
            {!isLoading && visibleAudits.length === 0 && (
              <div className="text-center py-10 text-stone-500 text-xs">
                <Check size={16} className="mx-auto mb-2 opacity-70" />
                Aucun sous-test pour ce filtre.
              </div>
            )}
          </div>
        </div>

        <div className="col-span-7 bg-white/5 border border-white/10 rounded-2xl p-4">
          {!selectedAudit ? (
            <div className="h-full flex items-center justify-center text-stone-500 text-sm">
              Sélectionnez un sous-test.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-white font-bold">{selectedAudit.testName}</h4>
                  <p className="text-sm text-stone-300">{selectedAudit.subtestName}</p>
                  <p className="text-[11px] text-stone-500 mt-1">
                    {selectedAudit.currentScoreType} → {selectedAudit.suggestedScoreType || 'indéterminé'}
                    {' · '}confiance {(selectedAudit.confidence * 100).toFixed(0)}%
                    {' · '}risque {selectedAudit.riskScore}
                  </p>
                </div>
                <button
                  onClick={() => openInCatalog(selectedAudit)}
                  className="text-[11px] text-amber-300 hover:text-amber-200 bg-amber-500/10 px-3 py-1.5 rounded-lg flex items-center gap-1"
                >
                  Ouvrir dans Catalogue <ArrowRight size={12} />
                </button>
              </div>

              <div className="h-56 bg-black/20 border border-white/10 rounded-xl p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: -10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2e313d" />
                    <XAxis dataKey="raw" stroke="#8f95a3" fontSize={10} />
                    <YAxis stroke="#8f95a3" fontSize={10} />
                    <Tooltip
                      contentStyle={{ background: '#131419', border: '1px solid #3b3f4f', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#d6dae5' }}
                    />
                    <Line type="monotone" dataKey="trend" stroke="#e07a5f" strokeWidth={2} dot={false} />
                    <Scatter dataKey="score" fill="#9cd1ff" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase text-stone-400">Issues détectées</h5>
                {selectedAudit.issues.length === 0 ? (
                  <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                    Aucune issue active pour ce sous-test.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                    {selectedAudit.issues.map((issue) => {
                      const issueKey = buildAdminFittingIssueKey(selectedAudit.subtestId, issue);
                      return (
                        <div key={issue.id} className="text-xs bg-white/5 border border-white/10 rounded-lg p-2 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-stone-300">
                              <span className="text-amber-300 font-bold">{issue.code}</span> · {issue.message}
                            </div>
                            <div className="text-[10px] text-stone-500 mt-0.5">
                              Confiance {(issue.confidence * 100).toFixed(0)}%{issue.normId ? ` · norm ${issue.normId}` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => void handleDismissIssue(selectedAudit, issue.id)}
                            disabled={dismissingIssueKey === issueKey}
                            className="text-[10px] text-stone-300 hover:text-white px-2 py-1 rounded bg-white/5 disabled:opacity-50"
                          >
                            {dismissingIssueKey === issueKey ? '...' : 'Ignorer'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase text-stone-400">Corrections proposees</h5>
                {selectedAudit.suggestions.length === 0 ? (
                  <div className="text-xs text-stone-400 bg-white/5 border border-white/10 rounded-lg p-2">
                    Aucune correction automatique proposee pour ce sous-test.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                    {selectedAudit.suggestions.map((suggestion) => (
                      <div key={suggestion.id} className="text-xs bg-white/5 border border-white/10 rounded-lg p-2">
                        <div className="text-stone-200">
                          <span className="text-fuchsia-300 font-bold">{suggestion.kind}</span> · {suggestion.reason}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          Confiance {(suggestion.confidence * 100).toFixed(0)}%
                          {suggestion.field ? ` · ${suggestion.field}` : ''}
                          {typeof suggestion.value === 'number' ? `=${suggestion.value}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
