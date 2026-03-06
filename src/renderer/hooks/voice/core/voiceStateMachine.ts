export type VoicePhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'processing'
  | 'sending'
  | 'rewriting'
  | 'stopped';

export type VoiceStateContext = {
  recording: boolean;
  starting: boolean;
  processing: boolean;
  sending: boolean;
  rewriting: boolean;
};

export function deriveVoicePhase(ctx: VoiceStateContext): VoicePhase {
  if (ctx.rewriting) return 'rewriting';
  if (ctx.sending) return 'sending';
  if (ctx.processing) return 'processing';
  if (ctx.recording) return 'recording';
  if (ctx.starting) return 'starting';
  return 'idle';
}

export function hasActiveVoiceSession(ctx: VoiceStateContext): boolean {
  return deriveVoicePhase(ctx) !== 'idle';
}

export function resolveIndicatorPhaseStatus(args: {
  phase: VoicePhase;
  indicatorStatus: 'speaking' | 'silent' | 'loading';
}): 'speaking' | 'silent' | 'loading' {
  const { phase, indicatorStatus } = args;
  if (phase === 'processing' || phase === 'sending' || phase === 'rewriting') return 'loading';
  if (phase === 'recording') return indicatorStatus;
  return 'silent';
}
