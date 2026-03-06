import styles from '../common.module.scss';
import stylesPhrase from './index.module.scss';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HistorySearchIcon from '@/assets/icons/history-search.svg?react';
import CustomContentDialog from '@/renderer/components/CustomContentDialog';
import EditIcon from '@/assets/icons/edit.svg?react';
import DeleteIcon from '@/assets/icons/notes-delete.svg?react';
import ConfirmDialog from '@/renderer/components/ConfirmDialog';
import { message } from '@/renderer/components/Message';
import {
  getKeywordsListApi,
  addKeywordsApi,
  updateKeywordsApi,
  deleteKeywordsApi,
} from '@/services/phrase';

type PhraseItem = {
  id: string;
  keyword: string;
  content: string;
  created_at?: number;
};

const PAGE_SIZE = 30;
const MAX_PHRASE_LENGTH = 255;

function parseListResponse(resp: any): { list: PhraseItem[]; total: number } {
  const payload = resp?.data ?? resp ?? {};
  const rawList = Array.isArray(payload?.list) ? payload.list : [];
  const list = rawList.map((item: any) => ({
    id: item.id,
    keyword: item.keyword ?? item.word ?? '',
    content: item.content ?? '',
    created_at: item.created_at,
  }));
  const total = typeof payload?.total === 'number' ? payload.total : list.length;
  return { list, total };
}

const PhrasePage = () => {
  const [queryInput, setQueryInput] = useState('');
  const [queryKeyword, setQueryKeyword] = useState('');
  const [items, setItems] = useState<PhraseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editingItem, setEditingItem] = useState<PhraseItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PhraseItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const latestQueryRef = useRef('');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  const loadPhrases = useCallback(async (targetPage: number, append: boolean, keyword: string) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const resp = await getKeywordsListApi({
        page: targetPage,
        size: PAGE_SIZE,
        word: keyword || undefined,
      });
      if (keyword !== latestQueryRef.current) return;

      const parsed = parseListResponse(resp);
      setTotal(parsed.total);
      setPage(targetPage);
      setItems((prev) => (append ? [...prev, ...parsed.list] : parsed.list));
    } catch {
      if (!append) setItems([]);
      if (!append) setTotal(0);
      message.error('短语列表加载失败，请稍后重试');
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
      setQueryKeyword(queryInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    latestQueryRef.current = queryKeyword;
    void loadPhrases(1, false, queryKeyword);
  }, [queryKeyword, loadPhrases]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void loadPhrases(page + 1, true, latestQueryRef.current as string);
  }, [hasMore, loadPhrases, loading, loadingMore, page]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: null, rootMargin: '120px 0px 120px 0px', threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore]);

  const refreshFirstPage = useCallback(async () => {
    await loadPhrases(1, false, latestQueryRef.current as string);
  }, [loadPhrases]);

  const onAddConfirm = useCallback(async () => {
    const keyword = titleInput.trim();
    const content = contentInput.trim();
    if (!keyword) {
      message.error('请输入关键词');
      return;
    }
    if (!content) {
      message.error('请输入短语内容');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const resp = await addKeywordsApi({ keyword, content });
      if (resp?.success === false) throw new Error('failed');
      message.success('新增短语成功');
      setAddDialogOpen(false);
      setTitleInput('');
      setContentInput('');
      await refreshFirstPage();
    } catch (err: any) {
      if (err?.error?.response?.data?.message) {
        message.error(err.error.response.data.message);
      } else {
        message.error('新增短语失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }, [contentInput, refreshFirstPage, submitting, titleInput]);

  const onEditClick = useCallback((item: PhraseItem) => {
    setEditingItem(item);
    setEditTitle(item.keyword);
    setEditContent(item.content || '');
    setEditDialogOpen(true);
  }, []);

  const onEditConfirm = useCallback(async () => {
    const keyword = editTitle.trim();
    const content = editContent.trim();
    if (!editingItem) return;
    if (!keyword) {
      message.error('请输入关键词');
      return;
    }
    if (!content) {
      message.error('请输入短语内容');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const resp = await updateKeywordsApi(editingItem.id, { keyword, content });
      if (resp?.success === false) throw new Error('failed');
      message.success('编辑短语成功');
      setEditDialogOpen(false);
      setEditingItem(null);
      await refreshFirstPage();
    } catch (err: any) {
      if (err?.error?.response?.data?.message) {
        message.error(err.error.response.data.message);
      } else {
        message.error('编辑短语失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }, [editContent, editTitle, editingItem, refreshFirstPage, submitting]);

  const onDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      const resp = await deleteKeywordsApi(deleteTarget.id);
      if (resp?.success === false) throw new Error('failed');
      message.success('删除短语成功');
      setDeleteTarget(null);
      await refreshFirstPage();
    } catch (err: any) {
      if (err?.error?.response?.data?.message) {
        message.error(err.error.response.data.message);
      } else {
        message.error('删除短语失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }, [deleteTarget, refreshFirstPage, submitting]);

  return (
    <div className={`${styles.page} ${stylesPhrase.history}`}>
      <div className={stylesPhrase.header}>
        <div className={stylesPhrase.titleWrap}>
          <h1 className={stylesPhrase.title}>自定义短语</h1>
          <p className={stylesPhrase.subtitle}>设置快捷短语，让复杂内容录入更简单。</p>
        </div>
        <button
          type="button"
          className={stylesPhrase.addButton}
          onClick={() => setAddDialogOpen(true)}
        >
          <span>新增</span>
        </button>
      </div>

      <div className={stylesPhrase.privacyCard}>
        <div className={stylesPhrase.privacyTitle}>定制你的输入方式</div>
        <div className={stylesPhrase.privacyDesc}>
          点击右上角的“新增”按键后，您可以为任何常用的文本内容设定简短的语音指令。无论是长串账号，还是复杂的文本内容，当您说出预设的关键词时，对应的内容将自动填充。
        </div>
        <div className={stylesPhrase.searchWrap}>
          <span className={stylesPhrase.searchLabel}>个人自定义（{total}）</span>
          <div className={stylesPhrase.searchInputWrap}>
            <HistorySearchIcon className={stylesPhrase.searchIcon} />
            <input
              className={stylesPhrase.searchInput}
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

      <div className={stylesPhrase.listWrap}>
        {items.length === 0 && !loading ? (
          <div className={stylesPhrase.empty}>暂无数据</div>
        ) : (
          <div className={stylesPhrase.list}>
            {items.map((item) => (
              <div key={item.id} className={stylesPhrase.listItem}>
                <div className={stylesPhrase.phraseLine}>
                  <span className={stylesPhrase.keywordText}>{item.keyword}</span>
                  <span className={stylesPhrase.arrow}>→</span>
                  <span className={stylesPhrase.contentText}>{item.content || '-'}</span>
                </div>
                <div className={stylesPhrase.actions}>
                  <button
                    type="button"
                    className={`${stylesPhrase.iconBtn} ${stylesPhrase.editBtn}`}
                    title="编辑"
                    aria-label="编辑"
                    onClick={() => onEditClick(item)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    className={`${stylesPhrase.iconBtn} ${stylesPhrase.deleteBtn}`}
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
        {(loading || loadingMore) && <div className={stylesPhrase.loadingText}>加载中...</div>}
        {hasMore && <div ref={loadMoreRef} className={stylesPhrase.loadMoreSentinel} />}
      </div>

      <CustomContentDialog
        open={addDialogOpen}
        title="自定义短语"
        cancelText="取消"
        confirmText={submitting ? '保存中...' : '保存内容'}
        onCancel={() => {
          setAddDialogOpen(false);
          setTitleInput('');
          setContentInput('');
        }}
        onConfirm={() => void onAddConfirm()}
        confirmLoading={submitting}
      >
        <div className={stylesPhrase.addDialogFieldWrap}>
          <input
            className={stylesPhrase.addDialogTitleInput}
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value.slice(0, MAX_PHRASE_LENGTH))}
            placeholder="快捷短语"
            maxLength={MAX_PHRASE_LENGTH}
          />
          <span className={stylesPhrase.addDialogCharCount}>
            {titleInput.length}/{MAX_PHRASE_LENGTH}
          </span>
        </div>
        <div className={stylesPhrase.addDialogFieldWrap}>
          <textarea
            className={stylesPhrase.addDialogTextarea}
            value={contentInput}
            onChange={(e) => setContentInput(e.target.value.slice(0, MAX_PHRASE_LENGTH))}
            placeholder="输出内容"
            maxLength={MAX_PHRASE_LENGTH}
          />
          <span className={stylesPhrase.addDialogCharCount}>
            {contentInput.length}/{MAX_PHRASE_LENGTH}
          </span>
        </div>
      </CustomContentDialog>

      <CustomContentDialog
        open={editDialogOpen}
        title="编辑短语"
        cancelText="取消"
        confirmText={submitting ? '保存中...' : '保存更改'}
        onCancel={() => {
          if (submitting) return;
          setEditDialogOpen(false);
          setEditingItem(null);
          setEditTitle('');
          setEditContent('');
        }}
        onConfirm={() => void onEditConfirm()}
        confirmLoading={submitting}
      >
        <div className={stylesPhrase.addDialogFieldWrap}>
          <input
            className={stylesPhrase.addDialogTitleInput}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value.slice(0, MAX_PHRASE_LENGTH))}
            placeholder="请输入关键词"
            maxLength={MAX_PHRASE_LENGTH}
          />
          <span className={stylesPhrase.addDialogCharCount}>
            {editTitle.length}/{MAX_PHRASE_LENGTH}
          </span>
        </div>
        <div className={stylesPhrase.addDialogFieldWrap}>
          <textarea
            className={stylesPhrase.addDialogTextarea}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value.slice(0, MAX_PHRASE_LENGTH))}
            placeholder="请输入短语内容"
            maxLength={MAX_PHRASE_LENGTH}
          />
          <span className={stylesPhrase.addDialogCharCount}>
            {editContent.length}/{MAX_PHRASE_LENGTH}
          </span>
        </div>
      </CustomContentDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="您确认要删除该短语吗？"
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

export default PhrasePage;
