import { useRef } from 'react';
import stylesCommon from '../common.module.scss';
import stylesNotes from './index.module.scss';
import EmptyIcon from '@/assets/icons/notes-empty.svg?react';
import SortIcon from '@/assets/icons/notes-sort.svg?react';
import { useNotesLayout } from './hooks/useNotesLayout';
import { useTodoDraft } from './hooks/useTodoDraft';
import { useTodos } from './hooks/useTodos';
import { useMasonryGrid } from './hooks/useMasonryGrid';
import { useStickyNoteState } from './hooks/useStickyNoteState';
import { TodoComposer } from './components/TodoComposer';
import { TodoListHeader } from './components/TodoListHeader';
import { TodoGroupsGrid } from './components/TodoGroupsGrid';
import { TodoEditModal } from './components/TodoEditModal';
import styles from './todoList.module.scss';

type Props = {
  embedded?: boolean;
};

const TodoListPage = ({ embedded }: Props) => {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { layout, toggleLayout } = useNotesLayout('three');
  const {
    todos,
    stats,
    groupsTotal,
    groupedTodos,
    filteredGroups,
    loading,
    loadingMore,
    hasMore,
    loadedOnce,
    queryInput,
    setQueryInput,
    addTasks,
    toggleDone,
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
    isBatchMode,
    setIsBatchMode,
    selectedGroupIds,
    toggleGroupSelection,
    selectAllGroups,
    clearSelection,
    batchDeleteGroups,
  } = useTodos();
  const {
    groupTitle,
    setGroupTitle,
    draftItems,
    draftInputRefs,
    resetDraft,
    addDraftItem,
    updateDraftItem,
    removeDraftItem,
  } = useTodoDraft();
  const openStickyNoteIds = useStickyNoteState();
  const { gridRef, cardRefs, rowSpans } = useMasonryGrid({
    layout,
    groupCount: groupsTotal,
    renderedGroupCount: filteredGroups.length,
  });

  const layoutClass =
    layout === 'one'
      ? `${styles.groupsGridMasonry} ${styles.groupsGridOne}`
      : layout === 'two'
        ? `${styles.groupsGridMasonry} ${styles.groupsGridTwo}`
        : `${styles.groupsGridMasonry} ${styles.groupsGridThree}`;

  const containerClassName = embedded
    ? styles.containerEmbedded
    : `${stylesCommon.page} ${styles.containerStandalone}`;

  const handleSaveDraft = () => {
    const hasAnyItemText = draftItems.some((item) => item.text.trim());
    const hasTitle = Boolean(groupTitle.trim());
    if (!hasAnyItemText && !hasTitle) return;
    addTasks(draftItems, groupTitle);
    resetDraft();
  };

  return (
    <div className={containerClassName}>
      <div className={styles.header}>
        <div className={stylesNotes.header}>
          <h1 className={stylesNotes.title}>待办事项</h1>
          <p className={stylesNotes.subtitle}>记录即开始，执行更高效</p>
        </div>
        <div className={styles.headerRight}>
          {!embedded && (
            <button
              type="button"
              className={`${stylesNotes.layoutButton} ${stylesNotes[`layout-${layout}`]}`}
              onClick={toggleLayout}
              aria-label="切换布局"
            >
              <SortIcon className={stylesNotes.sortIcon} />
            </button>
          )}
        </div>
      </div>

      <TodoComposer
        groupTitle={groupTitle}
        setGroupTitle={setGroupTitle}
        draftItems={draftItems}
        updateDraftItem={updateDraftItem}
        addDraftItem={addDraftItem}
        removeDraftItem={removeDraftItem}
        draftInputRefs={draftInputRefs}
        onSave={handleSaveDraft}
      />

      <TodoListHeader
        groupCount={groupsTotal}
        queryInput={queryInput}
        setQueryInput={setQueryInput}
        layout={layout}
        toggleLayout={toggleLayout}
        searchInputRef={searchInputRef}
        isBatchMode={isBatchMode}
        setIsBatchMode={setIsBatchMode}
        onSelectAll={selectAllGroups}
        onDeleteSelected={batchDeleteGroups}
        selectedCount={selectedGroupIds?.size || 0}
      />

      {loadedOnce && !loading && todos.length === 0 ? (
        <div className={stylesNotes.empty}>
          <EmptyIcon className={stylesNotes.emptyIcon} />
          <p className={stylesNotes.emptyTitle}>暂无待办</p>
          <p className={stylesNotes.emptyDesc}>写下当前要完成的任务</p>
        </div>
      ) : loadedOnce && !loading && todos.length > 0 && filteredGroups.length === 0 ? (
        <div className={stylesNotes.empty}>
          <EmptyIcon className={stylesNotes.emptyIcon} />
          <p className={stylesNotes.emptyTitle}>暂无匹配待办</p>
        </div>
      ) : filteredGroups.length > 0 ? (
        <TodoGroupsGrid
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          groups={filteredGroups}
          layoutClass={layoutClass}
          rowSpans={rowSpans}
          gridRef={gridRef as React.RefObject<HTMLDivElement>}
          cardRefs={cardRefs}
          toggleDone={toggleDone}
          openEditGroup={openEditGroup}
          deleteGroup={deleteGroup}
          openStickyNoteIds={openStickyNoteIds}
          isBatchMode={isBatchMode}
          selectedGroupIds={selectedGroupIds}
          toggleGroupSelection={toggleGroupSelection}
        />
      ) : null}

      <TodoEditModal
        open={editingGroupId !== null}
        editingGroupTitle={editingGroupTitle}
        setEditingGroupTitle={setEditingGroupTitle}
        editingGroupItems={editingGroupItems}
        updateEditingGroupItem={updateEditingGroupItem}
        deleteEditingGroupItem={deleteEditingGroupItem}
        addEditingGroupItem={addEditingGroupItem}
        editItemInputRefs={editItemInputRefs}
        onClose={closeEditGroup}
        onSave={saveEditingGroup}
      />
    </div>
  );
};

export default TodoListPage;
