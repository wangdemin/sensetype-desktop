import { useVoiceRecognition } from '@/renderer/hooks/useVoiceRecognition';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import VoiceStatusBar from '@/renderer/components/VoiceStatusBar';

export default function VoiceRecognitionHost() {
  // 必须常驻：负责监听主进程发来的 global-record，并驱动录音/识别/悬浮窗
  const { status } = useVoiceRecognition({ autoInsert: true });
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const holdKeyText = isWin && !isMac ? '右 Alt' : label;

  // 仅开发环境展示 UI；生产环境仍然保留录音逻辑（通过上面的 hook）
  if (!import.meta.env.DEV) return null;
  return <VoiceStatusBar status={status} holdKeyText={holdKeyText} />;
}
