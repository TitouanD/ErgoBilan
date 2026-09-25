import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import type { AdminTestSummary, AdminTestRecord, AdminSubtestRecord } from '../../types';
import { supabase } from '../../services/db';
import {
  Loader2, Plus, RefreshCw, Save, Search, Trash2,
  Globe, Lock, GripVertical, X,
} from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────

const SCORE_TYPES = [
  { value: 'none',       label: 'Sans score' },
  { value: 'standard',   label: 'Note Standard (moy 100)' },
  { value: 'scaled',     label: 'Note Scalée (moy 10)' },
  { value: 't-score',    label: 'Score T (moy 50)' },
  { value: 'percentile', label: 'Percentile' },
  { value: 'sten',       label: 'Sten (1-10)' },
  { value: 'stanine',    label: 'Stanine (1-9)' },
];

const makeSubtestId = (testId: string) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${testId}_sub_${suffix}`;
};

interface SubtestDraft extends AdminSubtestRecord {
  isNew?: boolean;
  display_order: number;
  display_group_order?: number | null;
}

// ─── component ────────────────────────────────────────────────────────────────

export const AdminLibrary: React.FC = () => {
  const toast = useToast();

  // List state
  const [scope, setScope] = useState<'public' | 'private' | 'all'>('public');
  const [search, setSearch] = useState('');
  const [tests, setTests] = useState<AdminTestSummary[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);

  // Detail state
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [testRecord, setTestRecord] = useState<AdminTestRecord | null>(null);
  const [subtests, setSubtests] = useState<SubtestDraft[]>([]);
  const [deletedSubtestIds, setDeletedSubtestIds] = useState<string[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Categories
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);

  // Drag-to-reorder
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // ── Load categories ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('official_categories').select('id, label').order('sort_order').then(({ data }) => {
      if (data) setCategories(data as Array<{ id: string; label: string }>);
    });
  }, []);

  // ── Load tests list ────────────────────────────────────────────────────────
  const loadTests = useCallback(async () => {
    setLoadingTests(true);
    try {
      const data = await AdminService.listTests(scope);
      setTests(data);
    } catch (e) {
      Logger.error('DB', 'Failed to load tests', e);
      toast.error('Erreur lors du chargement des tests.');
    } finally {
      setLoadingTests(false);
    }
  }, [scope, toast]);

  useEffect(() => { loadTests(); }, [loadTests]);

  // ── Load detail ────────────────────────────────────────────────────────────
  const loadDetail = useCallback(async (testId: string) => {
    setLoadingDetail(true);
    setIsDirty(false);
    setDeletedSubtestIds([]);
    try {
      const { test, subtests: subs } = await AdminService.loadTestDetail(testId);
      setTestRecord(test);
      setSubtests(subs.map((s, i) => ({
        ...s,
        display_order: (s as SubtestDraft).display_order ?? i + 1,
        display_group_order: (s as SubtestDraft).display_group_order ?? null,
      })));
    } catch (e) {
      Logger.error('DB', 'Failed to load test detail', e);
      toast.error('Erreur lors du chargement du test.');
    } finally {
      setLoadingDetail(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedTestId) loadDetail(selectedTestId);
    else { setTestRecord(null); setSubtests([]); }
  }, [selectedTestId, loadDetail]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!testRecord) return;
    setIsSaving(true);
    try {
      const reindexed = subtests.map((s, i) => ({ ...s, display_order: i + 1 }));
      await AdminService.saveTestDetail(testRecord, reindexed as AdminSubtestRecord[], deletedSubtestIds);
      setDeletedSubtestIds([]);
      setIsDirty(false);
      toast.success('Test sauvegardé.');
      await loadTests();
    } catch (e: any) {
      toast.error('Erreur : ' + (e?.message ?? 'Sauvegarde impossible.'));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Delete test ───────────────────────────────────────────────────────────
  const handleDeleteTest = async () => {
    if (!testRecord || !window.confirm(`Supprimer "${testRecord.name}" et tous ses sous-tests ?`)) return;
    try {
      await AdminService.deleteTest(testRecord.id);
      setSelectedTestId(null);
      toast.success('Test supprimé.');
      await loadTests();
    } catch (e: any) {
      toast.error('Erreur : ' + (e?.message ?? 'Suppression impossible.'));
    }
  };

  // ── Subtest mutations ─────────────────────────────────────────────────────
  const addSubtest = () => {
    if (!testRecord) return;
    const newSub: SubtestDraft = {
      id: makeSubtestId(testRecord.id),
      test_id: testRecord.id,
      name: '',
      score_type: 'none',
      input_model: 'numeric_4mode',
      display_order: subtests.length + 1,
      display_group_order: null,
      organization_id: testRecord.organization_id ?? null,
      isNew: true,
    };
    setSubtests(prev => [...prev, newSub]);
    setIsDirty(true);
  };

  const updateSubtest = (id: string, patch: Partial<SubtestDraft>) => {
    setSubtests(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setIsDirty(true);
  };

  const removeSubtest = (id: string) => {
    setSubtests(prev => prev.filter(s => s.id !== id));
    setDeletedSubtestIds(prev => [...prev, id]);
    setIsDirty(true);
  };

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    setSubtests(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(s => s.id === draggingId);
      const toIdx = arr.findIndex(s => s.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr.map((s, i) => ({ ...s, display_order: i + 1 }));
    });
    setDraggingId(null);
    setIsDirty(true);
  };

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tests.filter(t => !q || t.name.toLowerCase().includes(q));
  }, [tests, search]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* LEFT — test list */}
      <div className="w-72 shrink-0 flex flex-col border-r border-white/5 bg-[#131419]">
        {/* Scope + search */}
        <div className="p-4 space-y-3 border-b border-white/5">
          <div className="flex gap-1 bg-white/5 rounded-lg p-1">
            {(['public', 'private', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => { setScope(s); setSelectedTestId(null); }}
                className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-1.5 rounded-md transition-all ${scope === s ? 'bg-white/10 text-white' : 'text-stone-500 hover:text-stone-300'}`}
              >
                {s === 'public' ? 'Public' : s === 'private' ? 'Privé' : 'Tous'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full bg-white/5 border border-white/5 rounded-lg pl-8 pr-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 outline-none focus:border-white/20"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2">
          {loadingTests ? (
            <div className="flex justify-center py-8 text-stone-500"><Loader2 size={20} className="animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-stone-600 text-xs py-8">Aucun test</p>
          ) : (
            filtered.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTestId(t.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-left transition-colors ${selectedTestId === t.id ? 'bg-white/10 text-white' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'}`}
              >
                {t.organization_id
                  ? <Lock size={12} className="shrink-0 text-amber-500" />
                  : <Globe size={12} className="shrink-0 text-emerald-500" />}
                <span className="truncate">{t.name}</span>
                <span className="ml-auto text-[10px] text-stone-600 shrink-0">{(t as any).subtest_count ?? 0}</span>
              </button>
            ))
          )}
        </div>

        {/* Refresh */}
        <div className="p-3 border-t border-white/5">
          <button onClick={loadTests} disabled={loadingTests} className="w-full flex items-center justify-center gap-2 py-2 text-xs text-stone-500 hover:text-stone-300 transition-colors">
            <RefreshCw size={12} className={loadingTests ? 'animate-spin' : ''} /> Actualiser
          </button>
        </div>
      </div>

      {/* RIGHT — detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedTestId ? (
          <div className="flex-1 flex items-center justify-center text-stone-600">
            <p className="text-sm">Sélectionnez un test pour l'éditer</p>
          </div>
        ) : loadingDetail ? (
          <div className="flex-1 flex items-center justify-center text-stone-500">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : testRecord ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#1A1C23] shrink-0">
              <div className="flex items-center gap-3">
                {testRecord.organization_id
                  ? <Lock size={14} className="text-amber-500" />
                  : <Globe size={14} className="text-emerald-500" />}
                <h2 className="font-bold text-white text-base truncate max-w-sm">{testRecord.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteTest}
                  className="p-2 rounded-lg text-stone-500 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                  title="Supprimer le test"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {isSaving ? 'Sauvegarde…' : 'Sauvegarder'}
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Test metadata */}
              <section className="grid grid-cols-2 gap-4">
                <label className="col-span-2 block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Nom du test</span>
                  <input
                    value={testRecord.name}
                    onChange={e => { setTestRecord(r => r ? { ...r, name: e.target.value } : r); setIsDirty(true); }}
                    className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/30"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Catégorie</span>
                  <select
                    value={testRecord.category_id}
                    onChange={e => { setTestRecord(r => r ? { ...r, category_id: e.target.value } : r); setIsDirty(true); }}
                    className="mt-1 w-full bg-[#1A1C23] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/30"
                  >
                    {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Auteur</span>
                  <input
                    value={testRecord.author ?? ''}
                    onChange={e => { setTestRecord(r => r ? { ...r, author: e.target.value } : r); setIsDirty(true); }}
                    placeholder="Auteur"
                    className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/30"
                  />
                </label>
              </section>

              {/* Subtests */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                    Sous-tests ({subtests.length})
                  </h3>
                  <button onClick={addSubtest} className="flex items-center gap-1.5 text-xs font-bold text-[var(--primary)] hover:opacity-80">
                    <Plus size={13} /> Ajouter
                  </button>
                </div>

                <div className="space-y-2">
                  {subtests.map(sub => (
                    <div
                      key={sub.id}
                      draggable
                      onDragStart={() => handleDragStart(sub.id)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => handleDrop(sub.id)}
                      className={`group flex items-start gap-2 p-3 rounded-xl border transition-colors ${draggingId === sub.id ? 'border-[var(--primary)]/60 bg-[var(--primary)]/5' : 'border-white/5 bg-white/3 hover:border-white/10'}`}
                    >
                      <button className="mt-2.5 text-stone-600 hover:text-stone-400 cursor-grab active:cursor-grabbing shrink-0">
                        <GripVertical size={14} />
                      </button>
                      <div className="flex-1 grid grid-cols-12 gap-2">
                        {/* Name */}
                        <input
                          value={sub.name}
                          onChange={e => updateSubtest(sub.id, { name: e.target.value })}
                          placeholder="Nom *"
                          className="col-span-6 bg-transparent border-b border-white/10 text-sm text-white py-1 outline-none focus:border-[var(--primary)] placeholder:text-stone-600"
                        />
                        {/* Score type */}
                        <select
                          value={sub.score_type ?? 'none'}
                          onChange={e => updateSubtest(sub.id, { score_type: e.target.value })}
                          className="col-span-6 bg-[#1A1C23] border border-white/5 rounded-lg text-xs text-stone-300 px-2 py-1 outline-none focus:border-white/20"
                        >
                          {SCORE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => removeSubtest(sub.id)}
                        className="mt-2 p-1 rounded text-stone-600 hover:text-rose-400 transition-colors shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}

                  {subtests.length === 0 && (
                    <div className="text-center py-8 text-stone-600 text-sm border border-dashed border-white/5 rounded-xl">
                      Aucun sous-test — cliquez sur « Ajouter » pour commencer.
                    </div>
                  )}
                </div>
              </section>

            </div>

            {/* Dirty footer */}
            {isDirty && (
              <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between shrink-0 bg-amber-900/10">
                <span className="text-xs text-amber-400">Modifications non sauvegardées</span>
                <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-200">
                  <Save size={12} /> Sauvegarder
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};
