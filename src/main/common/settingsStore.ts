import Store from 'electron-store';
import {
  DEFAULT_TOGGLE_TO_RECORD,
  type HoldToRecordKeyMac,
  type HoldToRecordKeyWin,
  normalizeMacHoldKey,
  normalizeToggleToRecordConfig,
  normalizeWinHoldKey,
  type ToggleToRecordConfig,
} from '../../common/hotkeyRules';


export type HoldToRecordKey = HoldToRecordKeyMac | HoldToRecordKeyWin;

export interface HoldToRecordConfig {
  /** macOS: option/control/shift/command */
  macKey: HoldToRecordKeyMac;
  /** Windows: alt/control/shift/win/rshift/rctrl/ralt（rshift 会归一到 shift） */
  winKey: HoldToRecordKeyWin;
  /** long-press threshold */
  delayMs: number;
}

export type AccessibilityPromptState = {
  /** 首次启动时是否已经尝试提示过（避免拒绝后反复弹） */
  firstPromptedAt: number | null;
  /** 最近一次“用户主动触发”的提示时间（用于冷却） */
  lastUserPromptAt: number | null;
};

interface SettingsData {
  holdToRecord: HoldToRecordConfig;
  toggleToRecord: ToggleToRecordConfig;
  accessibilityPrompt: AccessibilityPromptState;
  /** 是否开机自启（macOS/Windows 通过 app.setLoginItemSettings 生效） */
  autoLaunchEnabled: boolean;
  /** 首选麦克风 deviceId（null 表示使用系统默认麦克风） */
  preferredMicDeviceId: string | null;
  /** 是否允许播放系统提示音（shell.beep） */
  systemPromptSoundEnabled: boolean;
  /**
   * 录音保存目录：
   * - null: 不保存（默认）
   * - string: 保存到该目录（通常是用户选定目录下的应用子目录）
   */
  recordingSaveDir: string | null;
  /**
   * 自动翻译目标语言：
   * - 'None' 表示关闭
   * - 其它值通常是 BCP-47 语言标签（如 'en-US', 'zh-CN'）
   */
  preferredLanguageVariant: string;
}

const DEFAULT_HOLD_TO_RECORD: HoldToRecordConfig = {
  macKey: 'option',
  winKey: 'ralt',
  delayMs: 0,
};

const DEFAULT_ACCESSIBILITY_PROMPT: AccessibilityPromptState = {
  firstPromptedAt: null,
  lastUserPromptAt: null,
};

const settingsStore: any = new Store<SettingsData>({
  name: 'settings',
  defaults: {
    holdToRecord: DEFAULT_HOLD_TO_RECORD,
    toggleToRecord: DEFAULT_TOGGLE_TO_RECORD,
    accessibilityPrompt: DEFAULT_ACCESSIBILITY_PROMPT,
    autoLaunchEnabled: false,
    preferredMicDeviceId: null,
    // 默认关闭“交互声音/系统提示音”
    systemPromptSoundEnabled: false,
    // 默认不保存录音
    recordingSaveDir: null,
    preferredLanguageVariant: 'None',
  },
});

// FIX: 清除旧版本残留的 systemPromptSoundEnabled 缓存
// 之前版本可能是开启的，现在隐藏入口并默认关闭，需要强制移除旧配置以生效默认值
if (settingsStore.has('systemPromptSoundEnabled')) {
  settingsStore.delete('systemPromptSoundEnabled');
}

// 按产品要求：录音保存不跨启动持久化（每次启动默认不保存）。
// 说明：用户在本次运行中仍可在设置里手动选择目录启用保存；
//       但下次启动会再次被重置为 null。
try {
  settingsStore.set('recordingSaveDir', null);
} catch {
  // ignore
}

function normalizeDelayMs(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_HOLD_TO_RECORD.delayMs;
  // 合理区间：
  // - 0: 立即触发（更跟手，但更容易误触发/与组合键冲突）
  // - 过长：影响体验
  return Math.min(500, Math.max(0, Math.round(n)));
}

export function getHoldToRecordConfig(): HoldToRecordConfig {
  const rawUnknown = settingsStore.get('holdToRecord') as unknown;
  const raw =
    rawUnknown && typeof rawUnknown === 'object'
      ? (rawUnknown as Partial<HoldToRecordConfig>)
      : undefined;
  return {
    macKey: normalizeMacHoldKey(raw?.macKey),
    winKey: normalizeWinHoldKey(raw?.winKey),
    delayMs: normalizeDelayMs(raw?.delayMs),
  };
}

export function setHoldToRecordConfig(patch: Partial<HoldToRecordConfig>): HoldToRecordConfig {
  const cur = getHoldToRecordConfig();
  const next: HoldToRecordConfig = {
    macKey: normalizeMacHoldKey(patch?.macKey ?? cur.macKey),
    winKey: normalizeWinHoldKey(patch?.winKey ?? cur.winKey),
    delayMs: normalizeDelayMs(patch?.delayMs ?? cur.delayMs),
  };
  settingsStore.set('holdToRecord', next);
  return next;
}

export function getToggleToRecordConfig(): ToggleToRecordConfig {
  return normalizeToggleToRecordConfig(settingsStore.get('toggleToRecord'));
}

export function setToggleToRecordConfig(patch: Partial<ToggleToRecordConfig>): ToggleToRecordConfig {
  const cur = getToggleToRecordConfig();
  const next = normalizeToggleToRecordConfig({
    ...cur,
    ...(patch || {}),
  });
  settingsStore.set('toggleToRecord', next);
  return next;
}

export function getAccessibilityPromptState(): AccessibilityPromptState {
  const rawUnknown = settingsStore.get('accessibilityPrompt') as unknown;
  const raw =
    rawUnknown && typeof rawUnknown === 'object'
      ? (rawUnknown as Partial<AccessibilityPromptState>)
      : undefined;
  return {
    firstPromptedAt: typeof raw?.firstPromptedAt === 'number' ? raw.firstPromptedAt : null,
    lastUserPromptAt: typeof raw?.lastUserPromptAt === 'number' ? raw.lastUserPromptAt : null,
  };
}

export function setAccessibilityPromptState(
  patch: Partial<AccessibilityPromptState>,
): AccessibilityPromptState {
  const cur = getAccessibilityPromptState();
  const next: AccessibilityPromptState = {
    firstPromptedAt: patch.firstPromptedAt ?? cur.firstPromptedAt,
    lastUserPromptAt: patch.lastUserPromptAt ?? cur.lastUserPromptAt,
  };
  settingsStore.set('accessibilityPrompt', next);
  return next;
}

export function getAutoLaunchEnabled(): boolean {
  const raw = settingsStore.get('autoLaunchEnabled') as unknown;
  return raw === true;
}

export function setAutoLaunchEnabled(enabled: unknown): boolean {
  const next = enabled === true;
  settingsStore.set('autoLaunchEnabled', next);
  return next;
}

export function getPreferredMicDeviceId(): string | null {
  const raw = settingsStore.get('preferredMicDeviceId') as unknown;
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length ? v : null;
}

export function setPreferredMicDeviceId(deviceId: unknown): string | null {
  if (deviceId === null || deviceId === undefined) {
    settingsStore.set('preferredMicDeviceId', null);
    return null;
  }
  const v = String(deviceId).trim();
  const next = v.length ? v : null;
  settingsStore.set('preferredMicDeviceId', next);
  return next;
}

export function getSystemPromptSoundEnabled(): boolean {
  const raw = settingsStore.get('systemPromptSoundEnabled') as unknown;
  // 默认关闭：仅显式 true 才开启
  return raw === true;
}

export function setSystemPromptSoundEnabled(enabled: unknown): boolean {
  // 默认关闭：仅显式 true 才开启
  const next = enabled === true;
  settingsStore.set('systemPromptSoundEnabled', next);
  return next;
}

export function getRecordingSaveDir(): string | null {
  const raw = settingsStore.get('recordingSaveDir') as unknown;
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length ? v : null;
}

export function setRecordingSaveDir(dir: unknown): string | null {
  if (dir === null || dir === undefined) {
    settingsStore.set('recordingSaveDir', null);
    return null;
  }
  const v = String(dir).trim();
  const next = v.length ? v : null;
  settingsStore.set('recordingSaveDir', next);
  return next;
}

function normalizePreferredLanguageVariant(v: unknown): string {
  // 'None' means disabled
  if (v === 'None') return 'None';
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return 'None';
  // 兼容业务枚举值：保留原 value（不要在设置里强行改成 BCP-47）
  // 需覆盖设置页的全部语言选项
  if (
    s === 'Arabic' ||
    s === 'Cantonese' ||
    s === 'Chinese' ||
    s === 'Dutch' ||
    s === 'English' ||
    s === 'French' ||
    s === 'German' ||
    s === 'Indonesian' ||
    s === 'Italian' ||
    s === 'Japanese' ||
    s === 'Korean' ||
    s === 'Malay' ||
    s === 'Portuguese' ||
    s === 'Russian' ||
    s === 'Spanish' ||
    s === 'Thai' ||
    s === 'Turkish' ||
    s === 'Urdu' ||
    s === 'Vietnamese'
  )
    return s;
  // Accept common BCP-47 forms like: en-US / zh-CN / fr-FR / etc.
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})+$/.test(s) || /^[a-z]{2,3}$/.test(s)) return s;
  return 'None';
}

export function getPreferredLanguageVariant(): string {
  const raw = settingsStore.get('preferredLanguageVariant') as unknown;
  return normalizePreferredLanguageVariant(raw);
}

export function setPreferredLanguageVariant(v: unknown): string {
  const next = normalizePreferredLanguageVariant(v);
  settingsStore.set('preferredLanguageVariant', next);
  return next;
}

// NOTE(standard-B): 不在 common 内做任何平台分支判断。
