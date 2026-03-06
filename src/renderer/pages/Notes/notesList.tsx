import { useCallback, useState, useRef, useEffect } from 'react';
import stylesNotes from './index.module.scss';
import { InfoButton } from '@/renderer/components/InfoListCard';
import ConfirmDialog from '@/renderer/components/ConfirmDialog';
import Modal from '@/renderer/components/Modal';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import { formatDateTime, getNoteTimestamp } from './hooks/notesUtils';
import type { NoteWithMeta } from './hooks/types';
import { useNoteMenu } from './hooks/useNoteMenu';
import { useNotesLayout } from './hooks/useNotesLayout';
import {
  useNoteComposer,
  useNoteDeletion,
  useNoteEditor,
  useNotesList,
} from './hooks/useNotesList';
import { useStickyNoteState } from './hooks/useStickyNoteState';
import { useNotesSearch } from './hooks/useNotesSearch';
import { NotesGrid } from './components/NotesGrid';
import SearchIcon from '@/assets/icons/notes-search.svg?react';
import SortIcon from '@/assets/icons/notes-sort.svg?react';
import CloseIcon from '@/assets/icons/close.svg?react';
import InfoIcon from '@/assets/icons/notes-info.svg?react';
import DeleteAll from '@/assets/icons/notes-more-delete.svg?react';

type Props = {
  embedded?: boolean;
};

const NotesList = ({ embedded }: Props) => {
  // 长按录音快捷键文案（用于 UI 提示，例如“按住 X 键开始说话”）
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const tips = `按住${label} 键或同时按下${isWin && !isMac ? 'Ctrl' : 'Fn'} + ${isWin && !isMac ? 'Win' : '空格'}键并开始说话...`;

  // 页面级错误提示（由各个请求/操作 Hook 统一上报）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState<string | null>(null);

  // 笔记列表数据源：负责拉取/刷新列表，并维护 notes/total/loading 等状态
  const {
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
  } = useNotesList({
    pageSize: 20,
    setError,
  });

  // 搜索与筛选：基于 notes 维护搜索框输入、标准化查询、过滤后的列表等
  const {
    queryInput,
    setQueryInput,
    normalizedQuery,
    filteredNotes,
    searchInputRef,
    onSearchKeyDown,
    clearSearch,
  } = useNotesSearch({ notes });

  // 布局切换：一列/两列/三列展示（默认三列）
  const { layout, toggleLayout } = useNotesLayout('three');

  // 单条笔记“更多操作”菜单状态：记录当前展开的 noteId，并提供开关/关闭能力
  const { activeMenuId, toggleMenu, closeMenu } = useNoteMenu();

  // 新建笔记：输入内容、是否可提交、提交中状态，以及创建动作
  const { content, setContent, canCreate, creating, create } = useNoteComposer({
    setNotes,
    setTotal,
    reload,
    setError,
  });

  // 编辑笔记：当前编辑中的 note、编辑内容、保存中状态，以及打开/关闭/保存动作
  const { editNote, editContent, setEditContent, editSaving, openEdit, closeEdit, saveEdit } =
    useNoteEditor({
      reload,
      setError,
    });

  // 删除笔记：二次确认的 noteId、请求删除/取消、删除中状态，以及确认删除动作
  const { confirmDeleteId, requestDelete, cancelDelete, deleting, deleteConfirmed } =
    useNoteDeletion({
    setNotes,
    setTotal,
    setError,
  });

  const openStickyNoteIds = useStickyNoteState();

  const composeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 输入内容变化时，如果光标在末尾，自动滚动到底部（解决语音输入不自动滚动的体验问题）
  useEffect(() => {
    const textarea = composeTextareaRef.current;
    if (textarea) {
      // 高度自适应
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;

      if (document.activeElement === textarea) {
        if (textarea.selectionStart === textarea.value.length) {
          textarea.scrollTop = textarea.scrollHeight;
        }
      }
    }
  }, [content]);

  useEffect(() => {
    const textarea = editTextareaRef.current;
    if (textarea) {
      // 高度自适应
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;

      if (document.activeElement === textarea) {
        if (textarea.selectionStart === textarea.value.length) {
          textarea.scrollTop = textarea.scrollHeight;
        }
      }
    }
  }, [editContent]);

  // 时间展示文案：提取笔记时间戳并格式化（用 useCallback 避免渲染时重复创建函数）
  const getTimeLabel = useCallback((note: NoteWithMeta) => {
    return formatDateTime(getNoteTimestamp(note));
  }, []);

  return (
    <>
      <div className={stylesNotes.header}>
        <h1 className={stylesNotes.title}>笔记</h1>
        <p className={stylesNotes.subtitle}>发条语音就能即刻成文，捕捉转瞬即逝的好想法</p>
      </div>

      <div
        className={stylesNotes.composeCard}
        style={{ margin: '0 auto', marginTop: '45px', position: 'relative' }}
      >
        <div className={stylesNotes.inputWrapper}>
          <textarea
            ref={composeTextareaRef}
            className={stylesNotes.composeInput}
            placeholder="把想法写下来吧..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={20000}
          />
          <span className={stylesNotes.wordCount}>{(content || '').length}/20000</span>
        </div>

        <div className={stylesNotes.composeFooter}>
          <div className={stylesNotes.composeHint}>
            <span className={stylesNotes.hintIcon}>
              <InfoIcon />
            </span>
            {/* 按住{label}键或开始说话 */}
            {tips}
          </div>
          <InfoButton variant="primary" onClick={create} disabled={!canCreate}>
            {creating ? '保存中...' : '完成'}
          </InfoButton>
        </div>
      </div>

      <div className={stylesNotes.listHeader}>
        <div className={stylesNotes.listTitle}>
          {isBatchMode ? (
            <span>已选择 {selectedNoteIds.size} 项</span>
          ) : (
            <>
              笔记列表 <span className={stylesNotes.countBadge}>{total}</span>
            </>
          )}
        </div>
        <div className={stylesNotes.listActions}>
          {isBatchMode ? (
            <>
              <button
                type="button"
                className={stylesNotes.textButton}
                onClick={selectAllNotes}
              >
                全选
              </button>
              <button
                type="button"
                className={stylesNotes.textButtonDanger}
                onClick={batchDeleteNotes}
                disabled={selectedNoteIds.size === 0}
              >
                删除
              </button>
              <button
                type="button"
                className={stylesNotes.textButton}
                onClick={() => setIsBatchMode(false)}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <div className={stylesNotes.searchArea}>
                <div className={stylesNotes.searchBox}>
                  <SearchIcon className={stylesNotes.searchIcon} />
                  <input
                    className={stylesNotes.searchInput}
                    placeholder="搜索笔记"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    ref={searchInputRef}
                    onKeyDown={onSearchKeyDown}
                  />
                  {queryInput && (
                    <button
                      type="button"
                      className={stylesNotes.searchClear}
                      aria-label="清空搜索"
                      onClick={(e) => {
                        e.preventDefault();
                        clearSearch();
                        window.setTimeout(() => searchInputRef.current?.focus(), 0);
                      }}
                    >
                      <CloseIcon className={stylesNotes.searchCloseIcon} />
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={stylesNotes.layoutButton}
                onClick={() => setIsBatchMode(true)}
              >
                <DeleteAll className={stylesNotes.deleteAllIcon} />
              </button>
              <button
                type="button"
                className={`${stylesNotes.layoutButton} ${stylesNotes[`layout-${layout}`]}`}
                onClick={toggleLayout}
                aria-label="切换布局"
              >
                <SortIcon className={stylesNotes.sortIcon} />
              </button>
            </>
          )}
        </div>
      </div>
      <NotesGrid
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        loadedOnce={loadedOnce}
        onLoadMore={loadMore}
        filteredNotes={filteredNotes}
        normalizedQuery={normalizedQuery}
        layout={layout}
        getTimeLabel={getTimeLabel}
        activeMenuId={activeMenuId}
        toggleMenu={toggleMenu}
        closeMenu={closeMenu}
        openEdit={openEdit}
        requestDelete={requestDelete}
        openStickyNoteIds={openStickyNoteIds}
        isBatchMode={isBatchMode}
        selectedNoteIds={selectedNoteIds}
        toggleNoteSelection={toggleNoteSelection}
      />

      <Modal
        open={Boolean(editNote)}
        onClose={closeEdit}
        className={stylesNotes.editModal}
        hideCloseButton
      >
        <div className={stylesNotes.composeCard} style={{ position: 'relative', width: '560px' }}>
          <div className={stylesNotes.inputWrapper}>
            <textarea
              ref={editTextareaRef}
              className={stylesNotes.composeInput}
              placeholder="把想法写下来吧..."
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              maxLength={20000}
            />
            <span className={stylesNotes.wordCount}>{(editContent || '').length}/20000</span>
          </div>
          <div className={stylesNotes.composeFooter}>
            <div className={stylesNotes.composeHint}>
              <span className={stylesNotes.hintIcon}>
                <InfoIcon />
              </span>
              {tips}
            </div>
            <InfoButton variant="primary" onClick={saveEdit}>
              {editSaving ? '保存中...' : '保存'}
            </InfoButton>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        danger
        title="删除这条笔记？"
        description="删除后不可恢复。"
        confirmText={deleting ? '删除中...' : '确定删除'}
        cancelText="取消"
        onCancel={cancelDelete}
        onConfirm={deleteConfirmed}
      />
    </>
  );
};

export default NotesList;
