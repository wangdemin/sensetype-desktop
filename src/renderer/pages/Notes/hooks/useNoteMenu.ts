import { useCallback, useEffect, useState } from 'react';

export function useNoteMenu() {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMenuId) return;
    const onDocClick = () => setActiveMenuId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [activeMenuId]);

  const toggleMenu = useCallback((id: string) => {
    setActiveMenuId((prev) => (prev === id ? null : id));
  }, []);

  const closeMenu = useCallback(() => setActiveMenuId(null), []);

  return { activeMenuId, toggleMenu, closeMenu };
}
