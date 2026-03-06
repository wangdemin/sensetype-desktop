export type RecognitionRoute = 'sse' | 'ws';

export function normalizeRecognitionRoute(input: unknown): RecognitionRoute {
  return input === 'ws' ? 'ws' : 'sse';
}

export function resolveRecognitionRouteByHotkeyMode(hotkeyMode: unknown): RecognitionRoute {
  return String(hotkeyMode || '').toLowerCase() === 'combo' ? 'ws' : 'sse';
}

export function resolveRecognitionRouteByTrigger(trigger: unknown): RecognitionRoute {
  return String(trigger || '').toLowerCase() === 'global-hotkey-combo' ? 'ws' : 'sse';
}

