import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createMeetingRecorder,
  type MeetingRecorder,
} from '@/renderer/meeting/recorder/meetingRecorder';
import type {
  MeetingRecorderDisplayMode,
  MeetingRecorderLiveSegment,
  MeetingRecorderStatus,
} from '@/renderer/meeting/recorder/types';

export type MicOption = 'inner+outer' | 'inner' | 'outer';
export type DisplayMode = MeetingRecorderDisplayMode;
type PermissionCheckResult = { granted: boolean; status?: string };

function getIpcRenderer(): {
  invoke?: (channel: string, ...args: any[]) => Promise<any>;
  on?: (channel: string, listener: (...args: any[]) => void) => void;
  off?: (channel: string, listener: (...args: any[]) => void) => void;
} | null {
  try {
    const fromPreload = (window as any)?.electronAPI?.ipcRenderer;
    if (fromPreload) return fromPreload;
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as any;
    return ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function isMacPlatform(): boolean {
  try {
    if ((window as any)?.sensetype?.isMacOs?.()) return true;
  } catch {
    // ignore
  }
  try {
    if (typeof process !== 'undefined' && process.platform === 'darwin') return true;
  } catch {
    // ignore
  }
  return false;
}

function isScreenRecordingError(msg: string): boolean {
  const s = String(msg || '');
  return /screen|capture|录制|屏幕|ScreenCaptureKit|permission|denied/i.test(s);
}

function parsePermissionCheckResult(raw: unknown): PermissionCheckResult | null {
  if (typeof raw === 'boolean') {
    return { granted: raw, status: raw ? 'granted' : 'denied' };
  }
  if (typeof raw === 'string') {
    const status = raw.toLowerCase();
    if (status === 'granted') return { granted: true, status };
    return { granted: false, status };
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.granted !== 'boolean') return null;
  return {
    granted: obj.granted,
    status: typeof obj.status === 'string' ? obj.status.toLowerCase() : undefined,
  };
}

function isPermissionHardDenied(status?: string): boolean {
  return status === 'denied' || status === 'restricted';
}

async function triggerScreenRecordingPrompt(): Promise<boolean> {
  const md = navigator?.mediaDevices as any;
  if (!md?.getDisplayMedia) return false;
  let tempStream: MediaStream | null = null;
  try {
    tempStream = (await md.getDisplayMedia({ video: true, audio: false })) as MediaStream;
    return true;
  } catch {
    return false;
  } finally {
    try {
      tempStream?.getTracks?.().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }
}

function openExternal(url: string) {
  try {
    const shellOpenExternal = (window as any)?.sensetype?.shellOpenExternal;
    if (typeof shellOpenExternal === 'function') {
      shellOpenExternal(url);
      return true;
    }
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require('electron') as any;
    if (shell?.openExternal) {
      shell.openExternal(url);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export type RecordingState = {
  status: MeetingRecorderStatus;
  error: string | null;
  notice: string | null;
  progress: string | null;
  transcript: string;
  liveTranscriptSegments: MeetingRecorderLiveSegment[];
  displayMode: DisplayMode;
  formattedText: string;
  rawFormatResult: unknown;
  recordTime: number;
  isRecordPaused: boolean;
  isScreenRecordingErr: boolean;
};

export type RecordingActions = {
  checkPermissionsAndStart: (
    micOption: MicOption,
    targetLanguage?: string,
    displayMode?: DisplayMode,
  ) => Promise<boolean>;
  stopRecording: () => Promise<void>;
  togglePause: () => Promise<void>;
  openScreenRecordingSettings: () => void;
};

export function useRecording(): [RecordingState, RecordingActions] {
  const ipc = useMemo(() => getIpcRenderer(), []);
  const recorderRef = useRef<MeetingRecorder | null>(null);

  const [status, setStatus] = useState<MeetingRecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [liveTranscriptSegments, setLiveTranscriptSegments] = useState<MeetingRecorderLiveSegment[]>([]);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('source');
  const [formattedText, setFormattedText] = useState('');
  const [rawFormatResult, setRawFormatResult] = useState<unknown>(null);
  const [recordTime, setRecordTime] = useState(0);
  const [isRecordPaused, setIsRecordPaused] = useState(false);

  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status !== 'recording') return;
    if (!isRecordPaused) {
      recordTimerRef.current = setInterval(() => {
        setRecordTime((prev) => prev + 1);
      }, 1000);
    } else if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
    }
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, [status, isRecordPaused]);

  useEffect(() => {
    return () => {
      recorderRef.current?.destroy().catch(() => undefined);
    };
  }, []);

  const createRecorderForMicOption = useCallback(
    (micOption: MicOption, targetLanguage = '', mode: DisplayMode = 'source'): MeetingRecorder => {
      const isElectron = !!ipc;
      const enableMicrophone = micOption === 'inner+outer' || micOption === 'outer';
      const enableSystemAudio =
        isElectron && (micOption === 'inner+outer' || micOption === 'inner');

      return createMeetingRecorder(
        {
          onStatus: ({ status: s, message }) => {
            setStatus(s);
            if (s !== 'error') {
              if (message) {
                if (/^\s*正在/.test(String(message))) setProgress(String(message));
                else setNotice(String(message));
              }
              if (s === 'recording' || s === 'idle') setProgress(null);
              setError(null);
            }
          },
          onLiveSegments: ({ segments }) => {
            setLiveTranscriptSegments(segments);
            setTranscript(
              segments
                .map((seg) => String(seg?.text || '').trim())
                .filter(Boolean)
                .join('\n'),
            );
          },
          onFormatted: ({ formattedText: ft, raw }) => {
            setFormattedText(ft || '');
            if (raw) setRawFormatResult(raw);
          },
          onError: ({ message: msg }) => {
            setNotice(null);
            setError(msg || '录音失败');
            setStatus('error');
          },
        },
        { enableMicrophone, enableSystemAudio, targetLanguage, displayMode: mode },
      );
    },
    [ipc],
  );

  const checkPermissionsAndStart = useCallback(
    async (
      micOption: MicOption,
      targetLanguage = '',
      mode: DisplayMode = 'source',
    ): Promise<boolean> => {
      const needsMic = micOption === 'inner+outer' || micOption === 'outer';
      const needsSystemAudio = micOption === 'inner+outer' || micOption === 'inner';

      if (needsMic && isMacPlatform() && ipc?.invoke) {
        try {
          const raw = await ipc.invoke('check-microphone-permission');
          const result = parsePermissionCheckResult(raw);
          if (result && !result.granted && isPermissionHardDenied(result.status)) {
            setError('麦克风权限未开启，请在系统设置中授权');
            return false;
          }
        } catch {
          // ignore
        }
      }

      if (needsSystemAudio && isMacPlatform()) {
        let screenPermission: PermissionCheckResult | null = null;
        try {
          const raw = await ipc?.invoke?.('check-screen-recording-permission');
          screenPermission = parsePermissionCheckResult(raw);
          if (screenPermission && !screenPermission.granted && isPermissionHardDenied(screenPermission.status)) {
            setError('屏幕录制权限未开启，请在系统设置中授权（用于捕获系统声音）');
            return false;
          }
        } catch {
          // ignore
        }

        // macOS 在 "not-determined" 时，需要触发一次 getDisplayMedia 才会走系统权限流程。
        if (screenPermission?.status === 'not-determined') {
          const grantedByPrompt = await triggerScreenRecordingPrompt();
          if (!grantedByPrompt) {
            setError('屏幕录制权限未开启或被拒绝，请在系统设置中授权后重试');
            return false;
          }
          try {
            const raw = await ipc?.invoke?.('check-screen-recording-permission');
            const latest = parsePermissionCheckResult(raw);
            if (latest && !latest.granted) {
              setError('屏幕录制权限未开启，请在系统设置中授权（用于捕获系统声音）');
              return false;
            }
          } catch {
            // ignore
          }
        }
      }

      // Reset state
      setError(null);
      setNotice(null);
      setProgress(null);
      setTranscript('');
      setLiveTranscriptSegments([]);
      setDisplayMode(mode);
      setFormattedText('');
      setRawFormatResult(null);
      setRecordTime(0);
      setIsRecordPaused(false);

      // Destroy previous recorder if any
      try {
        await recorderRef.current?.destroy();
      } catch {
        // ignore
      }

      const recorder = createRecorderForMicOption(micOption, targetLanguage, mode);
      recorderRef.current = recorder;

      try {
        await recorder.start();
        return true;
      } catch (e: any) {
        setStatus('error');
        const msg = String(e?.message || e || '启动失败');
        setError(msg);
        return false;
      }
    },
    [ipc, createRecorderForMicOption],
  );

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    try {
      await recorder.stop();
    } catch {
      // ignore
    }

    setRecordTime(0);
    setIsRecordPaused(false);
  }, []);

  const togglePause = useCallback(async () => {
    if (status !== 'recording') return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    const nextPaused = !isRecordPaused;
    // Optimistic UI update: make icon/time react immediately on click.
    setIsRecordPaused(nextPaused);
    try {
      if (isRecordPaused) await recorder.resume();
      else await recorder.pause();
      setIsRecordPaused(recorder.isPaused());
    } catch (e: any) {
      const msg = String(e?.message || e || '切换暂停状态失败');
      setNotice(msg);
      setIsRecordPaused(recorder.isPaused());
    }
  }, [status, isRecordPaused]);

  const openScreenRecordingSettings = useCallback(() => {
    openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }, []);

  const isScreenRecordingErr = !!(error && isMacPlatform() && isScreenRecordingError(error));

  const state: RecordingState = {
    status,
    error,
    notice,
    progress,
    transcript,
    liveTranscriptSegments,
    displayMode,
    formattedText,
    rawFormatResult,
    recordTime,
    isRecordPaused,
    isScreenRecordingErr,
  };

  const actions: RecordingActions = {
    checkPermissionsAndStart,
    stopRecording,
    togglePause,
    openScreenRecordingSettings,
  };

  return [state, actions];
}
