import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoteWithMeta, NotesLayout } from '../hooks/types';
import stylesNotes from '../index.module.scss';
import DeleteIcon from '@/assets/icons/notes-delete.svg?react';
import EmptyIcon from '@/assets/icons/notes-empty.svg?react';
import NotesButtonIcon from '@/assets/icons/notes-button.svg?react';
import CopyIcon from '@/assets/icons/notes-copy.svg?react';
import PushpinIcon from '@/assets/icons/notes-pushpin.svg?react';


async function copyToClipboard(text: string): Promise<boolean> {
  const t = (text ?? '').trim();
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // 兜底：部分环境可能没有 clipboard API（比如 Electron 某些上下文）
    try {
      const el = document.createElement('textarea');
      el.value = t;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

type Props = {
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadedOnce: boolean;
  onLoadMore: () => void;
  filteredNotes: NoteWithMeta[];
  normalizedQuery: string;
  layout: NotesLayout;
  getTimeLabel: (note: NoteWithMeta) => string;
  activeMenuId: string | null;
  toggleMenu: (noteId: string) => void;
  closeMenu: () => void;
  openEdit: (note: NoteWithMeta) => void;
  requestDelete: (noteId: string) => void;
  openStickyNoteIds?: Set<string>;
  isBatchMode?: boolean;
  selectedNoteIds?: Set<string>;
  toggleNoteSelection?: (noteId: string) => void;
};

export function NotesGrid({
  loading,
  loadingMore,
  hasMore,
  loadedOnce,
  onLoadMore,
  filteredNotes,
  normalizedQuery,
  layout,
  getTimeLabel,
  activeMenuId,
  toggleMenu,
  closeMenu,
  openEdit,
  requestDelete,
  openStickyNoteIds,
  isBatchMode = false,
  selectedNoteIds,
  toggleNoteSelection,
}: Props) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const layoutClass =
    layout === 'one'
      ? `${stylesNotes.notesGridMasonry} ${stylesNotes.notesGridOne}`
      : layout === 'two'
        ? `${stylesNotes.notesGridMasonry} ${stylesNotes.notesGridTwo}`
        : `${stylesNotes.notesGridMasonry} ${stylesNotes.notesGridThree}`;

  const measureSpans = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const computed = getComputedStyle(grid);
    const rowHeight = parseFloat(computed.getPropertyValue('--masonry-row-height')) || 8;
    const rowGap = parseFloat(computed.getPropertyValue('--masonry-row-gap')) || 16;
    const next: Record<string, number> = {};
    cardRefs.current.forEach((el, id) => {
      const height = el.getBoundingClientRect().height;
      next[id] = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
    });
    setRowSpans(next);
  }, []);

  useLayoutEffect(() => {
    measureSpans();
  }, [filteredNotes, layout, measureSpans]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => measureSpans());
    observer.observe(grid);
    return () => observer.disconnect();
  }, [measureSpans]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting && hasMore && !loadingMore && !loading) {
          onLoadMore();
        }
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, onLoadMore]);

  //等接口首次返回后再决定是否展示空态，避免首屏 useEffect 拉取前闪现“暂无笔记”
  if (loadedOnce && !loading && filteredNotes.length === 0) {
    return (
      <div className={stylesNotes.empty}>
        <EmptyIcon className={stylesNotes.emptyIcon} />
        <p className={stylesNotes.emptyTitle}>{normalizedQuery ? '暂无匹配笔记' : '暂无笔记'}</p>
      </div>
    );
  }

  return (
    <div ref={gridRef} className={`${stylesNotes.notesGrid} ${layoutClass}`}>
      {filteredNotes.map((note) => {
        const timeLabel = getTimeLabel(note);
        const isSelected = selectedNoteIds?.has(note.id);

        return (
          <div
            key={note.id}
            className={`${stylesNotes.noteCard} ${isSelected ? stylesNotes.noteCardSelected : ''}`}
            style={rowSpans[note.id] ? { gridRowEnd: `span ${rowSpans[note.id]}` } : undefined}
            ref={(el) => {
              if (el) {
                cardRefs.current.set(note.id, el);
              } else {
                cardRefs.current.delete(note.id);
              }
            }}
            onClick={() => {
              if (isBatchMode && toggleNoteSelection) {
                toggleNoteSelection(note.id);
                return;
              }
              openEdit(note);
              closeMenu();
            }}
          >
            {isBatchMode && (
              <label className={stylesNotes.batchCheckbox} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected || false}
                  onChange={() => toggleNoteSelection?.(note.id)}
                />
              </label>
            )}
            <div className={stylesNotes.noteContentBg}>
              {!isBatchMode && (
                <span
                  className={`${stylesNotes.pushpinIcon} ${
                    openStickyNoteIds?.has(note.id) ? stylesNotes.active : ''
                  }`}
                  title="贴在屏幕"
                  role="button"
                  tabIndex={0}
                  aria-label="贴在屏幕"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const ipc = (window as any).electronAPI?.ipcRenderer;
                      ipc?.send?.('create-sticky-note', { type: 'note', id: note.id });
                    } catch {
                      // ignore
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const ipc = (window as any).electronAPI?.ipcRenderer;
                      ipc?.send?.('create-sticky-note', { type: 'note', id: note.id });
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <PushpinIcon />
                </span>
              )}
              <div className={stylesNotes.noteContent}>
                {note.content?.length > 400 ? note.content.slice(0, 400) : note.content}
              </div>
            </div>
            <div className={stylesNotes.noteFooter}>
              <div className={stylesNotes.noteActions}>
                {!isBatchMode && (
                  <button
                    type="button"
                    className={stylesNotes.menuButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMenu(note.id);
                    }}
                    aria-label="笔记操作"
                  >
                    <NotesButtonIcon />
                  </button>
                )}
                {activeMenuId === note.id ? (
                  <div className={stylesNotes.menuPanel} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={stylesNotes.menuItem}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeMenu();
                        await copyToClipboard(note.content);
                      }}
                    >
                      <CopyIcon className={stylesNotes.menuItemIcon} />
                      复制
                    </button>
                    <button
                      type="button"
                      className={stylesNotes.menuItemDanger}
                      onClick={() => {
                        closeMenu();
                        requestDelete(note.id);
                      }}
                    >
                      <DeleteIcon className={stylesNotes.menuItemIcon} />
                      删除
                    </button>
                  </div>
                ) : null}
              </div>
              <span className={stylesNotes.noteTime}>{timeLabel}</span>
            </div>
          </div>
        );
      })}
      <div ref={loadMoreRef} className={stylesNotes.loadMoreTrigger} />
      {filteredNotes.length > 0 && !loading ? (
        <div className={stylesNotes.loadMoreStatus}>
          {loadingMore ? '加载更多...' : hasMore ? '下拉加载更多' : '没有更多了'}
        </div>
      ) : null}
    </div>
  );
}
