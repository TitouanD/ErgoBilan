import { useState, useCallback } from 'react';

interface TextHistory {
    value: string;
    set: (newValue: string) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    reset: (newValue: string) => void;
}

/**
 * Hook providing per-section undo/redo history for text editing.
 * Each call to `set()` pushes the current value onto the undo stack.
 * `reset()` clears the history (used when switching sections or cancelling edit).
 */
export const useTextHistory = (initialValue: string): TextHistory => {
    const [past, setPast] = useState<string[]>([]);
    const [present, setPresent] = useState<string>(initialValue);
    const [future, setFuture] = useState<string[]>([]);

    const set = useCallback((newValue: string) => {
        setPast(prev => [...prev, present]);
        setPresent(newValue);
        setFuture([]);
    }, [present]);

    const undo = useCallback(() => {
        if (past.length === 0) return;
        const previous = past[past.length - 1];
        setPast(prev => prev.slice(0, -1));
        setFuture(prev => [present, ...prev]);
        setPresent(previous);
    }, [past, present]);

    const redo = useCallback(() => {
        if (future.length === 0) return;
        const next = future[0];
        setFuture(prev => prev.slice(1));
        setPast(prev => [...prev, present]);
        setPresent(next);
    }, [future, present]);

    const reset = useCallback((newValue: string) => {
        setPast([]);
        setPresent(newValue);
        setFuture([]);
    }, []);

    return {
        value: present,
        set,
        undo,
        redo,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        reset,
    };
};
