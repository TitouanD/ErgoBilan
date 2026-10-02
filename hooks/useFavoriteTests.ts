import { useState, useCallback } from 'react';

const STORAGE_KEY = 'ergo_favorite_tests';
const RECENT_KEY = 'ergo_recent_tests';
const MAX_FAVORITES = 20;
const MAX_RECENT = 5;

const readIds = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const writeIds = (key: string, ids: string[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Ignore storage failures
  }
};

export const useFavoriteTests = () => {
  const [favorites, setFavoritesState] = useState<string[]>(() => readIds(STORAGE_KEY));
  const [recentTests, setRecentState] = useState<string[]>(() => readIds(RECENT_KEY));

  const toggleFavorite = useCallback((testId: string) => {
    setFavoritesState((prev) => {
      const next = prev.includes(testId) ? prev.filter((id) => id !== testId) : [testId, ...prev].slice(0, MAX_FAVORITES);
      writeIds(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const isFavorite = useCallback((testId: string) => favorites.includes(testId), [favorites]);

  const pushRecent = useCallback((testIds: string[]) => {
    setRecentState((prev) => {
      const next = [...testIds, ...prev.filter((id) => !testIds.includes(id))].slice(0, MAX_RECENT);
      writeIds(RECENT_KEY, next);
      return next;
    });
  }, []);

  return { favorites, recentTests, toggleFavorite, isFavorite, pushRecent };
};
