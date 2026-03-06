import { useCallback, useState } from 'react';
import type { NotesLayout } from './types';

export function useNotesLayout(initial: NotesLayout = 'two') {
  const [layout, setLayout] = useState<NotesLayout>(initial);

  const toggleLayout = useCallback(() => {
    setLayout((prev) => {
      if (prev === 'one') return 'two';
      if (prev === 'two') return 'three';
      return 'one';
    });
  }, []);

  return { layout, toggleLayout };
}
