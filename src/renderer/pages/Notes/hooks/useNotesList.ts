import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createNote, deleteNote, getNotes, updateNote } from '@/services';
import type { NoteWithMeta } from './types';
import { getErrorMessage } from './notesUtils';

type UseNotesListParams = {
  pageSize?: number;
  setError: (v: string | null) => void;
};

export function useNotesList({ pageSize = 50, setError }: UseNotesListParams) {
  const [notes, setNotes] = useState<NoteWithMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  // 首次列表请求是否已完成（用于避免首屏 useEffect 触发前闪现空态）
  const [loadedOnce, setLoadedOnce] = useState(false);
  // 标记是否已加载完所有数据（当接口返回空列表时置为 true，防止 total 不准导致无限请求）
  const [isEnd, setIsEnd] = useState(false);

  const hasMore = !isEnd && notes.length < total;

  // 接收便签窗口的数据变更通知，刷新列表
  const refreshStateRef = useRef({ running: false, pending: false });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(1);
    setIsEnd(false);
    try {
      const res = await getNotes({ page: 1, size: pageSize, desc_by: 'updated' });
      if (res.success) {
        const list = res.data?.list ?? [];
        const nextTotal = res.data?.total ?? list.length;
        setNotes(list);
        setTotal(nextTotal);
        // 如果第一页就没填满 pageSize，或者返回空，说明可能没更多了（虽然 hasMore 会校验 length < total，但加上这个更保险）
        // 不过主要依赖 loadMore 的判空逻辑
        setError(null);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [pageSize, setError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const ipc =
      (window as any).electronAPI?.ipcRenderer ??
      (window as any).require?.('electron')?.ipcRenderer ??
      null;
    if (!ipc?.on || !ipc?.removeListener) return;

    const handler = (_event: any, payload: { kind?: unknown } | undefined) => {
      const kind = typeof payload?.kind === 'string' ? payload.kind : 'all';
      if (kind !== 'note' && kind !== 'all') return;

      const st = refreshStateRef.current;
      if (st.running) {
        st.pending = true;
        return;
      }
      st.running = true;
      void (async () => {
        try {
          await reload();
        } finally {
          st.running = false;
          if (st.pending) {
            st.pending = false;
            st.running = true;
            try {
              await reload();
            } finally {
              st.running = false;
            }
          }
        }
      })();
    };

    ipc.on('notes-data-changed', handler);
    return () => ipc.removeListener('notes-data-changed', handler);
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    const nextPage = page + 1;
    try {
      const res = await getNotes({ page: nextPage, size: pageSize, desc_by: 'updated' });
      if (res.success) {
        const list = res.data?.list ?? [];
        const nextTotal = res.data?.total ?? total;

        if (list.length === 0) {
          setIsEnd(true);
          // 如果后端 total 比实际多，这里修正一下 total，让界面显示准确
          setTotal((prev) => prev);
        } else {
          setNotes((prev) => [...prev, ...list]);
          setTotal(nextTotal);
          setPage(nextPage);
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore, page, pageSize, setError, total]);

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  const toggleNoteSelection = useCallback((noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  const selectAllNotes = useCallback(() => {
    const allIds = new Set(notes.map((n) => n.id));
    setSelectedNoteIds(allIds);
  }, [notes]);

  const clearSelection = useCallback(() => {
    setSelectedNoteIds(new Set());
  }, []);

  const batchDeleteNotes = useCallback(async () => {
    if (selectedNoteIds.size === 0) return;
    setLoading(true); // 使用 loading 状态或者新增一个 batchDeleting 状态，这里复用 loading 简单点，或者不阻断 UI 仅显示进度
    try {
      const idsToDelete = Array.from(selectedNoteIds);
      // 并发删除
      await Promise.all(idsToDelete.map((id) => deleteNote({ id })));
      
      // 更新本地状态
      setNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
      setTotal((prev) => Math.max(0, prev - idsToDelete.length));
      
      clearSelection();
      setIsBatchMode(false);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
      // 失败后可能需要重新拉取列表以保证一致性
      void reload();
    } finally {
      setLoading(false);
    }
  }, [selectedNoteIds, clearSelection, reload, setError]);

  // 退出批量模式时清空选中
  useEffect(() => {
    if (!isBatchMode) {
      clearSelection();
    }
  }, [isBatchMode, clearSelection]);

  return {
    notes,
    setNotes,
    total,
    setTotal,
    loading,
    loadingMore,
    hasMore,
    loadedOnce,
    reload,
    loadMore,
    isBatchMode,
    setIsBatchMode,
    selectedNoteIds,
    toggleNoteSelection,
    selectAllNotes,
    clearSelection,
    batchDeleteNotes,
  };
}

type UseNoteComposerParams = {
  setNotes: Dispatch<SetStateAction<NoteWithMeta[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  reload: () => Promise<void>;
  setError: (v: string | null) => void;
};

export function useNoteComposer({ setNotes, setTotal, reload, setError }: UseNoteComposerParams) {
  const [content, setContent] = useState('');
  const [creating, setCreating] = useState(false);

  const canCreate = useMemo(() => content.trim().length > 0 && !creating, [content, creating]);

  const create = useCallback(async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createNote({ content: content.trim() });
      if (res.success) {
        const newNote = res.data;
        if (newNote?.id) {
          setNotes((prev) => [newNote, ...prev]);
          setTotal((prev) => prev + 1);
        } else {
          await reload();
        }
        setContent('');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }, [canCreate, content, reload, setError, setNotes, setTotal]);

  return { content, setContent, canCreate, creating, create };
}

type UseNoteEditorParams = {
  reload: () => Promise<void>;
  setError: (v: string | null) => void;
};

export function useNoteEditor({ reload, setError }: UseNoteEditorParams) {
  const [editNote, setEditNote] = useState<NoteWithMeta | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = useCallback((note: NoteWithMeta) => {
    setEditNote(note);
    setEditContent(note.content || '');
  }, []);

  const closeEdit = useCallback(() => setEditNote(null), []);

  const saveEdit = useCallback(async () => {
    if (!editNote) return;
    const next = editContent.trim();
    if (!next) return;
    setEditSaving(true);
    setError(null);
    try {
      const res = await updateNote({ id: editNote.id, content: next });
      if (res.success) {
        setEditNote(null);
        await reload();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setEditSaving(false);
    }
  }, [editContent, editNote, reload, setError]);

  return { editNote, editContent, setEditContent, editSaving, openEdit, closeEdit, saveEdit };
}

type UseNoteDeletionParams = {
  setNotes: Dispatch<SetStateAction<NoteWithMeta[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setError: (v: string | null) => void;
};

export function useNoteDeletion({ setNotes, setTotal, setError }: UseNoteDeletionParams) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const requestDelete = useCallback((id: string) => setConfirmDeleteId(id), []);
  const cancelDelete = useCallback(() => setConfirmDeleteId(null), []);

  const deleteConfirmed = useCallback(async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteNote({ id: confirmDeleteId });
      if (res.success) {
        setNotes((prev) => prev.filter((n) => n.id !== confirmDeleteId));
        setTotal((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, setError, setNotes, setTotal]);

  return { confirmDeleteId, requestDelete, cancelDelete, deleting, deleteConfirmed };
}
