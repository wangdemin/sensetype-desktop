import { resolveMacCaptureMicDevice } from '@/renderer/voice/micDevicePolicy';
import {
  createMeetingMinutesWsClient,
  DEFAULT_MEETING_MINUTES_WS_URL,
} from '@/renderer/pages/Meeting/ws/meetingMinutesWs';
import type {
  MeetingRecorderDisplayMode,
  MeetingRecorderEvents,
  MeetingRecorderLiveSegment,
  MeetingRecorderOptions,
  MeetingRecorderStatus,
} from './types';

type IpcRendererLike = {
  send?: (channel: string, ...args: any[]) => void;
  invoke?: (channel: string, ...args: any[]) => Promise<any>;
} | null;

function getIpcRenderer(): IpcRendererLike {
  try {
    return (window as any)?.electronAPI?.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function isMac(): boolean {
  try {
    if ((window as any)?.sensetype?.isMacOs?.() === true) return true;
  } catch {
    // ignore
  }
  try {
    // nodeIntegration on Electron windows

    return typeof process !== 'undefined' && process.platform === 'darwin';
  } catch {
    return false;
  }
}

function isWin(): boolean {
  try {
    if ((window as any)?.sensetype?.isWindows?.() === true) return true;
  } catch {
    // ignore
  }
  try {
    return typeof process !== 'undefined' && process.platform === 'win32';
  } catch {
    return false;
  }
}

async function getSystemAudioStreamViaDesktopCapturer(): Promise<MediaStream> {
  // NOTE:
  // - This uses Electron/Chromium desktop capture pipeline.
  // - On macOS, it relies on ScreenCaptureKit under the hood (Electron 26+),
  //   and requires Screen Recording permission.
  // - On Windows, it can include system audio for desktop sources.
  // - Some environments require requesting video together; we drop video tracks immediately.
  let desktopCapturer: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    desktopCapturer = (require('electron') as any)?.desktopCapturer ?? null;
  } catch {
    desktopCapturer = null;
  }
  if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
    throw new Error('系统声音捕获不可用：desktopCapturer.getSources 不存在');
  }

  const sources = (await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  })) as Array<{ id: string; name: string }>;
  const src = sources?.[0];
  if (!src?.id) throw new Error('无法获取屏幕源（desktopCapturer）');

  // IMPORTANT(mac):
  // - macOS “屏幕录制”权限通常只会在请求 video capture 时触发/出现
  // - 且仅 audio-only 的 desktop capture 在部分环境下拿不到系统音频
  // 所以在 mac 上我们会携带一个极小的 video 约束，然后立刻 stop/remove video track。
  const constraints: any = {
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: src.id,
      },
    },
    ...(isMac()
      ? {
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: src.id,
              maxWidth: 1,
              maxHeight: 1,
              maxFrameRate: 1,
            },
          },
        }
      : {}),
  };

  const stream: MediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  // Drop video immediately (we only need audio)
  try {
    stream.getVideoTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        //
      }
      try {
        stream.removeTrack(t);
      } catch {
        //
      }
    });
  } catch {
    // ignore
  }
  // If we didn't get audio, fail early so caller can fallback/degrade gracefully.
  try {
    if (stream.getAudioTracks().length === 0) {
      try {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            //
          }
        });
      } catch {
        //
      }
      throw new Error('系统声音捕获失败：未获取到音轨（desktopCapturer）');
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
  return stream;
}

async function getSystemAudioStreamViaDisplayMedia(): Promise<MediaStream> {
  // Browser API path (works in Electron too). This typically triggers the macOS Screen Recording prompt
  // via the system screen-sharing picker.
  const md = navigator?.mediaDevices as any;
  if (!md?.getDisplayMedia) {
    throw new Error('系统声音捕获不可用：getDisplayMedia 不存在');
  }
  // IMPORTANT(mac):
  // Many UIs require the user to explicitly enable "Share audio".
  const stream: MediaStream = await md.getDisplayMedia({
    audio: true,
    video: isMac() ? { width: 1, height: 1, frameRate: 1 } : true,
  });
  // Drop video immediately (we only need audio)
  try {
    stream.getVideoTracks().forEach((t: any) => {
      try {
        t.stop();
      } catch {
        //
      }
      try {
        stream.removeTrack(t);
      } catch {
        //
      }
    });
  } catch {
    // ignore
  }
  // If user didn't enable "Share audio" (or Electron didn't provide it), this will be empty.
  try {
    if (stream.getAudioTracks().length === 0) {
      try {
        stream.getTracks().forEach((t: any) => {
          try {
            t.stop();
          } catch {
            //
          }
        });
      } catch {
        //
      }
      throw new Error('系统声音捕获失败：未获取到音轨（getDisplayMedia）');
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
  return stream;
}

type NativeSystemAudioController = {
  stop: () => void;
};

function tryStartNativeSystemAudioCapture(onPcm: (chunk: Float32Array) => void): {
  controller: NativeSystemAudioController;
  sampleRate: number;
} | null {
  // Use dynamic require so bundler won't try to resolve at build-time

  const platformModule = isWin()
    ? 'sensetype-system-audio-win'
    : isMac()
      ? 'sensetype-system-audio-mac'
      : null;
  if (!platformModule) return null;

  let mod: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(platformModule);
  } catch (e: any) {
    // Dev fallback: if pnpm optionalDependencies were not installed (or were skipped),
    // try to load directly from the repo's native folder.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(path.resolve(process.cwd(), 'native', platformModule));
    } catch (e2: any) {
      throw new Error(
        `原生系统声音模块加载失败（${platformModule}）：${String(
          e?.message || e || 'unknown',
        )}；本地路径兜底也失败：${String(e2?.message || e2 || 'unknown')}`,
      );
    }
  }

  const start = mod?.startCapture || mod?.startLoopback || mod?.start;
  const stop = mod?.stopCapture || mod?.stopLoopback || mod?.stop;
  if (typeof start !== 'function' || typeof stop !== 'function') {
    throw new Error(`原生系统声音模块接口缺失（${platformModule}）`);
  }

  try {
    const ret = start({
      // ask for a stable format; native layer may coerce to device mix format
      sampleRate: 48000,
      channels: 1,
      format: 'f32',
      onPcm,
    });
    const sampleRate = typeof ret?.sampleRate === 'number' ? ret.sampleRate : 48000;
    const controller: NativeSystemAudioController = {
      stop: () => {
        try {
          stop();
        } catch {
          // ignore
        }
      },
    };
    return { controller, sampleRate };
  } catch (e: any) {
    throw new Error(
      `原生系统声音捕获启动失败（${platformModule}）：${String(e?.message || e || 'unknown')}`,
    );
  }
}

function floatToInt16(x: number): number {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
}

function float32ToPcm16Chunk(input: Float32Array, inputSampleRate: number): Int16Array {
  if (!input.length) return new Int16Array(0);
  const targetSampleRate = 16000;
  if (!inputSampleRate || inputSampleRate <= 0) return new Int16Array(0);

  if (inputSampleRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = floatToInt16(input[i] ?? 0);
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    const sample = s0 + (s1 - s0) * frac;
    out[i] = floatToInt16(sample);
  }
  return out;
}

type RecorderWordTs = {
  word?: string;
  start_time?: number;
  end_time?: number;
};

type RecorderFinalData = {
  text?: string;
  translation?: string;
  segment_id?: number;
  timestamp_start?: number;
  timestamp_end?: number;
  words?: RecorderWordTs[];
};

type RecorderSummarySection = {
  heading?: string;
  items?: string[];
};

type RecorderSummaryData = {
  title?: string;
  content?: string;
  sections?: RecorderSummarySection[];
  raw_sentences?: Array<{ text?: string; words?: RecorderWordTs[] }>;
  translated_title?: string;
  translated_content?: string;
  translated_sections?: RecorderSummarySection[];
  summary_index?: number;
  is_final?: boolean;
};

type RecorderTaskPausedData = {
  total_segment_count?: number;
  pre_pause_segment_count?: number;
  new_segments?: RecorderFinalData[];
  summary?: Omit<RecorderSummaryData, 'is_final'>;
};

function toSeconds(ms?: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
  return ms / 1000;
}

function normalizeWord(word: RecorderWordTs): { text: string; start: number; end: number } | null {
  const text = String(word?.word || '').trim();
  if (!text) return null;
  const start = toSeconds(word?.start_time);
  const end = toSeconds(word?.end_time);
  return {
    text,
    start,
    end: end > start ? end : start + 0.01,
  };
}

function normalizeWords(words: RecorderWordTs[] | undefined): Array<{ text: string; start: number; end: number }> {
  if (!Array.isArray(words) || words.length === 0) return [];
  return words.map(normalizeWord).filter((x): x is { text: string; start: number; end: number } => !!x);
}

function applyDisplayMode(
  sourceText: string,
  translationText: string,
  displayMode: MeetingRecorderDisplayMode,
): { text: string; translation?: string } {
  const source = String(sourceText || '').trim();
  const translation = String(translationText || '').trim();
  if (displayMode === 'translated') {
    const text = translation || source;
    return { text, translation: undefined };
  }
  if (displayMode === 'source') {
    return { text: source, translation: undefined };
  }
  return {
    text: source,
    translation: translation || undefined,
  };
}

function emitStatus(
  events: MeetingRecorderEvents,
  status: MeetingRecorderStatus,
  message?: string,
) {
  try {
    events.onStatus?.({ status, message });
  } catch {
    // ignore
  }
}

export type MeetingRecorder = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  isPaused: () => boolean;
  getSessionData: () => {
    createdAt: number;
    endedAt: number;
    transcriptText: string;
    formattedText: string;
    segments: Array<{ text: string; speaker: string }>;
    title?: string;
    keyPoints?: string[];
    wordCount?: number;
    rawFormatResult?: unknown;
  };
  destroy: () => Promise<void>;
};

export function createMeetingRecorder(
  events: MeetingRecorderEvents,
  options: MeetingRecorderOptions = {},
): MeetingRecorder {
  const ipc = getIpcRenderer();

  const cfg: Required<MeetingRecorderOptions> = {
    enableSystemAudio: options.enableSystemAudio !== false,
    enableMicrophone: options.enableMicrophone !== false,
    targetLanguage:
      typeof options.targetLanguage === 'string' ? options.targetLanguage.trim() : '',
    displayMode: options.displayMode || 'source',
  };

  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let silentSource: ConstantSourceNode | null = null;
  let silentGainNode: GainNode | null = null;
  let micStream: MediaStream | null = null;
  let sysStream: MediaStream | null = null;
  let sysNative: { controller: NativeSystemAudioController; sampleRate: number } | null = null;
  let sysPcmQueue: Float32Array[] = [];
  let sysPcmQueueSamples = 0;
  // For resampling native system PCM (if sys sampleRate != audioContext.sampleRate)
  let sysResampleInited = false;
  let sysResampleFrac = 0;
  let sysResampleCurr = 0;
  let sysResampleNext = 0;

  let status: MeetingRecorderStatus = 'idle';
  let stopRequested = false;
  let paused = false;
  let pauseTransition: Promise<void> | null = null;
  let mergedText = '';
  const finalizedSegments: RecorderFinalData[] = [];
  // 用于“会议纪要”接口：累计每次分段完成文本
  const formatSegments: Array<{ text: string; speaker: string }> = [];
  let sessionCreatedAt = 0;
  let sessionEndedAt = 0;
  let lastFormattedText = '';
  let lastFormatResult: unknown = null;
  let wsClient: ReturnType<typeof createMeetingMinutesWsClient> | null = null;
  let wsMode = false;

  const closeWsClient = () => {
    wsMode = false;
    try {
      wsClient?.close();
    } catch {
      // ignore
    }
    wsClient = null;
  };

  const sortFinalizedSegments = () => {
    finalizedSegments.sort((a, b) => {
      const aStart = Number(a?.timestamp_start);
      const bStart = Number(b?.timestamp_start);
      const aHasStart = Number.isFinite(aStart);
      const bHasStart = Number.isFinite(bStart);
      if (aHasStart && bHasStart && aStart !== bStart) return aStart - bStart;

      const aId = Number(a?.segment_id);
      const bId = Number(b?.segment_id);
      const aHasId = Number.isFinite(aId);
      const bHasId = Number.isFinite(bId);
      if (aHasId && bHasId && aId !== bId) return aId - bId;
      if (aHasStart && !bHasStart) return -1;
      if (!aHasStart && bHasStart) return 1;
      if (aHasId && !bHasId) return -1;
      if (!aHasId && bHasId) return 1;
      return 0;
    });
  };

  const findFinalSegmentIndex = (next: RecorderFinalData): number => {
    const nextId = Number(next?.segment_id);
    if (Number.isFinite(nextId)) {
      return finalizedSegments.findIndex((seg) => Number(seg?.segment_id) === nextId);
    }
    const nextStart = Number(next?.timestamp_start);
    const nextEnd = Number(next?.timestamp_end);
    const nextText = String(next?.text || '').trim();
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || !nextText) return -1;
    return finalizedSegments.findIndex(
      (seg) =>
        Number(seg?.timestamp_start) === nextStart &&
        Number(seg?.timestamp_end) === nextEnd &&
        String(seg?.text || '').trim() === nextText,
    );
  };

  const upsertFinalSegment = (
    data: RecorderFinalData,
  ): { changed: boolean; inserted: boolean; text: string } => {
    const text = String(data?.text || '').trim();
    if (!text) return { changed: false, inserted: false, text: '' };
    const normalized: RecorderFinalData = {
      ...data,
      text,
      words: Array.isArray(data?.words) ? data.words : [],
    };
    const idx = findFinalSegmentIndex(normalized);
    if (idx >= 0) {
      finalizedSegments[idx] = {
        ...finalizedSegments[idx],
        ...normalized,
      };
      sortFinalizedSegments();
      return { changed: true, inserted: false, text };
    }
    finalizedSegments.push(normalized);
    sortFinalizedSegments();
    return { changed: true, inserted: true, text };
  };

  const buildMarkdownFromSections = (sections: RecorderSummarySection[]): string => {
    return sections
      .map((section) => {
        const heading = String(section?.heading || '').trim();
        const items = Array.isArray(section?.items)
          ? section.items.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        if (!heading && items.length === 0) return '';
        const title = heading || '会议要点';
        return [`## ${title}`, ...items.map((item) => `- ${item}`)].join('\n');
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  };

  const emitSummary = (data: RecorderSummaryData | undefined) => {
    if (!data) return;
    const sourceTitle = String(data?.title || '').trim();
    const sourceContent = String(data?.content || '').trim();
    const sourceSections = Array.isArray(data?.sections) ? data.sections : [];
    const translatedTitle = String(data?.translated_title || '').trim();
    const translatedContent = String(data?.translated_content || '').trim();
    const translatedSections = Array.isArray(data?.translated_sections) ? data.translated_sections : [];
    const rawSentences = Array.isArray(data?.raw_sentences) ? data.raw_sentences : [];

    const useTranslated = cfg.displayMode === 'translated';
    const displayTitle = useTranslated
      ? translatedTitle || sourceTitle
      : sourceTitle || translatedTitle;
    const displaySections =
      useTranslated
        ? translatedSections.length > 0
          ? translatedSections
          : sourceSections
        : sourceSections.length > 0
          ? sourceSections
          : translatedSections;
    const displayContentRaw = useTranslated
      ? translatedContent || sourceContent
      : sourceContent || translatedContent;
    const displayContent = displayContentRaw || buildMarkdownFromSections(displaySections);

    if (!displayContent && displaySections.length === 0 && !displayTitle) return;

    const wsRaw = {
      result: {
        title: displayTitle || undefined,
        formatted_text: displayContent,
        sections: displaySections,
        raw_sentences: rawSentences,
        summary_index: data?.summary_index,
        is_final: !!data?.is_final,
        source_title: sourceTitle || undefined,
        source_content: sourceContent || undefined,
        source_sections: sourceSections,
        translated_title: translatedTitle || undefined,
        translated_content: translatedContent || undefined,
        translated_sections: translatedSections,
      },
    };

    lastFormattedText = displayContent;
    lastFormatResult = wsRaw;
    try {
      events.onFormatted?.({ formattedText: displayContent, raw: wsRaw });
    } catch {
      // ignore
    }
  };

  const buildLiveSegments = (): MeetingRecorderLiveSegment[] => {
    return finalizedSegments.reduce<MeetingRecorderLiveSegment[]>((acc, seg, index) => {
        const sourceText = String(seg?.text || '').trim();
        if (!sourceText) return acc;
        const words = normalizeWords(seg?.words);
        const start = toSeconds(seg?.timestamp_start);
        const end = Math.max(toSeconds(seg?.timestamp_end), start + 0.01);
        const displayed = applyDisplayMode(sourceText, String(seg?.translation || ''), cfg.displayMode);
        const segmentId = Number(seg?.segment_id);
        acc.push({
          id:
            Number.isFinite(segmentId) && segmentId >= 0
              ? `final-${Math.floor(segmentId)}`
              : `final-${index + 1}`,
          speakerId: 'A',
          text: displayed.text,
          translation: displayed.translation,
          start,
          end,
          words,
        });
        return acc;
      }, []);
  };

  const emitLiveSegments = () => {
    const segments = buildLiveSegments();
    try {
      events.onLiveSegments?.({ segments });
    } catch {
      // ignore
    }
    const transcriptText = segments
      .map((seg) => String(seg?.text || '').trim())
      .filter(Boolean)
      .join('\n');
    mergedText = transcriptText;
  };

  const cleanupStreams = () => {
    const stopStream = (s: MediaStream | null) => {
      if (!s) return;
      try {
        s.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            //
          }
        });
      } catch {
        // ignore
      }
    };
    stopStream(micStream);
    stopStream(sysStream);
    micStream = null;
    sysStream = null;
    try {
      sysNative?.controller?.stop?.();
    } catch {
      //
    }
    sysNative = null;
    sysPcmQueue = [];
    sysPcmQueueSamples = 0;
    sysResampleInited = false;
    sysResampleFrac = 0;
    sysResampleCurr = 0;
    sysResampleNext = 0;
  };

  const cleanupAudioGraph = async () => {
    try {
      processor?.disconnect();
    } catch {
      //
    }
    try {
      dest?.disconnect();
    } catch {
      //
    }
    try {
      silentSource?.stop();
    } catch {
      //
    }
    try {
      silentSource?.disconnect();
    } catch {
      //
    }
    try {
      silentGainNode?.disconnect();
    } catch {
      //
    }
    processor = null;
    dest = null;
    silentSource = null;
    silentGainNode = null;

    try {
      await audioContext?.close();
    } catch {
      //
    }
    audioContext = null;
  };

  const nextSystemSample = (): number => {
    if (sysPcmQueueSamples <= 0 || sysPcmQueue.length === 0) return 0;
    const head = sysPcmQueue[0]!;
    const v = head[0] ?? 0;
    if (head.length <= 1) {
      sysPcmQueue.shift();
    } else {
      sysPcmQueue[0] = head.subarray(1);
    }
    sysPcmQueueSamples -= 1;
    return v;
  };

  const popSystemSamples = (want: number): Float32Array => {
    if (want <= 0) return new Float32Array(0);
    if (sysPcmQueueSamples <= 0) return new Float32Array(want); // zeros
    const out = new Float32Array(want);
    let written = 0;
    while (written < want && sysPcmQueue.length) {
      const head = sysPcmQueue[0]!;
      const take = Math.min(head.length, want - written);
      out.set(head.subarray(0, take), written);
      written += take;
      if (take === head.length) {
        sysPcmQueue.shift();
      } else {
        sysPcmQueue[0] = head.subarray(take);
      }
      sysPcmQueueSamples -= take;
    }
    // remaining stays zero
    return out;
  };

  const popSystemSamplesResampled = (want: number): Float32Array => {
    if (!audioContext || !sysNative) return popSystemSamples(want);
    const outSr = audioContext.sampleRate;
    const inSr = sysNative.sampleRate || 48000;
    if (!outSr || !inSr || outSr === inSr) return popSystemSamples(want);

    const step = inSr / outSr; // input samples per output sample
    const out = new Float32Array(want);

    if (!sysResampleInited) {
      sysResampleCurr = nextSystemSample();
      sysResampleNext = nextSystemSample();
      sysResampleFrac = 0;
      sysResampleInited = true;
    }

    for (let i = 0; i < want; i++) {
      const a = sysResampleCurr;
      const b = sysResampleNext;
      const t = sysResampleFrac;
      out[i] = a + (b - a) * t;

      sysResampleFrac += step;
      while (sysResampleFrac >= 1.0) {
        sysResampleFrac -= 1.0;
        sysResampleCurr = sysResampleNext;
        sysResampleNext = nextSystemSample();
      }
    }
    return out;
  };

  const start = async () => {
    if (status === 'starting' || status === 'recording') return;

    stopRequested = false;
    mergedText = '';
    finalizedSegments.length = 0;
    formatSegments.length = 0;
    lastFormattedText = '';
    lastFormatResult = null;
    closeWsClient();
    paused = false;
    sessionCreatedAt = Date.now();
    sessionEndedAt = 0;

    status = 'starting';
    emitStatus(events, 'starting', '正在初始化音频…');

    // 1) microphone
    if (cfg.enableMicrophone) {
      let micDeviceId: string | null = null;
      try {
        const preferred = (await ipc?.invoke?.('settings-get-preferred-mic')) as
          | { deviceId?: unknown }
          | undefined;
        const d = typeof preferred?.deviceId === 'string' ? preferred.deviceId.trim() : '';
        micDeviceId = d || null;
      } catch {
        // ignore
      }
      if (isMac()) {
        try {
          const resolved = await resolveMacCaptureMicDevice(micDeviceId);
          if (resolved.fallbackApplied && resolved.deviceId) {
            micDeviceId = resolved.deviceId;
            emitStatus(events, 'starting', '检测到蓝牙耳机麦克风，已自动切换到内建麦克风');
          }
        } catch {
          // ignore
        }
      }
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { ideal: micDeviceId } } : true,
      });
      try {
        if (micStream.getAudioTracks().length === 0) throw new Error('未获取到麦克风音轨');
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    // 2) system audio
    if (cfg.enableSystemAudio) {
      try {
        // Native modules (mac/win) call onPcm(payload) where payload is usually:
        // { sampleRate, channels, pcm: Float32Array }
        // But keep backward-compat: allow passing Float32Array directly.
        const onSysPcm = (payload: any) => {
          if (stopRequested) return;
          const sr =
            typeof payload?.sampleRate === 'number' && Number.isFinite(payload.sampleRate)
              ? payload.sampleRate
              : null;
          const pcm = payload instanceof Float32Array ? payload : payload?.pcm;
          if (sysNative && sr) sysNative.sampleRate = sr;
          if (!(pcm instanceof Float32Array)) return;
          if (!pcm.length) return;
          // Keep queue bounded to avoid unbounded memory growth if consumer stalls.
          // Cap ~6 seconds @ 48k.
          const cap = 48000 * 6;
          if (sysPcmQueueSamples > cap) {
            // drop oldest
            sysPcmQueue = sysPcmQueue.slice(-8);
            sysPcmQueueSamples = sysPcmQueue.reduce((s, a) => s + a.length, 0);
          }
          sysPcmQueue.push(pcm);
          sysPcmQueueSamples += pcm.length;
        };

        let nativeErr: unknown = null;
        try {
          // Prefer native capture when available (WASAPI loopback / ScreenCaptureKit).
          sysNative = tryStartNativeSystemAudioCapture(onSysPcm);
        } catch (e) {
          nativeErr = e;
          sysNative = null;
        }

        if (!sysNative) {
          if (isMac()) {
            // macOS:
            // - Electron getDisplayMedia generally cannot provide "system audio" tracks.
            // - Only use it to trigger Screen Recording permission flow, then retry native capture.
            try {
              const md = navigator?.mediaDevices as any;
              if (md?.getDisplayMedia) {
                const tmp: MediaStream = await md.getDisplayMedia({ video: true, audio: false });
                try {
                  tmp.getTracks().forEach((t: any) => {
                    try {
                      t.stop();
                    } catch {
                      //
                    }
                  });
                } catch {
                  //
                }
              }
            } catch {
              // ignore; permission might require manual enable in System Settings
            }

            try {
              sysNative = tryStartNativeSystemAudioCapture(onSysPcm);
            } catch (e) {
              nativeErr = e;
              sysNative = null;
            }

            if (!sysNative) {
              throw new Error(
                `macOS 系统声音不可用：需要原生 ScreenCaptureKit 模块与“屏幕录制”权限（${String(
                  (nativeErr as any)?.message || nativeErr || 'native_unavailable',
                )}）`,
              );
            }
          } else {
            // Fallback A: desktopCapturer (Electron only)
            // Fallback B: getDisplayMedia (needs main-process setDisplayMediaRequestHandler on Electron)
            try {
              sysStream = await getSystemAudioStreamViaDesktopCapturer();
            } catch {
              sysStream = await getSystemAudioStreamViaDisplayMedia();
            }
          }
        }

        // Safety: never try to treat a video-only stream as audio.
        if (sysStream && sysStream.getAudioTracks().length === 0) {
          try {
            sysStream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                //
              }
            });
          } catch {
            //
          }
          sysStream = null;
          throw new Error('系统声音捕获失败：MediaStream 没有音轨');
        }
      } catch (e: any) {
        // Degrade gracefully: keep microphone-only recording.
        sysNative = null;
        sysStream = null;
        sysResampleInited = false;
        sysResampleFrac = 0;
        sysResampleCurr = 0;
        sysResampleNext = 0;
        emitStatus(
          events,
          'starting',
          `系统声音不可用，已降级为仅麦克风（${String(e?.message || e || 'unknown')}）`,
        );
      }
    }

    // 3) audio graph + processor
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        // ignore
      }
    }
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    if (!sysNative) {
      // Stream mixing path (mic + sys as MediaStreams)
      dest = audioContext.createMediaStreamDestination();
      const connectStream = (s: MediaStream | null, gainValue: number) => {
        if (!s) return;
        const src = audioContext!.createMediaStreamSource(s);
        const gain = audioContext!.createGain();
        gain.gain.value = gainValue;
        src.connect(gain);
        gain.connect(dest!);
      };
      connectStream(micStream, 1.0);
      connectStream(sysStream, 0.85);

      const mixedSrc = audioContext.createMediaStreamSource(dest.stream);
      mixedSrc.connect(processor);
    } else {
      // Native PCM mixing path (mic stream only in WebAudio; sys comes from sysPcmQueue)
      if (micStream) {
        const micSrc = audioContext.createMediaStreamSource(micStream);
        micSrc.connect(processor);
      } else {
        // Allow "system-audio-only" mode (e.g. inner option) by feeding a silent signal.
        silentSource = audioContext.createConstantSource();
        silentSource.offset.value = 0;
        silentGainNode = audioContext.createGain();
        silentGainNode.gain.value = 0;
        silentSource.connect(silentGainNode);
        silentGainNode.connect(processor);
        silentSource.start();
      }
    }

    // connect processor to a silent gain to keep graph alive without audible output
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    processor.connect(silent);
    silent.connect(audioContext.destination);

    // 4) 连接会议纪要 WS（仅保留 WS 链路）
    try {
      emitStatus(events, 'starting', '正在连接会议纪要服务…');
      wsClient = createMeetingMinutesWsClient({
        url: DEFAULT_MEETING_MINUTES_WS_URL,
        summaryIntervalS: 30,
        targetLanguage: cfg.targetLanguage,
        onResultFinal: (data: RecorderFinalData) => {
          const merged = upsertFinalSegment(data);
          if (!merged.changed) return;
          emitLiveSegments();
          if (merged.inserted) {
            formatSegments.push({ text: merged.text, speaker: '' });
            try {
              events.onToken?.({ content: merged.text });
            } catch {
              // ignore
            }
            try {
              events.onTranscriptDone?.({ text: merged.text });
            } catch {
              // ignore
            }
          }
        },
        onTaskPaused: (data: RecorderTaskPausedData) => {
          const newSegments = Array.isArray(data?.new_segments) ? data.new_segments : [];
          let changed = false;
          for (const seg of newSegments) {
            const merged = upsertFinalSegment(seg || {});
            changed = changed || merged.changed;
            if (merged.inserted) {
              formatSegments.push({ text: merged.text, speaker: '' });
            }
          }
          if (changed) emitLiveSegments();
          emitSummary(data?.summary);
        },
        onResultSummary: (data: RecorderSummaryData) => {
          emitSummary(data);
        },
        onTaskFailed: (message) => {
          status = 'error';
          emitStatus(events, 'error', message || '会议纪要任务失败');
          try {
            events.onError?.({ message: message || '会议纪要任务失败' });
          } catch {
            // ignore
          }
        },
      });
      await wsClient.connectAndStart();
      wsMode = wsClient.isReady();
      if (wsMode) emitStatus(events, 'starting', '会议纪要服务已连接');
    } catch (e: any) {
      wsMode = false;
      closeWsClient();
      throw new Error(`会议纪要 WS 连接失败：${String(e?.message || e || 'unknown')}`);
    }

    processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      try {
        if (stopRequested || paused) return;
        const input = ev.inputBuffer.getChannelData(0);
        // Copy out, because inputBuffer is reused
        const copy = new Float32Array(input.length);
        copy.set(input);

        // If we have native system PCM, mix it here (simple summation with clamp).
        if (sysNative) {
          const sys = popSystemSamplesResampled(copy.length);
          for (let i = 0; i < copy.length; i++) {
            const mixed = copy[i]! * 1.0 + sys[i]! * 0.85;
            copy[i] = Math.max(-1, Math.min(1, mixed));
          }
        }
        if (!wsMode || !wsClient || !audioContext) return;
        const pcm16 = float32ToPcm16Chunk(copy, audioContext.sampleRate);
        wsClient.sendAudio(pcm16);
      } catch {
        // ignore per-buffer failures
      }
    };

    status = 'recording';
    emitStatus(events, 'recording');
  };

  const stop = async () => {
    if (status === 'idle') return;
    stopRequested = true;
    paused = false;

    emitStatus(events, 'processing', '正在收尾…');
    if (wsClient) {
      try {
        await wsClient.finishTask();
      } catch {
        // ignore
      }
    }
    closeWsClient();

    sessionEndedAt = Date.now();
    cleanupStreams();
    await cleanupAudioGraph();
    status = 'idle';
    emitStatus(events, 'idle');
  };

  const getSessionData = () => {
    const createdAt = sessionCreatedAt || Date.now();
    const endedAt = sessionEndedAt || Date.now();
    const raw = lastFormatResult as any;
    const title = typeof raw?.result?.title === 'string' ? raw.result.title : undefined;
    const keyPoints = Array.isArray(raw?.result?.key_points)
      ? (raw.result.key_points.filter((x: any) => typeof x === 'string') as string[])
      : undefined;
    const wordCount =
      typeof raw?.result?.word_count === 'number' && Number.isFinite(raw.result.word_count)
        ? raw.result.word_count
        : undefined;
    return {
      createdAt,
      endedAt,
      // 以 done 段落为准，避免 token 拼接与 done 追加导致的重复
      transcriptText: formatSegments.length
        ? formatSegments
            .map((s) => String(s?.text || ''))
            .filter(Boolean)
            .join('\n')
        : String(mergedText || ''),
      formattedText: String(lastFormattedText || ''),
      segments: [...formatSegments],
      title,
      keyPoints,
      wordCount,
      rawFormatResult: raw,
    };
  };

  const destroy = async () => {
    try {
      await stop();
    } catch {
      // ignore
    }
    closeWsClient();
  };

  const pause = () => {
    if (pauseTransition) return pauseTransition;
    pauseTransition = (async () => {
      if (status !== 'recording') return;
      if (paused) return;
      if (!wsMode || !wsClient) {
        paused = true;
        emitStatus(events, 'recording', '录音已暂停');
        return;
      }

      emitStatus(events, 'recording', '正在暂停录音…');
      await wsClient.pauseTask();
      paused = true;
      emitStatus(events, 'recording', '录音已暂停');
    })().finally(() => {
      pauseTransition = null;
    });
    return pauseTransition;
  };

  const resume = () => {
    if (pauseTransition) return pauseTransition;
    pauseTransition = (async () => {
      if (status !== 'recording') return;
      if (!paused) return;
      if (!wsMode || !wsClient) {
        paused = false;
        emitStatus(events, 'recording', '录音已继续');
        return;
      }

      emitStatus(events, 'recording', '正在恢复录音…');
      await wsClient.resumeTask();
      paused = false;
      emitStatus(events, 'recording', '录音已继续');
    })().finally(() => {
      pauseTransition = null;
    });
    return pauseTransition;
  };

  const isPaused = () => paused;

  return { start, stop, pause, resume, isPaused, getSessionData, destroy };
}
