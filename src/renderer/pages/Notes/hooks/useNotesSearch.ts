import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { NoteWithMeta } from './types';
import { getNoteTimestamp } from './notesUtils';

type Params = {
  notes: NoteWithMeta[];
};

export function useNotesSearch({ notes }: Params) {
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(queryInput);
    }, 500);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredNotes = useMemo(() => {
    let out = notes;
    if (normalizedQuery) {
      out = out.filter((note) => (note.content || '').toLowerCase().includes(normalizedQuery));
    }
    const sorted = [...out];
    sorted.sort((a, b) => {
      const aTime = getNoteTimestamp(a) ?? 0;
      const bTime = getNoteTimestamp(b) ?? 0;
      return bTime - aTime;
    });
    return sorted;
  }, [notes, normalizedQuery]);

  const onSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setQueryInput('');
      setQuery('');
    }
  }, []);

  const clearSearch = useCallback(() => {
    setQueryInput('');
    setQuery('');
  }, []);

  const clearSearchAndFocus = useCallback(() => {
    setQueryInput('');
    setQuery('');
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  return {
    queryInput,
    setQueryInput,
    normalizedQuery,
    filteredNotes,
    searchInputRef,
    onSearchKeyDown,
    clearSearch,
    clearSearchAndFocus,
  };
}
