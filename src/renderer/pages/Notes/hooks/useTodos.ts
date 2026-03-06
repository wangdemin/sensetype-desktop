import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { DraftItem, TodoGroup, TodoItem } from './todoList.types';
import { createTodo, deleteTodo, getTodoList, updateTodo, updateTodoTask } from '@/services/notes';
import type {
  TodoItem as ApiTodoGroup,
  TodoTaskDTO as ApiTodoTaskDTO,
} from '@/services/notes/types';
import { TodoTaskStatus } from '@/services/notes/types';
import { getErrorMessage, toTimestamp } from './notesUtils';

const STORAGE_KEY = 'notes_todos_v1';
const TODO_PAGE_SIZE = 10;

function createClientTaskKey(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) {
    return `client_${cryptoObj.randomUUID()}`;
  }
  return `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function mapApiTodosToLocal(apiTodos: ApiTodoGroup[]): TodoItem[] {
  const local: TodoItem[] = [];

  for (const group of apiTodos) {
    const groupId = group?.id || '';
    const groupTitle = group?.title || undefined;
    const createdAt = toTimestamp(group?.created_at) ?? Date.now();
    const updatedAt = toTimestamp(group?.updated_at) ?? createdAt;

    const tasksAll: ApiTodoTaskDTO[] = Array.isArray(group?.tasks) ? group.tasks : [];
    // 后端可能返回 deleted=true 的任务，这里不展示
    const tasks = tasksAll.filter((t) => !t?.deleted);
    if (tasks.length === 0) {
      // 兼容“只有标题没有条目”的清单：用占位 item 维持分组结构
      local.push({
        id: `${groupId}_placeholder`,
        text: '',
        done: false,
        createdAt,
        updatedAt,
        groupTitle,
        groupId,
      });
      continue;
    }

    for (const task of tasks) {
      local.push({
        id: task?.id || '',
        text: task?.todo ?? '',
        done: task?.status === TodoTaskStatus.COMPLETED,
        createdAt,
        updatedAt,
        groupTitle,
        groupId,
      });
    }
  }

  return local;
}

type UseTodosSourceParams = {
  pageSize?: number;
};

export function useTodosSource({ pageSize = TODO_PAGE_SIZE }: UseTodosSourceParams = {}) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [isEnd, setIsEnd] = useState(false);
  const [loadedGroupsCount, setLoadedGroupsCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const refreshStateRef = useRef({ running: false, pending: false });
  const epochRef = useRef(0);
  const refreshingRef = useRef(false);
  const pageRef = useRef(1);
  const loadedGroupIdsRef = useRef<Set<string>>(new Set());

  const mergeTodosById = useCallback((prev: TodoItem[], next: TodoItem[]) => {
    if (next.length === 0) return prev;
    const nextById = new Map(next.map((t) => [t.id, t] as const));
    const seen = new Set<string>();
    const merged: TodoItem[] = [];
    // 先保持旧顺序，替换同 id 条目
    for (const item of prev) {
      const replacement = nextById.get(item.id);
      merged.push(replacement ?? item);
      seen.add(item.id);
    }
    // 再追加新条目
    for (const item of next) {
      if (seen.has(item.id)) continue;
      merged.push(item);
    }
    return merged;
  }, []);

  const hasMore = !isEnd && loadedGroupsCount < total;

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const reloadFromServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    refreshingRef.current = true;
    const myEpoch = ++epochRef.current;
    try {
      // 刷新当前已加载的页数，避免“回到第一页再加载第二页”造成闪烁
      const pagesToFetch = Math.max(1, pageRef.current);
      const groups: ApiTodoGroup[] = [];
      let nextTotal = total;
      let fetchedPages = 0;

      for (let p = 1; p <= pagesToFetch; p++) {
        const res = await getTodoList({ page: p, size: pageSize });
        // console.log(res, '---------reloadFromServer');
        if (epochRef.current !== myEpoch) return;
        if (!res.success) continue;

        const list = res.data?.list ?? [];
        nextTotal = res.data?.total ?? nextTotal;
        fetchedPages = p;

        if (list.length === 0) break;
        groups.push(...list);

        // 最后一页不足 pageSize 时，可提前结束
        if (list.length < pageSize) break;
      }

      // 以 group.id 去重，避免并发/重试导致重复组进入本地列表
      const uniqueGroups: ApiTodoGroup[] = [];
      const nextGroupIds = new Set<string>();
      for (const g of groups) {
        const id = g?.id ?? '';
        if (!id) continue;
        if (nextGroupIds.has(id)) continue;
        nextGroupIds.add(id);
        uniqueGroups.push(g);
      }

      const mapped = mapApiTodosToLocal(uniqueGroups);
      const effectiveTotal =
        typeof nextTotal === 'number' && Number.isFinite(nextTotal) && nextTotal > 0
          ? nextTotal
          : uniqueGroups.length;
      loadedGroupIdsRef.current = nextGroupIds;
      setTodos(mapped);
      setTotal(effectiveTotal);
      setLoadedGroupsCount(uniqueGroups.length);
      setPage(Math.max(1, fetchedPages || 1));
      pageRef.current = Math.max(1, fetchedPages || 1);
      setIsEnd(uniqueGroups.length === 0 || uniqueGroups.length >= effectiveTotal);
    } catch (err) {
      const msg = getErrorMessage(err);

      console.error('[todos] reloadFromServer failed:', msg, err);
      setError(msg);
    } finally {
      setLoading(false);
      refreshingRef.current = false;
      setLoadedOnce(true);
    }
  }, [pageSize, total]);

  useEffect(() => {
    // 清理历史本地缓存（数据源已切到接口）
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    void reloadFromServer();
  }, [reloadFromServer]);

  // 接收便签窗口的数据变更通知，刷新 todo 列表
  useEffect(() => {
    const ipc =
      (window as any).electronAPI?.ipcRenderer ??
      (window as any).require?.('electron')?.ipcRenderer ??
      null;
    if (!ipc?.on || !ipc?.removeListener) return;

    const handler = (_event: any, payload: { kind?: unknown } | undefined) => {
      const kind = typeof payload?.kind === 'string' ? payload.kind : 'all';
      if (kind !== 'todo' && kind !== 'all') return;

      const st = refreshStateRef.current;
      if (st.running) {
        st.pending = true;
        return;
      }
      st.running = true;
      void (async () => {
        try {
          await reloadFromServer();
        } finally {
          st.running = false;
          if (st.pending) {
            st.pending = false;
            st.running = true;
            try {
              await reloadFromServer();
            } finally {
              st.running = false;
            }
          }
        }
      })();
    };

    ipc.on('notes-data-changed', handler);
    return () => ipc.removeListener('notes-data-changed', handler);
  }, [reloadFromServer]);

  const loadMore = useCallback(async () => {
    // 刷新期间禁止 loadMore，避免“第二页重复追加/闪烁”
    if (refreshingRef.current) return;
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    const myEpoch = epochRef.current;
    try {
      const nextPage = pageRef.current + 1;
      const res = await getTodoList({ page: nextPage, size: pageSize });
      if (epochRef.current !== myEpoch) return;
      if (res.success) {
        const list = res.data?.list ?? [];
        const nextTotal = res.data?.total ?? total;

        if (list.length === 0) {
          setIsEnd(true);
        } else {
          // 以 group.id 去重，避免并发/重复请求同一页导致重复加载
          const newGroups: ApiTodoGroup[] = [];
          for (const g of list) {
            const id = g?.id ?? '';
            if (!id) continue;
            if (loadedGroupIdsRef.current.has(id)) continue;
            loadedGroupIdsRef.current.add(id);
            newGroups.push(g);
          }

          const mapped = mapApiTodosToLocal(newGroups);
          setTodos((prev) => mergeTodosById(prev, mapped));
          setTotal(nextTotal);
          setLoadedGroupsCount((prev) => prev + newGroups.length);
          setPage(nextPage);
          pageRef.current = nextPage;
        }
      }
    } catch (err) {
      const msg = getErrorMessage(err);

      console.error('[todos] loadMore failed:', msg, err);
      setError(msg);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore, mergeTodosById, pageSize, total]);

  return {
    todos,
    setTodos,
    total,
    loading,
    loadingMore,
    hasMore,
    loadedOnce,
    error,
    setError,
    reloadFromServer,
    loadMore,
  };
}

type UseTodoMutationsParams = {
  reloadFromServer: () => Promise<void>;
  setError: (v: string | null) => void;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  getTodosSnapshot: () => TodoItem[];
};

export function useTodoMutations({
  reloadFromServer,
  setError,
  setTodos,
  getTodosSnapshot,
}: UseTodoMutationsParams) {
  const [saving, setSaving] = useState(false);

  const createGroup = useCallback(
    async (draftItems: DraftItem[], groupTitle: string) => {
      const normalizedTitle = groupTitle.trim();
      const validItems = draftItems.filter((item) => item.text.trim());

      setSaving(true);
      setError(null);
      try {
        const tasks = validItems.map((item) => ({
          todo: item.text.trim(),
          status: item.done ? TodoTaskStatus.COMPLETED : TodoTaskStatus.TODO,
        }));

        // 如果只有标题没有任务，传一个空任务给后端，确保组能被创建且标题不丢失
        if (tasks.length === 0 && normalizedTitle) {
          tasks.push({
            todo: '',
            status: TodoTaskStatus.TODO,
          });
        }

        await createTodo({
          title: normalizedTitle,
          tasks,
        });

        await reloadFromServer();
      } catch (err) {
        const msg = getErrorMessage(err);

        console.error('[todos] createGroup failed:', msg, err);
        setError(msg);
      } finally {
        setSaving(false);
      }
    },
    [reloadFromServer, setError],
  );

  const toggleTaskStatus = useCallback(
    async (id: string) => {
      setError(null);

      // 使用 ref 提供的“最新快照”，避免依赖 setState 的执行时序
      const prevSnapshot = getTodosSnapshot();
      const current = prevSnapshot.find((t) => t.id === id);
      if (!current || !current.text.trim() || current.id.includes('_placeholder')) return;

      const nextDone = !current.done;

      // 更新 UI
      setTodos((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (!item.text.trim() || item.id.includes('_placeholder')) return item;
          return { ...item, done: nextDone, updatedAt: Date.now() };
        }),
      );
      try {
        await updateTodoTask({
          id: current.id,
          todo: current.text.trim(),
          status: nextDone ? TodoTaskStatus.COMPLETED : TodoTaskStatus.TODO,
        });
        // 轻量场景不 reload：本地已乐观更新，无需全量刷新，避免 loading 状态
        // 导致底部元素闪烁 / 滚动位置跳动
      } catch (err) {
        // 回滚
        setTodos(prevSnapshot);
        const msg = getErrorMessage(err);

        console.error('[todos] toggleTaskStatus failed:', msg, err);
        setError(msg);
      }
    },
    [getTodosSnapshot, setError, setTodos],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      setSaving(true);
      setError(null);
      try {
        await deleteTodo({ id: groupId });
        await reloadFromServer();
      } catch (err) {
        const msg = getErrorMessage(err);

        console.error('[todos] deleteGroup failed:', msg, err);
        setError(msg);
      } finally {
        setSaving(false);
      }
    },
    [reloadFromServer, setError],
  );

  return {
    saving,
    createGroup,
    toggleTaskStatus,
    deleteGroup,
  };
}

export const useTodos = () => {
  const {
    todos,
    setTodos,
    total: groupsTotal,
    loading,
    loadingMore,
    hasMore,
    loadedOnce,
    error,
    setError,
    reloadFromServer,
    loadMore,
  } = useTodosSource({
    pageSize: TODO_PAGE_SIZE,
  });
  const todosRef = useRef<TodoItem[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupItems, setEditingGroupItems] = useState<TodoItem[]>([]);
  const [editingGroupTitle, setEditingGroupTitle] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQueryInput, setDebouncedQueryInput] = useState('');
  const editItemInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const {
    saving,
    createGroup,
    toggleTaskStatus,
    deleteGroup: deleteGroupApi,
  } = useTodoMutations({
    reloadFromServer,
    setError,
    setTodos,
    getTodosSnapshot: () => todosRef.current,
  });

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  const toggleGroupSelection = useCallback((groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const selectAllGroups = useCallback(() => {
    // 只能全选当前已加载的 todos 里的组
    const allGroupIds = new Set(
      todosRef.current.map((t) => t.groupId).filter((id): id is string => Boolean(id)),
    );
    setSelectedGroupIds(allGroupIds);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedGroupIds(new Set());
  }, []);

  const batchDeleteGroups = useCallback(async () => {
    if (selectedGroupIds.size === 0) return;
    try {
      const idsToDelete = Array.from(selectedGroupIds);
      await Promise.all(idsToDelete.map((id) => deleteGroupApi(id)));
      clearSelection();
      setIsBatchMode(false);
    } catch (err) {
      console.error('[todos] batchDeleteGroups failed:', err);
      // 这里的错误处理可能不够精细，但 deleteGroupApi 内部已经有 setError
    }
  }, [deleteGroupApi, selectedGroupIds, clearSelection]);

  useEffect(() => {
    if (!isBatchMode) {
      clearSelection();
    }
  }, [isBatchMode, clearSelection]);

  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQueryInput(queryInput);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const stats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter((item) => item.done).length;
    return { total, completed };
  }, [todos]);

  const addTasks = useCallback(
    (draftItems: DraftItem[], groupTitle: string) => {
      // 由接口创建，成功后刷新列表；这里不做本地插入，避免临时 id 与服务端不一致
      void createGroup(draftItems, groupTitle);
    },
    [createGroup],
  );

  const toggleDone = useCallback(
    (id: string) => {
      void toggleTaskStatus(id);
    },
    [toggleTaskStatus],
  );

  const openEditGroup = useCallback(
    (groupId: string) => {
      const groupItems = todos.filter((item) => item.groupId === groupId);
      if (groupItems.length === 0) return;
      setEditingGroupId(groupId);
      setEditingGroupItems([...groupItems]);
      setEditingGroupTitle(groupItems[0]?.groupTitle || '');
    },
    [todos],
  );

  const closeEditGroup = useCallback(() => {
    setEditingGroupId(null);
    setEditingGroupItems([]);
    setEditingGroupTitle('');
  }, []);

  const updateEditingGroupItem = useCallback((id: string, updates: Partial<TodoItem>) => {
    setEditingGroupItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }, []);

  const deleteEditingGroupItem = useCallback((id: string) => {
    setEditingGroupItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addEditingGroupItem = useCallback(() => {
    if (!editingGroupId) return;
    const newId = createClientTaskKey();
    const newItem: TodoItem = {
      id: newId,
      text: '',
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      groupTitle: editingGroupTitle || undefined,
      groupId: editingGroupId,
    };
    setEditingGroupItems((prev) => [...prev, newItem]);
    setTimeout(() => {
      const newInput = editItemInputRefs.current.get(newId);
      newInput?.focus();
    }, 0);
  }, [editingGroupId, editingGroupTitle]);

  const saveEditingGroup = useCallback(() => {
    if (!editingGroupId) return;
    const normalizedTitle = editingGroupTitle.trim();
    const validItems = editingGroupItems.filter(
      (item) => item.text.trim() && !item.id.includes('_placeholder'),
    );

    // 无标题且无任务：视为删除整个组
    if (!normalizedTitle && validItems.length === 0) {
      void (async () => {
        try {
          setError(null);
          await deleteTodo({ id: editingGroupId });
          await reloadFromServer();
          closeEditGroup();
        } catch (err) {
          const msg = getErrorMessage(err);

          console.error('[todos] deleteEmptyGroupWhileSaving failed:', msg, err);
          setError(msg);
        }
      })();
      return;
    }

    // 计算原始任务列表，用于识别删除/更新/新增
    const originalTasks = todos.filter(
      (t) => t.groupId === editingGroupId && t.text.trim() && !t.id.includes('_placeholder'),
    );
    const originalById = new Map(originalTasks.map((t) => [t.id, t] as const));
    const editedExisting = validItems.filter((item) => originalById.has(item.id));
    const editedExistingIds = new Set(editedExisting.map((item) => item.id));
    const deletedOriginal = originalTasks.filter((t) => !editedExistingIds.has(t.id));
    const createdNew = validItems.filter((item) => !originalById.has(item.id));

    const tasksPayload = [
      // 更新（明确 deleted=false）
      ...editedExisting.map((item) => ({
        id: item.id,
        todo: item.text.trim(),
        status: item.done ? TodoTaskStatus.COMPLETED : TodoTaskStatus.TODO,
        deleted: false as const,
      })),
      // 删除（deleted=true）
      ...deletedOriginal.map((item) => ({
        id: item.id,
        todo: item.text.trim(),
        deleted: true as const,
      })),
      // 新增（只传 todo，不传 id）
      ...createdNew.map((item) => ({
        todo: item.text.trim(),
      })),
    ];
    void (async () => {
      setError(null);
      try {
        // 更新组（包含 title + tasks；后端若支持可在此创建新任务/覆盖任务）
        await updateTodo({
          id: editingGroupId,
          title: normalizedTitle,
          tasks: tasksPayload,
        });

        await reloadFromServer();
        closeEditGroup();
      } catch (err) {
        const msg = getErrorMessage(err);

        console.error('[todos] saveEditingGroup failed:', msg, err);
        setError(msg);
      }
    })();
  }, [
    closeEditGroup,
    editingGroupId,
    editingGroupItems,
    editingGroupTitle,
    reloadFromServer,
    setError,
    todos,
  ]);

  const deleteGroup = useCallback(
    (groupId: string) => {
      void deleteGroupApi(groupId);
      if (editingGroupId === groupId) closeEditGroup();
    },
    [closeEditGroup, deleteGroupApi, editingGroupId],
  );

  const groupedTodos = useMemo(() => {
    const groups = new Map<string, TodoGroup>();
    todos.forEach((item) => {
      const groupId = item.groupId || `ungrouped_${item.id}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          groupId,
          groupTitle: item.groupTitle,
          items: [],
          createdAt: item.createdAt,
        });
      }
      groups.get(groupId)!.items.push(item);
    });
    return Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [todos]);

  const normalizedQuery = useMemo(
    () => debouncedQueryInput.trim().toLowerCase(),
    [debouncedQueryInput],
  );
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groupedTodos;
    return groupedTodos.filter((group) => {
      const groupTitle = (group.groupTitle ?? '').toLowerCase();
      if (groupTitle.includes(normalizedQuery)) return true;
      return group.items.some((item) => item.text.toLowerCase().includes(normalizedQuery));
    });
  }, [groupedTodos, normalizedQuery]);

  return {
    todos,
    loading,
    loadingMore,
    hasMore,
    loadedOnce,
    error,
    stats,
    groupsTotal,
    groupedTodos,
    filteredGroups,
    queryInput,
    setQueryInput,
    addTasks,
    toggleDone,
    saving,
    editingGroupId,
    editingGroupItems,
    editingGroupTitle,
    setEditingGroupTitle,
    editItemInputRefs,
    openEditGroup,
    closeEditGroup,
    updateEditingGroupItem,
    deleteEditingGroupItem,
    addEditingGroupItem,
    saveEditingGroup,
    deleteGroup,
    loadMore,
    isBatchMode, // 批量模式状态
    setIsBatchMode,
    selectedGroupIds,
    toggleGroupSelection,
    selectAllGroups,
    clearSelection,
    batchDeleteGroups,
  };
};
