export type WinSystemAudioApi = {
  startLoopback: (
    onChunk: (p: { sampleRate: number; channels: number; pcm: Float32Array }) => void,
  ) => boolean;
  stopLoopback: () => void;
};

export function tryLoadWinSystemAudio<T = WinSystemAudioApi>(): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('sensetype-system-audio-win') as T;
  } catch {
    return null;
  }
}
