export type MicResolveResult = {
  deviceId: string | null;
  fallbackApplied: boolean;
  reason?: string;
  fromLabel?: string;
  toLabel?: string;
};

function norm(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

export function isLikelyBluetoothMicLabel(label: string): boolean {
  const s = norm(label);
  if (!s) return false;
  // macOS 常见蓝牙输入设备命名（AirPods/蓝牙免提等）
  return (
    s.includes('airpods') ||
    s.includes('bluetooth') ||
    s.includes('hands-free') ||
    s.includes('handsfree') ||
    s.includes('免提') ||
    s.includes('蓝牙')
  );
}

function isLikelyBuiltInMicLabel(label: string): boolean {
  const s = norm(label);
  if (!s) return false;
  return (
    s.includes('built-in') ||
    s.includes('internal microphone') ||
    s.includes('macbook') ||
    s.includes('内建') ||
    s.includes('内置')
  );
}

export async function resolveMacCaptureMicDevice(
  requestedDeviceId: string | null,
): Promise<MicResolveResult> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter((d) => d.kind === 'audioinput');
    if (!inputs.length) {
      return { deviceId: requestedDeviceId, fallbackApplied: false };
    }

    const reqId = requestedDeviceId ? String(requestedDeviceId).trim() : '';
    const requested =
      reqId && reqId !== 'default' && reqId !== 'communications'
        ? inputs.find((d) => d.deviceId === reqId) || null
        : null;
    const defaultDev = inputs.find((d) => d.deviceId === 'default') || null;
    const source = requested || defaultDev;

    // 如果无法判断来源设备标签，则不强制改动
    if (!source || !isLikelyBluetoothMicLabel(source.label || '')) {
      return { deviceId: requestedDeviceId, fallbackApplied: false };
    }

    const realInputs = inputs.filter((d) => d.deviceId && d.deviceId !== 'default');
    const nonBt = realInputs.filter((d) => !isLikelyBluetoothMicLabel(d.label || ''));
    if (!nonBt.length) {
      return { deviceId: requestedDeviceId, fallbackApplied: false };
    }

    const builtIn = nonBt.find((d) => isLikelyBuiltInMicLabel(d.label || ''));
    const fallback = builtIn || nonBt[0]!;
    return {
      deviceId: fallback.deviceId || null,
      fallbackApplied: true,
      reason: 'bluetooth-input-detected',
      fromLabel: source.label || undefined,
      toLabel: fallback.label || undefined,
    };
  } catch {
    return { deviceId: requestedDeviceId, fallbackApplied: false };
  }
}

