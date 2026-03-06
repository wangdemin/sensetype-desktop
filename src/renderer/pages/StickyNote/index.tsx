import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './index.module.scss';
import CloseIcon from '@/assets/icons/close.svg?react';
import { getNotes } from '@/services';
import { getTodoList, updateNote, updateTodoTask } from '@/services/notes';
import type { NoteWithMeta } from '@/renderer/pages/Notes/hooks/types';
import type { TodoItem as ApiTodoGroup } from '@/services/notes/types';
import { TodoTaskStatus } from '@/services/notes/types';

type StickyType = 'note' | 'todo';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface StickyData {
  id?: string;
  type: StickyType;
  title?: string;
  date: string;
  content?: string;
  progress: number;
  todos?: TodoItem[];
  created_at?: number | string;
}

function normalizeTimestamp(input?: number | string): number {
  if (!input) return Date.now();
  if (typeof input === 'number') {
    return input < 10000000000 ? input * 1000 : input;
  }
  const t = new Date(input).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

function formatDateBadge(input?: number | string | Date): string {
  try {
    const ts =
      input instanceof Date ? input.getTime() : normalizeTimestamp(input as number | string);
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}年${m}月${day}日`;
  } catch {
    return '';
  }
}

function normalizeStickyType(v: unknown): StickyType | null {
  const s = String(v || '').trim();
  if (s === 'note' || s === 'todo') return s;
  return null;
}

function mapTodoGroupToStickyData(group: ApiTodoGroup): StickyData {
  const createdAt = normalizeTimestamp(group.created_at);
  const tasks = Array.isArray(group?.tasks) ? group.tasks : [];
  return {
    id: group?.id,
    type: 'todo',
    title: group?.title || undefined,
    date: formatDateBadge(createdAt),
    progress: 0,
    created_at: createdAt,
    todos: tasks
      .filter((t) => !t?.deleted)
      .map((t) => ({
        id: t?.id,
        text: t?.todo ?? '',
        done: t?.status === TodoTaskStatus.COMPLETED,
      }))
      .filter((t) => Boolean(t.id)),
  };
}

async function fetchTodoGroupById(groupId: string): Promise<ApiTodoGroup | null> {
  const size = 50;
  const maxPages = 50;
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages && (page - 1) * size < total; page += 1) {
    const res = await getTodoList({ page, size, desc_by: 'created' });
    if (!res?.success) return null;
    const list = res.data?.list ?? [];
    const nextTotal = res.data?.total;
    if (typeof nextTotal === 'number' && Number.isFinite(nextTotal)) total = nextTotal;
    const found = list.find((g) => String(g?.id || '') === String(groupId));
    if (found) return found;
    if (list.length === 0) break;
  }
  return null;
}

async function fetchNoteById(noteId: string): Promise<NoteWithMeta | null> {
  const size = 50;
  const maxPages = 50;
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages && (page - 1) * size < total; page += 1) {
    const res = await getNotes({ page, size, desc_by: 'updated' });
    if (!res?.success) return null;
    const list = (res.data?.list ?? []) as NoteWithMeta[];
    const nextTotal = res.data?.total;
    if (typeof nextTotal === 'number' && Number.isFinite(nextTotal)) total = nextTotal;
    const found = list.find((n) => String(n?.id || '') === String(noteId));
    if (found) return found;
    if (list.length === 0) break;
  }
  return null;
}

const getIpcRenderer = () => {
  if ((window as any).electronAPI?.ipcRenderer) {
    return (window as any).electronAPI.ipcRenderer;
  } else if ((window as any).require) {
    try {
      return (window as any).require('electron').ipcRenderer;
    } catch (e) {
      return null;
    }
  }
  return null;
};

const StickyNote = () => {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<StickyData | null>(null);
  const [randomTheme, setRandomTheme] = useState<string>('');
  const [noteSaving, setNoteSaving] = useState(false);
  const MAX_SCROLL_HEIGHT = 350;

  const contentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const todoItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const noteSaveTimerRef = useRef<number | null>(null);
  const lastSavedNoteContentRef = useRef<string>('');
  const lastSentHeightRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

  // 随机选择主题
  useEffect(() => {
    const themes = [
      styles.themeBlue,
      styles.themePurple,
      styles.themePink,
      styles.themeYellow,
      styles.themeGreen,
    ];
    const randomIndex = Math.floor(Math.random() * themes.length);
    setRandomTheme(themes[randomIndex]);
  }, []);

  useEffect(() => {
    const typeParam = normalizeStickyType(searchParams.get('type'));
    const contentParam = searchParams.get('content');
    const idParam = searchParams.get('id');
    const initialType: StickyType =
      typeParam || (idParam ? 'todo' : contentParam ? 'note' : 'note');

    // 先给一个“可渲染骨架”，避免首屏闪空/高度计算异常
    setData({
      id: idParam || undefined,
      type: initialType,
      title: initialType === 'todo' ? '加载中...' : undefined,
      date: formatDateBadge(Date.now()),
      content: initialType === 'note' ? contentParam || '' : contentParam || undefined,
      progress: 0,
      todos: initialType === 'todo' ? [] : undefined,
    });

    let cancelled = false;
    const loadFromApi = async () => {
      try {
        if (initialType === 'todo' && idParam) {
          const group = await fetchTodoGroupById(idParam);
          if (cancelled) return;
          if (group) {
            setData(mapTodoGroupToStickyData(group));
          }
          return;
        }

        if (initialType === 'note' && idParam) {
          const note = await fetchNoteById(idParam);
          if (cancelled) return;
          if (note) {
            const ts = normalizeTimestamp(note.updated_at || note.created_at);
            lastSavedNoteContentRef.current = note.content || '';
            setData({
              id: note.id,
              type: 'note',
              date: formatDateBadge(ts),
              content: note.content || '',
              progress: 0,
              created_at: normalizeTimestamp(note.created_at),
            });
          }
          return;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load sticky note from API', e);
      }
    };
    void loadFromApi();

    const ipcRenderer = getIpcRenderer();
    const handleUpdate = (_event: any, payload: any) => {
      if (typeof payload === 'string') {
        setData((prev) =>
          prev
            ? { ...prev, content: payload }
            : { type: 'note', date: formatDateBadge(Date.now()), content: payload, progress: 0 },
        );
      } else if (typeof payload === 'object') {
        setData(payload);
      }
    };

    if (ipcRenderer?.on) {
      ipcRenderer.on('sticky-note-update', handleUpdate);
    }

    return () => {
      cancelled = true;
      if (ipcRenderer?.removeListener) {
        ipcRenderer.removeListener('sticky-note-update', handleUpdate);
      }
    };
  }, [searchParams]);

  const autosizeNoteTextarea = () => {
    const el = noteTextareaRef.current;
    if (!el) return;
    // 先收缩，再撑开到内容高度
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };

  const flushSaveNote = () => {
    if (noteSaveTimerRef.current !== null) {
      window.clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    }
    if (!data || data.type !== 'note') return;
    const id = data.id;
    if (!id) return;
    const nextContent = String(data.content ?? '');
    if (nextContent === lastSavedNoteContentRef.current) return;

    setNoteSaving(true);
    void (async () => {
      try {
        await updateNote({ id, content: nextContent });
        lastSavedNoteContentRef.current = nextContent;
        // 更新显示日期为最新
        setData((prev) => (prev ? { ...prev, date: formatDateBadge(Date.now()) } : prev));
        try {
          getIpcRenderer()?.send?.('notes-data-changed', { kind: 'note' });
        } catch {
          // ignore
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to update note content', e);
      } finally {
        setNoteSaving(false);
      }
    })();
  };

  const scheduleSaveNote = (nextContent: string) => {
    if (!data || data.type !== 'note') return;
    if (!data.id) return;
    if (nextContent === lastSavedNoteContentRef.current) return;
    if (noteSaveTimerRef.current !== null) {
      window.clearTimeout(noteSaveTimerRef.current);
    }
    noteSaveTimerRef.current = window.setTimeout(() => {
      flushSaveNote();
    }, 600);
  };

  // note 内容变化时自动撑高 textarea，保证窗口自适应高度
  useLayoutEffect(() => {
    if (!data || data.type !== 'note') return;
    autosizeNoteTextarea();
  }, [data?.type, data?.content]);

  // 卸载时清理防抖保存计时器
  useEffect(() => {
    return () => {
      if (noteSaveTimerRef.current !== null) {
        window.clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = null;
      }
    };
  }, []);

  // 自适应高度逻辑
  useLayoutEffect(() => {
    if (!data) return;

    const calcHeight = () => {
      const headerHeight = 48; // .header height
      const bodyPaddingBottom = 16; // .body padding-bottom

      let totalHeight = headerHeight + bodyPaddingBottom;

      // 获取各个部分的实际高度
      if (titleRef.current) {
        // offsetHeight 包括 padding + border
        totalHeight += titleRef.current.offsetHeight + 12; // + margin-bottom
      }

      if (contentRef.current) {
        const contentHeight = contentRef.current.offsetHeight;
        totalHeight += Math.min(contentHeight, MAX_SCROLL_HEIGHT);
      }

      if (footerRef.current) {
        totalHeight += footerRef.current.offsetHeight;
      }

      totalHeight += 4;
      return totalHeight;
    };

    const sendHeight = () => {
      const height = Math.ceil(calcHeight());
      if (lastSentHeightRef.current === height) return;
      lastSentHeightRef.current = height;

      try {
        const ipc = getIpcRenderer();
        if (ipc) {
          ipc.send('resize-sticky-note', height);
        } else {
          console.warn('ipcRenderer not found for resizing');
        }
      } catch (e) {
        console.error('Failed to resize window', e);
      }
    };

    const scheduleSend = () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
      resizeRafRef.current = requestAnimationFrame(() => {
        sendHeight();
      });

      // 稍微延迟再次更新，确保渲染/字体加载完成
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        sendHeight();
      }, 120);
    };

    // 初始测高
    scheduleSend();

    // DOM 尺寸变化时自动重新测高（todo 异步加载/增删条目时尤为需要）
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleSend();
          })
        : null;

    if (ro) {
      if (titleRef.current) ro.observe(titleRef.current);
      if (contentRef.current) ro.observe(contentRef.current);
      if (footerRef.current) ro.observe(footerRef.current);
    }

    // 兼容极少数不支持 ResizeObserver 的运行时
    const mo =
      !ro && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            scheduleSend();
          })
        : null;

    if (mo) {
      if (titleRef.current) {
        mo.observe(titleRef.current, { childList: true, subtree: true, characterData: true });
      }
      if (contentRef.current) {
        mo.observe(contentRef.current, { childList: true, subtree: true, characterData: true });
      }
      if (footerRef.current) {
        mo.observe(footerRef.current, { childList: true, subtree: true, characterData: true });
      }
    }

    return () => {
      ro?.disconnect();
      mo?.disconnect();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [data, data?.type]);

  const handleClose = () => {
    // 关闭前尽量把 note 的编辑内容落库
    flushSaveNote();
    window.close();
  };

  const handleToggleTodo = (todoId: string) => {
    if (!data || !data.todos) return;

    const newTodos = data.todos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t));
    setData({ ...data, todos: newTodos });
    const current = data.todos.find((t) => t.id === todoId);
    if (!current || !current.text.trim()) return;
    const nextDone = !current.done;
    void (async () => {
      try {
        await updateTodoTask({
          id: todoId,
          todo: current.text.trim(),
          status: nextDone ? TodoTaskStatus.COMPLETED : TodoTaskStatus.TODO,
        });
        try {
          getIpcRenderer()?.send?.('notes-data-changed', { kind: 'todo' });
        } catch {
          // ignore
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to update todo task', e);
        // 失败回滚
        setData((prev) => {
          if (!prev?.todos) return prev;
          return {
            ...prev,
            todos: prev.todos.map((t) => (t.id === todoId ? { ...t, done: current.done } : t)),
          };
        });
      }
    })();
  };

  const handleUpdateProgress = (newProgress: number) => {
    if (!data || data.type !== 'note') return;
    setData({ ...data, progress: newProgress } as StickyData);
  };

  if (!data) return null;

  const themeClass = randomTheme || styles.themeBlue;

  const progress =
    data.type === 'todo' && data.todos
      ? Math.round((data.todos.filter((t) => t.done).length / data.todos.length) * 100) || 0
      : data.progress;

  return (
    <div className={`${styles.container} ${themeClass}`}>
      <div className={styles.header}>
        <div className={styles.dateBadge}>{data.date}</div>
        <div className={styles.actions}>
          {/* <button className={styles.iconButton} title="更多">
            <MoreIcon />
          </button> */}
          <button className={styles.iconButton} onClick={handleClose} title="关闭">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        {data.type !== 'note' && (
          <div className={styles.title} ref={titleRef}>
            {data.title}
          </div>
        )}

        <div className={styles.scrollArea}>
          <div ref={contentRef}>
            {data.type === 'todo' && data.todos ? (
              <div className={styles.todoList}>
                {data.todos.map((todo, idx) => (
                  <div
                    key={todo.id}
                    ref={(el) => {
                      if (idx < 5) todoItemRefs.current[idx] = el;
                    }}
                    className={`${styles.todoItem} ${todo.done ? styles.done : ''}`}
                    onClick={() => handleToggleTodo(todo.id)}
                  >
                    {todo.text ? (
                      <div className={`${styles.checkbox} ${todo.done ? styles.checked : ''}`} />
                    ) : null}
                    <span>{todo.text}</span>
                  </div>
                ))}
                {data.content && <div className={styles.textContent}>{data.content}</div>}
              </div>
            ) : (
              <textarea
                ref={noteTextareaRef}
                className={`${styles.textContent} ${styles.noteEditor}`}
                value={data.content ?? ''}
                placeholder="写点什么..."
                onChange={(e) => {
                  const next = e.target.value;
                  setData((prev) => (prev ? { ...prev, content: next } : prev));
                  autosizeNoteTextarea();
                  scheduleSaveNote(next);
                }}
                onBlur={() => {
                  flushSaveNote();
                }}
                onKeyDown={(e) => {
                  // Ctrl/Cmd + S 立即保存
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    flushSaveNote();
                  }
                }}
              />
            )}
          </div>
        </div>

        {data.type === 'todo' && (
          <div className={styles.footer} ref={footerRef}>
            <div className={styles.progressLabel}>
              <span>当前进展</span>
              <span>{progress}%</span>
            </div>
            <div className={styles.progressDots}>
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className={`${styles.dot} ${(i + 1) * 10 <= progress ? styles.active : ''}`}
                  onClick={() => handleUpdateProgress((i + 1) * 10)}
                />
              ))}
            </div>
          </div>
        )}
        {data.type === 'note' && (
          <div
            className={styles.noteSavingHint}
            ref={footerRef}
            style={{ visibility: noteSaving ? 'visible' : 'hidden' }}
          >
            保存中...
          </div>
        )}
      </div>
    </div>
  );
};

export default StickyNote;
