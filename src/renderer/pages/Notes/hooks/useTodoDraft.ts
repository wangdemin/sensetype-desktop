import { useCallback, useRef, useState } from 'react';
import type { DraftItem } from './todoList.types';

function createDraftId(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const useTodoDraft = () => {
  const [groupTitle, setGroupTitle] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([
    { id: createDraftId(), text: '', done: false },
  ]);
  const draftInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const resetDraft = useCallback(() => {
    setGroupTitle('');
    setDraftItems([{ id: createDraftId(), text: '', done: false }]);
  }, []);

  const addDraftItem = useCallback((focusNewItem = false) => {
    setDraftItems((prev) => {
      const newId = createDraftId();
      const newItems = [...prev, { id: newId, text: '', done: false }];
      if (focusNewItem) {
        setTimeout(() => {
          const nextInput = draftInputRefs.current.get(newId);
          nextInput?.focus();
        }, 0);
      }
      return newItems;
    });
  }, []);

  const updateDraftItem = useCallback((id: string, updates: Partial<DraftItem>) => {
    setDraftItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const removeDraftItem = useCallback((id: string) => {
    setDraftItems((prev) => {
      const filtered = prev.filter((item) => item.id !== id);
      return filtered.length === 0 ? [{ id: createDraftId(), text: '', done: false }] : filtered;
    });
  }, []);

  return {
    groupTitle,
    setGroupTitle,
    draftItems,
    draftInputRefs,
    resetDraft,
    addDraftItem,
    updateDraftItem,
    removeDraftItem,
  };
};
