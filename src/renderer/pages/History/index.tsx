import styles from '../common.module.scss';
import stylesHistory from './index.module.scss';
import { useEffect, useMemo, useState } from 'react';
import { useHistoryStore } from '@/renderer/store/useHistoryStore';
import ShapeSimplifyIcon from '@/assets/icons/shape-simplify.svg?react';
import HistorySearchIcon from '@/assets/icons/history-search.svg?react';
import DeleteIcon from '@/assets/icons/notes-delete.svg?react';
import ConfirmDialog from '@/renderer/components/ConfirmDialog';
import { InfoButton } from '@/renderer/components/InfoListCard';
import { message } from '@/renderer/components/Message';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatDayTitle(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日`;
}

function formatTimeOnly(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 兜底：部分环境可能没有 clipboard API（比如 Electron 某些上下文）
    try {
      const el = document.createElement('textarea');
      el.value = text;
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

type DayGroup = {
  dayKey: string;
  title: string;
  items: { id: string; createdAt: number; text: string }[];
};

const HistoryPage = () => {
  const hydrate = useHistoryStore((s) => s.hydrate);
  const records = useHistoryStore((s) => s.records);
  const hydrated = useHistoryStore((s) => s.hydrated);
  const clear = useHistoryStore((s) => s.clear);
  const deleteRecord = useHistoryStore((s) => s.deleteRecord);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrate, hydrated]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(queryInput);
    }, 100);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  const groups: DayGroup[] = useMemo(() => {
    // 仅展示成功的识别结果；失败的先不展示，但已落库可追溯
    const done = records.filter((r) => r.status === 'done' && (r.text || '').trim());
    const map = new Map<string, DayGroup>();
    for (const r of done) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const existing = map.get(key);
      const item = { id: r.id, createdAt: r.createdAt, text: r.text };
      if (existing) existing.items.push(item);
      else map.set(key, { dayKey: key, title: formatDayTitle(r.createdAt), items: [item] });
    }
    const out = Array.from(map.values()).sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));
    for (const g of out) g.items.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [records]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups: DayGroup[] = useMemo(() => {
    if (!normalizedQuery) return groups;
    const out: DayGroup[] = [];
    for (const g of groups) {
      const items = g.items.filter((it) => it.text.toLowerCase().includes(normalizedQuery));
      if (items.length > 0) out.push({ ...g, items });
    }
    return out;
  }, [groups, normalizedQuery]);

  const showNoMatchEmpty =
    groups.length > 0 && filteredGroups.length === 0 && Boolean(normalizedQuery);

  const onCopy = async (text: string) => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) message.success('复制成功');
  };

  const onClearAll = () => {
    if (records.length === 0) return;
    setConfirmOpen(true);
  };

  const onDeleteClick = (id: string) => {
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const onDeleteConfirm = () => {
    if (deleteTargetId) {
      deleteRecord(deleteTargetId);
      setDeleteTargetId(null);
    }
    setDeleteConfirmOpen(false);
  };

  return (
    <div className={`${styles.page} ${stylesHistory.history}`}>
      <div className={stylesHistory.header}>
        <div className={stylesHistory.titleWrap}>
          <h1 className={stylesHistory.title}>历史记录</h1>
          <p className={stylesHistory.subtitle}>您的操作使用记录</p>
        </div>
        <InfoButton variant="secondary" onClick={onClearAll} disabled={records.length === 0}>
          全部清除
        </InfoButton>
      </div>

      <div
        className={stylesHistory.privacyCard}
        style={{ marginBottom: filteredGroups.length ? '27px' : '60px' }}
      >
        <div className={stylesHistory.privacyTitle}>您的数据保持私密</div>
        <div className={stylesHistory.privacyDesc}>
          您的语音口述是私密的，它们仅存在您的设备上，无法从其他地方访问，当您切换账号时，所有记录将自动删除。
        </div>
        <div className={stylesHistory.searchWrap}>
          <HistorySearchIcon className={stylesHistory.searchIcon} />
          <input
            className={stylesHistory.searchInput}
            placeholder="搜索历史记录"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQueryInput('');
                setQuery('');
              }
            }}
          />
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className={stylesHistory.empty}>
          {showNoMatchEmpty ? (
            <>
              <p className={stylesHistory.emptyTitle}>暂无匹配记录</p>
              <p className={stylesHistory.emptyDesc}>换个关键词试试。</p>
            </>
          ) : (
            <>
              <p className={stylesHistory.emptyTitle}>暂无记录</p>
              <p className={stylesHistory.emptyDesc}>
                按住录音热键说几句话，识别结果会自动出现在这里。
              </p>
            </>
          )}
        </div>
      ) : (
        <div className={stylesHistory.groups}>
          {filteredGroups.map((g) => (
            <div key={g.dayKey} className={stylesHistory.day}>
              <div className={stylesHistory.dayTitle}>{g.title}</div>
              <div className={stylesHistory.dayCard}>
                {g.items.map((it) => (
                  <div key={it.id} className={stylesHistory.row}>
                    <div className={stylesHistory.rowTime}>{formatTimeOnly(it.createdAt)}</div>
                    <div className={stylesHistory.rowText}>{it.text}</div>
                    <div className={stylesHistory.copyBtnWrap}>
                      <div
                        className={stylesHistory.copyBtn}
                        onClick={() => onCopy(it.text)}
                        title="复制"
                      >
                        <ShapeSimplifyIcon />
                      </div>
                      <div
                        className={stylesHistory.deleteBtn}
                        onClick={() => onDeleteClick(it.id)}
                        title="删除"
                      >
                        <DeleteIcon />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        danger
        title="清除全部历史记录？"
        description="该操作会删除当前账号在本机的语音转文字历史记录，且不可撤销。"
        confirmText="确定清除"
        cancelText="取消"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          clear();
          setConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        danger
        title="删除这条记录？"
        description="该操作不可撤销。"
        confirmText="确定删除"
        cancelText="取消"
        onCancel={() => {
          setDeleteConfirmOpen(false);
          setDeleteTargetId(null);
        }}
        onConfirm={onDeleteConfirm}
      />
    </div>
  );
};

export default HistoryPage;
