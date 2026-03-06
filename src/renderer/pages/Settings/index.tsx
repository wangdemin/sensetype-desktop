import { useCallback, useEffect, useRef, useState } from 'react';
import commonStyles from '../common.module.scss';
import KeyboardIcon from '@/assets/icons/settings-frame.svg?react';
import SettingsMicIcon from '@/assets/icons/settings-mic.svg?react';
import SettingsLanguageIcon from '@/assets/icons/settings-language.svg?react';
import pageStyles from './index.module.scss';
import { DropdownSelect } from '@/renderer/components/DropdownSelect';
import { track } from '@/utils/posthog';
import {
  DEFAULT_TOGGLE_TO_RECORD,
  formatAcceleratorForDisplay,
  normalizeAccelerator,
  type HoldToRecordKeyMac,
  type HoldToRecordKeyWin,
  type ToggleToRecordConfig,
} from '@/common/hotkeyRules';

type HoldToRecordConfig = {
  macKey: HoldToRecordKeyMac;
  winKey: HoldToRecordKeyWin;
  delayMs: number;
};

type MicrophoneDevice = {
  deviceId: string;
  label: string;
};

type OptionItem = { value: string; label: string; disabled?: boolean };

const DEFAULT_HOLD_TO_RECORD: HoldToRecordConfig = {
  macKey: 'option',
  winKey: 'ralt',
  delayMs: 0,
};

function normalizeMacHoldKey(value: unknown): HoldToRecordKeyMac {
  if (value === 'option' || value === 'control' || value === 'shift' || value === 'command')
    return value;
  return DEFAULT_HOLD_TO_RECORD.macKey;
}

function normalizeWinHoldKey(value: unknown): HoldToRecordKeyWin {
  if (value === 'rshift') return 'shift';
  if (
    value === 'alt' ||
    value === 'control' ||
    value === 'shift' ||
    value === 'win' ||
    value === 'rctrl' ||
    value === 'ralt' ||
    value === 'lalt' ||
    value === 'lctrl' ||
    value === 'lshift' ||
    value === 'lwin'
  ) {
    return value;
  }
  return DEFAULT_HOLD_TO_RECORD.winKey;
}

function formatHoldKeyLabel(key: HoldToRecordKeyMac | HoldToRecordKeyWin): string {
  if (key === 'option') return 'Option';
  if (key === 'control') return 'Ctrl';
  if (key === 'shift') return 'Shift';
  if (key === 'command') return 'Command';
  if (key === 'win') return 'Win';
  if (key === 'rshift') return 'Shift';
  if (key === 'rctrl') return '右 Ctrl';
  if (key === 'alt') return 'Alt';
  if (key === 'lalt') return '左 Alt';
  if (key === 'lctrl') return '左 Ctrl';
  if (key === 'lshift') return '左 Shift';
  if (key === 'lwin') return '左 Win';
  return '右 Alt';
}

function getHoldKeyFromEvent(
  e: KeyboardEvent,
  isMac: boolean,
): HoldToRecordKeyMac | HoldToRecordKeyWin | null {
  const key = String(e.key || '');
  const code = String(e.code || '');
  if (isMac) {
    if (key === 'Alt' || code === 'AltLeft' || code === 'AltRight') return 'option';
    if (key === 'Control' || code === 'ControlLeft' || code === 'ControlRight') return 'control';
    if (key === 'Shift' || code === 'ShiftLeft' || code === 'ShiftRight') return 'shift';
    if (key === 'Meta' || code === 'MetaLeft' || code === 'MetaRight') return 'command';
    return null;
  }
  if (code === 'AltRight') return 'ralt';
  if (code === 'AltLeft') return 'lalt';
  if (code === 'ControlRight') return 'rctrl';
  if (code === 'ControlLeft') return 'lctrl';
  if (code === 'ShiftRight') return 'rshift';
  if (code === 'ShiftLeft') return 'lshift';
  if (code === 'MetaLeft') return 'lwin';
  if (code === 'MetaRight') return 'win';
  if (key === 'Alt') return 'lalt';
  if (key === 'Control') return 'lctrl';
  if (key === 'Shift') return 'lshift';
  if (key === 'Meta') return 'lwin';
  return null;
}

type SettingsSaveResponse<T> =
  | T
  | {
      success?: unknown;
      config?: T;
      blockedReasons?: unknown;
      warningReasons?: unknown;
    };

const PREFERRED_LANGUAGE_STORAGE_KEY = 'preferred_language_variant';

const PREFERRED_LANGUAGE_OPTIONS: OptionItem[] = [
  { value: 'None', label: '默认语言' },
  { value: 'Chinese', label: '中文（普通话）' },
  { value: 'English', label: '英语' },
  { value: 'Arabic', label: '阿拉伯语' },
  { value: 'German', label: '德语' },
  { value: 'Russian', label: '俄语' },
  { value: 'French', label: '法语' },
  { value: 'Korean', label: '韩语' },
  { value: 'Dutch', label: '荷兰语' },
  { value: 'Malay', label: '马来语' },
  { value: 'Portuguese', label: '葡萄牙语' },
  { value: 'Japanese', label: '日语' },
  { value: 'Thai', label: '泰语' },
  { value: 'Turkish', label: '土耳其语' },
  { value: 'Urdu', label: '乌尔都语' },
  { value: 'Spanish', label: '西班牙语' },
  { value: 'Indonesian', label: '印尼语' },
  { value: 'Italian', label: '意大利语' },
  { value: 'Cantonese', label: '粤语' },
  { value: 'Vietnamese', label: '越南语' },
];

type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

type WindowBridge = Window & {
  sensetype?: {
    isMacOs?: () => boolean;
    isWindows?: () => boolean;
    showNotification?: (body: string) => void;
  };
  electronAPI?: {
    ipcRenderer?: IpcRendererLike;
  };
};

function getIpcRenderer(): IpcRendererLike | null {
  const w = window as unknown as WindowBridge;
  return w?.electronAPI?.ipcRenderer ?? null;
}

async function setMacHotkeySuspended(suspended: boolean, reason: string): Promise<void> {
  const w = window as unknown as WindowBridge;
  const isMac = w?.sensetype?.isMacOs?.() ?? false;
  if (!isMac) return;
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return;
  try {
    await ipcRenderer.invoke('hotkey-set-suspended', { suspended, reason });
  } catch {
    // ignore
  }
}

function getReasons(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((s): s is string => typeof s === 'string' && !!s.trim());
}

function parseSettingsSaveResponse<T>(input: SettingsSaveResponse<T>): {
  success: boolean;
  config: T | null;
  blockedReasons: string[];
  warningReasons: string[];
} {
  if (input && typeof input === 'object' && 'config' in input) {
    const obj = input as {
      success?: unknown;
      config?: T;
      blockedReasons?: unknown;
      warningReasons?: unknown;
    };
    return {
      success: obj.success !== false,
      config: (obj.config as T | undefined) ?? null,
      blockedReasons: getReasons(obj.blockedReasons),
      warningReasons: getReasons(obj.warningReasons),
    };
  }
  return {
    success: true,
    config: (input as T) ?? null,
    blockedReasons: [],
    warningReasons: [],
  };
}

function isModifierKey(key: string): boolean {
  return (
    key === 'Control' ||
    key === 'Alt' ||
    key === 'Shift' ||
    key === 'Meta' ||
    key === 'Super' ||
    key === 'Command'
  );
}

function isModifierAcceleratorToken(token: string): boolean {
  return (
    token === 'Command' ||
    token === 'Control' ||
    token === 'Alt' ||
    token === 'Shift' ||
    token === 'Super'
  );
}

function normalizeKeyFromKeyboardEvent(e: KeyboardEvent): string {
  const key = String(e.key || '');
  const code = String(e.code || '');
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Escape';
  if (key === 'Enter') return 'Enter';
  if (key === 'Tab') return 'Tab';
  if (key === 'Backspace') return 'Backspace';
  if (key === 'Delete') return 'Delete';
  if (key === 'Home') return 'Home';
  if (key === 'End') return 'End';
  if (key === 'PageUp') return 'PageUp';
  if (key === 'PageDown') return 'PageDown';
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')
    return key;
  if (key.length === 1) {
    return /[a-z]/i.test(key) ? key.toUpperCase() : key;
  }
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase();
  return key;
}

function buildAcceleratorFromKeyboardEvent(e: KeyboardEvent, isMac: boolean): string {
  const tokens: string[] = [];
  if (e.metaKey) tokens.push(isMac ? 'Command' : 'Super');
  if (e.ctrlKey) tokens.push('Control');
  if (e.altKey) tokens.push('Alt');
  if (e.shiftKey) tokens.push('Shift');
  const key = normalizeKeyFromKeyboardEvent(e);
  if (key && !isModifierKey(key)) tokens.push(key);
  return normalizeAccelerator(tokens.join('+'));
}

const SettingsPage = () => {
  const w = window as unknown as WindowBridge;
  const isMac = w?.sensetype?.isMacOs?.() ?? false;
  const isWin = w?.sensetype?.isWindows?.() ?? !isMac;
  const [holdToRecord, setHoldToRecord] = useState<HoldToRecordConfig>(DEFAULT_HOLD_TO_RECORD);
  const [holdWarnings, setHoldWarnings] = useState<string[]>([]);
  const [holdBlocked, setHoldBlocked] = useState<string[]>([]);
  const [toggleToRecord, setToggleToRecord] = useState<ToggleToRecordConfig>(
    DEFAULT_TOGGLE_TO_RECORD,
  );
  const [toggleWarnings, setToggleWarnings] = useState<string[]>([]);
  const [toggleBlocked, setToggleBlocked] = useState<string[]>([]);
  const [isCapturingHold, setIsCapturingHold] = useState(false);
  const [holdCaptureHint, setHoldCaptureHint] = useState('');
  const [isCapturingToggle, setIsCapturingToggle] = useState(false);
  const [toggleCaptureHint, setToggleCaptureHint] = useState('');
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [preferredMicDeviceId, setPreferredMicDeviceId] = useState<string | null>(null);
  const [preferredLanguageVariant, setPreferredLanguageVariant] = useState('None');
  // 录音保存：默认不保存（dir=null）
  const [recordingSaveDir, setRecordingSaveDir] = useState<string | null>(null);
  const [recordingDirLoading, setRecordingDirLoading] = useState(false);
  const [recordingClearLoading, setRecordingClearLoading] = useState(false);
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const saveSeqRef = useRef(0);
  const saveToggleSeqRef = useRef(0);
  const toggleCaptureFinalizeTimerRef = useRef<number | null>(null);
  const preferredMicSaveSeqRef = useRef(0);
  const preferredLanguageSaveSeqRef = useRef(0);

  const notify = useCallback((body: string) => {
    try {
      const w = window as unknown as WindowBridge;
      w?.sensetype?.showNotification?.(body);
      return;
    } catch {
      // ignore
    }
    try {
      alert(body);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    ipcRenderer
      .invoke('settings-get-hold-to-record')
      .then((value) => {
        // 主进程会 normalize & 补齐默认值；这里做一次兜底合并，避免返回异常导致 UI 崩
        const v = (value || {}) as Partial<HoldToRecordConfig>;
        const normalized: HoldToRecordConfig = {
          macKey: normalizeMacHoldKey(v.macKey),
          winKey: normalizeWinHoldKey(v.winKey),
          delayMs: typeof v.delayMs === 'number' ? v.delayMs : DEFAULT_HOLD_TO_RECORD.delayMs,
        };
        setHoldToRecord(normalized);
        // 历史上可能保存过 command，这里统一回写为受支持的键位，避免继续使用已下线选项。
        const hasUnsupportedMacKey = typeof v.macKey === 'string' && normalizeMacHoldKey(v.macKey) !== v.macKey;
        const hasUnsupportedWinKey =
          typeof v.winKey === 'string' &&
          normalizeWinHoldKey(v.winKey) !== v.winKey;
        if (hasUnsupportedMacKey || hasUnsupportedWinKey) {
          void ipcRenderer.invoke('settings-set-hold-to-record', normalized).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    ipcRenderer
      .invoke('settings-get-toggle-to-record')
      .then((value) => {
        const v = (value || {}) as Partial<ToggleToRecordConfig>;
        const normalized: ToggleToRecordConfig = {
          macMode: v.macMode === 'custom' ? 'custom' : 'default',
          macAccelerator: normalizeAccelerator(
            String(v.macAccelerator || DEFAULT_TOGGLE_TO_RECORD.macAccelerator),
          ),
          winAccelerator: normalizeAccelerator(
            String(v.winAccelerator || DEFAULT_TOGGLE_TO_RECORD.winAccelerator),
          ),
        };
        setToggleToRecord(normalized);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    let disposed = false;
    const syncVoiceSessionActive = () => {
      void ipcRenderer
        .invoke('hotkey-get-status')
        .then((value) => {
          if (disposed) return;
          const v = (value || {}) as { voiceSessionActive?: unknown };
          setIsVoiceSessionActive(v.voiceSessionActive === true);
        })
        .catch(() => undefined);
    };
    syncVoiceSessionActive();
    const timer = window.setInterval(syncVoiceSessionActive, 800);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    ipcRenderer
      .invoke('settings-get-recording-save-dir')
      .then((value) => {
        const v = (value || {}) as { dir?: unknown };
        const d = typeof v.dir === 'string' ? v.dir.trim() : '';
        setRecordingSaveDir(d ? d : null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    ipcRenderer
      .invoke('settings-get-auto-launch')
      .then((value) => {
        const v = (value || {}) as { enabled?: unknown };
        setAutoLaunchEnabled(v.enabled === true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // 目标语言：优先从主进程 settingsStore 读取；失败则兜底 localStorage；再兜底 None
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      try {
        const v = localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY) || 'None';
        setPreferredLanguageVariant(v);
      } catch {
        //
      }
      return;
    }
    ipcRenderer
      .invoke('settings-get-preferred-language-variant')
      .then((value) => {
        const v = (value || {}) as { value?: unknown };
        const s = typeof v.value === 'string' ? v.value : '';
        const next = s || 'None';
        setPreferredLanguageVariant(next);
        try {
          localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, next);
        } catch {
          //
        }
      })
      .catch(() => {
        try {
          const v = localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY) || 'None';
          setPreferredLanguageVariant(v);
        } catch {
          //
        }
      });
  }, []);

  const refreshMicrophones = useCallback(async () => {
    try {
      if (!navigator?.mediaDevices?.enumerateDevices) {
        setMicrophones([]);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        // Windows 会额外暴露两个“虚拟设备”：default / communications。
        // 我们已经提供了“系统默认”选项（__default__），因此这里在 Win 上隐藏它们，避免选中后出现不稳定行为。
        .filter((d) => {
          if (!isWin || isMac) return true;
          return d.deviceId !== 'default' && d.deviceId !== 'communications';
        })
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `麦克风 ${idx + 1}`,
        }))
        // 尽量去重（某些环境可能出现重复 deviceId）
        .filter((d, i, arr) => arr.findIndex((x) => x.deviceId === d.deviceId) === i);
      setMicrophones(mics);
    } catch (e) {
      console.warn('[Settings] enumerateDevices failed:', e);
      setMicrophones([]);
    }
  }, [isMac, isWin]);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    ipcRenderer
      .invoke('settings-get-preferred-mic')
      .then((value) => {
        const v = (value || {}) as { deviceId?: unknown };
        const d = typeof v.deviceId === 'string' ? v.deviceId.trim() : '';
        setPreferredMicDeviceId(d ? d : null);
      })
      .catch(() => undefined);

    void refreshMicrophones();
  }, [refreshMicrophones]);

  const saveHoldToRecord = useCallback(async (next: HoldToRecordConfig, seq: number) => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    try {
      const raw = (await ipcRenderer.invoke(
        'settings-set-hold-to-record',
        next,
      )) as SettingsSaveResponse<HoldToRecordConfig>;
      const saved = parseSettingsSaveResponse(raw);
      if (saved.blockedReasons.length) setHoldBlocked(saved.blockedReasons);
      else setHoldBlocked([]);
      setHoldWarnings(saved.warningReasons);
      if (!saved.success) {
        if (seq === saveSeqRef.current && saved.config) setHoldToRecord(saved.config);
        return;
      }
      // 只接受“最后一次选择”的回写，避免快速连选时旧请求覆盖新状态
      if (seq === saveSeqRef.current && saved.config) setHoldToRecord(saved.config);
    } catch (e) {
      console.error('Failed to save hold-to-record config:', e);
    } finally {
      // no-op: 保持 UI 可交互，保存过程不锁住下拉框
    }
  }, []);

  const saveToggleToRecord = useCallback(
    async (next: ToggleToRecordConfig, seq: number) => {
      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) return;
      try {
        const raw = (await ipcRenderer.invoke(
          'settings-set-toggle-to-record',
          next,
        )) as SettingsSaveResponse<ToggleToRecordConfig>;
        const saved = parseSettingsSaveResponse(raw);
        if (saved.blockedReasons.length) setToggleBlocked(saved.blockedReasons);
        else setToggleBlocked([]);
        setToggleWarnings(saved.warningReasons);
        if (!saved.success) {
          if (seq === saveToggleSeqRef.current && saved.config) setToggleToRecord(saved.config);
          return;
        }
        if (seq === saveToggleSeqRef.current && saved.config) setToggleToRecord(saved.config);
      } catch (e) {
        console.error('Failed to save toggle-to-record config:', e);
      }
    },
    [],
  );

  const onSaveCapturedHold = useCallback(
    (key: HoldToRecordKeyMac | HoldToRecordKeyWin) => {
      if (isVoiceSessionActive) return;
      const next: HoldToRecordConfig = isMac
        ? { ...holdToRecord, macKey: key as HoldToRecordKeyMac }
        : { ...holdToRecord, winKey: key as HoldToRecordKeyWin };
      const seq = ++saveSeqRef.current;
      setHoldToRecord(next);
      void saveHoldToRecord(next, seq);
    },
    [holdToRecord, isMac, isVoiceSessionActive, saveHoldToRecord],
  );

  const onResetHoldDefault = useCallback(() => {
    if (isVoiceSessionActive) return;
    const next: HoldToRecordConfig = isMac
      ? { ...holdToRecord, macKey: DEFAULT_HOLD_TO_RECORD.macKey }
      : { ...holdToRecord, winKey: DEFAULT_HOLD_TO_RECORD.winKey };
    const seq = ++saveSeqRef.current;
    setHoldBlocked([]);
    setHoldWarnings([]);
    setHoldCaptureHint('');
    setHoldToRecord(next);
    void saveHoldToRecord(next, seq);
  }, [holdToRecord, isMac, isVoiceSessionActive, saveHoldToRecord]);

  const onSaveCapturedToggle = useCallback(
    (accelerator: string) => {
      if (!accelerator) return;
      const next: ToggleToRecordConfig = isMac
        ? {
            ...toggleToRecord,
            macMode: 'custom',
            macAccelerator: accelerator,
          }
        : {
            ...toggleToRecord,
            winAccelerator: accelerator,
          };
      const seq = ++saveToggleSeqRef.current;
      setToggleToRecord(next);
      void saveToggleToRecord(next, seq);
    },
    [isMac, saveToggleToRecord, toggleToRecord],
  );

  const onResetToggleDefault = useCallback(() => {
    if (isVoiceSessionActive) return;
    const next: ToggleToRecordConfig = isMac
      ? {
          ...toggleToRecord,
          macMode: 'default',
          macAccelerator: DEFAULT_TOGGLE_TO_RECORD.macAccelerator,
        }
      : {
          ...toggleToRecord,
          winAccelerator: DEFAULT_TOGGLE_TO_RECORD.winAccelerator,
        };
    const seq = ++saveToggleSeqRef.current;
    setToggleBlocked([]);
    setToggleWarnings([]);
    setToggleCaptureHint('');
    setToggleToRecord(next);
    void saveToggleToRecord(next, seq);
  }, [isMac, isVoiceSessionActive, saveToggleToRecord, toggleToRecord]);

  const stopHoldCapture = useCallback(() => {
    setIsCapturingHold(false);
    setHoldCaptureHint('');
    void setMacHotkeySuspended(false, 'settings-hold-capture-stop');
  }, []);

  const clearToggleCaptureFinalizeTimer = useCallback(() => {
    if (toggleCaptureFinalizeTimerRef.current !== null) {
      window.clearTimeout(toggleCaptureFinalizeTimerRef.current);
      toggleCaptureFinalizeTimerRef.current = null;
    }
  }, []);

  const stopToggleCapture = useCallback(() => {
    clearToggleCaptureFinalizeTimer();
    setIsCapturingToggle(false);
    setToggleCaptureHint('');
  }, [clearToggleCaptureFinalizeTimer]);

  const startHoldCapture = useCallback(() => {
    if (isVoiceSessionActive) return;
    stopToggleCapture();
    setHoldBlocked([]);
    setHoldCaptureHint('请按下单个修饰键（Esc 取消）');
    setIsCapturingHold(true);
    void setMacHotkeySuspended(true, 'settings-hold-capture-start');
  }, [isVoiceSessionActive, stopToggleCapture]);

  const startToggleCapture = useCallback(() => {
    if (isVoiceSessionActive) return;
    stopHoldCapture();
    clearToggleCaptureFinalizeTimer();
    setToggleBlocked([]);
    setToggleWarnings([]);
    setToggleCaptureHint('请按下组合键（Esc 取消）');
    setIsCapturingToggle(true);
  }, [clearToggleCaptureFinalizeTimer, isVoiceSessionActive, stopHoldCapture]);

  useEffect(() => {
    if (!isCapturingHold) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stopHoldCapture();
        return;
      }
      const holdKey = getHoldKeyFromEvent(e, isMac);
      if (!holdKey) {
        setHoldCaptureHint('仅支持修饰键（Ctrl/Alt/Shift/Win）');
        return;
      }
      setHoldCaptureHint(`已捕获：${formatHoldKeyLabel(holdKey)}`);
      onSaveCapturedHold(holdKey);
      stopHoldCapture();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isCapturingHold, isMac, onSaveCapturedHold, stopHoldCapture]);

  useEffect(() => {
    return () => {
      void setMacHotkeySuspended(false, 'settings-unmount');
    };
  }, []);

  useEffect(() => {
    if (!isCapturingToggle) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stopToggleCapture();
        return;
      }
      const acc = buildAcceleratorFromKeyboardEvent(e, isMac);
      if (!acc) return;
      const parts = acc.split('+').filter(Boolean);
      const hasModifier = parts.some((part) => isModifierAcceleratorToken(part));
      if (parts.length < 2) {
        setToggleCaptureHint(
          hasModifier
            ? `已按下：${formatAcceleratorForDisplay(acc)}，请继续按第二个键`
            : '组合键需包含修饰键并至少 2 键',
        );
        clearToggleCaptureFinalizeTimer();
        return;
      }
      if (!hasModifier) {
        setToggleCaptureHint('组合键需包含修饰键并至少 2 键');
        clearToggleCaptureFinalizeTimer();
        return;
      }
      const hasNonModifier = parts.some((part) => !isModifierAcceleratorToken(part));
      setToggleCaptureHint(
        hasNonModifier
          ? `已捕获：${formatAcceleratorForDisplay(acc)}（松开后自动保存）`
          : `已按下：${formatAcceleratorForDisplay(acc)}（可继续按普通键）`,
      );
      clearToggleCaptureFinalizeTimer();
      toggleCaptureFinalizeTimerRef.current = window.setTimeout(
        () => {
          onSaveCapturedToggle(acc);
          stopToggleCapture();
        },
        hasNonModifier ? 180 : 360,
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearToggleCaptureFinalizeTimer();
    };
  }, [
    clearToggleCaptureFinalizeTimer,
    isCapturingToggle,
    isMac,
    onSaveCapturedToggle,
    stopToggleCapture,
  ]);

  const onToggleAutoLaunch = useCallback(() => {
    const next = !autoLaunchEnabled;
    setAutoLaunchEnabled(next);
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    void ipcRenderer
      .invoke('settings-set-auto-launch', { enabled: next })
      .then((value) => {
        const v = (value || {}) as { enabled?: unknown };
        setAutoLaunchEnabled(v.enabled === true);
      })
      .catch(() => undefined);
  }, [autoLaunchEnabled]);

  const onChooseRecordingSaveDir = useCallback(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    if (recordingDirLoading) return;
    setRecordingDirLoading(true);
    void ipcRenderer
      .invoke('settings-choose-recording-save-dir')
      .then((ret) => {
        const v = (ret || {}) as { dir?: unknown };
        const d = typeof v.dir === 'string' ? v.dir.trim() : '';
        setRecordingSaveDir(d ? d : null);
      })
      .catch(() => undefined)
      .finally(() => setRecordingDirLoading(false));
  }, [recordingDirLoading]);

  const onDisableRecordingSave = useCallback(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    if (recordingDirLoading) return;
    setRecordingDirLoading(true);
    void ipcRenderer
      .invoke('settings-set-recording-save-dir', { dir: null })
      .then((ret) => {
        const v = (ret || {}) as { dir?: unknown };
        const d = typeof v.dir === 'string' ? v.dir.trim() : '';
        setRecordingSaveDir(d ? d : null);
      })
      .catch(() => undefined)
      .finally(() => setRecordingDirLoading(false));
  }, [recordingDirLoading]);

  const onClearSavedRecordings = useCallback(async () => {
    const dir = recordingSaveDir || '';
    if (!dir) return;
    try {
      const ok = confirm('确定要清理已保存的录音吗？此操作不可撤销。');
      if (!ok) return;
    } catch {
      // ignore
    }
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    if (recordingClearLoading) return;
    setRecordingClearLoading(true);
    try {
      const res = (await ipcRenderer.invoke('recordings-clear-saved')) as
        | { success?: unknown; skipped?: unknown; clearedFiles?: unknown; error?: unknown }
        | undefined;
      if (res?.success === true) {
        const n = typeof res?.clearedFiles === 'number' ? res.clearedFiles : 0;
        notify(`已清理 ${n} 个录音文件`);
      } else if (res?.skipped === true) {
        notify('当前未启用录音保存');
      } else {
        notify(`清理失败：${typeof res?.error === 'string' ? res.error : '未知错误'}`);
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e && 'message' in e
            ? String((e as { message?: unknown }).message || '未知错误')
            : '未知错误';
      notify(`清理失败：${msg}`);
    } finally {
      setRecordingClearLoading(false);
    }
  }, [notify, recordingClearLoading, recordingSaveDir]);

  const onChangePreferredMic = useCallback((value: string) => {
    const next = value === '__default__' ? null : value;
    const seq = ++preferredMicSaveSeqRef.current;
    setPreferredMicDeviceId(next);
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    void ipcRenderer
      .invoke('settings-set-preferred-mic', { deviceId: next })
      .then((ret) => {
        if (seq !== preferredMicSaveSeqRef.current) return;
        const v = (ret || {}) as { deviceId?: unknown };
        const d = typeof v.deviceId === 'string' ? v.deviceId.trim() : '';
        setPreferredMicDeviceId(d ? d : null);
      })
      .catch(() => undefined);
  }, []);

  const holdLabel = formatHoldKeyLabel(isMac ? holdToRecord.macKey : holdToRecord.winKey);

  const toggleLabel = isMac
    ? toggleToRecord.macMode === 'custom'
      ? formatAcceleratorForDisplay(toggleToRecord.macAccelerator)
      : 'Fn + 空格（默认）'
    : formatAcceleratorForDisplay(toggleToRecord.winAccelerator);

  const micOptions: OptionItem[] = [
    { value: '__default__', label: '系统默认' },
    ...microphones.map((d) => ({ value: d.deviceId, label: d.label })),
  ];

  return (
    <div className={commonStyles.page}>
      <div className={pageStyles.pageHeader}>
        <div className={pageStyles.pageTitleWrap}>
          <h1 className={pageStyles.pageTitle}>设置</h1>
          <p className={pageStyles.pageSubtitle}>修改你的设置内容</p>
        </div>
      </div>

      <div className={pageStyles.container}>
        <div className={pageStyles.shortcutSection}>
          <div className={pageStyles.shortcutHeader}>
            <div className={pageStyles.shortcutIconWrap} aria-hidden="true">
              <KeyboardIcon />
            </div>
            <div className={pageStyles.shortcutHeaderText}>
              <div className={pageStyles.shortcutHeaderTitle}>键盘快捷键</div>
            </div>
          </div>

          {/* 按你的要求：不展示「交互声音」「语音输入时静音」，这里只保留快捷键 */}
          <div className={pageStyles.shortcutCard}>
            <div className={`${pageStyles.shortcutItem} ${pageStyles.toggleShortcutItem}`}>
              <div className={`${pageStyles.shortcutItemLeft} ${pageStyles.toggleShortcutItemLeft}`}>
                <div className={pageStyles.shortcutItemTitle}>语音输入（长按模式）</div>
                <div className={pageStyles.shortcutItemDesc}>
                  长按单个快捷键时说话
                </div>
                {holdWarnings.length ? (
                  <div className={pageStyles.toggleShortcutWarningInline}>
                    {`提示：${holdWarnings.join('；')}`}
                  </div>
                ) : null}
              </div>

              <div className={pageStyles.toggleInputColumn}>
                <div className={pageStyles.toggleHotkeyInput}>
                  <button
                    type="button"
                    className={pageStyles.toggleHotkeyValueBtn}
                    onClick={startHoldCapture}
                    disabled={isVoiceSessionActive}
                    title={
                      isVoiceSessionActive
                        ? '录音中暂不可修改快捷键'
                        : '点击后按下想要的快捷键'
                    }
                  >
                    <span className={pageStyles.toggleHotkeyValueText}>
                      {isCapturingHold ? '请按下单键…' : holdLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={pageStyles.toggleHotkeyActionBtn}
                    onClick={onResetHoldDefault}
                    disabled={isVoiceSessionActive}
                    title="恢复默认快捷键"
                    aria-label="恢复默认快捷键"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M16.95 7.05A7 7 0 1 0 19 12"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M19 4.5V9.5H14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                {holdCaptureHint ? (
                  <div className={pageStyles.toggleCaptureHintInline}>{holdCaptureHint}</div>
                ) : null}
              </div>
            </div>
            {holdBlocked.length ? (
              <div className={pageStyles.hotkeyRuleRow}>{`禁止：${holdBlocked.join('；')}`}</div>
            ) : null}

            <div
              className={`${pageStyles.shortcutItem} ${pageStyles.toggleShortcutItem}`}
              style={{ borderTop: '1px solid #eef2f7' }}
            >
              <div className={`${pageStyles.shortcutItemLeft} ${pageStyles.toggleShortcutItemLeft}`}>
                <div className={pageStyles.shortcutItemTitle}>语言输入（非长按模式）</div>
                <div className={pageStyles.shortcutItemDesc}>
                  按下设置好的组合键（支持两键或三键），松开后即可开始识别，说话时无需长按，再次按下即可停止。
                </div>
                {toggleWarnings.length ? (
                  <div className={pageStyles.toggleShortcutWarningInline}>
                    {`提示：${toggleWarnings.join('；')}`}
                  </div>
                ) : null}
              </div>

              <div className={pageStyles.toggleInputColumn}>
                <div className={pageStyles.toggleHotkeyInput}>
                  <button
                    type="button"
                    className={pageStyles.toggleHotkeyValueBtn}
                    onClick={startToggleCapture}
                    disabled={isVoiceSessionActive}
                    title={
                      isVoiceSessionActive
                        ? '录音中暂不可修改快捷键'
                        : '点击后按下想要的组合键'
                    }
                  >
                    <span className={pageStyles.toggleHotkeyValueText}>
                      {isCapturingToggle ? '请按下组合键…' : toggleLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={pageStyles.toggleHotkeyActionBtn}
                    onClick={onResetToggleDefault}
                    disabled={isVoiceSessionActive}
                    title="恢复默认组合键"
                    aria-label="恢复默认组合键"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M16.95 7.05A7 7 0 1 0 19 12"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M19 4.5V9.5H14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                {toggleCaptureHint ? (
                  <div className={pageStyles.toggleCaptureHintInline}>{toggleCaptureHint}</div>
                ) : null}
              </div>
            </div>
            {toggleBlocked.length ? (
              <div className={pageStyles.hotkeyRuleRow}>{`禁止：${toggleBlocked.join('；')}`}</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className={pageStyles.container}>
        <div className={pageStyles.shortcutSection}>
          <div className={pageStyles.shortcutHeader}>
            <div className={pageStyles.shortcutIconWrap} aria-hidden="true">
              <SettingsMicIcon />
            </div>
            <div className={pageStyles.shortcutHeaderText}>
              <div className={pageStyles.shortcutHeaderTitle}>音频</div>
            </div>
          </div>

          <div className={pageStyles.shortcutCard}>
            <div className={pageStyles.shortcutItem}>
              <div className={pageStyles.shortcutItemLeft}>
                <div className={pageStyles.shortcutItemTitle}>麦克风</div>
                <div className={pageStyles.shortcutItemDesc}>
                  选择您首选的麦克风，以便SenseAudio AI语音输入法捕捉您的声音
                </div>
              </div>

              <div className={pageStyles.shortcutItemRight}>
                <DropdownSelect
                  value={preferredMicDeviceId ?? '__default__'}
                  options={micOptions}
                  onChange={onChangePreferredMic}
                  ariaLabel="选择麦克风"
                  title="选择麦克风"
                  triggerClassName={pageStyles.hotkeyPill}
                />
              </div>
            </div>
          </div>
          {/* <div className={pageStyles.shortcutCard} style={{ marginTop: '8px' }}>
            <div className={pageStyles.shortcutItem}>
              <div className={pageStyles.shortcutItemLeft}>
                <div className={pageStyles.shortcutItemTitle}>录音保存位置</div>
                <div className={pageStyles.shortcutItemDesc}>
                  {recordingSaveDir ? (
                    <>
                      已启用，保存到：
                      <span className={pageStyles.kvVal} style={{ marginLeft: 6 }}>
                        {recordingSaveDir}
                      </span>
                    </>
                  ) : (
                    <>默认不保存；选择目录后将自动保存本次启动的每次录音（重启后会自动关闭）</>
                  )}
                </div>
              </div>

              <div className={pageStyles.shortcutItemRight}>
                <button
                  type="button"
                  className={pageStyles.secondaryBtn}
                  onClick={onChooseRecordingSaveDir}
                  disabled={recordingDirLoading}
                >
                  {recordingSaveDir ? '更换目录' : '选择目录'}
                </button>
                {recordingSaveDir ? (
                  <button
                    type="button"
                    className={pageStyles.secondaryBtn}
                    onClick={onDisableRecordingSave}
                    disabled={recordingDirLoading}
                  >
                    不保存
                  </button>
                ) : null}
              </div>
            </div>

            <div className={pageStyles.shortcutItem} style={{ borderTop: '1px solid #eef2f7' }}>
              <div className={pageStyles.shortcutItemLeft}>
                <div className={pageStyles.shortcutItemTitle}>一键清理已保存录音</div>
                <div className={pageStyles.shortcutItemDesc}>
                  仅清理应用保存目录内的内容（不会影响其它文件）
                </div>
              </div>
              <div className={pageStyles.shortcutItemRight}>
                <button
                  type="button"
                  className={pageStyles.dangerBtn}
                  onClick={onClearSavedRecordings}
                  disabled={!recordingSaveDir || recordingClearLoading}
                >
                  {recordingClearLoading ? '清理中…' : '清理'}
                </button>
              </div>
            </div>
          </div> */}
          {/* <div className={pageStyles.shortcutCard} style={{ marginTop: '8px' }}>
            <div className={pageStyles.shortcutItem}>
              <div className={pageStyles.shortcutItemLeft}>
                <div className={pageStyles.shortcutItemTitle}>交互声音</div>
                <div className={pageStyles.shortcutItemDesc}>为开始/停止等关键操作播放声音</div>
              </div>
              <div className={pageStyles.shortcutItemRight}>
                <label
                  className={`${pageStyles.switch} ${systemSoundEnabled ? pageStyles.switchOn : ''}`}
                >
                  <input
                    className={pageStyles.switchInput}
                    type="checkbox"
                    checked={systemSoundEnabled}
                    onChange={onToggleSystemSound}
                    aria-label="交互声音"
                  />
                  <span className={pageStyles.switchKnob} aria-hidden="true" />
                </label>
              </div>
            </div>
          </div> */}
        </div>
      </div>
      <div className={pageStyles.container}>
        <div className={pageStyles.shortcutSection}>
          <div className={pageStyles.shortcutHeader}>
            <div className={pageStyles.shortcutIconWrap} aria-hidden="true">
              <SettingsLanguageIcon />
            </div>
            <div className={pageStyles.shortcutHeaderText}>
              <div className={pageStyles.shortcutHeaderTitle}>语言</div>
            </div>
          </div>

          <div className={pageStyles.shortcutCard}>
            <div className={pageStyles.shortcutItem}>
              <div className={pageStyles.shortcutItemLeft}>
                <div className={pageStyles.shortcutItemTitle}>自动翻译</div>
                <div className={pageStyles.shortcutItemDesc}>请选择语音识别后输出的目标语言</div>
              </div>

              <div className={pageStyles.shortcutItemRight}>
                <DropdownSelect
                  value={preferredLanguageVariant ?? 'None'}
                  options={PREFERRED_LANGUAGE_OPTIONS}
                  onChange={(value) => {
                    const next = value || 'None';
                    track('sensetype_setting_change', { $x_language: next });
                    const seq = ++preferredLanguageSaveSeqRef.current;
                    setPreferredLanguageVariant(next);
                    // 同步写入 localStorage，便于请求层同步读取
                    try {
                      localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, next);
                    } catch {
                      //
                    }
                    // 异步持久化到主进程 settings store
                    const ipcRenderer = getIpcRenderer();
                    if (!ipcRenderer) return;
                    void ipcRenderer
                      .invoke('settings-set-preferred-language-variant', { value: next })
                      .then((ret) => {
                        if (seq !== preferredLanguageSaveSeqRef.current) return;
                        const v = (ret || {}) as { value?: unknown };
                        const saved = typeof v.value === 'string' ? v.value : next;
                        setPreferredLanguageVariant(saved);
                        try {
                          localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, saved);
                        } catch {
                          //
                        }
                      })
                      .catch(() => undefined);
                  }}
                  ariaLabel="自动翻译"
                  title={
                    PREFERRED_LANGUAGE_OPTIONS.find(
                      (o) => o.value === (preferredLanguageVariant ?? 'None'),
                    )?.label ?? '自动翻译'
                  }
                  triggerClassName={`${pageStyles.hotkeyPill} ${pageStyles.languagePill}`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={pageStyles.container}>
        <div className={pageStyles.shortcutSection}>
          <div className={pageStyles.shortcutHeader}>
            <div className={pageStyles.shortcutIconWrap} aria-hidden="true">
              <KeyboardIcon />
            </div>
            <div className={pageStyles.shortcutHeaderText}>
              <div className={pageStyles.shortcutHeaderTitle}>应用行为</div>
            </div>
          </div>

          <div className={pageStyles.shortcutCard}>
            <div className={pageStyles.shortcutItem}>
              <div className={pageStyles.shortcutItemLeft}>
                <div className={pageStyles.shortcutItemTitle}>登录时启动应用</div>
                <div className={pageStyles.shortcutItemDesc}>
                  当您的计算机启动时，自动打开SenseAudio AI语音输入法
                </div>
              </div>
              <div className={pageStyles.shortcutItemRight}>
                <label
                  className={`${pageStyles.switch} ${autoLaunchEnabled ? pageStyles.switchOn : ''}`}
                >
                  <input
                    className={pageStyles.switchInput}
                    type="checkbox"
                    checked={autoLaunchEnabled}
                    onChange={onToggleAutoLaunch}
                    aria-label="开机自启"
                  />
                  <span className={pageStyles.switchKnob} aria-hidden="true" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
