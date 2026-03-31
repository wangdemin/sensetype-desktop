/**
 * 语音识别 Hook
 *
 * 提供录音、音频转换、语音识别和自动插入文本的功能。
 * 支持通过全局快捷键（由主进程触发）或手动调用开始/停止录音。
 *
 * 工作流程：
 * 1. 获取麦克风权限并开始录音（WebM/Opus 格式）
 * 2. 停止录音后将音频转换为 MP3 格式
 * 3. 发送 MP3 音频到 API 进行语音识别
 * 4. 根据配置自动将识别结果插入到当前输入框或粘贴到外部应用
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rewriteTextRequest } from '../../axios/http';
import type { VoiceInputWsClient } from '@/axios/ws';
import type { VoiceIndicatorStatus } from '@/renderer/components/VoiceIndicator';
import { isInitKeyTestSuppressRecording } from '@/renderer/hooks/globalRecordSuppression';
import type { GlobalRecordPayload } from '@/main/common/holdRecorderTypes';
import { requestUserInfoRefresh } from '@/renderer/utils/refreshUserInfo';
import { requestCheckinCalendarRefreshOnFirstUseToday } from '@/renderer/utils/checkinCalendarRefresh';
import { track } from '@/utils/posthog';
import { convertToMp3 as convertToMp3Raw } from '@/renderer/voice/audioMp3';
import { createNote } from '@/services';
import { runRewritePipeline } from './voice/pipeline/rewritePipeline';
import { handleSopCreateNote } from './voice/sop/sopHandler';
import {
  deriveVoicePhase,
  hasActiveVoiceSession,
  resolveIndicatorPhaseStatus,
} from './voice/core/voiceStateMachine';
import { startAudioAnalysisImpl, stopAudioAnalysisImpl } from './voice/audio/analysisController';
import { runStartRecordingFlow } from './voice/recording/startRecordingController';
import { withTimeout as withTimeoutHelper } from './voice/utils/timeoutHelper';
import {
  normalizeTextForExternalInsert as normalizeTextForExternalInsertRaw,
  stripAllNewlines as stripAllNewlinesRaw,
  validateRewriteSelectedText as validateRewriteSelectedTextRaw,
} from './voice/utils/textNormalizer';
import {
  getSelectedTextInFocusedTextInputInThisWindow as getSelectedTextInFocusedTextInputInThisWindowRaw,
  getSelectedTextInThisWindow as getSelectedTextInThisWindowRaw,
  insertIntoFocusedEditableInThisWindow as insertIntoFocusedEditableInThisWindowRaw,
} from './voice/ui/textInsertion';
import { sendVoiceFeedback, tryShowRewriteOverlayHelper } from './voice/ipc/feedbackController';
import {
  snapshotPreBuffer as snapshotPreBufferRaw,
  startPreBuffer as startPreBufferRaw,
  stopPreBuffer as stopPreBufferRaw,
} from './voice/stream/preBufferManager';
import {
  disposeWarmStream as disposeWarmStreamRaw,
  ensureWarmMicStream as ensureWarmMicStreamRaw,
} from './voice/stream/warmStreamManager';
import { createMacPreloader, createWindowsPreloader } from './voice/preload/platformPreloader';
import {
  type RecognitionRoute,
  resolveRecognitionRouteByHotkeyMode,
  resolveRecognitionRouteByTrigger,
} from './voice/recording/recognitionRoute';

const MAX_REWRITE_SELECTED_TEXT_LEN = 5000;
const SINGLE_KEY_HOLD_LOCK_THRESHOLD_MS = 10_000;
const SINGLE_KEY_HOLD_LOCK_EDGE_GRACE_MS = 220;
const WIN_STRAY_START_AFTER_STOP_COOLDOWN_MS = 320;

/**
 * 语音识别状态
 */
export type VoiceRecognitionStatus = {
  /** 是否正在录音 */
  recording: boolean;
  /** 是否正在处理音频（转换格式等） */
  processing: boolean;
  /** 是否正在发送音频到 API */
  sending: boolean;
  /** 是否正在请求“重写”接口 */
  rewriting: boolean;
  /** 录音状态指示器（speaking/silent/loading） */
  indicatorStatus: VoiceIndicatorStatus;
  /** 音频波形（0..1），用于更自然的波动显示 */
  indicatorVolumes: number[] | null;
  /** 转换后的 MP3 音频 URL（用于播放预览） */
  audioUrl: string | null;
  /** API 返回的识别结果文本 */
  apiResult: string | null;
  /** 错误信息 */
  error: string | null;
};

/**
 * Hook 配置选项
 */
export type UseVoiceRecognitionOptions = {
  /**
   * 识别成功后是否自动写入当前输入位置：
   * - 如果本窗口输入框聚焦：直接插入
   * - 否则：请求主进程对外部前台应用粘贴（剪贴板+Cmd/Ctrl+V）
   */
  autoInsert?: boolean;
};

export type VoiceHookPlatform = 'darwin' | 'win32';

export type VoiceHookPlatformAdapter = {
  platform: VoiceHookPlatform;
  /**
   * 安装平台级副作用（例如：mac 的辅助功能权限提示按键监听）。
   * - 只允许做“纯副作用”（事件监听/IPC 调用等），不要在这里调用 React hooks。
   * - 返回清理函数（可选）。
   */
  installPlatformEffects?: (ctx: { ipcRenderer: any }) => void | (() => void);
  /**
   * stopRecording() 之后的平台兜底（例如：Windows stop 可能发生在 start 异步任意阶段，需要延迟收口）
   */
  afterStopRequested?: (ctx: {
    stopRecording: () => void;
    cleanupStream: () => void;
    recordingRef: React.MutableRefObject<boolean>;
    startingRef: React.MutableRefObject<boolean>;
    processingRef: React.MutableRefObject<boolean>;
    mediaRecorderRef: React.MutableRefObject<MediaRecorder | null>;
    streamRef: React.MutableRefObject<MediaStream | null>;
    setRecording: (v: boolean) => void;
  }) => void;
};

/**
 * 统一导出给业务侧使用的 Hook 名称。
 *
 * 说明：
 * - 运行时会被 Vite alias 替换到 `./mac/useVoiceRecognition.ts` 或 `./win/useVoiceRecognition.ts`，
 *   以注入真实的平台适配器，避免这里引入平台文件造成循环依赖。
 * - 这里提供一个“默认兜底适配器”，主要用于 TypeScript/IDE 能正确识别导出成员并通过类型检查。
 */
const defaultAdapter: VoiceHookPlatformAdapter = {
  platform:
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'win32' : 'darwin',
};

export function useVoiceRecognition(options: UseVoiceRecognitionOptions = {}) {
  return useVoiceRecognitionBase(defaultAdapter, options);
}

/**
 * 语音识别 Hook
 *
 * shared 实现：通过参数 platform 注入 mac/win 差异，避免在同一文件里堆平台分支。
 *
 * @param options 配置选项
 * @returns 返回状态对象和控制函数
 */
export function useVoiceRecognitionBase(
  adapter: VoiceHookPlatformAdapter,
  options: UseVoiceRecognitionOptions = {},
) {
  const { autoInsert = true } = options;
  const isWin =
    adapter.platform === 'win32' ||
    ((window as any)?.sensetype?.isWindows?.() ?? /Windows/i.test(navigator.userAgent));
  const isMac =
    adapter.platform === 'darwin' ||
    ((window as any)?.sensetype?.isMacOs?.() ??
      (typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)));

  // 调试日志开关（避免生产环境高频 console.log 拖慢渲染线程导致“卡死”）
  const VOICE_DEBUG = useMemo(() => {
    try {
      return localStorage.getItem('SENSETYPE_VOICE_DEBUG') === '1';
    } catch {
      return false;
    }
  }, []);
  const dlog = useCallback(
    (...args: any[]) => {
      if (VOICE_DEBUG) console.log(...args);
    },
    [VOICE_DEBUG],
  );

  // SOP：避免同一条 sop 重复处理（一次录音会话内）
  const sopHandledRef = useRef<Set<string>>(new Set());

  // ========== 状态管理 ==========
  /** 是否正在录音 */
  const [recording, setRecording] = useState(false);
  /** 是否正在启动录音（从触发到拿到流/真正开始录音的过渡态） */
  const [starting, setStarting] = useState(false);
  /** 是否正在处理音频（转换格式） */
  const [processing, setProcessing] = useState(false);
  /** 是否正在发送音频到 API */
  const [sending, setSending] = useState(false);
  /** 是否正在调用重写接口 */
  const [rewriting, setRewriting] = useState(false);
  /** 是否已经拿到麦克风 stream（用于 Win 上区分“唤起中”与普通 loading） */
  const [micAcquired, setMicAcquired] = useState(false);
  /** Win：只有“真的在等麦克风”超过阈值时才显示“麦克风唤起中”，避免每次都闪一下 */
  const [showMicWaking, setShowMicWaking] = useState(false);
  /** 录音波形状态 */
  const [indicatorStatus, setIndicatorStatus] = useState<VoiceIndicatorStatus>('silent');
  const [indicatorVolumes, setIndicatorVolumes] = useState<number[] | null>(null);
  /** 组合键 WS 实时预览文本（显示在波动条上方） */
  const [indicatorPreviewText, setIndicatorPreviewText] = useState('');
  /** 转换后的 MP3 音频 URL */
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  /** API 返回的识别结果 */
  const [apiResult, setApiResult] = useState<string | null>(null);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);

  // 预加载 effect 会在文件较前位置引用 ensureWarmMicStream；
  // 这里先提供稳定代理，真实实现在后文初始化后写入 ref，避免 TDZ。
  const ensureWarmMicStreamImplRef = useRef<
    (reason: 'startup' | 'after-stop' | 'manual') => Promise<void>
  >(async () => undefined);
  const ensureWarmMicStream = useCallback(
    (reason: 'startup' | 'after-stop' | 'manual') => ensureWarmMicStreamImplRef.current(reason),
    [],
  );

  // ========== 平台预加载优化 ==========
  useEffect(() => {
    if (!isWin) return;
    const preloadResources = createWindowsPreloader({
      audioContextRef,
      micPermissionGrantedRef,
      micPermissionCheckedAtRef,
      preferredMicDeviceIdRef,
      ensureWarmMicStream,
    });
    const t = window.setTimeout(() => {
      void preloadResources();
    }, 120);
    return () => {
      try {
        window.clearTimeout(t);
      } catch {
        //
      }
    };
  }, [isWin, ensureWarmMicStream]);

  useEffect(() => {
    if (isWin) return;
    const stoppedRef = { current: false };
    const preloadResources = createMacPreloader({
      audioContextRef,
      micPermissionGrantedRef,
      micPermissionCheckedAtRef,
      ensureWarmMicStream,
    });
    const t = window.setTimeout(() => {
      void preloadResources(stoppedRef);
    }, 600);
    return () => {
      stoppedRef.current = true;
      try {
        window.clearTimeout(t);
      } catch {
        //
      }
    };
  }, [isWin, ensureWarmMicStream]);

  // ========== Refs 引用 ==========
  /** MediaRecorder 实例引用 */
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  /** 音频流引用 */
  const streamRef = useRef<MediaStream | null>(null);
  /** 录音数据块数组 */
  const chunksRef = useRef<Blob[]>([]);
  /** 录音状态引用（用于在异步回调中判断） */
  const recordingRef = useRef(false);
  /** 本次录音会话开始时间（用于统计语音时长） */
  const sessionStartedAtRef = useRef<number>(0);
  /** 手动 stop 触发时缓存起点，避免“松开即清零”影响 onstop 时长结算 */
  const stopStartedAtSnapshotRef = useRef<number>(0);
  /** 本次录音触发来源（暂不展示，先存起来） */
  const sessionTriggerRef = useRef<string>('global-hotkey');
  /** 本次录音：累计语音时长（ms） */
  const recordingDurationSumMsRef = useRef<number>(0);
  /** 防重复：确保每次录音只打一次 record_end */
  const recordEndTrackedRef = useRef<boolean>(false);
  /** 防重复：确保每次录音只打一次 stt_success */
  const sttSuccessTrackedRef = useRef<boolean>(false);
  /** 防重复：确保每次录音只打一次 rewrite_execute（重写接口返回后） */
  const rewriteExecuteTrackedRef = useRef<boolean>(false);
  /**
   * 期望的录音状态（用于实现“按住录音/松开停止”，以及避免异步 start 在松开后才开始）
   * - startRecording() 会把它置为 true
   * - stopRecording() 会把它置为 false
   */
  const desiredRecordingRef = useRef(false);
  /** start 请求序号：用于取消正在进行中的异步 start */
  const startSeqRef = useRef(0);
  /** 本次会话识别链路：单键=SSE，组合键/长录音=WS */
  const recognitionRouteRef = useRef<RecognitionRoute>('sse');
  /** 是否正在执行 startRecording 的异步流程（未必已经开始真正录音） */
  const startingRef = useRef(false);
  /** startRecording 进入异步流程的时间戳（用于检测卡死自恢复） */
  const startingAtRef = useRef<number>(0);
  /** 组合键取消：停止录音但不做识别/重写 */
  const cancelRequestedRef = useRef(false);
  /** 音频 URL 引用（用于清理） */
  const audioUrlRef = useRef<string | null>(null);
  /** 麦克风权限检查缓存：避免每次 start 都走一次 askForMediaAccess IPC */
  const micPermissionGrantedRef = useRef<boolean | null>(null);
  const micPermissionCheckedAtRef = useRef<number>(0);
  /** 音频分析相关引用（用于更自然的波形） */
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Win优化：连接 analyser -> gain(0) -> destination，防止音频流因“无输出”被系统优化挂起
  const analyserGainRef = useRef<GainNode | null>(null);
  // 手动最终停止标记：用于 stop 与 onstop 异步收口协调
  const finalStopRequestedRef = useRef(false);
  // 外部应用是否做过“逐 token 输出”（用于避免 done/tail 再输出导致重复）
  const externalTokenPastedRef = useRef(false);
  // 重写：缓存“需要被重写的选中文本”（避免 stop->done 期间选区丢失导致不走重写）
  const pendingRewriteSelectedTextRef = useRef<string>('');
  // 取消/打断：中止 SSE 请求 + 终止后续输出
  const asrAbortControllerRef = useRef<AbortController | null>(null);
  const abortAllRef = useRef(false);
  const smoothedBarsRef = useRef<number[]>(new Array(12).fill(0));
  const smoothRmsRef = useRef(0);
  const speakingHoldRef = useRef(0);
  const lastAnalyserAtRef = useRef(0);

  /** warm mic stream（用于减少首次/偶发 getUserMedia 延迟，macOS & Windows 均适用） */
  const warmStreamRef = useRef<MediaStream | null>(null);
  const warmStreamExpireTimerRef = useRef<number | null>(null);
  const lastGumSuccessAtRef = useRef<number>(0);
  const WARM_TTL_MS = 3 * 60_000;
  // ========== 预缓冲（解决 Windows "前面丢字"） ==========
  const PRE_BUFFER_SECONDS = 0.3; // 300ms：仅覆盖热键→recorder.start() 的延迟，避免过多前置噪音
  const preBufferRef = useRef<Float32Array | null>(null);
  const preBufferPosRef = useRef(0);
  const preBufferFullRef = useRef(false);
  const preBufferSampleRateRef = useRef(0);
  const preBufferCtxRef = useRef<AudioContext | null>(null);
  const preBufferProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const preBufferGainRef = useRef<GainNode | null>(null);
  const preBufferSnapshotRef = useRef<{ pcm: Float32Array; sampleRate: number } | null>(null);
  const preferredMicDeviceIdRef = useRef<string | null>(null);
  const voiceWsClientRef = useRef<VoiceInputWsClient | null>(null);
  const voiceWsConnectPromiseRef = useRef<Promise<void> | null>(null);
  const voiceWsErrorRef = useRef<string | null>(null);
  const voiceWsResultTextRef = useRef<string>('');
  const voiceWsAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceWsSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceWsProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voiceWsGainRef = useRef<GainNode | null>(null);

  /** startRecording 流程上下文（由薄编排层组装并传给 runStartRecordingFlow） */
  const startFlowContextRef = useRef<any>(null);

  // 追踪 processing 状态，以便在 timeout 回调中访问最新值
  const processingRef = useRef(processing);
  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  const stopStreamTracks = useCallback((s: MediaStream | null | undefined) => {
    try {
      s?.getTracks?.().forEach((t) => {
        try {
          t.stop();
        } catch {
          //
        }
      });
    } catch {
      //
    }
  }, []);

  const handleSopAction = useCallback(async (payload: { action?: string; content?: string }) => {
    await handleSopCreateNote({
      payload,
      sopHandledSet: sopHandledRef.current,
      createNote,
      toast: ({ visible, status, message, autoHideMs }) => {
        try {
          (window as any)?.electronAPI?.ipcRenderer?.send?.('voice-indicator-set', {
            visible,
            status,
            message,
            autoHideMs,
          });
        } catch {
          //
        }
      },
    });
  }, []);

  const stopPreBuffer = useCallback(
    () =>
      stopPreBufferRaw({
        preBufferProcessorRef,
        preBufferGainRef,
        preBufferCtxRef,
        preBufferRef,
        preBufferPosRef,
        preBufferFullRef,
      }),
    [],
  );

  const snapshotPreBuffer = useCallback(
    () =>
      snapshotPreBufferRaw({
        preBufferRef,
        preBufferSampleRateRef,
        preBufferFullRef,
        preBufferPosRef,
      }),
    [],
  );

  const startPreBuffer = useCallback(
    (stream: MediaStream) =>
      startPreBufferRaw({
        stream,
        preBufferSeconds: PRE_BUFFER_SECONDS,
        preBufferCtxRef,
        preBufferSampleRateRef,
        preBufferRef,
        preBufferPosRef,
        preBufferFullRef,
        preBufferProcessorRef,
        preBufferGainRef,
        stopPreBuffer,
      }),
    [stopPreBuffer],
  );

  const disposeWarmStream = useCallback(
    () =>
      disposeWarmStreamRaw({
        warmStreamExpireTimerRef,
        stopPreBuffer,
        warmStreamRef,
        stopStreamTracks,
      }),
    [stopStreamTracks, stopPreBuffer],
  );

  const stopAudioAnalysis = useCallback(() => {
    stopAudioAnalysisImpl({
      analyserTimerRef,
      analyserRef,
      analyserGainRef,
      audioContextRef,
      smoothedBarsRef,
      smoothRmsRef,
      speakingHoldRef,
      lastAnalyserAtRef,
      setIndicatorVolumes,
      setIndicatorStatus,
    });
  }, []);

  const startAudioAnalysis = useCallback(
    async (stream: MediaStream) => {
      await startAudioAnalysisImpl({
        stream,
        dlog,
        stopAudioAnalysis,
        analyserTimerRef,
        analyserRef,
        analyserGainRef,
        audioContextRef,
        smoothedBarsRef,
        smoothRmsRef,
        speakingHoldRef,
        lastAnalyserAtRef,
        setIndicatorVolumes,
        setIndicatorStatus,
      });
    },
    [dlog, stopAudioAnalysis],
  );

  /** Electron IPC 渲染进程通信对象 */
  const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;

  // 将指示器状态/波形推送给主进程，由主进程用系统悬浮窗显示（与重写窗口一致）
  const lastIndicatorSentAtRef = useRef(0);
  const lastIndicatorKeyRef = useRef('');
  const indicatorNoticeHoldUntilRef = useRef(0);
  const indicatorNoticeStatusRef = useRef<'notice' | 'error' | null>(null);
  const indicatorNoticeMessageRef = useRef<string | undefined>(undefined);
  // 单键长按免按模式：
  // - 长按达到阈值后松开，不结束录音，进入“锁定录音”
  // - 锁定后再按一次并松开，才真正结束
  const singleKeyHoldTimerRef = useRef<number | null>(null);
  const singleKeyPressActiveRef = useRef(false);
  const singleKeyPressStartedAtRef = useRef(0);
  const singleKeyLastStopAtRef = useRef(0);
  const singleKeyLockedAtRef = useRef(0);
  const singleKeyLongHoldReachedRef = useRef(false);
  const singleKeyLockedRef = useRef(false);
  const singleKeyAwaitStopReleaseRef = useRef(false);
  // 全局热键事件序列去重（主进程 native keyhook 为单一事件源时使用）。
  // 目的：避免重复/乱序 start-stop 事件破坏录音状态机。
  const lastGlobalRecordEventSeqRef = useRef(0);
  const lastGlobalRecordEventStampRef = useRef('');
  // stop 流程竞态兜底：少数环境会出现 recorder 已 inactive 但 onstop 未触发，
  // 导致 processing/sending 状态无法回落，后续 start 被永久拦截。
  const stopRaceRecoveryTimerRef = useRef<number | null>(null);

  const clearSingleKeyHoldTimer = useCallback(() => {
    const timer = singleKeyHoldTimerRef.current;
    if (timer == null) return;
    try {
      window.clearTimeout(timer);
    } catch {
      //
    }
    singleKeyHoldTimerRef.current = null;
  }, []);

  const clearStopRaceRecoveryTimer = useCallback(() => {
    const timer = stopRaceRecoveryTimerRef.current;
    if (timer == null) return;
    try {
      window.clearTimeout(timer);
    } catch {
      //
    }
    stopRaceRecoveryTimerRef.current = null;
  }, []);

  const resetSingleKeyLockState = useCallback(() => {
    clearSingleKeyHoldTimer();
    singleKeyPressActiveRef.current = false;
    singleKeyPressStartedAtRef.current = 0;
    singleKeyLastStopAtRef.current = 0;
    singleKeyLockedAtRef.current = 0;
    singleKeyLongHoldReachedRef.current = false;
    singleKeyLockedRef.current = false;
    singleKeyAwaitStopReleaseRef.current = false;
  }, [clearSingleKeyHoldTimer]);
  const sendIndicatorSet = useCallback(
    (payload: {
      visible: boolean;
      status: 'speaking' | 'silent' | 'loading' | 'notice' | 'error';
      message?: string;
      volumes?: number[] | null;
      previewText?: string;
      autoHideMs?: number;
      resetTimer?: boolean;
      nonBlockingHint?: boolean;
    }) => {
      if (!ipcRenderer?.send) return false;
      try {
        const now = performance.now();
        if (payload.visible && (payload.status === 'notice' || payload.status === 'error')) {
          const holdMs = Math.max(400, Number(payload.autoHideMs || 1600));
          indicatorNoticeHoldUntilRef.current = now + holdMs;
          indicatorNoticeStatusRef.current = payload.status;
          indicatorNoticeMessageRef.current = payload.message;
        }
        ipcRenderer.send('voice-indicator-set', payload);
        return true;
      } catch (error) {
        console.warn('[useVoiceRecognition] IPC send failed (voice-indicator-set):', error);
        return false;
      }
    },
    [ipcRenderer],
  );
  const sendSingleKeyHint = useCallback(
    (message: string, autoHideMs: number) => {
      if (!message) return;
      sendIndicatorSet({
        visible: true,
        status: 'notice',
        message,
        autoHideMs,
      });
    },
    [sendIndicatorSet],
  );
  useEffect(() => {
    if (!ipcRenderer?.send) return;
    const phase = deriveVoicePhase({ recording, starting, processing, sending, rewriting });
    const baseVisible = hasActiveVoiceSession({
      recording,
      starting,
      processing,
      sending,
      rewriting,
    });
    const now = performance.now();
    const holdActive = !baseVisible && now < indicatorNoticeHoldUntilRef.current;
    const visible = baseVisible || holdActive;
    const status: VoiceIndicatorStatus =
      starting && !micAcquired && micPermissionGrantedRef.current !== true
        ? 'loading'
        : resolveIndicatorPhaseStatus({ phase, indicatorStatus });

    // 优化：在“看似录音但还没数据”的瞬间，不要显示 silent 而是 loading，
    // 否则用户会看到波动条出来一瞬间是平的，然后才动，感觉像“没反应”
    //
    // UPDATE: 用户反馈“刚开始的三个点还是会影响录音”，且“已经有权限就不要显示三个点”。
    // 所以如果已经有权限（micPermissionGrantedRef=true），即使数据还没来，也优先显示波动条（silent 态），
    // 避免“加载中”让用户误以为还没开始录音。
    let effectiveStatus: 'speaking' | 'silent' | 'loading' | 'notice' | 'error' =
      status === 'silent' &&
      recording &&
      indicatorStatus === 'silent' &&
      !indicatorVolumes &&
      micPermissionGrantedRef.current !== true
        ? 'loading'
        : status;

    // Win：按下开始录音后，如果还没拿到麦克风流，用“麦克风唤起中”替代三点 loading
    let message =
      isWin && showMicWaking && starting && !micAcquired && !recording ? '麦克风唤起中' : undefined;
    let volumes = indicatorVolumes;
    const previewText =
      !message &&
      visible &&
      (effectiveStatus === 'speaking' ||
        effectiveStatus === 'silent' ||
        effectiveStatus === 'loading')
        ? String(indicatorPreviewText || '')
        : '';
    if (holdActive && indicatorNoticeStatusRef.current) {
      effectiveStatus = indicatorNoticeStatusRef.current;
      message = indicatorNoticeMessageRef.current;
      volumes = null;
    }
    const key = `${visible}:${effectiveStatus}:${recording ? 1 : 0}:${message || ''}:${previewText}`;

    // 更频繁地更新波形数据，确保实时性
    const shouldSend =
      key !== lastIndicatorKeyRef.current ||
      now - lastIndicatorSentAtRef.current > 30 ||
      (recording && volumes); // 录音时更频繁更新

    if (shouldSend) {
      lastIndicatorKeyRef.current = key;
      lastIndicatorSentAtRef.current = now;
      if (
        sendIndicatorSet({
          visible,
          status: effectiveStatus,
          volumes,
          message,
          previewText: previewText || undefined,
        })
      ) {
        // Windows调试：记录发送的数据
        if (VOICE_DEBUG && visible && recording) {
          dlog(
            '[useVoiceRecognition] sent indicator data - status:',
            status,
            'volumes length:',
            volumes?.length,
          );
        }
      }
    }
  }, [
    VOICE_DEBUG,
    dlog,
    indicatorStatus,
    indicatorVolumes,
    ipcRenderer,
    isWin,
    micAcquired,
    showMicWaking,
    processing,
    recording,
    rewriting,
    sendIndicatorSet,
    sending,
    starting,
    indicatorPreviewText,
  ]);

  // Win：只有“确实卡在获取麦克风”的时候才展示“麦克风唤起中”
  useEffect(() => {
    if (!isWin) return;
    if (!starting || micAcquired || recording) {
      setShowMicWaking(false);
      return;
    }

    // 优化：如果已知有麦克风权限（非首次启动），给更多时间容忍 IPC/getUserMedia 耗时，
    // 避免每次按下都闪现“唤起中”，提升“热启动”体感。
    const delay = micPermissionGrantedRef.current ? 800 : 200;

    const t = window.setTimeout(() => {
      // 仍然处于“按下后启动中 + 还没拿到麦克风”的状态，才显示
      setShowMicWaking(true);
    }, delay);
    return () => {
      try {
        window.clearTimeout(t);
      } catch {
        //
      }
      setShowMicWaking(false);
    };
  }, [isWin, micAcquired, recording, starting]);

  const sendFeedback = useCallback(
    (payload: { type: string; message?: string; detail?: any }) =>
      sendVoiceFeedback(ipcRenderer, payload),
    [ipcRenderer],
  );

  const toastOnIndicator = useCallback(
    (payload: {
      visible: boolean;
      status: 'speaking' | 'silent' | 'loading' | 'notice' | 'error';
      message?: string;
      volumes?: number[] | null;
      previewText?: string;
      autoHideMs?: number;
      resetTimer?: boolean;
    }) => sendIndicatorSet(payload),
    [sendIndicatorSet],
  );

  const toastErrorOnIndicator = useCallback(
    (message: string, autoHideMs = 1600) => {
      const msg = String(message || '').trim();
      if (!msg) return;
      toastOnIndicator({
        visible: true,
        status: 'error',
        message: msg,
        autoHideMs,
      });
    },
    [toastOnIndicator],
  );

  const validateRewriteSelectedText = useCallback(
    (text: string): string =>
      validateRewriteSelectedTextRaw({
        text,
        maxLen: MAX_REWRITE_SELECTED_TEXT_LEN,
        onTooLong: (msg) =>
          toastOnIndicator({
            visible: true,
            status: 'notice',
            message: msg,
            autoHideMs: 2200,
          }),
      }),
    [toastOnIndicator],
  );

  const stripAllNewlines = useCallback((text: string) => stripAllNewlinesRaw(text), []);

  const normalizeTextForExternalInsert = useCallback(
    (text: string) => normalizeTextForExternalInsertRaw(text),
    [],
  );

  const tryShowRewriteOverlay = useCallback(
    async (text: string, questionText?: string) => {
      // 教程/初始化引导流程中，overlay 的展示策略可能需要特殊处理（例如避免打断引导）。
      // 这里用一个可选的全局标记位做判定（没有设置时默认视为 false）。
      const isInitTutorialScene =
        (
          window as Window & {
            __sensetype_init_steps_in_progress__?: unknown;
          }
        ).__sensetype_init_steps_in_progress__ === true;
      return await tryShowRewriteOverlayHelper({
        ipcRenderer,
        text,
        questionText,
        isInitTutorialScene,
        onError: (msg) => {
          // overlay 展示失败时要同步：本地 error 状态、指示器提示、以及反馈上报（便于定位阶段性问题）。
          setError(msg);
          toastErrorOnIndicator(msg);
          sendFeedback({
            type: 'recognition-error',
            message: msg,
            detail: { stage: 'rewrite-overlay' },
          });
        },
      });
    },
    [ipcRenderer, sendFeedback, toastErrorOnIndicator],
  );

  const executeRewriteFlow = useCallback(
    async (selectedText: string, instruction: string) => {
      setRewriting(true);
      sendFeedback({ type: 'rewrite-started' });
      const pipelineResult = await runRewritePipeline({
        selectedText,
        instruction,
        rewriteTextRequest,
        normalizeText: stripAllNewlines,
        showOverlay: tryShowRewriteOverlay,
      });
      if (!pipelineResult.ok) {
        const msg = pipelineResult.errorMessage;
        setError(msg);
        toastErrorOnIndicator(msg);
        sendFeedback({ type: 'recognition-error', message: msg });
        setRewriting(false);
        return null;
      }

      if (!rewriteExecuteTrackedRef.current) {
        rewriteExecuteTrackedRef.current = true;
        track('sensetype_task_rewrite_execute');
      }
      sendFeedback({ type: 'rewrite-done' });
      requestUserInfoRefresh({ reason: 'rewrite-done' });
      requestCheckinCalendarRefreshOnFirstUseToday();
      setRewriting(false);
      return {
        rewritten: pipelineResult.rewritten,
        rawResponse: pipelineResult.rawResponse,
      };
    },
    [sendFeedback, stripAllNewlines, toastErrorOnIndicator, tryShowRewriteOverlay],
  );

  const withTimeout = useCallback(
    async <T>(p: Promise<T>, ms: number, label: string) => withTimeoutHelper(p, ms, label),
    [],
  );

  const ensureWarmMicStreamImpl = useCallback(
    async (reason: 'startup' | 'after-stop' | 'manual') =>
      ensureWarmMicStreamRaw({
        reason,
        isMac,
        isWin,
        micPermissionGrantedRef,
        warmStreamRef,
        warmStreamExpireTimerRef,
        warmTtlMs: WARM_TTL_MS,
        preferredMicDeviceIdRef,
        withTimeout,
        disposeWarmStream,
        startPreBuffer,
        dlog,
      }),
    [WARM_TTL_MS, disposeWarmStream, isMac, startPreBuffer, withTimeout, isWin, dlog],
  );
  ensureWarmMicStreamImplRef.current = ensureWarmMicStreamImpl;

  // unmount 清理 warm stream，避免后台占用麦克风
  useEffect(() => {
    return () => {
      disposeWarmStream();
    };
  }, [disposeWarmStream]);

  /**
   * 清理音频流
   * 停止所有音频轨道并清空引用
   */
  const closeVoiceWsSession = useCallback(() => {
    try {
      voiceWsProcessorRef.current?.disconnect();
    } catch {
      //
    }
    voiceWsProcessorRef.current = null;
    try {
      voiceWsSourceRef.current?.disconnect();
    } catch {
      //
    }
    voiceWsSourceRef.current = null;
    try {
      voiceWsGainRef.current?.disconnect();
    } catch {
      //
    }
    voiceWsGainRef.current = null;
    try {
      voiceWsAudioCtxRef.current?.close();
    } catch {
      //
    }
    voiceWsAudioCtxRef.current = null;
    try {
      voiceWsClientRef.current?.close();
    } catch {
      //
    }
    voiceWsClientRef.current = null;
    voiceWsConnectPromiseRef.current = null;
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMicAcquired(false);
    stopAudioAnalysis();
    closeVoiceWsSession();
  }, [closeVoiceWsSession, stopAudioAnalysis]);

  /**
   * 在当前窗口的聚焦输入框中插入文本
   *
   * 支持两种类型的输入元素：
   * 1. HTMLInputElement 或 HTMLTextAreaElement：直接操作 value 和 selection
   * 2. contentEditable 元素：使用 execCommand 插入文本
   *
   * @param text 要插入的文本
   * @returns 是否成功插入
   */
  const insertIntoFocusedEditableInThisWindow = useCallback(
    (text: string) => insertIntoFocusedEditableInThisWindowRaw(text),
    [],
  );

  /**
   * 读取“当前窗口内聚焦输入框”的选中文本（仅 input/textarea）。
   * 用于：当用户在 App 内选中一段文字后说话，应走“重写弹窗”，而不是直接替换选区。
   */
  const getSelectedTextInFocusedTextInputInThisWindow = useCallback(
    (): string => getSelectedTextInFocusedTextInputInThisWindowRaw(),
    [],
  );

  /**
   * 读取“当前窗口内”的选中文本（支持 input/textarea + contentEditable）。
   * 用于：重写模式在录音开始前缓存选区，保证 done 后一定能调用重写接口。
   */
  const getSelectedTextInThisWindow = useCallback(
    (): string => getSelectedTextInThisWindowRaw(),
    [],
  );

  /**
   * 将音频 Blob 转换为 MP3 格式
   *
   * 转换流程：
   * 1. 确保 lamejs 已加载
   * 2. 使用 AudioContext 解码音频数据
   * 3. 将多声道音频混合为单声道（如果有多声道）
   * 4. 将 Float32 格式转换为 Int16 PCM 格式
   * 5. 使用 lamejs 编码为 MP3
   *
   * @param audioBlob 原始音频 Blob（通常是 WebM/Opus 格式）
   * @returns MP3 格式的音频 Blob
   */
  const convertToMp3 = useCallback(
    async (audioBlob: Blob, opts?: Parameters<typeof convertToMp3Raw>[1]): Promise<Blob> => {
      dlog('[convertToMp3] 开始转换，输入 Blob 大小:', audioBlob.size, 'bytes');
      const mp3 = await convertToMp3Raw(audioBlob, opts);
      dlog('[convertToMp3] MP3 转换完成，输出 Blob 大小:', mp3.size, 'bytes');
      return mp3;
    },
    [dlog],
  );

  /**
   * 停止录音
   *
   * 如果 MediaRecorder 正在运行，调用 stop() 触发 onstop 回调。
   * 否则直接清理状态和流。
   */
  const stopRecording = useCallback(() => {
    clearStopRaceRecoveryTimer();
    resetSingleKeyLockState();

    const stopActiveRecorder = (recorder: MediaRecorder) => {
      try {
        setProcessing(true); // 松开后立即进入 loading，直到接口完成
        setIndicatorPreviewText('');
      } catch {
        //
      }
      recorder.stop();
    };

    finalStopRequestedRef.current = true;
    // 松开按键后立即重置会话起点（用于 UI 计时立刻归零），
    // 同时保留快照供 onstop 结算 duration 使用。
    stopStartedAtSnapshotRef.current = sessionStartedAtRef.current || 0;
    sessionStartedAtRef.current = 0;
    // 标记“不再期望录音”，同时取消任何尚未完成的 start 流程
    desiredRecordingRef.current = false;
    startSeqRef.current += 1;

    // 如果还没进入真正录音态（例如 getUserMedia 还在 pending），直接清理即可
    if (!recordingRef.current) {
      // 某些边界情况下 recordingRef 还没来得及置 true，但 MediaRecorder 已经处于 recording 状态。
      // 这里用 MediaRecorder.state 作为兜底，确保 stop 不会丢。
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          stopActiveRecorder(mediaRecorderRef.current);
          return;
        }
      } catch {
        // ignore
      }

      // cancel 标志只对当前一次有效
      cancelRequestedRef.current = false;
      finalStopRequestedRef.current = false;
      if (startingRef.current) {
        startingRef.current = false;
        setStarting(false);
        setRecording(false);
        setIndicatorPreviewText('');
        cleanupStream();
      }
      return;
    }

    // 如果 MediaRecorder 正在运行，调用 stop() 会触发 onstop 回调
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        stopActiveRecorder(mediaRecorderRef.current);
      } else {
        // stop 与 onstop 可能存在时序竞态；
        // 这里先进入 processing，等待 onstop 统一收口，避免“松开即消失”。
        if (!cancelRequestedRef.current && finalStopRequestedRef.current) {
          setStarting(false);
          startingRef.current = false;
          setRecording(false);
          recordingRef.current = false;
          setIndicatorPreviewText('');
          setProcessing(true);
          setSending(true);
          // 仅 Win 生效：等待 onstop 收口；若超时仍未收口，强制复位，避免“只能用一次”。
          if (isWin) {
            stopRaceRecoveryTimerRef.current = window.setTimeout(() => {
              stopRaceRecoveryTimerRef.current = null;
              if (!finalStopRequestedRef.current) return;
              if (recordingRef.current || startingRef.current) return;
              console.warn(
                '[useVoiceRecognition] stop race timeout, force reset stuck processing/sending state',
              );
              finalStopRequestedRef.current = false;
              cancelRequestedRef.current = false;
              setProcessing(false);
              setSending(false);
              setRewriting(false);
              setIndicatorPreviewText('');
              cleanupStream();
              try {
                sendFeedback({
                  type: 'recording-stopped',
                  detail: { reason: 'stop-race-timeout' },
                });
              } catch {
                //
              }
              try {
                setTimeout(() => {
                  try {
                    ipcRenderer?.invoke?.('hotkey-reregister').catch(() => undefined);
                  } catch {
                    //
                  }
                }, 120);
              } catch {
                //
              }
            }, 1800);
          }
          return;
        }

        // 只有明确不是“等待收口”的情况才做直接清理
        setStarting(false);
        setRecording(false);
        recordingRef.current = false;
        setIndicatorPreviewText('');
        cleanupStream();
        cancelRequestedRef.current = false;
        finalStopRequestedRef.current = false;
      }
    } catch (error) {
      console.warn('[useVoiceRecognition] stopRecording error, forcing cleanup:', error);
      setStarting(false);
      setRecording(false);
      recordingRef.current = false;
      setIndicatorPreviewText('');
      cleanupStream();
      cancelRequestedRef.current = false;
      finalStopRequestedRef.current = false;
    }
  }, [
    cleanupStream,
    clearStopRaceRecoveryTimer,
    ipcRenderer,
    isWin,
    resetSingleKeyLockState,
    sendFeedback,
  ]);

  /**
   * 开始录音
   *
   * 薄编排层：组装上下文后委托 runStartRecordingFlow 执行完整流程。
   */
  startFlowContextRef.current = {
    recordingRef,
    processingRef,
    startingRef,
    startingAtRef,
    desiredRecordingRef,
    startSeqRef,
    cancelRequestedRef,
    setStarting,
    setRecording,
    setError,
    cleanupStream,
    sessionTriggerRef,
    recognitionRouteRef,
    recordingDurationSumMsRef,
    recordEndTrackedRef,
    sttSuccessTrackedRef,
    rewriteExecuteTrackedRef,
    externalTokenPastedRef,
    pendingRewriteSelectedTextRef,
    finalStopRequestedRef,
    sopHandledRef,
    getSelectedTextInThisWindow,
    getSelectedTextInFocusedTextInputInThisWindow,
    validateRewriteSelectedText,
    autoInsert,
    ipcRenderer,
    withTimeout,
    convertToMp3,
    startAudioAnalysis,
    stopAudioAnalysis,
    chunksRef,
    mediaRecorderRef,
    streamRef,
    preBufferSnapshotRef,
    voiceWsClientRef,
    voiceWsConnectPromiseRef,
    voiceWsErrorRef,
    voiceWsResultTextRef,
    voiceWsAudioCtxRef,
    voiceWsSourceRef,
    voiceWsProcessorRef,
    voiceWsGainRef,
    setIndicatorPreviewText,
    setProcessing,
    setSending,
    setRewriting,
    sendFeedback,
    handleSopAction,
    stripAllNewlines,
    insertIntoFocusedEditableInThisWindow,
    normalizeTextForExternalInsert,
    executeRewriteFlow,
    rewriteTextRequest,
    tryShowRewriteOverlay,
    toastErrorOnIndicator,
    isWin,
    isMac,
    micPermissionGrantedRef,
    micPermissionCheckedAtRef,
    lastGumSuccessAtRef,
    preferredMicDeviceIdRef,
    warmStreamRef,
    warmStreamExpireTimerRef,
    snapshotPreBuffer,
    stopPreBuffer,
    dlog,
    VOICE_DEBUG,
    setMicAcquired,
    sendIndicatorSet,
    sessionStartedAtRef,
    stopStartedAtSnapshotRef,
    asrAbortControllerRef,
    abortAllRef,
    setApiResult,
    audioUrlRef,
    setAudioUrl,
    ensureWarmMicStream,
    closeVoiceWsSession,
  };
  const startRecording = useCallback(async (trigger?: string) => {
    recognitionRouteRef.current = resolveRecognitionRouteByTrigger(trigger);
    return runStartRecordingFlow(startFlowContextRef.current, trigger);
  }, []);

  /**
   * 监听全局录音事件（由主进程通过全局快捷键触发）
   *
   * 当主进程检测到全局快捷键时，会发送 'global-record' 事件，
   * 根据 payload.action 决定开始或停止录音。
   *
   * 清理时：
   * 1. 移除事件监听器
   * 2. 如果正在录音则停止录音
   * 3. 清理音频流
   * 4. 释放音频 URL 资源
   */
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleGlobalRecord = (_: any, payload: GlobalRecordPayload) => {
      const action = payload?.action;
      if (action !== 'start' && action !== 'stop' && action !== 'cancel') return;

      // Windows 单源策略：主进程默认只转发 native keyhook 事件。
      // 这里按 eventSeq 做幂等处理，避免重复/乱序事件把状态机拉坏。
      if (isWin && payload?.source === 'native-keyhook') {
        const incomingSeq = Number(payload?.eventSeq || 0);
        if (incomingSeq > 0) {
          if (incomingSeq <= lastGlobalRecordEventSeqRef.current) {
            return;
          }
          lastGlobalRecordEventSeqRef.current = incomingSeq;
        } else {
          // 兼容极端情况：缺少 seq 时用 action+eventAt 兜底去重。
          const stamp = `${action}:${String(payload?.eventAt || 0)}`;
          if (stamp === lastGlobalRecordEventStampRef.current) {
            return;
          }
          lastGlobalRecordEventStampRef.current = stamp;
        }
      }

      // 初始化“按键测试”阶段：仅用于验证按键状态，不触发真正录音链路。
      if (isInitKeyTestSuppressRecording()) {
        if (action === 'start') desiredRecordingRef.current = false;
        return;
      }

      const hotkeyMode = String(payload?.hotkeyMode || '').toLowerCase();
      const isSingleHotkeyMode = hotkeyMode !== 'combo';

      if (action === 'start') {
        if (isSingleHotkeyMode) {
          // Win 原生层存在 start 重放机制：
          // 同一次按压期间可能收到多次 start，这里直接去重，避免“计时归零/状态抖动”。
          if (isWin && singleKeyPressActiveRef.current) {
            return;
          }
          // Win：在 stop 后短窗口内忽略 stray start，避免“松开后又被拉起”。
          if (
            isWin &&
            !singleKeyLockedRef.current &&
            singleKeyLastStopAtRef.current > 0 &&
            Date.now() - singleKeyLastStopAtRef.current < WIN_STRAY_START_AFTER_STOP_COOLDOWN_MS
          ) {
            return;
          }

          if (singleKeyLockedRef.current) {
            const now = Date.now();
            if (
              isWin &&
              singleKeyLastStopAtRef.current > 0 &&
              now - singleKeyLastStopAtRef.current < WIN_STRAY_START_AFTER_STOP_COOLDOWN_MS
            ) {
              return;
            }
            if (
              isWin &&
              singleKeyLockedAtRef.current > 0 &&
              now - singleKeyLockedAtRef.current < WIN_STRAY_START_AFTER_STOP_COOLDOWN_MS
            ) {
              return;
            }
            if (!singleKeyPressActiveRef.current && !singleKeyAwaitStopReleaseRef.current) {
              singleKeyPressActiveRef.current = true;
              singleKeyPressStartedAtRef.current = now;
              singleKeyAwaitStopReleaseRef.current = true;
            }
            return;
          }

          if (!singleKeyPressActiveRef.current) {
            singleKeyPressActiveRef.current = true;
            singleKeyPressStartedAtRef.current = Date.now();
            singleKeyLongHoldReachedRef.current = false;
            clearSingleKeyHoldTimer();
            singleKeyHoldTimerRef.current = window.setTimeout(() => {
              singleKeyHoldTimerRef.current = null;
              if (singleKeyLockedRef.current || !singleKeyPressActiveRef.current) return;
              if (!recordingRef.current && !startingRef.current) return;
              singleKeyLongHoldReachedRef.current = true;
              sendSingleKeyHint('可以松开继续录音，再按一下并松开结束', 500);
            }, SINGLE_KEY_HOLD_LOCK_THRESHOLD_MS);
          }
        } else {
          resetSingleKeyLockState();
        }

        // 防抖：若当前已处于录音会话（recording/starting/processing），忽略重复 start，
        // 避免 Win 残留事件导致波动条重置/计时归零。
        const canStartNewSession =
          !recordingRef.current && !startingRef.current && !processingRef.current;
        if (isWin && !canStartNewSession) {
          return;
        }

        desiredRecordingRef.current = true;
        setIndicatorPreviewText('');
        recognitionRouteRef.current = resolveRecognitionRouteByHotkeyMode(hotkeyMode);
        const trigger = hotkeyMode === 'combo' ? 'global-hotkey-combo' : 'global-hotkey';
        // 每次检测到按下都先清零计时，避免上一轮异常态残留导致计时续接
        sendIndicatorSet({
          visible: true,
          status: 'loading',
          volumes: null,
          resetTimer: true,
        });
        startRecording(trigger);
      } else if (action === 'stop') {
        if (isSingleHotkeyMode) {
          const heldMs = Math.max(0, Date.now() - (singleKeyPressStartedAtRef.current || 0));
          const reachedThresholdByDuration =
            heldMs >= SINGLE_KEY_HOLD_LOCK_THRESHOLD_MS - SINGLE_KEY_HOLD_LOCK_EDGE_GRACE_MS;
          const shouldLockOnRelease =
            !singleKeyLockedRef.current &&
            singleKeyPressActiveRef.current &&
            (singleKeyLongHoldReachedRef.current || reachedThresholdByDuration) &&
            (recordingRef.current || startingRef.current);

          singleKeyPressActiveRef.current = false;
          singleKeyPressStartedAtRef.current = 0;
          if (isWin) singleKeyLastStopAtRef.current = Date.now();
          clearSingleKeyHoldTimer();

          if (singleKeyLockedRef.current) {
            if (!singleKeyAwaitStopReleaseRef.current) return;
            singleKeyAwaitStopReleaseRef.current = false;
            singleKeyLockedRef.current = false;
            singleKeyLongHoldReachedRef.current = false;
          } else if (shouldLockOnRelease) {
            singleKeyLockedRef.current = true;
            singleKeyLockedAtRef.current = Date.now();
            singleKeyLongHoldReachedRef.current = false;
            return;
          }
        } else {
          resetSingleKeyLockState();
        }

        desiredRecordingRef.current = false;
        stopRecording();

        adapter.afterStopRequested?.({
          stopRecording,
          cleanupStream,
          recordingRef,
          startingRef,
          processingRef,
          mediaRecorderRef,
          streamRef,
          setRecording,
        });
      } else if (action === 'cancel') {
        resetSingleKeyLockState();
        // 组合键：取消语音（不走识别/重写）
        console.info('[useVoiceRecognition] 收到 cancel 事件，准备取消录音');
        desiredRecordingRef.current = false;
        cancelRequestedRef.current = true;
        abortAllRef.current = true;
        try {
          asrAbortControllerRef.current?.abort();
        } catch {
          //
        }
        asrAbortControllerRef.current = null;
        try {
          pendingRewriteSelectedTextRef.current = '';
        } catch {
          //
        }
        // 注意：cancel 可能发生在“录音中 / 正在唤起麦克风 / 已停止录音但正在 sending/rewriting”的任意阶段
        // - 若仍在录音/唤起中：交给 stopRecording + cancelled 分支兜底清理
        // - 若已进入 sending/processing：stopRecording 可能是 no-op，需要这里直接清状态并隐藏波动条
        if (recordingRef.current || startingRef.current) {
          console.info(
            '[useVoiceRecognition] cancelRequestedRef 已设置为 true，调用 stopRecording',
          );
          stopRecording();
        } else {
          try {
            setStarting(false);
            startingRef.current = false;
            startingAtRef.current = 0;
          } catch {
            //
          }
          try {
            setRecording(false);
            recordingRef.current = false;
          } catch {
            //
          }
          try {
            setSending(false);
            setRewriting(false);
            setProcessing(false);
            setIndicatorPreviewText('');
          } catch {
            //
          }
          try {
            cleanupStream();
          } catch {
            //
          }
        }

        try {
          // 确保主进程 voiceSessionActive 状态复位，否则 hotkey-reregister 可能会被锁住
          sendFeedback({ type: 'recording-stopped' });
        } catch {
          //
        }

        // 和“录音超时”一致：强制重置热键状态，避免下次需要按两下
        // 使用 setTimeout 确保在 recording-stopped 状态同步到主进程之后执行
        setTimeout(() => {
          try {
            ipcRenderer?.invoke?.('hotkey-reregister').catch(() => {});
          } catch {
            //
          }
        }, 300);
      }
    };

    // 监听全局录音事件
    ipcRenderer.on('global-record', handleGlobalRecord);

    // 清理函数
    return () => {
      resetSingleKeyLockState();
      clearStopRaceRecoveryTimer();
      // 移除事件监听器
      ipcRenderer.off('global-record', handleGlobalRecord);

      // 如果正在录音或 start 流程尚未完成，停止/取消录音
      if (recordingRef.current || startingRef.current) stopRecording();
      else cleanupStream();

      // 释放音频 URL 资源
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [
    adapter,
    cleanupStream,
    ipcRenderer,
    isWin,
    sendFeedback,
    sendIndicatorSet,
    sendSingleKeyHint,
    startRecording,
    stopRecording,
    resetSingleKeyLockState,
    clearSingleKeyHoldTimer,
    clearStopRaceRecoveryTimer,
  ]);

  // 平台级副作用（例如 mac 的辅助功能权限提示按键监听）
  useEffect(() => {
    if (!ipcRenderer) return;
    return adapter.installPlatformEffects?.({ ipcRenderer });
  }, [adapter, ipcRenderer]);

  // 组装状态对象
  const status: VoiceRecognitionStatus = {
    recording,
    processing,
    sending,
    rewriting,
    indicatorStatus: resolveIndicatorPhaseStatus({
      phase: deriveVoicePhase({ recording, starting, processing, sending, rewriting }),
      indicatorStatus,
    }),
    indicatorVolumes,
    audioUrl,
    apiResult,
    error,
  };

  // 返回状态和控制函数
  return {
    /** 当前状态 */
    status,
    /** 开始录音函数 */
    startRecording,
    /** 停止录音函数 */
    stopRecording,
  };
}
