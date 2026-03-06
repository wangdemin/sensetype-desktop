/* eslint-disable @typescript-eslint/no-require-imports */

export function getKeyhookPackageName(): string {
  return 'sensetype-keyhook-mac';
}

export function tryLoadKeyhook<T = any>(): T | null {
  try {
    // Use dynamic require so optionalDependency doesn't hard-fail at bundle time.
    return require(getKeyhookPackageName()) as T;
  } catch {
    return null;
  }
}
