/* eslint-disable @typescript-eslint/no-require-imports */

export function getKeyhookPackageName(): string {
  return 'sensetype-keyhook-win';
}

let lastKeyhookLoadError: unknown = null;

export function getLastKeyhookLoadError(): unknown {
  return lastKeyhookLoadError;
}

export function tryLoadKeyhook<T = unknown>(): T | null {
  try {
    lastKeyhookLoadError = null;
    // Use dynamic require so optionalDependency doesn't hard-fail at bundle time.
    return require(getKeyhookPackageName()) as T;
  } catch (e) {
    lastKeyhookLoadError = e;
    return null;
  }
}

export function loadKeyhookOrThrow<T = unknown>(): T {
  const mod = tryLoadKeyhook<T>();
  if (mod) return mod;
  const err = lastKeyhookLoadError;
  throw err instanceof Error ? err : new Error(String(err || 'failed to load native keyhook'));
}
