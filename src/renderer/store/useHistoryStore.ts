import { create } from 'zustand';
import { getUserInfo, type UserInfo } from '@/utils/auth';

export type VoiceHistoryStatus = 'done' | 'error' | 'cancelled';

export type VoiceHistoryRecord = {
  /** 唯一 id（本地生成） */
  id: string;
  /** 识别记录创建时间（通常为录音结束时间） */
  createdAt: number; // ms
  /** 录音开始时间 */
  startedAt: number; // ms
  /** 录音结束时间 */
  endedAt: number; // ms
  /** 语音时长 */
  durationMs: number;
  /** 识别状态 */
  status: VoiceHistoryStatus;
  /** 识别结果文本（done） */
  text: string;
  /** 错误信息（error） */
  errorMessage?: string;
  /** 额外信息（暂不展示，先存起来） */
  meta?: {
    /** 发送到识别接口的音频信息 */
    audio?: {
      mimeType?: string;
      sizeBytes?: number;
    };
    /** 识别接口原始返回（如果未来从 string 升级为对象，可直接塞这里） */
    rawResponse?: unknown;
    /** 本条记录的模式：普通识别 / 重写 */
    mode?: 'asr' | 'rewrite' | string;
    /** 重写相关信息（不展示，先存） */
    rewrite?: {
      selectedText?: string;
      instruction?: string;
      rawResponse?: unknown;
    };
    /** 触发来源（global-hotkey/manual） */
    trigger?: 'global-hotkey' | 'manual' | string;
    /** 识别链路：短录音 sse / 长录音 ws */
    recognitionRoute?: 'sse' | 'ws' | string;
  };
};

type PersistedShapeV1 = {
  version: 1;
  records: VoiceHistoryRecord[];
};

/**
 * 旧版本历史记录（未绑定账号）使用的全局 key。
 * 新版本会按账号分桶存储：`${LEGACY_STORAGE_KEY}::u:${userKey}`
 */
const LEGACY_STORAGE_KEY = 'SENSETYPE_VOICE_HISTORY_V1';
const MAX_RECORDS = 500;

function stripAllNewlines(text: unknown): string {
  try {
    // 删除换行，并吞掉换行两侧的空白，避免“换行被替换成空格”的观感
    return String(text ?? '').replace(/[ \t\u00A0]*(\r\n|\r|\n)[ \t\u00A0]*/g, '');
  } catch {
    return String(text ?? '');
  }
}

function shouldPreserveNewlines(record: Partial<VoiceHistoryRecord> | null | undefined): boolean {
  try {
    const route = String((record as any)?.meta?.recognitionRoute || '').toLowerCase();
    if (route === 'ws') return true;
    // 兼容老数据：长录音常见触发来源为组合键
    const trigger = String((record as any)?.meta?.trigger || '').toLowerCase();
    return trigger === 'global-hotkey-combo';
  } catch {
    return false;
  }
}

function sanitizeRecords(records: VoiceHistoryRecord[]): {
  records: VoiceHistoryRecord[];
  changed: boolean;
} {
  let changed = false;
  const next = (records || []).map((r) => {
    const rawText = String((r as any)?.text ?? '');
    const text = shouldPreserveNewlines(r) ? rawText : stripAllNewlines(rawText);
    if (text !== (r as any)?.text) changed = true;
    return { ...(r as any), text } as VoiceHistoryRecord;
  });
  return { records: next, changed };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeUserKey(userInfo?: UserInfo | null): string {
  try {
    const raw = (userInfo as any)?.id ?? (userInfo as any)?.phone ?? 'guest';
    const s = String(raw || '').trim();
    return s || 'guest';
  } catch {
    return 'guest';
  }
}

function getCurrentUserKey(): string {
  return normalizeUserKey(getUserInfo());
}

function getStorageKeyForUser(userKey: string): string {
  // 使用 encodeURIComponent 规避极端字符导致 key 异常
  return `${LEGACY_STORAGE_KEY}::u:${encodeURIComponent(String(userKey || 'guest'))}`;
}

function loadFromStorage(storageKey: string): VoiceHistoryRecord[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = safeParse(raw) as PersistedShapeV1 | null;
    if (!parsed || (parsed as any).version !== 1 || !Array.isArray((parsed as any).records))
      return [];
    // 轻量校验 + 过滤脏数据
    return (parsed.records as any[]).filter(
      (r) => r && typeof r.id === 'string' && typeof r.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function saveToStorage(storageKey: string, records: VoiceHistoryRecord[]) {
  try {
    const payload: PersistedShapeV1 = { version: 1, records };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore quota / security exceptions
  }
}

function genId(): string {
  // 足够本地唯一即可
  return `vh_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

type HistoryState = {
  hydrated: boolean;
  records: VoiceHistoryRecord[];
  /** 当前记录所属的账号 key（userId / phone / guest） */
  userKey: string;
};

type HistoryActions = {
  hydrate: () => void;
  addRecord: (record: Omit<VoiceHistoryRecord, 'id'> & { id?: string }) => string;
  deleteRecord: (id: string) => void;
  clear: () => void;
};

function sortByCreatedAtDesc(records: VoiceHistoryRecord[]): VoiceHistoryRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

function bindAuthChangedOnce(set: (partial: Partial<HistoryState>) => void) {
  try {
    const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
    if (!ipcRenderer?.on) return;
    if ((window as any).__sensetype_history_store_auth_changed_bound) return;
    (window as any).__sensetype_history_store_auth_changed_bound = true;

    ipcRenderer.on('auth-changed', (_event: any, payload: any) => {
      try {
        const userKey = normalizeUserKey(payload?.userInfo ?? null);
        const storageKey = getStorageKeyForUser(userKey);
        const loaded = sortByCreatedAtDesc(loadFromStorage(storageKey));
        const { records, changed } = sanitizeRecords(loaded);
        if (changed) saveToStorage(storageKey, records);
        set({ userKey, records, hydrated: true });
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  hydrated: false,
  records: [],
  userKey: getCurrentUserKey(),

  hydrate: () => {
    bindAuthChangedOnce(set);
    const userKey = getCurrentUserKey();
    const storageKey = getStorageKeyForUser(userKey);
    const loaded = sortByCreatedAtDesc(loadFromStorage(storageKey));
    const { records, changed } = sanitizeRecords(loaded);
    if (changed) saveToStorage(storageKey, records);

    // 兼容：若新分桶为空，且存在旧全局历史，则默认展示旧历史（作为 guest 的“遗留数据”）。
    // 不做自动迁移到当前账号，避免误绑定到错误账号。
    if (records.length === 0) {
      try {
        const legacyLoaded = sortByCreatedAtDesc(loadFromStorage(LEGACY_STORAGE_KEY));
        const { records: legacy, changed: legacyChanged } = sanitizeRecords(legacyLoaded);
        if (legacyChanged) saveToStorage(LEGACY_STORAGE_KEY, legacy);
        if (legacy.length > 0) {
          set({ records: legacy, hydrated: true, userKey });
          return;
        }
      } catch {
        // ignore
      }
    }

    set({ records, hydrated: true, userKey });
  },

  addRecord: (record) => {
    // 确保不会因为未 hydrate 而覆盖历史（History 页可能从未打开过）
    const currentUserKey = getCurrentUserKey();
    const currentStorageKey = getStorageKeyForUser(currentUserKey);
    if (!get().hydrated || get().userKey !== currentUserKey) {
      const loaded = sortByCreatedAtDesc(loadFromStorage(currentStorageKey));
      set({ records: loaded, hydrated: true, userKey: currentUserKey });
    }

    const id = record.id ?? genId();
    const keepNewlines = shouldPreserveNewlines({ meta: record.meta });
    const next: VoiceHistoryRecord = {
      id,
      createdAt: record.createdAt ?? record.endedAt ?? Date.now(),
      startedAt: record.startedAt ?? record.createdAt ?? Date.now(),
      endedAt: record.endedAt ?? record.createdAt ?? Date.now(),
      durationMs: Math.max(0, record.durationMs ?? 0),
      status: record.status,
      text: keepNewlines ? String(record.text ?? '') : stripAllNewlines(record.text ?? ''),
      errorMessage: record.errorMessage,
      meta: record.meta,
    };

    const prev = get().records;
    const merged = [next, ...prev].slice(0, MAX_RECORDS);
    set({ records: merged, hydrated: true, userKey: currentUserKey });
    saveToStorage(currentStorageKey, merged);
    return id;
  },

  deleteRecord: (id: string) => {
    const currentUserKey = getCurrentUserKey();
    const currentStorageKey = getStorageKeyForUser(currentUserKey);
    if (!get().hydrated || get().userKey !== currentUserKey) {
      const loaded = sortByCreatedAtDesc(loadFromStorage(currentStorageKey));
      set({ records: loaded, hydrated: true, userKey: currentUserKey });
    }

    const prev = get().records;
    const filtered = prev.filter((r) => r.id !== id);
    set({ records: filtered, hydrated: true, userKey: currentUserKey });
    saveToStorage(currentStorageKey, filtered);
  },

  clear: () => {
    const currentUserKey = getCurrentUserKey();
    const currentStorageKey = getStorageKeyForUser(currentUserKey);
    set({ records: [], hydrated: true, userKey: currentUserKey });
    saveToStorage(currentStorageKey, []);
  },
}));

// 模块加载时自动绑定一次，确保登录/登出后历史自动切换
try {
  bindAuthChangedOnce((partial) => useHistoryStore.setState(partial));
} catch {
  // ignore
}
