import React, { useEffect, useMemo, useState } from 'react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type { AdminTestBundle, AdminTestSummary, AdminSubtestRecord, AdminNormRecord, SubtestDuplicatePair, NormDuplicateSummary, NormQualityFlag, DuplicatePair, MergeResult } from '../../types';
import { Check, Loader2, Plus, RefreshCw, Save, Search, Trash2, ArrowUpRight, Globe, Lock, GitMerge, Zap, AlertTriangle, Settings, Wrench, Database, ArrowRight } from 'lucide-react';
import { normalizeSubtestName } from '../../utils';
import { supabase } from '../../services/db';

interface SubtestDraft extends AdminSubtestRecord {
  isNew?: boolean;
}

interface NormDraft extends AdminNormRecord {
  temp_id?: string;
}

const slugify = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const createSubtestId = (testId: string, name: string) => {
  const slug = slugify(name).slice(0, 40) || 'subtest';
  const suffix = crypto.randomUUID().slice(0, 6);
  return `${testId}_${slug}_${suffix}`;
};

const toNumber = (val: string | number | null | undefined): number | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isNaN(val) ? null : val;
  const cleaned = String(val).trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

const QUALITATIVE_5_BUCKETS_PRESET = {
  options: [
    { code: 'much_less', label: 'Beaucoup moins que les autres', order: 1 },
    { code: 'less', label: 'Moins que les autres', order: 2 },
    { code: 'as_others', label: 'Comme la plupart des autres', order: 3 },
    { code: 'more', label: 'Plus que les autres', order: 4 },
    { code: 'much_more', label: 'Beaucoup plus que les autres', order: 5 },
  ],
  defaultMetric: 'raw',
} as const;

export const AdminLibrary: React.FC = () => {
  const toast = useToast();
  const [scope, setScope] = useState<'public' | 'private' | 'all'>('public');
  const [search, setSearch] = useState('');
  const [tests, setTests] = useState<AdminTestSummary[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);

  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AdminTestBundle | null>(null);
  const [selectedSubtestId, setSelectedSubtestId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [subTab, setSubTab] = useState<'normes' | 'meta' | 'validation' | 'outils'>('normes');
  const [inputConfigDraft, setInputConfigDraft] = useState('{}');

  // Dedup state
  const [subtestDupPairs, setSubtestDupPairs] = useState<SubtestDuplicatePair[]>([]);
  const [subtestDupTarget, setSubtestDupTarget] = useState<string | null>(null);
  const [isScanningSubs, setIsScanningSubs] = useState(false);
  const [normDupSummary, setNormDupSummary] = useState<NormDuplicateSummary[]>([]);
  const [isScanningNorms, setIsScanningNorms] = useState(false);
  const [isDedupingNorms, setIsDedupingNorms] = useState(false);

  // Quality check state
  const [qualityFlags, setQualityFlags] = useState<NormQualityFlag[]>([]);
  const [isCheckingQuality, setIsCheckingQuality] = useState(false);

  // Test-level dedup state
  interface DedupCluster {
    id: string;
    tests: Array<{ id: string; name: string; org_id: string | null; subtests_count: number; norms_count: number }>;
    maxSimilarity: number;
  }
  const [testDupClusters, setTestDupClusters] = useState<DedupCluster[]>([]);
  const [testDupThreshold, setTestDupThreshold] = useState(0.4);
  const [isLoadingTestDups, setIsLoadingTestDups] = useState(false);
  const [isMergingTests, setIsMergingTests] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [lastMergeResult, setLastMergeResult] = useState<MergeResult | null>(null);

  const buildClusters = (pairs: DuplicatePair[]): DedupCluster[] => {
    const parent: Record<string, string> = {};
    const find = (x: string): string => { if (!parent[x]) parent[x] = x; if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; };
    const union = (a: string, b: string) => { parent[find(a)] = find(b); };
    const testInfo: Record<string, { name: string; org_id: string | null; subtests_count: number; norms_count: number }> = {};
    const pairSim: Record<string, number> = {};
    pairs.forEach(p => {
      union(p.test_id_a, p.test_id_b);
      testInfo[p.test_id_a] = { name: p.test_name_a, org_id: p.org_id_a, subtests_count: p.subtests_count_a, norms_count: p.norms_count_a };
      testInfo[p.test_id_b] = { name: p.test_name_b, org_id: p.org_id_b, subtests_count: p.subtests_count_b, norms_count: p.norms_count_b };
      pairSim[[p.test_id_a, p.test_id_b].sort().join('|')] = p.similarity_score;
    });
    const groups: Record<string, string[]> = {};
    Object.keys(testInfo).forEach(id => { const r = find(id); if (!groups[r]) groups[r] = []; groups[r].push(id); });
    return Object.entries(groups).map(([root, ids]) => {
      let maxSim = 0;
      ids.forEach(a => ids.forEach(b => { if (a < b) maxSim = Math.max(maxSim, pairSim[[a, b].sort().join('|')] || 0); }));
      return {
        id: root,
        tests: ids.map(id => ({ id, ...testInfo[id] })).sort((a, b) => (a.org_id === null ? -1 : b.org_id === null ? 1 : b.norms_count - a.norms_count)),
        maxSimilarity: maxSim,
      };
    }).sort((a, b) => b.maxSimilarity - a.maxSimilarity);
  };

  const loadTestDups = async () => {
    setIsLoadingTestDups(true);
    setSelectedClusterId(null);
    setMergeTargetId(null);
    setLastMergeResult(null);
    try {
      const pairs = await AdminService.findDuplicates(testDupThreshold);
      setTestDupClusters(buildClusters(pairs));
    } catch (e) {
      Logger.error('DB', 'Test dedup scan failed', e);
      toast.error('Erreur lors du scan de doublons.');
    } finally {
      setIsLoadingTestDups(false);
    }
  };

  const handleMergeTests = async (cluster: DedupCluster, target: string) => {
    const sourceIds = cluster.tests.map(t => t.id).filter(id => id !== target);
    if (sourceIds.length === 0) return;
    setIsMergingTests(true);
    try {
      const result = await AdminService.mergeTests(sourceIds, target);
      setLastMergeResult(result);
      toast.success(`Fusion réussie ! ${result.merged_tests} test(s) fusionné(s) dans « ${result.target_name} ».`);
      await loadTestDups();
      await loadTests();
    } catch (e) {
      Logger.error('DB', 'Merge tests failed', e);
      toast.error('Erreur lors de la fusion : ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsMergingTests(false);
    }
  };

  useEffect(() => {
    supabase.from('official_categories').select('id, label').order('sort_order').then(({ data }) => {
      if (data) setCategories(data);
    });
  }, []);

  useEffect(() => {
    if (!bundle || !selectedSubtestId) {
      setInputConfigDraft('{}');
      return;
    }
    const current = bundle.subtests.find((s) => s.id === selectedSubtestId);
    setInputConfigDraft(JSON.stringify(current?.input_config || {}, null, 2));
  }, [bundle, selectedSubtestId]);

  const loadTests = async () => {
    setLoadingTests(true);
    try {
      const data = await AdminService.listTests(scope);
      setTests(data);
    } catch (e) {
      Logger.error('DB', 'Admin list tests failed', e);
      toast.error('Impossible de charger la bibliothèque.');
    } finally {
      setLoadingTests(false);
    }
  };

  const loadBundle = async (testId: string) => {
    setBundle(null);
    setSelectedSubtestId(null);
    setIsDirty(false);
    // Reset dedup & quality state
    setSubtestDupPairs([]);
    setNormDupSummary([]);
    setQualityFlags([]);
    try {
      const data = await AdminService.getTestBundle(testId);
      const subtests = (data.subtests || []) as SubtestDraft[];
      const norms = (data.norms || []) as NormDraft[];
      setBundle({ ...data, subtests, norms });
      setSelectedSubtestId(subtests[0]?.id || null);
    } catch (e) {
      Logger.error('DB', 'Admin bundle load failed', e);
      toast.error('Impossible de charger le test.');
    }
  };

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (bundle && isDirty && !isSaving) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bundle, isDirty, isSaving]);

  useEffect(() => {
    loadTests();
  }, [scope]);

  const filteredTests = useMemo(() => {
    if (!search.trim()) return tests;
    const q = search.toLowerCase();
    return tests.filter(t => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }, [tests, search]);

  const updateTestField = (field: keyof AdminTestBundle['test'], value: any) => {
    setBundle(prev => {
      if (!prev) return prev;
      setIsDirty(true);
      return { ...prev, test: { ...prev.test, [field]: value } };
    });
  };

  const updateSubtestField = (subtestId: string, field: keyof AdminSubtestRecord, value: any) => {
    setBundle(prev => {
      if (!prev) return prev;
      if (field === 'name') {
        const normalized = normalizeSubtestName(String(value || ''));
        if (normalized && prev.subtests.some(s => s.id !== subtestId && normalizeSubtestName(s.name) === normalized)) {
          toast.error('Ce nom de sous-test existe deja pour ce test.');
          return prev;
        }
      }
      setIsDirty(true);
      return {
        ...prev,
        subtests: prev.subtests.map(s => (s.id === subtestId ? { ...s, [field]: value } : s))
      };
    });
  };

  const addSubtest = () => {
    if (!bundle) return;
    const newName = `Nouveau Sous-test ${bundle.subtests.length + 1}`;
    const newSub: SubtestDraft = {
      id: createSubtestId(bundle.test.id, newName),
      test_id: bundle.test.id,
      name: newName,
      unit: 'pts',
      score_type: 'scaled',
      computation_mode: 'LOOKUP',
      input_model: 'numeric_4mode',
      input_config: {},
      organization_id: bundle.test.organization_id || null,
      isNew: true
    };
    setBundle(prev => prev ? ({ ...prev, subtests: [...prev.subtests, newSub] }) : prev);
    setSelectedSubtestId(newSub.id);
    setIsDirty(true);
  };

  const deleteSubtest = async (subtest: SubtestDraft) => {
    if (!bundle) return;
    if (subtest.isNew) {
      setBundle(prev => prev ? ({
        ...prev,
        subtests: prev.subtests.filter(s => s.id !== subtest.id),
        norms: prev.norms.filter(n => n.subtest_id !== subtest.id)
      }) : prev);
      setSelectedSubtestId(null);
      setIsDirty(true);
      return;
    }

    if (!confirm('Supprimer ce sous-test ? Cette action est définitive.')) return;
    try {
      await AdminService.deleteSubtest(subtest.id);
      toast.success('Sous-test supprimé.');
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Admin delete subtest failed', e);
      toast.error('Suppression impossible.');
    }
  };

  const addNormRow = (subtestId: string) => {
    setBundle(prev => {
      if (!prev) return prev;
      const newNorm: NormDraft = {
        temp_id: crypto.randomUUID(),
        subtest_id: subtestId,
        organization_id: prev.test.organization_id || null,
        age_min_months: null,
        age_max_months: null,
        gender: 'Mixed',
        raw_min: null,
        raw_max: null,
        mean: null,
        sd: null,
        standard_score: null,
        percentile: null
      };
      setIsDirty(true);
      return { ...prev, norms: [...prev.norms, newNorm] };
    });
  };

  const updateNormField = (normKey: string, field: keyof AdminNormRecord, value: any) => {
    setBundle(prev => {
      if (!prev) return prev;
      setIsDirty(true);
      return {
        ...prev,
        norms: prev.norms.map(n => {
          const key = (n.id || (n as NormDraft).temp_id) as string;
          if (key !== normKey) return n;
          return { ...n, [field]: value };
        })
      };
    });
  };

  const deleteNorm = (normKey: string) => {
    setBundle(prev => {
      if (!prev) return prev;
      setIsDirty(true);
      return { ...prev, norms: prev.norms.filter(n => (n.id || (n as NormDraft).temp_id) !== normKey) };
    });
  };

  const sanitizeBundle = (raw: AdminTestBundle): AdminTestBundle => {
    const test = {
      id: raw.test.id,
      name: raw.test.name,
      category_id: raw.test.category_id,
      version: raw.test.version || '1.0',
      author: raw.test.author || '',
      organization_id: raw.test.organization_id || null
    };

    const subtests = raw.subtests.map(s => ({
      id: s.id,
      test_id: test.id,
      name: s.name,
      unit: s.unit || 'pts',
      score_type: s.score_type || 'scaled',
      computation_mode: s.computation_mode || 'LOOKUP',
      input_model: s.input_model || 'numeric_4mode',
      input_config: s.input_config || {},
      organization_id: s.organization_id || test.organization_id || null
    }));

    const norms = raw.norms.map(n => ({
      subtest_id: n.subtest_id,
      organization_id: n.organization_id || test.organization_id || null,
      age_min_months: toNumber(n.age_min_months),
      age_max_months: toNumber(n.age_max_months),
      gender: n.gender || 'Mixed',
      raw_min: toNumber(n.raw_min),
      raw_max: toNumber(n.raw_max),
      mean: toNumber(n.mean),
      sd: toNumber(n.sd),
      standard_score: toNumber(n.standard_score),
      percentile: toNumber(n.percentile)
    }));

    return { test, subtests, norms };
  };

  const handleSave = async () => {
    if (!bundle) return;
    setIsSaving(true);
    try {
      const payload = sanitizeBundle(bundle);
      await AdminService.saveTestBundle(payload);
      toast.success('Test sauvegardé.');
      setIsDirty(false);
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Admin save bundle failed', e);
      toast.error('Échec de la sauvegarde.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTest = async () => {
    if (!bundle) return;
    if (!confirm('Supprimer définitivement ce test ?')) return;
    try {
      await AdminService.deleteTest(bundle.test.id);
      toast.success('Test supprimé.');
      setBundle(null);
      setSelectedSubtestId(null);
      setSelectedTestId(null);
      await loadTests();
    } catch (e) {
      Logger.error('DB', 'Admin delete test failed', e);
      toast.error('Suppression impossible.');
    }
  };

  const handlePromoteSubtests = async (subtestIds: string[]) => {
    if (!bundle) return;
    if (!confirm(`Promouvoir ${subtestIds.length} sous-test(s) en public ? Cette action est irréversible.`)) return;
    setIsPromoting(true);
    try {
      await AdminService.promoteSubtests(subtestIds);
      toast.success(`${subtestIds.length} sous-test(s) promu(s) en public.`);
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Promote subtests failed', e);
      toast.error('Échec de la promotion.');
    } finally {
      setIsPromoting(false);
    }
  };

  const privateSubtests = bundle?.subtests.filter(s => s.organization_id) || [];
  const activeSubtest = bundle?.subtests.find(s => s.id === selectedSubtestId) || null;
  const subtestNorms = bundle?.norms.filter(n => n.subtest_id === selectedSubtestId) || [];
  const pendingNormsForSubtest = subtestNorms.filter(n => n.organization_id);
  const publicNormsForSubtest = subtestNorms.filter(n => !n.organization_id);

  // Pending norms count per subtest (for badges)
  const pendingNormCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (bundle?.norms || []).forEach(n => {
      if (n.organization_id) {
        counts[n.subtest_id] = (counts[n.subtest_id] || 0) + 1;
      }
    });
    return counts;
  }, [bundle?.norms]);

  // Total pending norms for the whole test
  const totalPendingNorms = useMemo(() => {
    return (bundle?.norms || []).filter(n => n.organization_id).length;
  }, [bundle?.norms]);

  const handlePromoteNorms = async (params: { subtestId?: string; testId?: string; organizationId?: string }, label: string) => {
    if (!bundle) return;
    if (!confirm(`Promouvoir ${label} en public ? Cette action est irréversible.`)) return;
    try {
      const result = await AdminService.promoteNorms(params);
      toast.success(`${result.promoted} norme(s) promue(s).`);
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Promote norms failed', e);
      toast.error('Échec de la promotion des normes.');
    }
  };

  const handleRejectNorms = async (params: { subtestId?: string; testId?: string; organizationId?: string }, label: string) => {
    if (!bundle) return;
    if (!confirm(`Rejeter et supprimer ${label} ? Cette action est irréversible.`)) return;
    try {
      const result = await AdminService.rejectNorms(params);
      toast.success(`${result.rejected} norme(s) rejetée(s).`);
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Reject norms failed', e);
      toast.error('Échec du rejet des normes.');
    }
  };
  // --- DEDUP HANDLERS ---

  const handleScanSubtestDups = async () => {
    if (!bundle) return;
    setIsScanningSubs(true);
    setSubtestDupPairs([]);
    setSubtestDupTarget(null);
    try {
      const pairs = await AdminService.findDuplicateSubtests(bundle.test.id, 0.4);
      setSubtestDupPairs(pairs);
      if (pairs.length === 0) toast.success('Aucun doublon de sous-test détecté.');
    } catch (e) {
      Logger.error('DB', 'Scan subtest dups failed', e);
      toast.error('Erreur lors du scan.');
    } finally {
      setIsScanningSubs(false);
    }
  };

  const handleMergeSubtests = async (sourceIds: string[], targetId: string) => {
    if (!bundle) return;
    if (!confirm(`Fusionner ${sourceIds.length} sous-test(s) dans la cible ? Les normes seront déplacées.`)) return;
    try {
      const result = await AdminService.mergeSubtests(sourceIds, targetId);
      toast.success(`Fusion réussie : ${result.migrated_norms} normes déplacées dans « ${result.target_name} ».`);
      setSubtestDupPairs([]);
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Merge subtests failed', e);
      toast.error('Erreur lors de la fusion des sous-tests.');
    }
  };

  const handleScanNormDups = async () => {
    if (!bundle) return;
    setIsScanningNorms(true);
    setNormDupSummary([]);
    try {
      const summary = await AdminService.findDuplicateNorms({ testId: bundle.test.id });
      setNormDupSummary(summary);
      if (summary.length === 0) toast.success('Aucune norme en doublon.');
    } catch (e) {
      Logger.error('DB', 'Scan norm dups failed', e);
      toast.error('Erreur lors du scan des normes.');
    } finally {
      setIsScanningNorms(false);
    }
  };

  const handleDeduplicateNorms = async (params: { subtestId?: string; testId?: string }) => {
    if (!bundle) return;
    if (!confirm('Supprimer toutes les normes en double ? (conserve une par clé unique)')) return;
    setIsDedupingNorms(true);
    try {
      const result = await AdminService.deduplicateNorms(params);
      toast.success(`${result.deleted} norme(s) en double supprimée(s).`);
      setNormDupSummary([]);
      await loadBundle(bundle.test.id);
    } catch (e) {
      Logger.error('DB', 'Deduplicate norms failed', e);
      toast.error('Erreur lors de la déduplication.');
    } finally {
      setIsDedupingNorms(false);
    }
  };

  const handleQualityCheck = async () => {
    if (!bundle) return;
    setIsCheckingQuality(true);
    setQualityFlags([]);
    try {
      const flags = await AdminService.normQualityCheck({ testId: bundle.test.id });
      setQualityFlags(flags);
      if (flags.length === 0) toast.success('Aucun problème de qualité détecté 🎉');
    } catch (e) {
      Logger.error('DB', 'Quality check failed', e);
      toast.error('Erreur lors du contrôle qualité.');
    } finally {
      setIsCheckingQuality(false);
    }
  };
  return (
    <div className="grid grid-cols-12 gap-8 h-full p-8">
      {/* LISTE TESTS */}
      <div className="col-span-4 space-y-4 overflow-y-auto max-h-full pr-2 custom-scrollbar">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un test"
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-3 text-xs text-stone-200 outline-none focus:border-[#E07A5F]"
            />
          </div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as any)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 text-xs text-stone-200 outline-none focus:border-[#E07A5F]"
          >
            <option value="public" className="bg-[#23252F] text-stone-200">Public</option>
            <option value="private" className="bg-[#23252F] text-stone-200">Privé</option>
            <option value="all" className="bg-[#23252F] text-stone-200">Tous</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-[10px] font-bold text-stone-500 uppercase tracking-wider">
          <span>Tests ({filteredTests.length})</span>
          <button
            onClick={loadTests}
            className="text-stone-400 hover:text-white flex items-center gap-1"
            title="Rafraîchir"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {loadingTests ? (
          <div className="flex items-center justify-center py-10 text-stone-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          filteredTests.map(t => (
            <button
              key={t.id}
              onClick={() => {
                if (isDirty && !confirm('Modifications non sauvegardées. Continuer ?')) return;
                setSelectedTestId(t.id);
                loadBundle(t.id);
              }}
              className={`w-full text-left p-3 rounded-xl border transition-all ${selectedTestId === t.id ? 'bg-white/10 border-[#E07A5F] ring-1 ring-[#E07A5F]' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-white truncate">{t.name}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(t.pending_norms_count || 0) > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-400" title={`${t.pending_norms_count} norme(s) en attente de validation`}>
                      {t.pending_norms_count} <Lock size={8} className="inline" />
                    </span>
                  )}
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${t.organization_id ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                    {t.organization_id ? 'Privé' : 'Public'}
                  </span>
                </div>
              </div>
              <div className="text-[10px] text-stone-500 mt-1">{t.subtest_count || 0} sous-tests{(t.pending_norms_count || 0) > 0 ? ` · ${t.pending_norms_count} normes en attente` : ''}</div>
            </button>
          ))
        )}
      </div>

      {/* EDITOR */}
      <div className="col-span-8 bg-[#131419] rounded-2xl border border-white/5 p-6 flex flex-col h-full">
        {!bundle ? (
          <div className="h-full flex flex-col overflow-y-auto custom-scrollbar">
            {/* Test-level dedup panel */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <GitMerge size={20} className="text-violet-400" /> Déduplication des tests
                </h3>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-stone-500 font-bold">Seuil</label>
                    <input type="range" min={0.2} max={0.9} step={0.05} value={testDupThreshold} onChange={e => setTestDupThreshold(parseFloat(e.target.value))} className="w-20 accent-violet-500" />
                    <span className="text-[10px] text-stone-400 font-mono w-7">{Math.round(testDupThreshold * 100)}%</span>
                  </div>
                  <button onClick={loadTestDups} disabled={isLoadingTestDups} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
                    {isLoadingTestDups ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                    Analyser
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-stone-500">Détecte les tests avec des noms similaires dans le catalogue et permet de les fusionner.</p>
            </div>

            {/* Last merge result */}
            {lastMergeResult && (
              <div className="mb-4 bg-emerald-900/30 border border-emerald-700/50 p-3 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span><strong>{lastMergeResult.merged_tests}</strong> test(s) fusionné(s) dans « {lastMergeResult.target_name} » — {lastMergeResult.moved_subtests} sous-tests, {lastMergeResult.migrated_norms} normes, {lastMergeResult.updated_sessions} sessions.</span>
              </div>
            )}

            {/* Loading */}
            {isLoadingTestDups && (
              <div className="flex items-center justify-center py-16"><Loader2 size={28} className="text-violet-500 animate-spin" /></div>
            )}

            {/* Empty state */}
            {!isLoadingTestDups && testDupClusters.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-stone-600">
                <Check size={40} className="mb-3 opacity-20" />
                <p className="font-bold text-sm mb-1">Aucun doublon détecté</p>
                <p className="text-[10px] text-stone-500">Cliquez « Analyser » pour scanner le catalogue (seuil : {Math.round(testDupThreshold * 100)}%).</p>
              </div>
            )}

            {/* Clusters */}
            {!isLoadingTestDups && testDupClusters.length > 0 && (
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-violet-400 uppercase">{testDupClusters.length} groupe(s) détecté(s)</span>
                {testDupClusters.map(cluster => (
                  <div key={cluster.id} className={`bg-white/5 rounded-xl border transition-all ${selectedClusterId === cluster.id ? 'border-violet-500/50 ring-1 ring-violet-500/30' : 'border-white/5 hover:border-white/10'}`}>
                    <div className="p-4 cursor-pointer" onClick={() => { setSelectedClusterId(selectedClusterId === cluster.id ? null : cluster.id); setMergeTargetId(null); }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          {cluster.tests.map((t, i) => (
                            <React.Fragment key={t.id}>
                              {i > 0 && <span className="text-stone-600">≈</span>}
                              <span className="font-bold text-white text-xs flex items-center gap-1">
                                {t.org_id === null ? <Globe size={10} className="text-blue-400" /> : <Lock size={10} className="text-amber-400" />}
                                {t.name}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cluster.maxSimilarity > 0.8 ? 'bg-red-500/20 text-red-400' : cluster.maxSimilarity > 0.6 ? 'bg-amber-500/20 text-amber-400' : 'bg-stone-500/20 text-stone-400'
                          }`}>
                          {Math.round(cluster.maxSimilarity * 100)}% — {cluster.maxSimilarity > 0.8 ? 'PROBABLE' : cluster.maxSimilarity > 0.6 ? 'POSSIBLE' : 'FAIBLE'}
                        </span>
                      </div>
                    </div>
                    {selectedClusterId === cluster.id && (
                      <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-2">
                        <p className="text-[10px] text-stone-500 font-bold uppercase">Cible de fusion :</p>
                        {cluster.tests.map(t => (
                          <button key={t.id} onClick={() => setMergeTargetId(t.id)} className={`w-full text-left p-2.5 rounded-lg border transition-all flex items-center justify-between text-xs ${mergeTargetId === t.id ? 'border-violet-500 bg-violet-500/10' : 'border-white/5 bg-white/5 hover:border-white/10'
                            }`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${mergeTargetId === t.id ? 'border-violet-500 bg-violet-500' : 'border-stone-600'}`}>
                                {mergeTargetId === t.id && <Check size={10} className="text-white" />}
                              </div>
                              {t.org_id === null
                                ? <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded font-bold">PUBLIC</span>
                                : <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded font-bold">PRIVÉ</span>
                              }
                              <span className="font-bold text-white">{t.name}</span>
                              <span className="text-stone-500">{t.subtests_count} st · {t.norms_count} n</span>
                            </div>
                            {mergeTargetId === t.id && <span className="text-[9px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded font-bold">CIBLE</span>}
                          </button>
                        ))}
                        {mergeTargetId && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 bg-white/5 rounded-lg p-2 text-[10px] text-stone-400">
                              <ArrowRight size={10} className="inline mr-1 text-violet-400" />
                              {cluster.tests.filter(t => t.id !== mergeTargetId).map(t => t.name).join(', ')} → <strong className="text-white">{cluster.tests.find(t => t.id === mergeTargetId)?.name}</strong>
                            </div>
                            <button
                              onClick={() => handleMergeTests(cluster, mergeTargetId)}
                              disabled={isMergingTests}
                              className="px-4 py-2 bg-violet-600 text-white rounded-lg font-bold text-xs hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50"
                            >
                              {isMergingTests ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                              Fusionner
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* HEADER */}
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xl font-bold text-white">{bundle.test.name}</h3>
                <p className="text-xs text-stone-500">ID: {bundle.test.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadBundle(bundle.test.id)}
                  className="px-3 py-2 text-xs font-bold rounded-lg border border-white/10 text-stone-400 hover:text-white hover:bg-white/5"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-[#E07A5F] text-white hover:bg-[#d0694e] flex items-center gap-2 disabled:opacity-60"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Sauvegarder
                </button>
                <button
                  onClick={handleDeleteTest}
                  className="px-3 py-2 text-xs font-bold rounded-lg border border-white/10 text-rose-400 hover:text-white hover:bg-rose-500/20"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {isDirty && (
              <div className="mb-3 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Modifications non sauvegardées.
              </div>
            )}

            {/* SUB-TABS */}
            <div className="flex items-center gap-1 mb-4 border-b border-white/5 pb-2">
              {([
                { key: 'normes' as const, label: 'Normes & Sous-tests', icon: <Database size={13} /> },
                { key: 'meta' as const, label: 'Métadonnées', icon: <Settings size={13} /> },
                { key: 'validation' as const, label: 'Validation', icon: <ArrowUpRight size={13} />, badge: totalPendingNorms },
                { key: 'outils' as const, label: 'Outils', icon: <Wrench size={13} /> },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setSubTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${subTab === tab.key
                      ? 'bg-white/10 text-white'
                      : 'text-stone-500 hover:text-stone-300 hover:bg-white/5'
                    }`}
                >
                  {tab.icon}
                  {tab.label}
                  {(tab.badge ?? 0) > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold">{tab.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ═══ SUB-TAB: NORMES & SOUS-TESTS ═══ */}
            {subTab === 'normes' && (
              <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
                <div className="col-span-4 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-stone-500 uppercase">
                      Sous-tests ({bundle.subtests.length})
                    </span>
                    <button onClick={addSubtest} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                      <Plus size={12} /> Ajouter
                    </button>
                  </div>

                  <div className="space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    {bundle.subtests.map(s => (
                      <div
                        key={s.id}
                        className={`p-3 rounded-lg border cursor-pointer ${selectedSubtestId === s.id ? 'bg-white/10 border-[#E07A5F]' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                        onClick={() => setSelectedSubtestId(s.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {s.organization_id ? <Lock size={10} className="text-amber-400 flex-shrink-0" /> : <Globe size={10} className="text-emerald-400 flex-shrink-0" />}
                            <span className="text-xs font-bold text-white truncate">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteSubtest(s); }}
                              className="text-stone-400 hover:text-rose-400"
                              title="Supprimer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="text-[10px] text-stone-500 flex items-center gap-1">
                          {s.score_type} · {s.computation_mode} · {s.input_model || 'numeric_4mode'} {s.organization_id ? '· Privé' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-span-8 flex flex-col min-h-0">
                  {!activeSubtest ? (
                    <div className="h-full flex items-center justify-center text-stone-600">
                      Sélectionnez un sous-test.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-12 gap-4 mb-4">
                        <div className="col-span-6">
                          <label className="text-[10px] font-bold text-stone-500 uppercase">Nom</label>
                          <input
                            value={activeSubtest.name}
                            onChange={(e) => updateSubtestField(activeSubtest.id, 'name', e.target.value)}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="text-[10px] font-bold text-stone-500 uppercase">Unité</label>
                          <input
                            value={activeSubtest.unit || ''}
                            onChange={(e) => updateSubtestField(activeSubtest.id, 'unit', e.target.value)}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="text-[10px] font-bold text-stone-500 uppercase">Score Type</label>
                          <select
                            value={activeSubtest.score_type || 'standard'}
                            onChange={(e) => updateSubtestField(activeSubtest.id, 'score_type', e.target.value)}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                          >
                            <option value="standard" className="bg-[#23252F] text-stone-200">standard</option>
                            <option value="scaled" className="bg-[#23252F] text-stone-200">scaled</option>
                            <option value="sten" className="bg-[#23252F] text-stone-200">sten</option>
                            <option value="t-score" className="bg-[#23252F] text-stone-200">t-score</option>
                            <option value="percentile" className="bg-[#23252F] text-stone-200">percentile</option>
                            <option value="none" className="bg-[#23252F] text-stone-200">none</option>
                          </select>
                        </div>
                        <div className="col-span-4">
                          <label className="text-[10px] font-bold text-stone-500 uppercase">Computation</label>
                          <select
                            value={activeSubtest.computation_mode || 'LOOKUP'}
                            onChange={(e) => updateSubtestField(activeSubtest.id, 'computation_mode', e.target.value)}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                          >
                            <option value="LOOKUP" className="bg-[#23252F] text-stone-200">LOOKUP</option>
                            <option value="PARAMETRIC" className="bg-[#23252F] text-stone-200">PARAMETRIC</option>
                          </select>
                        </div>
                        <div className="col-span-4">
                          <label className="text-[10px] font-bold text-stone-500 uppercase">Input model</label>
                          <select
                            value={activeSubtest.input_model || 'numeric_4mode'}
                            onChange={(e) => updateSubtestField(activeSubtest.id, 'input_model', e.target.value)}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                          >
                            <option value="numeric_4mode" className="bg-[#23252F] text-stone-200">numeric_4mode</option>
                            <option value="qualitative_category" className="bg-[#23252F] text-stone-200">qualitative_category</option>
                            <option value="raw_only" className="bg-[#23252F] text-stone-200">raw_only</option>
                          </select>
                        </div>
                        <div className="col-span-12">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] font-bold text-stone-500 uppercase">Input config (JSON)</label>
                            {activeSubtest.input_model === 'qualitative_category' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const preset = {
                                    options: QUALITATIVE_5_BUCKETS_PRESET.options.map((opt) => ({ ...opt })),
                                    defaultMetric: QUALITATIVE_5_BUCKETS_PRESET.defaultMetric,
                                  };
                                  setInputConfigDraft(JSON.stringify(preset, null, 2));
                                  updateSubtestField(activeSubtest.id, 'input_config', preset);
                                  toast.success('Preset qualitatif 5 categories applique.');
                                }}
                                className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 uppercase"
                              >
                                Appliquer preset 5 categories
                              </button>
                            )}
                          </div>
                          <textarea
                            value={inputConfigDraft}
                            onChange={(e) => setInputConfigDraft(e.target.value)}
                            onBlur={() => {
                              try {
                                const parsed = JSON.parse(inputConfigDraft || '{}');
                                updateSubtestField(activeSubtest.id, 'input_config', parsed);
                              } catch {
                                toast.error('input_config JSON invalide.');
                              }
                            }}
                            rows={4}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-stone-500 uppercase">Normes</span>
                          <span className="text-[10px] text-stone-600">
                            {publicNormsForSubtest.length} publiques
                            {pendingNormsForSubtest.length > 0 && (
                              <span className="text-amber-400 ml-1">+ {pendingNormsForSubtest.length} en attente</span>
                            )}
                          </span>
                        </div>
                        <button onClick={() => addNormRow(activeSubtest.id)} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                          <Plus size={12} /> Ajouter
                        </button>
                      </div>

                      <div className="flex-1 overflow-auto border border-white/5 rounded-lg">
                        <table className="min-w-full text-[11px] text-stone-300">
                          <thead className="bg-[#1A1C23] text-stone-500 uppercase text-[10px] sticky top-0">
                            <tr>
                              <th className="p-2 w-6" title="Statut"></th>
                              <th className="p-2">Âge min</th>
                              <th className="p-2">Âge max</th>
                              <th className="p-2">Genre</th>
                              <th className="p-2">Raw min</th>
                              <th className="p-2">Raw max</th>
                              <th className="p-2">Mean</th>
                              <th className="p-2">SD</th>
                              <th className="p-2">NS</th>
                              <th className="p-2">%</th>
                              <th className="p-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {subtestNorms.map((n, idx) => {
                              const key = (n.id || (n as NormDraft).temp_id || String(idx)) as string;
                              return (
                                <tr key={key} className="border-t border-white/5">
                                  <td className="p-1 text-center" title={n.organization_id ? `Org: ${n.organization_id}` : 'Publique'}>
                                    {n.organization_id ? <Lock size={10} className="text-amber-400 inline" /> : <Globe size={10} className="text-emerald-400 inline" />}
                                  </td>
                                  <td className="p-1"><input value={n.age_min_months ?? ''} onChange={(e) => updateNormField(key, 'age_min_months', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1"><input value={n.age_max_months ?? ''} onChange={(e) => updateNormField(key, 'age_max_months', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1">
                                    <select value={n.gender ?? 'Mixed'} onChange={(e) => updateNormField(key, 'gender', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-1 py-1 text-[11px] text-stone-300">
                                      <option value="Mixed" className="bg-[#23252F] text-stone-200">Mixed</option>
                                      <option value="M" className="bg-[#23252F] text-stone-200">M</option>
                                      <option value="F" className="bg-[#23252F] text-stone-200">F</option>
                                    </select>
                                  </td>
                                  <td className="p-1"><input value={n.raw_min ?? ''} onChange={(e) => updateNormField(key, 'raw_min', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1"><input value={n.raw_max ?? ''} onChange={(e) => updateNormField(key, 'raw_max', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1"><input value={n.mean ?? ''} onChange={(e) => updateNormField(key, 'mean', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1"><input value={n.sd ?? ''} onChange={(e) => updateNormField(key, 'sd', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1"><input value={n.standard_score ?? ''} onChange={(e) => updateNormField(key, 'standard_score', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1"><input value={n.percentile ?? ''} onChange={(e) => updateNormField(key, 'percentile', e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1" /></td>
                                  <td className="p-1 text-right">
                                    <button onClick={() => deleteNorm(key)} className="text-rose-400 hover:text-rose-300">
                                      <Trash2 size={12} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {subtestNorms.length === 0 && (
                              <tr>
                                <td className="p-3 text-center text-stone-500" colSpan={11}>Aucune norme</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ═══ SUB-TAB: MÉTADONNÉES ═══ */}
            {subTab === 'meta' && (
              <div className="space-y-6">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-6">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Nom du test</label>
                    <input
                      value={bundle.test.name}
                      onChange={(e) => updateTestField('name', e.target.value)}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Catégorie</label>
                    <select
                      value={bundle.test.category_id || ''}
                      onChange={(e) => updateTestField('category_id', e.target.value)}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      <option value="" className="bg-[#23252F] text-stone-200">—</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id} className="bg-[#23252F] text-stone-200">{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Version</label>
                    <input
                      value={bundle.test.version || ''}
                      onChange={(e) => updateTestField('version', e.target.value)}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-6">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Auteur</label>
                    <input
                      value={bundle.test.author || ''}
                      onChange={(e) => updateTestField('author', e.target.value)}
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Visibilité</label>
                    <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                      {bundle.test.organization_id
                        ? <><Lock size={14} className="text-amber-400" /> <span className="text-amber-300">Privé</span></>
                        : <><Globe size={14} className="text-emerald-400" /> <span className="text-emerald-300">Public</span></>
                      }
                    </div>
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold text-stone-500 uppercase">Sous-tests</label>
                    <div className="mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-stone-300">
                      {bundle.subtests.length}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ SUB-TAB: VALIDATION ═══ */}
            {subTab === 'validation' && (
              <div className="space-y-4">
                {totalPendingNorms === 0 && privateSubtests.length === 0 ? (
                  <div className="text-center py-20 text-stone-600 bg-white/5 rounded-xl border border-dashed border-white/10">
                    <Check size={40} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm">Aucune norme ou sous-test en attente de validation.</p>
                  </div>
                ) : (
                  <>
                    {/* Pending norms section */}
                    {totalPendingNorms > 0 && (
                      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                            <Lock size={14} /> {totalPendingNorms} norme(s) en attente
                          </h4>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePromoteNorms({ testId: bundle.test.id }, `${totalPendingNorms} norme(s) du test`)}
                              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 rounded-lg"
                            >
                              <Check size={12} /> Approuver toutes
                            </button>
                            <button
                              onClick={() => handleRejectNorms({ testId: bundle.test.id }, `${totalPendingNorms} norme(s) du test`)}
                              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 px-3 py-1.5 bg-rose-500/10 rounded-lg"
                            >
                              <Trash2 size={12} /> Rejeter toutes
                            </button>
                          </div>
                        </div>
                        {/* Per-subtest breakdown */}
                        <div className="space-y-1">
                          {bundle.subtests.filter(s => (pendingNormCounts[s.id] || 0) > 0).map(s => (
                            <div key={s.id} className="flex items-center justify-between text-[11px] bg-white/5 rounded-lg px-3 py-2">
                              <span className="text-white font-bold">{s.name} <span className="text-amber-400 font-normal">({pendingNormCounts[s.id]} normes)</span></span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handlePromoteNorms({ subtestId: s.id }, `${pendingNormCounts[s.id]} norme(s) de ${s.name}`)}
                                  className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                                >
                                  <Check size={10} /> Approuver
                                </button>
                                <button
                                  onClick={() => handleRejectNorms({ subtestId: s.id }, `${pendingNormCounts[s.id]} norme(s) de ${s.name}`)}
                                  className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                                >
                                  <Trash2 size={10} /> Rejeter
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Private subtests section */}
                    {privateSubtests.length > 0 && !bundle.test.organization_id && (
                      <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-violet-400 flex items-center gap-2">
                            <ArrowUpRight size={14} /> {privateSubtests.length} sous-test(s) privé(s)
                          </h4>
                          <button
                            onClick={() => handlePromoteSubtests(privateSubtests.map(s => s.id))}
                            disabled={isPromoting}
                            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 px-3 py-1.5 bg-violet-500/10 rounded-lg disabled:opacity-50"
                          >
                            {isPromoting ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
                            Tout promouvoir en public
                          </button>
                        </div>
                        <div className="space-y-1">
                          {privateSubtests.map(s => (
                            <div key={s.id} className="flex items-center justify-between text-[11px] bg-white/5 rounded-lg px-3 py-2">
                              <span className="text-white font-bold">{s.name}</span>
                              <button
                                onClick={() => handlePromoteSubtests([s.id])}
                                disabled={isPromoting}
                                className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1 disabled:opacity-50"
                              >
                                <ArrowUpRight size={10} /> Promouvoir
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ═══ SUB-TAB: OUTILS ═══ */}
            {subTab === 'outils' && (
              <div className="space-y-6">
                {/* Quality check */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-400" /> Contrôle qualité des normes
                    </h4>
                    <button
                      onClick={handleQualityCheck}
                      disabled={isCheckingQuality}
                      className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 rounded-lg disabled:opacity-50"
                    >
                      {isCheckingQuality ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                      Lancer le contrôle
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-500">Vérifie les incohérences : âges inversés, scores hors limites, SD négatifs, normes incomplètes...</p>
                  {qualityFlags.length > 0 && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                          <AlertTriangle size={12} /> {qualityFlags.length} problème(s) détecté(s)
                        </span>
                        <button onClick={() => setQualityFlags([])} className="text-[10px] text-stone-500 hover:text-stone-300">Fermer</button>
                      </div>
                      <div className="max-h-60 overflow-y-auto space-y-1 custom-scrollbar">
                        {qualityFlags.map((f, idx) => (
                          <div key={idx} className="text-[10px] bg-white/5 rounded px-2 py-1.5 flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${f.flag_code.includes('INVERTED') || f.flag_code === 'NEGATIVE_SD' ? 'bg-red-500/20 text-red-400' :
                                f.flag_code.includes('IMPLAUSIBLE') || f.flag_code.includes('OOB') ? 'bg-amber-500/20 text-amber-400' :
                                  'bg-stone-500/20 text-stone-400'
                              }`}>{f.flag_code}</span>
                            <span className="text-stone-400">{f.subtest_name}:</span>
                            <span className="text-white">{f.flag_label}</span>
                            <span className="text-stone-600 ml-auto">{f.details}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Subtest dedup */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <GitMerge size={14} className="text-violet-400" /> Doublons de sous-tests
                    </h4>
                    <button
                      onClick={handleScanSubtestDups}
                      disabled={isScanningSubs}
                      className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 rounded-lg disabled:opacity-50"
                    >
                      {isScanningSubs ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                      Scanner
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-500">Détecte les sous-tests en doublon par similarité de nom et propose la fusion.</p>
                  {subtestDupPairs.length > 0 && (
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 space-y-1.5">
                      <span className="text-[10px] font-bold text-violet-400 uppercase">{subtestDupPairs.length} doublon(s) détecté(s)</span>
                      {subtestDupPairs.map((p, idx) => (
                        <div key={idx} className="text-[10px] bg-white/5 rounded p-2 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <span className="text-white font-bold">{p.subtest_name_a}</span>
                            <span className="text-stone-500">({p.norms_count_a}n)</span>
                            <span className="text-violet-400 mx-1">{"≈"}</span>
                            <span className="text-white font-bold">{p.subtest_name_b}</span>
                            <span className="text-stone-500">({p.norms_count_b}n)</span>
                            <span className="text-stone-600 ml-1">{Math.round(p.similarity_score * 100)}%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleMergeSubtests([p.subtest_id_b], p.subtest_id_a)}
                              className="text-[9px] text-violet-400 hover:text-violet-300 px-1.5 py-0.5 bg-violet-500/10 rounded"
                              title={`Garder « ${p.subtest_name_a} »`}
                            >
                              ← Garder A
                            </button>
                            <button
                              onClick={() => handleMergeSubtests([p.subtest_id_a], p.subtest_id_b)}
                              className="text-[9px] text-violet-400 hover:text-violet-300 px-1.5 py-0.5 bg-violet-500/10 rounded"
                              title={`Garder « ${p.subtest_name_b} »`}
                            >
                              Garder B →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Norm dedup */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Zap size={14} className="text-violet-400" /> Doublons de normes
                    </h4>
                    <button
                      onClick={handleScanNormDups}
                      disabled={isScanningNorms}
                      className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 rounded-lg disabled:opacity-50"
                    >
                      {isScanningNorms ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      Scanner
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-500">Identifie les normes parfaitement identiques et nettoie les doublons.</p>
                  {normDupSummary.length > 0 && (
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-violet-400 uppercase">Normes en double détectées</span>
                        <button
                          onClick={() => handleDeduplicateNorms({ testId: bundle.test.id })}
                          disabled={isDedupingNorms}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 disabled:opacity-50"
                        >
                          {isDedupingNorms ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                          Tout dédupliquer
                        </button>
                      </div>
                      {normDupSummary.map((d, idx) => (
                        <div key={idx} className="text-[10px] flex items-center justify-between bg-white/5 rounded p-1.5">
                          <span className="text-white">{d.subtest_name}: <span className="text-violet-400">{d.duplicate_group_count} groupe(s)</span>, <span className="text-amber-400">{d.total_excess_rows} excédentaire(s)</span></span>
                          <button
                            onClick={() => handleDeduplicateNorms({ subtestId: d.subtest_id })}
                            disabled={isDedupingNorms}
                            className="text-[9px] text-violet-400 hover:text-violet-300 px-1.5 py-0.5 bg-violet-500/10 rounded disabled:opacity-50"
                          >
                            Dédupliquer
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
};

