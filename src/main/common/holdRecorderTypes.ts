import type { HoldToRecordKey } from './settingsStore';

export type RecorderAction = 'start' | 'stop' | 'cancel' | 'keydown' | 'keyup';

export type GlobalRecordSource = 'native-keyhook';

export type GlobalRecordPayload = {
  action?: 'start' | 'stop' | 'cancel';
  hotkeyMode?: 'single' | 'combo' | string;
  eventSeq?: number;
  eventAt?: number;
  source?: GlobalRecordSource | string;
};

export type GlobalRecordAckPayload = {
  eventSeq?: number;
  eventAt?: number;
  action?: 'start' | 'stop' | 'cancel';
  source?: GlobalRecordSource | string;
  accepted?: boolean;
  rendererAt?: number;
};

export type HoldRecorderBackend = 'native' | 'disabled';
export type HoldRecorderEventType = RecorderAction | 'unknown';

export type HoldRecorderStatus = {
  backend: HoldRecorderBackend;
  key?: HoldToRecordKey;
  delayMs?: number;
  nativeVersion?: string | null;
  nativeIsRunning?: boolean | null;
  lastEventSeq?: number | null;
  /** 是否曾经收到过 start 事件（用于避免“长期未使用”却无限自愈重注册） */
  everStarted?: boolean;
  lastEventType?: HoldRecorderEventType;
  lastEventAt?: number | null;
  lastRestartAt?: number | null;
  lastError?: string | null;
  lastRegisterReason?: string | null;
  registerCount?: number;
  disposeCount?: number;
};
