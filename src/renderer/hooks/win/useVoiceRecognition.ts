import type { UseVoiceRecognitionOptions, VoiceRecognitionStatus } from '../useVoiceRecognition';
import { useVoiceRecognitionBase } from '../useVoiceRecognition';

export type { UseVoiceRecognitionOptions, VoiceRecognitionStatus } from '../useVoiceRecognition';

const winAdapter = {
  platform: 'win32' as const,
  afterStopRequested: ({
    stopRecording,
    cleanupStream,
    recordingRef,
    startingRef,
    processingRef,
    mediaRecorderRef,
    streamRef,
    setRecording,
  }: any) => {
    // Windows: 延迟兜底 —— 如果正常 stop 流程未能及时完成，强制收口
    setTimeout(() => {
      try {
        if (processingRef?.current) return;
        if (recordingRef.current || startingRef.current) stopRecording();
      } catch { /* */ }
    }, 80);
    setTimeout(() => {
      try {
        // 已进入后处理（转码/请求）时，不做“强制清理”，否则会出现“松开后秒消失且无错误提示”
        if (processingRef?.current) return;
        if (recordingRef.current || startingRef.current) {
          try {
            if (mediaRecorderRef.current?.state !== 'inactive') {
              mediaRecorderRef.current?.stop();
            }
          } catch { /* */ }
          try {
            streamRef.current?.getTracks?.().forEach((t: any) => { try { t.stop(); } catch { /* */ } });
          } catch { /* */ }
          startingRef.current = false;
          recordingRef.current = false;
          setRecording(false);
          cleanupStream();
        }
      } catch { /* */ }
    }, 300);
  },
};

export function useVoiceRecognition(options: UseVoiceRecognitionOptions = {}) {
  return useVoiceRecognitionBase(winAdapter, options);
}
