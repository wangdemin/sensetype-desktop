import { useEffect, useState } from 'react';

function getIpcRenderer() {
  if ((window as any).electronAPI?.ipcRenderer) {
    return (window as any).electronAPI.ipcRenderer;
  } else if ((window as any).require) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (window as any).require('electron').ipcRenderer;
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function useStickyNoteState() {
  const [openStickyNoteIds, setOpenStickyNoteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ipc = getIpcRenderer();
    if (!ipc) return;

    // Initial fetch
    if (ipc.invoke) {
      ipc.invoke('get-open-sticky-notes')
        .then((ids: unknown) => {
          if (Array.isArray(ids)) {
            setOpenStickyNoteIds(new Set(ids));
          }
        })
        .catch(() => {
          // ignore
        });
    }

    const handleStateChange = (_event: any, payload: any) => {
      const { id, isOpen } = payload || {};
      if (!id) return;
      setOpenStickyNoteIds((prev) => {
        const next = new Set(prev);
        if (isOpen) {
          next.add(String(id));
        } else {
          next.delete(String(id));
        }
        return next;
      });
    };

    if (ipc.on) {
      ipc.on('sticky-note-state-change', handleStateChange);
    }

    return () => {
      if (ipc.removeListener) {
        ipc.removeListener('sticky-note-state-change', handleStateChange);
      }
    };
  }, []);

  return openStickyNoteIds;
}
