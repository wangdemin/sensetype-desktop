function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g?.getRandomValues) {
    g.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i += 1) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createTraceparent(): string {
  const version = '00';
  const traceId = randomHex(16);
  const parentId = randomHex(8);
  const flags = '01';
  return `${version}-${traceId}-${parentId}-${flags}`;
}

export function withTraceparentHeader(
  headers?: Record<string, string>,
): { headers: Record<string, string>; traceparent: string } {
  const existing = String(headers?.traceparent || headers?.Traceparent || '').trim();
  const traceparent = existing || createTraceparent();
  return {
    headers: {
      ...(headers || {}),
      traceparent,
    },
    traceparent,
  };
}

export function logTraceparentSend(kind: string, endpoint: string, traceparent: string): void {
  console.log(`[traceparent][${kind}] ${endpoint} -> ${traceparent}`);
}
