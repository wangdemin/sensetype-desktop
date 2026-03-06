import { sendAudioStreamRequest } from '@/axios/http';

export async function runShortRecordingSseOnStop(args: {
  ctx: any;
  mp3Blob: Blob;
  shouldRecordOnly: boolean;
}): Promise<{ result: string; streamedInsertedInThisWindow: boolean }> {
  const { ctx, mp3Blob, shouldRecordOnly } = args;
  const streamedInsertedInThisWindow = false;

  try {
    ctx.setIndicatorPreviewText?.('');
  } catch {
    // ignore
  }

  const ctrl = new AbortController();
  ctx.asrAbortControllerRef.current = ctrl;
  const result = await sendAudioStreamRequest(mp3Blob, {
    recordOnly: shouldRecordOnly,
    enableSop: !shouldRecordOnly,
    signal: ctrl.signal,
    onSop: (p) => {
      console.log('[asr-sse][sop]', p?.action, p?.content);
      if (shouldRecordOnly) return;
      void ctx.handleSopAction(p);
    },
  });

  return { result, streamedInsertedInThisWindow };
}

