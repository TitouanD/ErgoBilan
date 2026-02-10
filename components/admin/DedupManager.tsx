
import React, { useState, useEffect, useMemo } from 'react';
import { AdminService } from '../../services/admin';
import { DuplicatePair, MergeResult } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import { Loader2, GitMerge, Check, AlertTriangle, Search, Globe, Lock, ArrowRight, Trash2, RefreshCw } from 'lucide-react';

interface DedupCluster {
    id: string;
    tests: Array<{
        id: string;
        name: string;
        org_id: string | null;
        subtests_count: number;
        norms_count: number;
    }>;
    maxSimilarity: number;
}

/**
 * Admin Deduplication Manager
 * Detects duplicate test clusters and allows 1-click merge
 */
export const DedupManager: React.FC = () => {
    const [clusters, setClusters] = useState<DedupCluster[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [threshold, setThreshold] = useState(0.4);
    const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
    const [targetId, setTargetId] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<MergeResult | null>(null);
    const toast = useToast();

    const loadDuplicates = async () => {
        setIsLoading(true);
        setSelectedCluster(null);
        setTargetId(null);
        setLastResult(null);
        try {
            const pairs = await AdminService.findDuplicates(threshold);
            const clusterMap = buildClusters(pairs);
            setClusters(clusterMap);
        } catch (e) {
            Logger.error('DB', 'Failed to load duplicates', e);
            toast.error('Erreur chargement des doublons.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDuplicates();
    }, [threshold]);

    const buildClusters = (pairs: DuplicatePair[]): DedupCluster[] => {
        // Union-Find to group connected pairs into clusters
        const parent: Record<string, string> = {};
        const find = (x: string): string => {
            if (!parent[x]) parent[x] = x;
            if (parent[x] !== x) parent[x] = find(parent[x]);
            return parent[x];
        };
        const union = (a: string, b: string) => {
            parent[find(a)] = find(b);
        };

        const testInfo: Record<string, { name: string; org_id: string | null; subtests_count: number; norms_count: number }> = {};
        const pairSimilarity: Record<string, number> = {};

        pairs.forEach(p => {
            union(p.test_id_a, p.test_id_b);
            testInfo[p.test_id_a] = { name: p.test_name_a, org_id: p.org_id_a, subtests_count: p.subtests_count_a, norms_count: p.norms_count_a };
            testInfo[p.test_id_b] = { name: p.test_name_b, org_id: p.org_id_b, subtests_count: p.subtests_count_b, norms_count: p.norms_count_b };
            const key = [p.test_id_a, p.test_id_b].sort().join('|');
            pairSimilarity[key] = p.similarity_score;
        });

        const groups: Record<string, string[]> = {};
        Object.keys(testInfo).forEach(id => {
            const root = find(id);
            if (!groups[root]) groups[root] = [];
            groups[root].push(id);
        });

        return Object.entries(groups).map(([root, ids]) => {
            let maxSim = 0;
            ids.forEach(a => ids.forEach(b => {
                if (a < b) {
                    const key = [a, b].sort().join('|');
                    maxSim = Math.max(maxSim, pairSimilarity[key] || 0);
                }
            }));

            return {
                id: root,
                tests: ids
                    .map(id => ({ id, ...testInfo[id] }))
                    .sort((a, b) => {
                        // Public first, then by norms_count desc
                        if (a.org_id === null && b.org_id !== null) return -1;
                        if (a.org_id !== null && b.org_id === null) return 1;
                        return b.norms_count - a.norms_count;
                    }),
                maxSimilarity: maxSim,
            };
        }).sort((a, b) => b.maxSimilarity - a.maxSimilarity);
    };

    const handleMerge = async (cluster: DedupCluster, target: string) => {
        const sourceIds = cluster.tests.map(t => t.id).filter(id => id !== target);
        if (sourceIds.length === 0) return;

        setIsMerging(true);
        try {
            const result = await AdminService.mergeTests(sourceIds, target);
            setLastResult(result);
            toast.success(`Fusion réussie ! ${result.merged_tests} test(s) fusionné(s) dans « ${result.target_name} ».`);
            // Reload clusters
            await loadDuplicates();
        } catch (e) {
            Logger.error('DB', 'Merge failed', e);
            toast.error('Erreur lors de la fusion : ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsMerging(false);
        }
    };

    return (
        <div className="p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <GitMerge size={20} className="text-violet-400" />
                        Déduplication des Tests
                    </h3>
                    <p className="text-xs text-stone-500 mt-1">
                        Détecte les tests avec des noms similaires et permet de les fusionner en un clic.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-stone-500 font-bold">Seuil</label>
                        <input
                            type="range"
                            min={0.2}
                            max={0.9}
                            step={0.05}
                            value={threshold}
                            onChange={e => setThreshold(parseFloat(e.target.value))}
                            className="w-24 accent-violet-500"
                        />
                        <span className="text-xs text-stone-400 font-mono w-8">{Math.round(threshold * 100)}%</span>
                    </div>
                    <button
                        onClick={loadDuplicates}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700 transition-all disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Analyser
                    </button>
                </div>
            </div>

            {/* Last result banner */}
            {lastResult && (
                <div className="bg-emerald-900/30 border border-emerald-700/50 p-4 rounded-xl flex items-center gap-3">
                    <Check size={18} className="text-emerald-400 shrink-0" />
                    <span className="text-sm text-emerald-300">
                        Dernière fusion : <strong>{lastResult.merged_tests}</strong> test(s) intégré(s) dans « {lastResult.target_name} » — 
                        {lastResult.moved_subtests} sous-tests déplacés, {lastResult.migrated_norms} normes migrées, {lastResult.updated_sessions} sessions mises à jour.
                    </span>
                </div>
            )}

            {/* Loading state */}
            {isLoading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={32} className="text-violet-500 animate-spin" />
                </div>
            )}

            {/* Empty state */}
            {!isLoading && clusters.length === 0 && (
                <div className="text-center py-20 text-stone-600 bg-white/5 rounded-xl border border-dashed border-white/10 p-8">
                    <Check size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="font-bold mb-2">Aucun doublon détecté</p>
                    <p className="text-xs text-stone-500">Tous les tests ont des noms suffisamment distincts (seuil: {Math.round(threshold * 100)}%)</p>
                </div>
            )}

            {/* Cluster list */}
            {!isLoading && clusters.map(cluster => (
                <div 
                    key={cluster.id} 
                    className={`bg-[#131419] rounded-2xl border transition-all ${
                        selectedCluster === cluster.id ? 'border-violet-500/50 ring-1 ring-violet-500/30' : 'border-white/5 hover:border-white/10'
                    }`}
                >
                    {/* Cluster header */}
                    <div
                        className="p-5 cursor-pointer"
                        onClick={() => {
                            setSelectedCluster(selectedCluster === cluster.id ? null : cluster.id);
                            setTargetId(null);
                        }}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-violet-500/10 rounded-xl">
                                    <AlertTriangle size={16} className="text-violet-400" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        {cluster.tests.map((t, i) => (
                                            <React.Fragment key={t.id}>
                                                {i > 0 && <span className="text-stone-600">≈</span>}
                                                <span className="font-bold text-white text-sm flex items-center gap-1">
                                                    {t.org_id === null ? <Globe size={12} className="text-blue-400" /> : <Lock size={12} className="text-amber-400" />}
                                                    {t.name}
                                                </span>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                    <p className="text-[11px] text-stone-500 mt-1">
                                        {cluster.tests.length} tests • Similarité max: {Math.round(cluster.maxSimilarity * 100)}%
                                    </p>
                                </div>
                            </div>
                            <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${
                                cluster.maxSimilarity > 0.8 ? 'bg-red-500/20 text-red-400' : 
                                cluster.maxSimilarity > 0.6 ? 'bg-amber-500/20 text-amber-400' : 
                                'bg-stone-500/20 text-stone-400'
                            }`}>
                                {cluster.maxSimilarity > 0.8 ? 'PROBABLE' : cluster.maxSimilarity > 0.6 ? 'POSSIBLE' : 'FAIBLE'}
                            </span>
                        </div>
                    </div>

                    {/* Expanded detail */}
                    {selectedCluster === cluster.id && (
                        <div className="px-5 pb-5 border-t border-white/5 pt-4">
                            <p className="text-xs text-stone-500 mb-3 font-bold uppercase tracking-wider">
                                Sélectionnez le test cible (les autres seront fusionnés dedans) :
                            </p>
                            <div className="space-y-2 mb-4">
                                {cluster.tests.map(t => (
                                    <button
                                        key={t.id}
                                        onClick={() => setTargetId(t.id)}
                                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                                            targetId === t.id 
                                                ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30' 
                                                : 'border-white/5 bg-white/5 hover:border-white/10 hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                                targetId === t.id ? 'border-violet-500 bg-violet-500' : 'border-stone-600'
                                            }`}>
                                                {targetId === t.id && <Check size={12} className="text-white" />}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    {t.org_id === null ? (
                                                        <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">PUBLIC</span>
                                                    ) : (
                                                        <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">PRIVÉ</span>
                                                    )}
                                                    <span className="font-bold text-sm text-white">{t.name}</span>
                                                </div>
                                                <p className="text-[11px] text-stone-500 mt-0.5">
                                                    {t.subtests_count} sous-tests • {t.norms_count} normes • ID: {t.id.substring(0, 20)}...
                                                </p>
                                            </div>
                                        </div>
                                        {targetId === t.id && (
                                            <span className="text-[10px] bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded font-bold">CIBLE</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                            
                            {targetId && (
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 bg-white/5 rounded-xl p-3 text-xs text-stone-400">
                                        <ArrowRight size={12} className="inline mr-1 text-violet-400" />
                                        {cluster.tests.filter(t => t.id !== targetId).map(t => t.name).join(', ')} → <strong className="text-white">{cluster.tests.find(t => t.id === targetId)?.name}</strong>
                                    </div>
                                    <button
                                        onClick={() => handleMerge(cluster, targetId)}
                                        disabled={isMerging}
                                        className="px-6 py-3 bg-violet-600 text-white rounded-xl font-bold text-xs hover:bg-violet-700 transition-all shadow-lg shadow-violet-900/30 flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {isMerging ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
                                        Fusionner
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
