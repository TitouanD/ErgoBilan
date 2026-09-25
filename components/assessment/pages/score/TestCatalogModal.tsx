/**
 * TestCatalogModal — picker used by the score page to add tests/subtests from
 * the catalogue (search, categories, favourites, recent tests), create a
 * custom test or add a free observation.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Layers, MessageSquare, Plus, Search, Star, X } from 'lucide-react';
import type { TestData } from '../../../../types';
import type { SubtestDef } from '../../../../data/testCatalog';
import { useCatalog } from '../../../../contexts/CatalogContext';
import { useFavoriteTests } from '../../../../hooks/useFavoriteTests';
import { CustomTestEditor } from '../../shared/CustomTestEditor';
import {
  compareSubtestsForDisplay,
  getDisplayGroupKey,
  getDisplayGroupLabel,
  getSubtestDisplayName,
} from '../../../../utils/subtestOrdering';
import { CUSTOM_OBSERVATIONS_TEST_ID } from '../../../../utils/catalogIndex';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingTests: TestData;
  /** testId → subtest ids to add. */
  onAddTests: (selection: Record<string, string[]>) => void;
}

export const TestCatalogModal: React.FC<Props> = ({ isOpen, onClose, existingTests, onAddTests }) => {
  const { catalog, searchTests, ensureCatalogLoaded, reloadCatalog, loading } = useCatalog();
  const { recentTests, toggleFavorite, isFavorite } = useFavoriteTests();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [subtestSearchByTest, setSubtestSearchByTest] = useState<Record<string, string>>({});
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    ensureCatalogLoaded();
    setExpandedTestId(null);
    setActiveCategoryId('all');
    setSubtestSearchByTest({});
  }, [isOpen, ensureCatalogLoaded]);

  const toggleSubtest = (testId: string, subtestId: string) => {
    setSelected((prev) => {
      const current = prev[testId] || [];
      if (current.includes(subtestId)) {
        const next = current.filter((id) => id !== subtestId);
        if (next.length === 0) {
          const { [testId]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [testId]: next };
      }
      return { ...prev, [testId]: [...current, subtestId] };
    });
  };

  const totalSelected = Object.values(selected).reduce((acc: number, ids: string[]) => acc + ids.length, 0);
  const categoryTabs = useMemo(() => [{ id: 'all', label: 'Tous' }, ...catalog.map((c) => ({ id: c.id, label: c.name }))], [catalog]);
  const allTests = useMemo(() => catalog.flatMap((c) => c.tests), [catalog]);
  const testsToRender = useMemo(() => {
    if (searchTerm.trim()) return searchTests(searchTerm.trim());
    if (activeCategoryId === 'all') return allTests;
    return catalog.find((c) => c.id === activeCategoryId)?.tests || [];
  }, [searchTerm, searchTests, activeCategoryId, catalog, allTests]);
  const favoriteTests = useMemo(() => allTests.filter((t) => isFavorite(t.id)), [allTests, isFavorite]);
  const recentTestObjects = useMemo(
    () => recentTests.map((id) => allTests.find((t) => t.id === id)).filter(Boolean) as typeof allTests,
    [recentTests, allTests],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[var(--secondary)]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-6xl h-[88vh] rounded-[34px] overflow-hidden bg-[var(--card-bg)] shadow-[0_35px_80px_rgba(0,0,0,0.28)] border border-[var(--border-color)] flex flex-col">
        <div className="px-6 py-5 border-b border-[var(--border-color)] bg-[var(--card-bg)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif font-bold text-2xl flex items-center gap-3">
                <Layers size={24} className="text-[var(--primary)]" />
                Catalogue tests
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Sélection rapide des tests et sous-tests.</p>
            </div>
            <div className="flex items-center gap-2">
              {totalSelected > 0 && (
                <span className="rounded-full bg-[var(--primary)] text-white px-3 py-1 text-xs font-bold">
                  {totalSelected} sélectionné(s)
                </span>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-full bg-[var(--hover-bg)] hover:bg-[var(--border-color)] transition-colors text-[var(--text-secondary)]"
              >
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {searchTerm.trim() && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--hover-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] text-sm font-bold hover:border-[var(--secondary)] hover:text-[var(--text-heading)] transition-colors"
              >
                <ChevronLeft size={16} />
                Catégories
              </button>
            )}
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher un test ou un sous-test..."
                className="w-full pl-12 pr-4 py-3 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl outline-none text-[var(--text-heading)] font-semibold focus:ring-2 focus:ring-[var(--primary-opacity-20)]"
                autoFocus
              />
            </div>
          </div>
          {!searchTerm.trim() && (
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCategoryId(tab.id)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
                    activeCategoryId === tab.id
                      ? 'bg-[var(--secondary)] text-white shadow-sm'
                      : 'bg-[var(--progress-bg)] text-[var(--text-main)] hover:bg-[var(--border-color)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-[var(--app-bg)] custom-scrollbar">
          {loading && testsToRender.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Chargement...</p>}
          {testsToRender.length === 0 && !loading && (
            <p className="text-sm text-[var(--text-secondary)]">Aucun test trouvé pour ce filtre.</p>
          )}

          {/* Favorites section */}
          {!searchTerm.trim() && favoriteTests.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <Star size={11} className="text-amber-400 fill-amber-400" />
                Favoris
              </h3>
              <div className="flex flex-wrap gap-2">
                {favoriteTests.map((t) => {
                  const sc = (selected[t.id] || []).length;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setExpandedTestId((prev) => (prev === t.id ? null : t.id))}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${sc > 0 ? 'bg-[var(--primary-opacity-5)] border-[var(--primary)]/40 text-[var(--primary)]' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'}`}
                    >
                      {t.name}
                      {sc > 0 && <span className="ml-1.5 rounded-full bg-[var(--primary)] text-white px-1.5 text-[10px]">{sc}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent tests section */}
          {!searchTerm.trim() && recentTestObjects.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Récemment utilisés</h3>
              <div className="flex flex-wrap gap-2">
                {recentTestObjects.map((t) => {
                  const sc = (selected[t.id] || []).length;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setExpandedTestId((prev) => (prev === t.id ? null : t.id))}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${sc > 0 ? 'bg-[var(--primary-opacity-5)] border-[var(--primary)]/40 text-[var(--primary)]' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'}`}
                    >
                      {t.name}
                      {sc > 0 && <span className="ml-1.5 rounded-full bg-[var(--primary)] text-white px-1.5 text-[10px]">{sc}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            {testsToRender.map((test) => {
              const isExpanded = expandedTestId === test.id;
              const selectedCount = (selected[test.id] || []).length;
              const alreadyCount = Object.keys(existingTests[test.id] || {}).length;
              const subtestSearch = (subtestSearchByTest[test.id] || '').trim().toLowerCase();
              const filteredSubtests = subtestSearch
                ? test.subtests.filter((st) => getSubtestDisplayName(st).toLowerCase().includes(subtestSearch))
                : test.subtests;
              return (
                <div
                  key={test.id}
                  className={`rounded-2xl border overflow-hidden transition-all ${
                    selectedCount > 0
                      ? 'border-[var(--primary)]/40 bg-[var(--primary-opacity-5)] shadow-sm'
                      : 'border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--text-secondary)]'
                  } ${isExpanded ? 'xl:col-span-2' : ''}`}
                >
                  {/* Two sibling buttons: a <button> cannot contain another one. */}
                  <div className="flex items-center gap-2 pr-3">
                    <button
                      type="button"
                      onClick={() => setExpandedTestId((prev) => (prev === test.id ? null : test.id))}
                      className="flex-1 min-w-0 pl-4 py-3 text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[var(--text-heading)] truncate">{test.name}</p>
                        <p className="text-[11px] text-[var(--text-secondary)]">{test.subtests.length} sous-tests</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {alreadyCount > 0 && (
                          <span className="rounded-full bg-[var(--progress-bg)] text-[var(--text-secondary)] px-2 py-0.5 text-[10px] font-bold">
                            {alreadyCount} déjà
                          </span>
                        )}
                        {selectedCount > 0 && (
                          <span className="rounded-full bg-[var(--primary)] text-white px-2 py-0.5 text-[10px] font-bold">
                            {selectedCount}
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-[var(--text-secondary)]" />
                        ) : (
                          <ChevronRight size={16} className="text-[var(--text-secondary)]" />
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(test.id)}
                      className="p-1 rounded-lg hover:bg-[var(--hover-bg)] transition-colors shrink-0"
                      aria-label={isFavorite(test.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    >
                      <Star size={14} className={isFavorite(test.id) ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-disabled)]'} />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-[var(--border-color)] px-3 pb-3 pt-2 grid grid-cols-1 gap-2">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
                        <input
                          value={subtestSearchByTest[test.id] || ''}
                          onChange={(e) => setSubtestSearchByTest((prev) => ({ ...prev, [test.id]: e.target.value }))}
                          placeholder="Filtrer les sous-tests..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl outline-none focus:ring-1 focus:ring-[var(--primary-opacity-20)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)]"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                        {(() => {
                          const sortedSTs = [...filteredSubtests].sort(compareSubtestsForDisplay);
                          const selItems: Array<{ type: 'header'; gkey: string; label: string } | { type: 'sub'; st: SubtestDef }> = [];
                          let lastSelGKey = '';
                          for (const st of sortedSTs) {
                            const gKey = getDisplayGroupKey(st);
                            if (gKey && gKey !== lastSelGKey && !subtestSearch) {
                              selItems.push({ type: 'header', gkey: gKey, label: getDisplayGroupLabel(st) || gKey });
                              lastSelGKey = gKey;
                            }
                            selItems.push({ type: 'sub', st });
                          }
                          return selItems.map((item) => {
                            if (item.type === 'header') {
                              return (
                                <div key={`grp-${item.gkey}`} className="col-span-full mt-2 first:mt-0 flex items-center gap-2 px-1">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--primary)]">
                                    {item.label}
                                  </span>
                                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                                </div>
                              );
                            }
                            const { st } = item;
                            const already = existingTests[test.id]?.[st.id] !== undefined;
                            const checked = already || (selected[test.id] || []).includes(st.id);
                            return (
                              <label
                                key={st.id}
                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                                  already
                                    ? 'bg-[var(--hover-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                    : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={already}
                                  onChange={() => toggleSubtest(test.id, st.id)}
                                  className="accent-[var(--primary)]"
                                />
                                <span className="truncate">{getSubtestDisplayName(st)}</span>
                                {already && <span className="ml-auto text-[10px] uppercase font-bold">ajouté</span>}
                              </label>
                            );
                          });
                        })()}
                      </div>
                      {filteredSubtests.length === 0 && (
                        <p className="text-xs text-[var(--text-secondary)] px-1 py-2">Aucun sous-test ne correspond à la recherche.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border-color)] bg-[var(--card-bg)] flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-secondary)] font-semibold">{totalSelected} épreuve(s) sélectionnée(s)</span>
            <button
              type="button"
              onClick={() => setShowCustomEditor(true)}
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--primary)] hover:underline"
            >
              <Plus size={13} /> Créer un test
            </button>
            <button
              type="button"
              onClick={() => {
                onAddTests({ [CUSTOM_OBSERVATIONS_TEST_ID]: [`custom_${Date.now()}`] });
                onClose();
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--primary)] hover:underline transition-colors"
            >
              <MessageSquare size={13} /> Observation libre
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 font-bold text-[var(--text-secondary)]">
              Annuler
            </button>
            <button
              onClick={() => {
                onAddTests(selected);
                setSelected({});
                onClose();
              }}
              disabled={totalSelected === 0}
              className="px-5 py-2 rounded-xl bg-[var(--secondary)] text-white font-bold disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
        </div>
      </div>
      {showCustomEditor && <CustomTestEditor onClose={() => setShowCustomEditor(false)} onCreated={() => void reloadCatalog()} />}
    </div>
  );
};
