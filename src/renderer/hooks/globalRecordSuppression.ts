const INIT_KEY_TEST_SUPPRESS_RECORDING_FLAG = '__sensetype_init_key_test_suppress_recording__';

type RuntimeWindow = Window & Record<string, unknown>;

export function setInitKeyTestSuppressRecording(suppressed: boolean): void {
  try {
    (window as RuntimeWindow)[INIT_KEY_TEST_SUPPRESS_RECORDING_FLAG] = !!suppressed;
  } catch {
    // ignore
  }
}

export function isInitKeyTestSuppressRecording(): boolean {
  try {
    return !!(window as RuntimeWindow)[INIT_KEY_TEST_SUPPRESS_RECORDING_FLAG];
  } catch {
    return false;
  }
}
