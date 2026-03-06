import type { HoldToRecordKey } from './settingsStore';

export type RecorderAction = 'start' | 'stop' | 'cancel' | 'keydown' | 'keyup';

export type HoldRecorderBackend = 'native' | 'disabled';
export type HoldRecorderEventType = RecorderAction | 'unknown';

export type HoldRecorderStatus = {
  backend: HoldRecorderBackend;
  key?: HoldToRecordKey;
  delayMs?: number;
  nativeVersion?: string | null;
  nativeIsRunning?: boolean | null;
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
