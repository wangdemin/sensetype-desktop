import styles from '../common.module.scss';
import stylesHistory from './index.module.scss';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HistorySearchIcon from '@/assets/icons/history-search.svg?react';
import CustomContentDialog from '@/renderer/components/CustomContentDialog';
import EditIcon from '@/assets/icons/edit.svg?react';
import DeleteIcon from '@/assets/icons/notes-delete.svg?react';
import ConfirmDialog from '@/renderer/components/ConfirmDialog';
import { message } from '@/renderer/components/Message';
import {
  getHotwordsListApi,
  addHotwordApi,
  updateHotwordApi,
  deleteHotwordApi,
} from '@/services/dictionaries';

type HotwordItem = {
  id: string;
  word: string;
  created_at: number;
};

const PAGE_SIZE = 30;
const MAX_WORD_LENGTH = 255;

function parseListResponse(resp: any): { list: HotwordItem[]; total: number } {
  const payload = resp?.data ?? resp ?? {};
  const list = Array.isArray(payload?.list) ? (payload.list as HotwordItem[]) : [];
  const total = typeof payload?.total === 'number' ? payload.total : list.length;
  return { list, total };
}

const DictionariesPage = () => {
  const [queryInput, setQueryInput] = useState('');
  const [queryWord, setQueryWord] = useState('');
  const [items, setItems] = useState<HotwordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState('');
  const [editingItem, setEditingItem] = useState<HotwordItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HotwordItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const latestQueryRef = useRef('');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  const loadHotwords = useCallback(async (targetPage: number, append: boolean, word: string) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const resp = await getHotwordsListApi({
        page: targetPage,
        size: PAGE_SIZE,
        word: word || undefined,
      });
      if (word !== latestQueryRef.current) return;

      const parsed = parseListResponse(resp);
      setTotal(parsed.total);
      setPage(targetPage);
      setItems((prev) => (append ? [...prev, ...parsed.list] : parsed.list));
    } catch {
      if (!append) setItems([]);
      if (!append) setTotal(0);
      message.error('词典列表加载失败，请稍后重试');
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryWord(queryInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    latestQueryRef.current = queryWord;
    void loadHotwords(1, false, queryWord);
  }, [queryWord, loadHotwords]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void loadHotwords(page + 1, true, latestQueryRef.current);
  }, [hasMore, loadHotwords, loading, loadingMore, page]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) loadMore();
      },
      { root: null, rootMargin: '120px 0px 120px 0px', threshold: 0 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore]);

  const refreshFirstPage = useCallback(async () => {
    await loadHotwords(1, false, latestQueryRef.current);
  }, [loadHotwords]);

  const onAddConfirm = useCallback(async () => {
    const word = newEntry.trim();
    if (!word) {
      message.error('请输入词条名称');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const resp = await addHotwordApi({ word });
      if (resp?.success === false) throw new Error('failed');
      message.success('新增词条成功');
      setAddDialogOpen(false);
      setNewEntry('');
      await refreshFirstPage();
    } catch (err: any) {
      if (err?.error?.response?.data?.message) {
        message.error(err.error.response.data.message);
      } else {
        message.error('新增词条失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }, [newEntry, refreshFirstPage, submitting]);

  const onEditClick = useCallback((item: HotwordItem) => {
    setEditingItem(item);
    setEditEntry(item.word);
    setEditDialogOpen(true);
  }, []);

  const onEditConfirm = useCallback(async () => {
    const word = editEntry.trim();
    if (!editingItem) return;
    if (!word) {
      message.error('请输入词条名称');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const resp = await updateHotwordApi(editingItem.id, { word });
      if (resp?.success === false) throw new Error('failed');
      message.success('编辑词条成功');
      setEditDialogOpen(false);
      setEditingItem(null);
      await refreshFirstPage();
    } catch {
      message.error('编辑词条失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }, [editEntry, editingItem, refreshFirstPage, submitting]);

  const onDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      const resp = await deleteHotwordApi(deleteTarget.id);
      if (resp?.success === false) throw new Error('failed');
      message.success('删除词条成功');
      setDeleteTarget(null);
      await refreshFirstPage();
    } catch {
      message.error('删除词条失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }, [deleteTarget, refreshFirstPage, submitting]);

  return (
    <div className={`${styles.page} ${stylesHistory.history}`}>
      <div className={stylesHistory.header}>
        <div className={stylesHistory.titleWrap}>
          <h1 className={stylesHistory.title}>词典</h1>
          <p className={stylesHistory.subtitle}>添加专属词汇或术语，提升语音识别精度。</p>
        </div>
        <button
          type="button"
          className={stylesHistory.addButton}
          onClick={() => setAddDialogOpen(true)}
        >
          <span>新增</span>
        </button>
      </div>

      <div className={stylesHistory.privacyCard}>
        <div className={stylesHistory.privacyTitle}>让输入法更懂你的表达</div>
        <div className={stylesHistory.privacyDesc}>
          点击右上角的“新增”按键后，您可以将常使用的人名、专业术语或特定简称等添加至词典。添加后，系统将根据您的语言习惯自动校准识别结果，确保在各种语境下都能够实现高效精准的文本录入。
        </div>
        <div className={stylesHistory.searchWrap}>
          <span className={stylesHistory.searchLabel}>个人词典（{total}）</span>
          <div className={stylesHistory.searchInputWrap}>
            <HistorySearchIcon className={stylesHistory.searchIcon} />
            <input
              className={stylesHistory.searchInput}
              placeholder="请搜索内容..."
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQueryInput('');
              }}
            />
          </div>
        </div>
      </div>

      <div className={stylesHistory.listWrap}>
        {items.length === 0 && !loading ? (
          <div className={stylesHistory.empty}>暂无数据</div>
        ) : (
          <div className={stylesHistory.list}>
            {items.map((item) => (
              <div key={item.id} className={stylesHistory.listItem}>
                <span className={stylesHistory.wordText}>{item.word}</span>
                <div className={stylesHistory.actions}>
                  <button
                    type="button"
                    className={`${stylesHistory.iconBtn} ${stylesHistory.editBtn}`}
                    title="编辑"
                    aria-label="编辑"
                    onClick={() => onEditClick(item)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    className={`${stylesHistory.iconBtn} ${stylesHistory.deleteBtn}`}
                    title="删除"
                    aria-label="删除"
                    onClick={() => setDeleteTarget(item)}
                  >
                    <DeleteIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {(loading || loadingMore) && <div className={stylesHistory.loadingText}>加载中...</div>}
        {hasMore && <div ref={loadMoreRef} className={stylesHistory.loadMoreSentinel} />}
      </div>

      <CustomContentDialog
        open={addDialogOpen}
        title="新增词条"
        cancelText="取消"
        confirmText={submitting ? '保存中...' : '保存词条'}
        onCancel={() => {
          setAddDialogOpen(false);
          setNewEntry('');
        }}
        onConfirm={() => void onAddConfirm()}
        confirmLoading={submitting}
      >
        <div className={stylesHistory.addDialogInputWrap}>
          <input
            className={stylesHistory.addDialogInput}
            value={newEntry}
            onChange={(e) => setNewEntry(e.target.value.slice(0, MAX_WORD_LENGTH))}
            placeholder="请输入您的内容"
            maxLength={MAX_WORD_LENGTH}
          />
          <span className={stylesHistory.addDialogCharCount}>
            {newEntry.length}/{MAX_WORD_LENGTH}
          </span>
        </div>
      </CustomContentDialog>

      <CustomContentDialog
        open={editDialogOpen}
        title="编辑词条"
        cancelText="取消"
        confirmText={submitting ? '保存中...' : '保存更改'}
        onCancel={() => {
          if (submitting) return;
          setEditDialogOpen(false);
          setEditingItem(null);
        }}
        onConfirm={() => void onEditConfirm()}
        confirmLoading={submitting}
      >
        <div className={stylesHistory.addDialogInputWrap}>
          <input
            className={stylesHistory.addDialogInput}
            value={editEntry}
            onChange={(e) => setEditEntry(e.target.value.slice(0, MAX_WORD_LENGTH))}
            placeholder="请输入词条"
            maxLength={MAX_WORD_LENGTH}
          />
          <span className={stylesHistory.addDialogCharCount}>
            {editEntry.length}/{MAX_WORD_LENGTH}
          </span>
        </div>
      </CustomContentDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="您确认要删除该组短语吗？"
        description="删除后，内容将无法找回。"
        danger
        confirmLoading={submitting}
        confirmText={submitting ? '删除中...' : '确定删除'}
        cancelText="取消"
        onCancel={() => {
          if (submitting) return;
          setDeleteTarget(null);
        }}
        onConfirm={() => void onDeleteConfirm()}
      />
    </div>
  );
};

export default DictionariesPage;
