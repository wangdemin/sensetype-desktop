import { useCallback, useEffect, useMemo, useState } from 'react';

type HoldToRecordKeyMac = 'option' | 'control' | 'shift' | 'command';
type HoldToRecordKeyWin = 'alt' | 'control' | 'shift' | 'win' | 'rshift' | 'rctrl' | 'ralt';
type HoldToRecordConfig = {
  macKey: HoldToRecordKeyMac;
  winKey: HoldToRecordKeyWin;
  delayMs: number;
};

type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

type WindowBridge = Window & {
  sensetype?: {
    isMacOs?: () => boolean;
    isWindows?: () => boolean;
  };
  electronAPI?: {
    ipcRenderer?: IpcRendererLike;
  };
};

function getIpcRenderer(): IpcRendererLike | null {
  const w = window as unknown as WindowBridge;
  return w?.electronAPI?.ipcRenderer ?? null;
}

function describeHoldKey(isMac: boolean, cfg: HoldToRecordConfig | null): string {
  if (!cfg) return isMac ? 'Option' : '右 Alt';
  if (!isMac) {
    if (cfg.winKey === 'alt') return 'Alt';
    if (cfg.winKey === 'control') return 'Ctrl';
    if (cfg.winKey === 'shift') return 'Shift';
    if (cfg.winKey === 'win') return 'Win';
    if (cfg.winKey === 'rshift') return 'Shift';
    if (cfg.winKey === 'rctrl') return '右 Ctrl';
    return '右 Alt';
  }
  if (cfg.macKey === 'control') return 'Control';
  if (cfg.macKey === 'shift') return 'Shift';
  if (cfg.macKey === 'command') return 'Command';
  return 'option';
}

export function useHoldToRecordKeyLabel() {
  const w = window as unknown as WindowBridge;
  const isMac = w?.sensetype?.isMacOs?.() ?? false;
  const isWin = w?.sensetype?.isWindows?.() ?? !isMac;
  const [holdToRecord, setHoldToRecord] = useState<HoldToRecordConfig | null>(null);

  const load = useCallback(async () => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;
    try {
      const value = (await ipcRenderer.invoke('settings-get-hold-to-record')) as unknown;
      const v = (value || {}) as Partial<HoldToRecordConfig>;
      if (v && typeof v === 'object') {
        setHoldToRecord({
          macKey: (v.macKey ?? 'option') as HoldToRecordKeyMac,
          winKey: (v.winKey ?? 'ralt') as HoldToRecordKeyWin,
          delayMs: typeof v.delayMs === 'number' ? v.delayMs : 0,
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    // 设置页可能会更改快捷键：回到前台时刷新一次
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  const label = useMemo(() => describeHoldKey(isMac, holdToRecord), [isMac, holdToRecord]);

  return { label, isMac, isWin };
}
