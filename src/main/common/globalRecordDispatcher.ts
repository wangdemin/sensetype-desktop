import type { BrowserWindow, WebContents } from 'electron';
import type { RecorderAction } from './holdRecorderTypes';

export type GlobalRecordPayload = {
  action: RecorderAction;
  hotkeyMode?: 'single' | 'combo';
  key?: string;
};

type ListenerState = {
  ready: boolean;
  pending: GlobalRecordPayload | null;
  loadFlushAttached: boolean;
};

const listenerStates = new WeakMap<WebContents, ListenerState>();

function getListenerState(webContents: WebContents): ListenerState {
  let state = listenerStates.get(webContents);
  if (state) return state;
  state = {
    ready: false,
    pending: null,
    loadFlushAttached: false,
  };
  listenerStates.set(webContents, state);
  webContents.once('destroyed', () => {
    listenerStates.delete(webContents);
  });
  return state;
}

function sendNow(webContents: WebContents, payload: GlobalRecordPayload, logTag: string): boolean {
  if (webContents.isDestroyed()) return false;
  try {
    webContents.send('global-record', payload);
    console.info(`${logTag} sent event '${payload.action}'`);
    return true;
  } catch (error) {
    console.warn(`${logTag} failed to send event '${payload.action}':`, error);
    return false;
  }
}

function canSendNow(webContents: WebContents, state: ListenerState): boolean {
  return !webContents.isDestroyed() && !webContents.isLoading() && state.ready;
}

function flushPending(webContents: WebContents, logTag: string): boolean {
  const state = getListenerState(webContents);
  if (!state.pending) return false;
  if (!canSendNow(webContents, state)) return false;
  const payload = state.pending;
  state.pending = null;
  try {
    webContents.send('global-record', payload);
    console.info(`${logTag} flushed event '${payload.action}'`);
    return true;
  } catch (error) {
    console.warn(`${logTag} failed to flush event '${payload.action}':`, error);
    state.pending = payload;
    return false;
  }
}

function attachLoadFlush(webContents: WebContents, logTag: string) {
  const state = getListenerState(webContents);
  if (state.loadFlushAttached) return;
  state.loadFlushAttached = true;
  webContents.once('did-finish-load', () => {
    state.loadFlushAttached = false;
    flushPending(webContents, logTag);
  });
}

export function setGlobalRecordListenerReady(webContents: WebContents, ready: boolean) {
  const state = getListenerState(webContents);
  state.ready = ready;
  if (ready) {
    flushPending(webContents, '[global-record-dispatcher]');
  }
}

export function dispatchGlobalRecord(
  win: BrowserWindow | undefined,
  payload: GlobalRecordPayload,
  options?: {
    disableBackgroundThrottlingForStart?: boolean;
    logTag?: string;
  },
): boolean {
  if (!win || win.isDestroyed()) return false;
  const webContents = win.webContents;
  if (webContents.isDestroyed()) return false;

  const logTag = options?.logTag || '[global-record-dispatcher]';
  if (payload.action === 'start' && options?.disableBackgroundThrottlingForStart) {
    try {
      webContents.setBackgroundThrottling(false);
    } catch {
      // ignore
    }
  }

  const state = getListenerState(webContents);
  if (canSendNow(webContents, state)) {
    return sendNow(webContents, payload, logTag);
  }

  state.pending = payload;
  if (webContents.isLoading()) {
    attachLoadFlush(webContents, logTag);
  }
  return false;
}
