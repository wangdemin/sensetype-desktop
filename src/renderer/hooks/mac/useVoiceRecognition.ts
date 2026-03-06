import type { UseVoiceRecognitionOptions, VoiceRecognitionStatus } from '../useVoiceRecognition';
import { useVoiceRecognitionBase } from '../useVoiceRecognition';

export type { UseVoiceRecognitionOptions, VoiceRecognitionStatus } from '../useVoiceRecognition';

const macAdapter = {
  platform: 'darwin' as const,
  installPlatformEffects: ({ ipcRenderer }: { ipcRenderer: any }) => {
    // 当前窗口前台按键兜底：当用户尝试按住录音键但未获得辅助功能权限时，触发一次系统提示（由主进程统一控制，带冷却）。
    // IMPORTANT: 这里不做任何系统权限检测（避免按键后同步调用导致卡顿）。
    if (!ipcRenderer?.invoke) return;

    let expected: string | null = null;
    let lastPromptAt = 0;

    try {
      ipcRenderer
        .invoke('settings-get-hold-to-record')
        .then((cfg: any) => {
          const macKey = cfg?.macKey;
          // 浏览器/DOM 中：Option 对应 Alt，Command 对应 Meta
          if (macKey === 'option') expected = 'Alt';
          else if (macKey === 'control') expected = 'Control';
          else if (macKey === 'shift') expected = 'Shift';
          else if (macKey === 'command') expected = 'Meta';
          else expected = 'Alt';
        })
        .catch(() => undefined);
    } catch {
      // ignore
    }

    const isPromptSuppressedRoute = () => {
      try {
        const inInit =
          (
            window as Window & {
              __sensetype_init_steps_in_progress__?: unknown;
            }
          ).__sensetype_init_steps_in_progress__ === true;
        if (inInit) return true;

        const hash = window.location.hash || '';
        // 登录/引导路由与主界面内输入场景，按住修饰键时不应主动弹系统权限提示，
        // 否则容易造成窗口失焦、层级变化，影响首次使用体验。
        return (
          hash === '#/login' ||
          hash.startsWith('#/login?') ||
          hash.startsWith('#/login/') ||
          hash === '#/' ||
          hash.startsWith('#/?')
        );
      } catch {
        return false;
      }
    };

    const isEditableFocused = () => {
      try {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'TEXTAREA') return true;
        if (tag === 'INPUT') {
          const input = el as HTMLInputElement;
          const t = String(input.type || 'text').toLowerCase();
          // 仅把常见文本输入类型视作“可编辑输入”
          return (
            t === 'text' ||
            t === 'search' ||
            t === 'email' ||
            t === 'url' ||
            t === 'tel' ||
            t === 'password' ||
            t === 'number'
          );
        }
        return el.isContentEditable;
      } catch {
        return false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      try {
        if (!ipcRenderer?.invoke) return;
        if (e.repeat) return;
        if (document.hidden) return;
        // 输入框场景下按住录音键常用于直接语音输入，不应触发系统弹窗抢焦点。
        if (isEditableFocused()) return;
        // 登录/引导与主界面中，避免按键即触发系统权限提示导致窗口层级抖动。
        if (isPromptSuppressedRoute()) return;
        if (!expected) return;
        if (e.key !== expected) return;
        const now = Date.now();
        if (now - lastPromptAt < 800) return;
        lastPromptAt = now;
        ipcRenderer.invoke('accessibility-prompt-for-hotkey').catch(() => undefined);
      } catch {
        // ignore
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  },
};

export function useVoiceRecognition(options: UseVoiceRecognitionOptions = {}) {
  return useVoiceRecognitionBase(macAdapter, options);
}
