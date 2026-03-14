import type React from 'react';
import { track } from '@/utils/posthog';
import {
  isLikelyBluetoothMicLabel,
  resolveMacCaptureMicDevice,
} from '@/renderer/voice/micDevicePolicy';
import {
  buildSpeechCaptureConstraints,
  buildSpeechFallbackConstraints,
  normalizePreferredMicDeviceId,
} from '@/renderer/voice/capturePolicy';
import { createHandleRecorderStop } from './recorderStopHandler';
import { normalizeRecognitionRoute } from './recognitionRoute';
import { setupLongRecordingWsOnStart } from './routes/longRecordingWsRoute';

type MutableRef<T> = React.MutableRefObject<T>;

const APP_WAKEUP_DAY_KEY = 'sensetype_app_wakeup_day';
const MAX_REWRITE_SELECTED_TEXT_LEN = 5000;

export function resolveStartRecordingErrorMessage(err: any): string {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    return '麦克风权限被拒绝，请在系统设置中授予权限。';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return '未找到可用的麦克风设备，请检查设备连接。';
  }
  if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
    return '麦克风设备被其他应用占用，请关闭其他使用麦克风的应用后重试。';
  }
  if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
    return '麦克风设备不支持所需的音频格式，请检查设备设置。';
  }
  return err?.message || '无法开始录音，请确认麦克风权限。';
}

export async function startRecorderWithMonitoring(args: {
  recorder: MediaRecorder;
  timeSlice: number;
  dlog: (...args: any[]) => void;
  debugEnabled: boolean;
  chunksRef: MutableRef<Blob[]>;
  sessionStartedAtRef: MutableRef<number>;
  handleRecorderStop: () => Promise<void>;
  recordingRef: MutableRef<boolean>;
  setRecording: (v: boolean) => void;
  setStarting: (v: boolean) => void;
  startingRef: MutableRef<boolean>;
  startingAtRef: MutableRef<number>;
  sendFeedback: (payload: { type: string; message?: string; detail?: any }) => void;
  sendIndicatorSet?: (payload: {
    visible: boolean;
    status: 'speaking' | 'silent' | 'loading' | 'notice' | 'error';
    message?: string;
    volumes?: number[] | null;
    previewText?: string;
    autoHideMs?: number;
    resetTimer?: boolean;
  }) => boolean;
}) {
  const {
    recorder,
    timeSlice,
    dlog,
    debugEnabled,
    chunksRef,
    sessionStartedAtRef,
    handleRecorderStop,
    recordingRef,
    setRecording,
    setStarting,
    startingRef,
    startingAtRef,
    sendFeedback,
    sendIndicatorSet,
  } = args;

  const startTime = Date.now();
  let checkInterval: NodeJS.Timeout | null = null;

  sessionStartedAtRef.current = Date.now();
  recorder.start(timeSlice);
  dlog('[useVoiceRecognition] MediaRecorder 已启动，状态:', recorder.state);

  if (debugEnabled) {
    checkInterval = setInterval(() => {
      if (recorder.state === 'recording') {
        const chunkCount = chunksRef.current.length;
        dlog(`[useVoiceRecognition] 录音中... 状态: ${recorder.state}, 数据块: ${chunkCount}`);
        if (chunkCount === 0 && Date.now() - startTime > 1000) {
          console.warn('[useVoiceRecognition] 警告：录音已启动但未收到任何数据，请检查麦克风');
        }
      } else {
        dlog('[useVoiceRecognition] 录音状态异常，当前状态:', recorder.state);
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    }, 800);
  }

  const originalOnStop = handleRecorderStop;
  recorder.onstop = async () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    await originalOnStop();
  };

  recordingRef.current = true;
  setRecording(true);
  setStarting(false);
  startingRef.current = false;
  startingAtRef.current = 0;
  sendFeedback({ type: 'recording-started' });

  try {
    sendIndicatorSet?.({
      visible: true,
      status: 'silent',
      volumes: null,
      resetTimer: true,
    });
  } catch {
    //
  }
}

/**
 * 开始录音流程的完整实现（从 useVoiceRecognition 迁移）
 * @param ctx 由 useVoiceRecognition 组装的上下文对象
 * @param trigger 触发来源（如 'global-hotkey'）
 */
export async function runStartRecordingFlow(ctx: any, trigger?: string): Promise<void> {
  // 防止重复录音或正在处理时开始新的录音
  if (ctx.recordingRef.current || ctx.processingRef.current) return;
  if (ctx.startingRef.current) {
    // 某些 macOS/Electron 环境下 getUserMedia 可能在后台挂起，导致 starting 永远不结束
    const startedAt = ctx.startingAtRef.current;
    if (startedAt && Date.now() - startedAt > 15000) {
      console.warn('[useVoiceRecognition] startRecording stuck >15s, force reset');
      ctx.startingRef.current = false;
      ctx.startingAtRef.current = 0;
      ctx.desiredRecordingRef.current = false;
      ctx.setStarting(false);
      ctx.setRecording(false);
      ctx.cleanupStream();
    } else {
      return;
    }
  }

  // 标记“期望开始录音”，并为本次 start 分配一个序号（用于中途取消）
  ctx.desiredRecordingRef.current = true;
  const mySeq = (ctx.startSeqRef.current += 1);

  // 重置 cancel 状态，防止上一轮残留导致本轮秒退
  ctx.cancelRequestedRef.current = false;

  ctx.startingRef.current = true;
  ctx.startingAtRef.current = Date.now();
  // 按下即重置指示条计时，避免上一轮异常态残留导致计时续接
  try {
    ctx.sendIndicatorSet?.({
      visible: true,
      status: 'loading',
      volumes: null,
      resetTimer: true,
    });
  } catch {
    //
  }
  // 进入启动态：让系统指示条先出现（冷启动/老机器第一次 getUserMedia 可能较慢）
  ctx.setStarting(true);
  ctx.sessionTriggerRef.current = trigger || 'global-hotkey';

  // 统计“日使用量”：每日首次语音唤起时记录一次
  try {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    const last = localStorage.getItem(APP_WAKEUP_DAY_KEY);
    if (last !== day) {
      localStorage.setItem(APP_WAKEUP_DAY_KEY, day);
      track('sensetype_app_wakeup');
    }
  } catch {
    // ignore
  }

  ctx.recordingDurationSumMsRef.current = 0;
  ctx.recordEndTrackedRef.current = false;
  ctx.sttSuccessTrackedRef.current = false;
  ctx.rewriteExecuteTrackedRef.current = false;
  ctx.externalTokenPastedRef.current = false;
  ctx.pendingRewriteSelectedTextRef.current = '';
  ctx.voiceWsResultTextRef.current = '';
  ctx.setIndicatorPreviewText?.('');
  ctx.voiceWsErrorRef.current = null;
  ctx.finalStopRequestedRef.current = false;
  ctx.sopHandledRef.current = new Set();
  try {
    ctx.closeVoiceWsSession?.();
  } catch {
    // ignore
  }

  const _windowFocusedAtStart = (() => {
    try {
      return document.hasFocus();
    } catch {
      return false;
    }
  })();
  // 选中文字重写检测：提前发起 IPC，与后续 getUserMedia 并行执行
  const _startCanInsertInThisWindow = (() => {
    try {
      if (!_windowFocusedAtStart) return false;
      const el = document.activeElement as any;
      const isTextInput =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (typeof el?.tagName === 'string' &&
          (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea'));
      return Boolean(isTextInput || el?.isContentEditable);
    } catch {
      return false;
    }
  })();
  // 同步检查窗口内选区（超长直接拦截，不进入录音流程）
  const _inWindowSel = (() => {
    try {
      const text = String(ctx.getSelectedTextInThisWindow() || '').trim();
      if (text && text.length > MAX_REWRITE_SELECTED_TEXT_LEN) {
        ctx.validateRewriteSelectedText(text);
        ctx.desiredRecordingRef.current = false;
        ctx.startingRef.current = false;
        ctx.setStarting(false);
        return '';
      }
      return text;
    } catch {
      return '';
    }
  })();
  if (!ctx.desiredRecordingRef.current) return;
  if (_inWindowSel) {
    ctx.pendingRewriteSelectedTextRef.current = _inWindowSel;
  }
  // 外部选区 IPC：立即发起（不 await），与 getUserMedia 并行
  // ctx.autoInsert=false（如教程页）时跳过：不需要改写/插入，且 macOS 上
  // get-selected-text 通过 osascript/System Events 模拟 Cmd+C，
  // 会激活 System Events 进程导致 Electron 窗口失焦后移。
  // 当前窗口在前台时，跳过外部选区读取，避免不必要的焦点扰动/层级变化。
  const _externalSelP =
    !_inWindowSel && ctx.autoInsert && !_startCanInsertInThisWindow && !_windowFocusedAtStart
      ? ctx.ipcRenderer?.invoke?.('get-selected-text')?.catch(() => '')
      : null;
  if (_externalSelP && !ctx.pendingRewriteSelectedTextRef.current) {
    // 让外部选区读取继续在后台跑，不阻塞热键唤起录音。
    void _externalSelP
      .then((value) => {
        const extSelRaw = String(value || '').trim();
        if (!extSelRaw || ctx.pendingRewriteSelectedTextRef.current) return;
        ctx.pendingRewriteSelectedTextRef.current = extSelRaw;
      })
      .catch(() => {
        // ignore
      });
  }

  const cancelled = () => ctx.startSeqRef.current !== mySeq || !ctx.desiredRecordingRef.current;
  const markMicReady = (ts = Date.now()) => {
    ctx.setMicAcquired(true);
    ctx.lastGumSuccessAtRef.current = ts;
    ctx.micPermissionGrantedRef.current = true;
    ctx.micPermissionCheckedAtRef.current = ts;
    try {
      localStorage.setItem('SENSETYPE_MIC_GRANTED', '1');
    } catch {
      //
    }
  };

  // 检查浏览器是否支持 getUserMedia
  if (!navigator?.mediaDevices?.getUserMedia) {
    const msg = '当前环境无法访问麦克风，请检查权限或设备。';
    ctx.setError(msg);
    ctx.toastErrorOnIndicator?.(msg);
    ctx.sendFeedback({
      type: 'recognition-error',
      message: msg,
    });
    ctx.desiredRecordingRef.current = false;
    ctx.startingRef.current = false;
    ctx.setStarting(false);
    return;
  }

  ctx.setError(null);

  try {
    // macOS: 先通过主进程请求麦克风权限（Intel Mac 需要主动请求）
    if (ctx.ipcRenderer?.invoke && ctx.isMac) {
      try {
        const now = Date.now();
        // 10 分钟内已确认 granted：跳过重复检查，减少冷启动额外耗时
        const shouldRecheck =
          ctx.micPermissionGrantedRef.current !== true ||
          now - ctx.micPermissionCheckedAtRef.current > 10 * 60 * 1000;
        if (shouldRecheck) {
          const permissionResult = (await ctx.ipcRenderer.invoke(
            'request-microphone-permission',
          )) as any;
          ctx.micPermissionGrantedRef.current = permissionResult?.granted === true;
          ctx.micPermissionCheckedAtRef.current = now;
          if (!permissionResult?.granted) {
            const msg = '需要麦克风权限才能使用语音识别功能，请在系统设置中授予权限。';
            ctx.setError(msg);
            ctx.toastErrorOnIndicator?.(msg);
            ctx.sendFeedback({
              type: 'recognition-error',
              message: msg,
            });
            ctx.desiredRecordingRef.current = false;
            ctx.startingRef.current = false;
            ctx.setStarting(false);
            return;
          }
        }
      } catch (permError) {
        console.warn('[useVoiceRecognition] Failed to request microphone permission:', permError);
        // 继续尝试 getUserMedia，可能权限已经授予
      }
    }

    // 获取麦克风音频流
    // 注意：Windows 上指定 deviceId + 高级约束（echoCancellation 等）在某些设备切换/睡眠唤醒场景会变得非常不稳定：
    // - 可能 getUserMedia 长时间挂起
    // - 或切换一次后后续设备都不可用
    // 因此 Win 走一套更“typeless”的策略：先用最宽松约束拿到流，再可选 applyConstraints。
    //
    // IMPORTANT(win):
    // 之前把“已预检权限”的超时压到 1500ms，会导致非冷启动也经常超时，从而出现“按下后一直 loading 但没录上”的体验。
    // 这里改为更稳健的动态超时：最近成功过走快路径，否则给足时间 + 失败自动回退。
    const now = Date.now();
    const gumTimeoutMs = ctx.isWin
      ? now - (ctx.lastGumSuccessAtRef.current || 0) < 2 * 60 * 1000
        ? 2800
        : ctx.micPermissionGrantedRef.current === true
          ? 6500
          : 10000
      : 12000;
    const gumTimeoutFallbackMs = ctx.isWin ? Math.max(gumTimeoutMs, 10000) : gumTimeoutMs;

    // 使用缓存的首选麦克风（避免录音启动时的 IPC 延迟）
    let preferredMicDeviceId = normalizePreferredMicDeviceId(ctx.preferredMicDeviceIdRef.current);
    if (ctx.isMac) {
      try {
        const resolved = await resolveMacCaptureMicDevice(preferredMicDeviceId);
        if (resolved.fallbackApplied && resolved.deviceId) {
          preferredMicDeviceId = normalizePreferredMicDeviceId(resolved.deviceId);
        }
      } catch {
        // ignore
      }
    }
    const audioConstraints = buildSpeechCaptureConstraints({
      isMac: ctx.isMac,
      isWin: ctx.isWin,
      preferredMicDeviceId,
      permissionGranted: ctx.micPermissionGrantedRef.current,
    });

    console.log('[useVoiceRecognition] 请求麦克风权限，约束:', audioConstraints);

    // 若 warm stream 存在，直接复用（能显著减少 getUserMedia 冷启动延迟，macOS & Windows 均适用）
    try {
      const warm = ctx.warmStreamRef.current;
      const warmOk =
        warm &&
        warm.getAudioTracks().some((t) => t && t.readyState === 'live' && t.enabled !== false);
      // mac: warm stream 可能来自蓝牙麦，音质会退化；此时放弃 warm 复用，走新流获取
      const warmIsBluetoothMic =
        !!warm &&
        !!ctx.isMac &&
        warm.getAudioTracks().some((t) => isLikelyBluetoothMicLabel(String(t?.label || '')));
      if (warmIsBluetoothMic) {
        try {
          warm.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              //
            }
          });
        } catch {
          //
        }
        ctx.warmStreamRef.current = null;
      }
      if (warmOk && !warmIsBluetoothMic) {
        // 取走 warm stream 作为本次录音的真实 stream（后续由 ctx.cleanupStream 统一 stop）
        ctx.warmStreamRef.current = null;
        if (ctx.warmStreamExpireTimerRef.current) {
          try {
            window.clearTimeout(ctx.warmStreamExpireTimerRef.current);
          } catch {
            //
          }
          ctx.warmStreamExpireTimerRef.current = null;
        }
        ctx.streamRef.current = warm;
        // warm stream 复用：认为已拿到麦克风，避免 UI 误判为“唤起中”
        markMicReady(now);
        // 快照预缓冲（回溯热键按下前的音频，解决"前面丢字"）
        ctx.preBufferSnapshotRef.current = ctx.snapshotPreBuffer();
        ctx.stopPreBuffer();
        ctx.dlog(
          '[useVoiceRecognition] using warm mic stream, preBuffer:',
          !!ctx.preBufferSnapshotRef.current,
        );
      }
    } catch {
      // ignore
    }

    // 没有 warm stream：正常 getUserMedia
    try {
      if (!ctx.streamRef.current) {
        ctx.streamRef.current = await ctx.withTimeout(
          navigator.mediaDevices.getUserMedia(audioConstraints),
          gumTimeoutMs,
          'getUserMedia(primary)',
        );
      }
      // getUserMedia 成功：已拿到麦克风
      markMicReady();
    } catch (getUserMediaError: any) {
      // 如果基本约束失败，尝试更宽松的约束
      console.warn('[useVoiceRecognition] 使用基本约束失败，尝试更宽松的约束:', getUserMediaError);
      try {
        const fallbackConstraints = buildSpeechFallbackConstraints(preferredMicDeviceId);
        console.log('[useVoiceRecognition] 尝试使用宽松约束:', fallbackConstraints);
        ctx.streamRef.current = await ctx.withTimeout(
          navigator.mediaDevices.getUserMedia(fallbackConstraints),
          gumTimeoutFallbackMs,
          'getUserMedia(fallback)',
        );
        markMicReady();
      } catch (fallbackError: any) {
        console.error('[useVoiceRecognition] 使用宽松约束也失败:', fallbackError);
        // 如果是“指定设备”导致失败，最后再尝试一次“系统默认”，避免用户选错设备后直接不可用
        if (preferredMicDeviceId) {
          try {
            const defaultConstraints: MediaStreamConstraints = { audio: true };
            console.log(
              '[useVoiceRecognition] 指定设备失败，回退系统默认麦克风:',
              defaultConstraints,
            );
            ctx.streamRef.current = await ctx.withTimeout(
              navigator.mediaDevices.getUserMedia(defaultConstraints),
              gumTimeoutFallbackMs,
              'getUserMedia(default)',
            );
            markMicReady();
          } catch {
            // ignore
          }
          if (ctx.streamRef.current) {
            // ok
          } else {
            throw getUserMediaError;
          }
        } else {
          throw getUserMediaError; // 抛出原始错误
        }
      }
    }

    // 已拿到麦克风流：用于 Win 上把“唤起中”提示切回正常 loading/波形
    if (ctx.streamRef.current) {
      ctx.setMicAcquired(true);
    }

    // Win: 不在这里 applyConstraints。
    // 经验：Windows 上频繁 applyConstraints + 设备切换场景会显著增加“后续设备都不可用/卡死”的概率。

    // 如果在等待麦克风期间已“松开/停止”，立刻退出（避免后续流程又把录音启动起来）
    if (cancelled()) {
      ctx.cleanupStream();
      ctx.startingRef.current = false;
      ctx.setStarting(false);
      return;
    }

    // 验证音频流是否有效
    if (!ctx.streamRef.current) {
      throw new Error('获取到的音频流为空');
    }

    const audioTracks = ctx.streamRef.current.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('音频流中没有音频轨道');
    }
    // 精简：只确保轨道启用，省去大量诊断代码以减少启动延迟
    for (const track of audioTracks) {
      if (!track.enabled) track.enabled = true;
    }

    // 启动音频分析（用于波形/说话判定）
    ctx.startAudioAnalysis(ctx.streamRef.current);
    // 如果在等待麦克风权限/设备期间已经“松开/停止”，则不要再继续开始录音
    if (cancelled()) {
      ctx.cleanupStream();
      ctx.startingRef.current = false;
      ctx.setStarting(false);
      return;
    }

    const recognitionRoute = normalizeRecognitionRoute(ctx.recognitionRouteRef?.current);
    if (recognitionRoute === 'ws') {
      await setupLongRecordingWsOnStart(ctx);
    }

    // 创建 MediaRecorder，使用 WebM/Opus 格式
    // 检查浏览器是否支持该格式
    const supportedMimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    let selectedMimeType = 'audio/webm;codecs=opus';
    for (const mimeType of supportedMimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        console.log('[useVoiceRecognition] 使用音频格式:', selectedMimeType);
        break;
      }
    }

    if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
      console.warn('[useVoiceRecognition] 浏览器不支持任何音频格式，使用默认格式');
    }

    const timeSlice = ctx.isWin ? 10 : 100; // Windows使用10ms，macOS使用100ms

    const recorder = new MediaRecorder(ctx.streamRef.current, {
      audioBitsPerSecond: 160_000,
      mimeType: selectedMimeType,
    });

    console.log('[useVoiceRecognition] MediaRecorder 创建成功，状态:', recorder.state);

    // 清空之前的数据块
    ctx.chunksRef.current = [];

    // 添加错误监听
    recorder.onerror = (event: any) => {
      console.error('[useVoiceRecognition] MediaRecorder 错误:', event);
      const msg = '录音过程中发生错误，请重试。';
      ctx.setError(msg);
      ctx.toastErrorOnIndicator?.(msg);
    };

    // 监听数据可用事件，收集录音数据块
    let dataReceivedCount = 0;
    let totalDataSize = 0;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        dataReceivedCount++;
        totalDataSize += event.data.size;
        // 高频事件：只在 debug 模式下打印，避免日志导致卡顿
        ctx.dlog(
          `[useVoiceRecognition] 收到音频数据块 #${dataReceivedCount}，大小: ${event.data.size} bytes，累计: ${totalDataSize} bytes`,
        );
        ctx.chunksRef.current.push(event.data);
      } else {
        ctx.dlog('[useVoiceRecognition] 收到空的音频数据块');
      }
    };

    // 录音停止时的处理（先定义，稍后会在 start 后包装）
    const handleRecorderStop = createHandleRecorderStop({
      ctx,
      windowFocusedAtStart: _windowFocusedAtStart,
      startCanInsertInThisWindow: _startCanInsertInThisWindow,
      externalSelP: _externalSelP,
    });

    // 保存 recorder 引用并开始录音
    ctx.mediaRecorderRef.current = recorder;

    // stop 可能发生在 MediaRecorder 创建后、start 前；这里再检查一次，避免“松开也开始录音”。
    if (cancelled()) {
      try {
        if (ctx.mediaRecorderRef.current && ctx.mediaRecorderRef.current.state !== 'inactive') {
          ctx.mediaRecorderRef.current.stop();
        }
      } catch {
        //
      }
      ctx.cleanupStream();
      ctx.startingRef.current = false;
      return;
    }

    await startRecorderWithMonitoring({
      recorder,
      timeSlice,
      dlog: ctx.dlog,
      debugEnabled: ctx.VOICE_DEBUG,
      chunksRef: ctx.chunksRef,
      sessionStartedAtRef: ctx.sessionStartedAtRef,
      handleRecorderStop,
      recordingRef: ctx.recordingRef,
      setRecording: ctx.setRecording,
      setStarting: ctx.setStarting,
      startingRef: ctx.startingRef,
      startingAtRef: ctx.startingAtRef,
      sendFeedback: ctx.sendFeedback,
      sendIndicatorSet: ctx.sendIndicatorSet,
    });
  } catch (err: any) {
    console.error('[useVoiceRecognition] 开始录音失败:', err);
    const errorMessage = resolveStartRecordingErrorMessage(err);

    ctx.setError(errorMessage);
    ctx.toastErrorOnIndicator?.(errorMessage);
    ctx.sendFeedback({
      type: 'recognition-error',
      message: errorMessage,
    });
    ctx.desiredRecordingRef.current = false;
    ctx.recordingRef.current = false;
    ctx.setStarting(false);
    ctx.startingRef.current = false;
    ctx.startingAtRef.current = 0;
    ctx.setIndicatorPreviewText?.('');
    ctx.cleanupStream();
  }
}
