import React, { useEffect, useMemo, useState } from 'react';
import styles from './index.module.scss';
import one from '@/assets/gif/one.gif';
import two from '@/assets/gif/two.gif';
import DoneIcon from '@/assets/icons/done.svg?react';

type Step2PermissionProps = {
  onNext: () => void;
};

type IpcRendererLike = {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

type PermissionResult = {
  granted: boolean;
  status?: string;
};

function parsePermissionResult(v: unknown): PermissionResult | null {
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  if (typeof obj.granted !== 'boolean') return null;
  return { granted: obj.granted, status: typeof obj.status === 'string' ? obj.status : undefined };
}

const Step2Permission: React.FC<Step2PermissionProps> = ({ onNext }) => {
  const ipcRenderer = (window as unknown as { electronAPI?: { ipcRenderer?: IpcRendererLike } })
    ?.electronAPI?.ipcRenderer;
  const isMac =
    (window as unknown as { sensetype?: { isMacOs?: () => boolean } })?.sensetype?.isMacOs?.() ??
    false;

  // type: 1 = 辅助功能(Accessibility)；2 = 麦克风(Microphone)
  const [type, setType] = useState<1 | 2>(1);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  const allGranted = isMac ? accessibilityGranted && micGranted : false;

  const rightHint = useMemo(() => {
    if (!isMac) return '在系统设置中打开您的权限';
    if (type === 1) return '在系统设置中的辅助功能打开您的权限';
    return '在系统设置中的麦克风打开您的权限';
  }, [isMac, type]);

  // mac 已全部授权时，禁止停留在此页，直接进入下一步
  useEffect(() => {
    if (!isMac) return;
    if (allGranted) onNext();
  }, [allGranted, isMac, onNext]);

  // 仅检查：若辅助功能已授权，自动进入“麦克风”阶段（不在这里触发辅助功能弹窗）
  useEffect(() => {
    if (!isMac) return;
    const invoke = ipcRenderer?.invoke;
    if (!invoke) return;

    let stopped = false;
    const check = async () => {
      try {
        const raw = await invoke('check-accessibility-permission');
        const res = parsePermissionResult(raw);
        if (stopped) return;
        const granted = res?.granted === true;
        setAccessibilityGranted(granted);
        if (granted) setType(2);
      } catch {
        // ignore
      }
    };

    void check();
    const timer = window.setInterval(check, 800);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [ipcRenderer, isMac]);

  // 仅检查：麦克风权限（不触发系统弹窗）。用于已授权时展示“下一步”。
  useEffect(() => {
    if (!isMac) return;
    if (type !== 2) return;
    const invoke = ipcRenderer?.invoke;
    if (!invoke) return;

    let stopped = false;
    const check = async () => {
      try {
        const raw = await invoke('check-microphone-permission');
        const res = parsePermissionResult(raw);
        if (stopped) return;
        const granted = res?.granted === true;
        setMicGranted(granted);
        if (granted) setMicDenied(false);
      } catch {
        // ignore
      }
    };

    void check();
    const timer = window.setInterval(check, 800);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [ipcRenderer, isMac, type]);

  // 进入“麦克风”阶段后，自动触发麦克风授权；允许后自动下一步
  useEffect(() => {
    if (!isMac) return;
    if (type !== 2) return;
    // 切到麦克风阶段时重置状态：由用户点击“继续”触发请求
    setMicDenied(false);
  }, [ipcRenderer, isMac, onNext, type]);

  const onAllowMicrophone = async () => {
    const invoke = ipcRenderer?.invoke;
    if (isMac && invoke) {
      try {
        const raw = await invoke('request-microphone-permission');
        const res = parsePermissionResult(raw);
        if (res?.granted === true) {
          setMicGranted(true);
          onNext();
          return;
        }
        setMicDenied(true);
      } catch {
        setMicDenied(true);
      }
      return;
    }
    // 非 mac：暂时直接进入下一步（避免卡在此步）
    onNext();
  };

  const onAllowAccessibility = async () => {
    // 这里点击“允许”时，触发系统的辅助功能授权引导（弹窗/打开设置页由主进程统一处理）
    const invoke = ipcRenderer?.invoke;
    if (isMac && invoke) {
      try {
        // 引导页的“允许”属于用户明确动作：强制触发一次（绕过主进程 5 分钟冷却）
        await invoke('accessibility-prompt-for-hotkey', { force: true, source: 'init-step-2' });
      } catch {
        // ignore
      }
      return;
    }
    // 非 mac：暂时直接进入下一步（避免卡在此步）
    onNext();
  };

  return (
    <div className={styles.permissionContent}>
      <div className={styles.left}>
        <div className={styles.title}>权限开启</div>

        <div className={styles.card}>
          <div className={styles.listItem}>
            <span className={styles.checkIcon} aria-hidden="true">
              <DoneIcon />
            </span>
            <span>您需要允许SenseAudio AI语音输入法使用您的麦克风。</span>
          </div>
          <div className={styles.listItem}>
            <span className={styles.checkIcon} aria-hidden="true">
              <DoneIcon />
            </span>
            <span>您需要允许SenseAudio AI语音输入法将语音转为文字后，输入到您选中的文本框中。</span>
          </div>
        </div>

        {micDenied ? <div className={styles.warn}>需要麦克风权限才能使用语音输入。</div> : null}

        <div style={{ width: '100%', display: 'flex', justifyContent: 'right' }}>
          <div
            className={styles.button}
            onClick={allGranted ? onNext : type === 1 ? onAllowAccessibility : onAllowMicrophone}
          >
            继续
          </div>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.preview}>
          <img src={type === 1 ? one : two} alt="" />
        </div>
        <div className={styles.caption}>{rightHint}</div>
      </div>
    </div>
  );
};

export default Step2Permission;
