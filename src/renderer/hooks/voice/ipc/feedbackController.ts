export function sendVoiceFeedback(
  ipcRenderer: any,
  payload: { type: string; message?: string; detail?: any },
) {
  try {
    ipcRenderer?.send?.('voice-feedback', payload);
  } catch {
    //
  }
}

export function toastVoiceIndicator(
  ipcRenderer: any,
  payload: {
    visible: boolean;
    status: 'speaking' | 'silent' | 'loading' | 'notice' | 'error';
    message?: string;
    volumes?: number[] | null;
    autoHideMs?: number;
  },
) {
  try {
    ipcRenderer?.send?.('voice-indicator-set', payload);
  } catch {
    //
  }
}

export async function tryShowRewriteOverlayHelper(args: {
  ipcRenderer: any;
  text: string;
  questionText?: string;
  isInitTutorialScene: boolean;
  onError: (message: string) => void;
}): Promise<boolean> {
  const { ipcRenderer, text, questionText, isInitTutorialScene, onError } = args;
  const t = String(text || '').trim();
  if (!t) return false;
  const q = String(questionText || '').trim();

  ipcRenderer?.send?.('renderer-log', {
    tag: 'tryShowRewriteOverlayHelper',
    message: t,
  });
  const payload = isInitTutorialScene
    ? { text: t, questionText: q, scene: 'init-tutorial' as const }
    : { text: t, questionText: q };
  try {
    ipcRenderer?.send?.('renderer-log', '123123');
    if (ipcRenderer?.invoke) {
      ipcRenderer?.send?.('renderer-log', '123123');

      const res = await ipcRenderer.invoke('rewrite-overlay-show', payload);
      if (res && typeof res === 'object' && (res as any).success === false) {
        throw new Error((res as any).error || '无法显示重写窗口');
      }
      return true;
    }
    ipcRenderer?.send?.('renderer-log', '888');
    ipcRenderer?.send?.('rewrite-overlay-show', payload);
    return true;
  } catch (e: any) {
    onError(String(e?.message || '无法显示重写窗口'));
    return false;
  }
}
