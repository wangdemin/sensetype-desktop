export type HoldToRecordKeyMac = 'option' | 'control' | 'shift' | 'command';
export type HoldToRecordKeyWin = 'alt' | 'control' | 'shift' | 'win' | 'rshift' | 'rctrl' | 'ralt' | 'lalt' | 'lctrl' | 'lshift' | 'lwin';

export type HoldToRecordKey = HoldToRecordKeyMac | HoldToRecordKeyWin;
export type HotkeyPlatform = 'mac' | 'win';

export type ToggleToRecordConfig = {
  macMode: 'default' | 'custom';
  macAccelerator: string;
  winAccelerator: string;
};

export type HotkeyValidationResult = {
  blockedReasons: string[];
  warningReasons: string[];
  normalizedAccelerator: string;
};

export const MAC_HOLD_KEYS: HoldToRecordKeyMac[] = ['option', 'control', 'shift', 'command'];
export const WIN_HOLD_KEYS: HoldToRecordKeyWin[] = [
  'alt',
  'control',
  'shift',
  'win',
  'rshift',
  'rctrl',
  'ralt',
  'lalt',
  'lctrl',
  'lshift',
  'lwin',
];

export const DEFAULT_TOGGLE_TO_RECORD: ToggleToRecordConfig = {
  macMode: 'default',
  macAccelerator: 'Control+Space',
  winAccelerator: 'Control+Super',
};

const MODIFIER_ORDER = ['Command', 'Control', 'Alt', 'Shift', 'Super'] as const;
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER);

const KEY_ALIASES: Record<string, string> = {
  cmd: 'Command',
  command: 'Command',
  meta: 'Super',
  win: 'Super',
  windows: 'Super',
  super: 'Super',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  esc: 'Escape',
  return: 'Enter',
  spacebar: 'Space',
  ' ': 'Space',
  plus: '+',
};

const DISPLAY_LABELS: Record<string, string> = {
  Command: 'Cmd',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Win',
  Space: '空格',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  ArrowUp: '上',
  ArrowDown: '下',
  ArrowLeft: '左',
  ArrowRight: '右',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
};

const WIN_BLOCKED_COMBOS = new Set<string>([
  'Alt+Tab',
  'Alt+F4',
  'Control+Alt+Delete',
  'Control+Shift+Escape',
  'Super+L',
  'Super+D',
  'Super+R',
  'Super+X',
  'Super+Tab',
  'Control+Escape',
]);

const MAC_BLOCKED_COMBOS = new Set<string>([
  'Command+Tab',
  'Command+Space',
  'Control+Space',
  'Command+Q',
  'Command+W',
  'Command+M',
  'Command+Option+Escape',
]);

const WIN_WARN_COMBOS = new Set<string>([
  'Control+C',
  'Control+V',
  'Control+X',
  'Control+Z',
  'Control+Y',
  'Control+A',
  'Control+S',
]);

const MAC_WARN_COMBOS = new Set<string>([
  'Command+C',
  'Command+V',
  'Command+X',
  'Command+Z',
  'Command+A',
  'Command+S',
]);

function normalizeToken(token: string): string {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const aliased = KEY_ALIASES[lower] || raw;
  if (/^f\d{1,2}$/i.test(aliased)) return aliased.toUpperCase();
  if (aliased.length === 1 && /[a-z]/i.test(aliased)) return aliased.toUpperCase();
  if (aliased.length === 1 && /\d/.test(aliased)) return aliased;
  if (/^arrow(up|down|left|right)$/i.test(aliased)) {
    const suffix = aliased.slice(5).toLowerCase();
    return `Arrow${suffix[0].toUpperCase()}${suffix.slice(1)}`;
  }
  if (lower === 'escape') return 'Escape';
  if (lower === 'enter') return 'Enter';
  if (lower === 'tab') return 'Tab';
  if (lower === 'space') return 'Space';
  if (lower === 'backspace') return 'Backspace';
  if (lower === 'delete' || lower === 'del') return 'Delete';
  if (lower === 'home') return 'Home';
  if (lower === 'end') return 'End';
  if (lower === 'pageup' || lower === 'pgup') return 'PageUp';
  if (lower === 'pagedown' || lower === 'pgdn') return 'PageDown';
  if (lower === 'insert' || lower === 'ins') return 'Insert';
  if (lower === 'minus') return '-';
  if (lower === 'equal') return '=';
  if (lower === 'backquote') return '`';
  if (lower === 'bracketleft') return '[';
  if (lower === 'bracketright') return ']';
  if (lower === 'backslash') return '\\';
  if (lower === 'semicolon') return ';';
  if (lower === 'quote') return "'";
  if (lower === 'comma') return ',';
  if (lower === 'period') return '.';
  if (lower === 'slash') return '/';
  if (MODIFIER_SET.has(aliased)) return aliased;
  return aliased;
}

export function normalizeAccelerator(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw.trim()) return '';
  const parts = raw
    .split('+')
    .map((s) => normalizeToken(s))
    .filter(Boolean);
  if (!parts.length) return '';

  const uniq = Array.from(new Set(parts));
  const modifiers = MODIFIER_ORDER.filter((m) => uniq.includes(m));
  const others = uniq.filter((p) => !MODIFIER_SET.has(p));
  return [...modifiers, ...others].join('+');
}

export function formatAcceleratorForDisplay(accelerator: string): string {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return '未设置';
  return normalized
    .split('+')
    .map((t) => DISPLAY_LABELS[t] || t)
    .join(' + ');
}

export function normalizeMacHoldKey(v: unknown): HoldToRecordKeyMac {
  if (v === 'option' || v === 'control' || v === 'shift' || v === 'command') return v;
  return 'option';
}

export function normalizeWinHoldKey(v: unknown): HoldToRecordKeyWin {
  if (v === 'rshift') return 'shift';
  if (
    v === 'alt' ||
    v === 'control' ||
    v === 'shift' ||
    v === 'win' ||
    v === 'rctrl' ||
    v === 'ralt' ||
    v === 'lalt' ||
    v === 'lctrl' ||
    v === 'lshift' ||
    v === 'lwin'
  )
    return v;
  return 'ralt';
}

export function describeHoldKeyLabel(platform: HotkeyPlatform, key: HoldToRecordKey): string {
  if (platform === 'mac') {
    if (key === 'option') return 'Option';
    if (key === 'control') return 'Control';
    if (key === 'shift') return 'Shift';
    if (key === 'command') return 'Command';
    return 'Option';
  }
  if (key === 'alt') return 'Alt';
  if (key === 'control') return 'Ctrl';
  if (key === 'shift') return 'Shift';
  if (key === 'win') return 'Win';
  if (key === 'rshift') return 'Shift';
  if (key === 'rctrl') return '右 Ctrl';
  if (key === 'ralt') return '右 Alt';
  if (key === 'lalt') return '左 Alt';
  if (key === 'lctrl') return '左 Ctrl';
  if (key === 'lshift') return '左 Shift';
  if (key === 'lwin') return '左 Win';
  return '右 Alt';
}

export function validateHoldKey(platform: HotkeyPlatform, key: HoldToRecordKey): {
  blockedReasons: string[];
  warningReasons: string[];
} {
  const blockedReasons: string[] = [];
  const warningReasons: string[] = [];
  if (platform === 'mac' && !MAC_HOLD_KEYS.includes(key as HoldToRecordKeyMac)) {
    blockedReasons.push('macOS 长按模式仅支持 Option / Control / Shift / Command。');
    return { blockedReasons, warningReasons };
  }
  if (platform === 'win' && !WIN_HOLD_KEYS.includes(key as HoldToRecordKeyWin)) {
    blockedReasons.push('Windows 长按模式仅支持 Alt/Ctrl/Shift/Win 及右侧修饰键。');
    return { blockedReasons, warningReasons };
  }

  if (platform === 'mac' && key === 'command') {
    warningReasons.push('Command 作为长按键可能与应用常用快捷键冲突。');
  }
  if (platform === 'win' && (key === 'win' || key === 'alt')) {
    warningReasons.push('该键位容易与系统快捷键冲突，建议先测试后使用。');
  }
  return { blockedReasons, warningReasons };
}

function hasModifier(parts: string[]): boolean {
  return parts.some((p) => MODIFIER_SET.has(p));
}

function allModifiers(parts: string[]): boolean {
  return parts.length > 0 && parts.every((p) => MODIFIER_SET.has(p));
}

export function validateToggleAccelerator(
  platform: HotkeyPlatform,
  accelerator: unknown,
): HotkeyValidationResult {
  const blockedReasons: string[] = [];
  const warningReasons: string[] = [];
  const normalized = normalizeAccelerator(accelerator);
  const parts = normalized ? normalized.split('+').filter(Boolean) : [];

  if (!normalized || parts.length < 2) {
    blockedReasons.push('组合键至少需要 2 个按键。');
  }
  if (parts.length > 3) {
    blockedReasons.push('组合键最多支持 3 键。');
  }
  if (!hasModifier(parts)) {
    blockedReasons.push('组合键必须至少包含 Ctrl/Alt/Shift/Win(Command) 中的一个修饰键。');
  }
  const isPlatformDefault =
    (platform === 'win' && normalized === DEFAULT_TOGGLE_TO_RECORD.winAccelerator) ||
    (platform === 'mac' && normalized === DEFAULT_TOGGLE_TO_RECORD.macAccelerator);
  if (allModifiers(parts) && !isPlatformDefault) {
    warningReasons.push('纯修饰键组合容易误触发，建议包含一个普通键。');
  }

  if (platform === 'win' && WIN_BLOCKED_COMBOS.has(normalized)) {
    blockedReasons.push('该组合键属于系统保留快捷键，无法作为唤起键。');
  }
  if (platform === 'mac' && MAC_BLOCKED_COMBOS.has(normalized)) {
    blockedReasons.push('该组合键属于系统保留快捷键，无法作为唤起键。');
  }

  if (platform === 'win' && WIN_WARN_COMBOS.has(normalized)) {
    warningReasons.push('该组合键与高频编辑快捷键冲突，可能影响日常输入。');
  }
  if (platform === 'mac' && MAC_WARN_COMBOS.has(normalized)) {
    warningReasons.push('该组合键与高频编辑快捷键冲突，可能影响日常输入。');
  }
  if (/\+F\d{1,2}$/.test(normalized)) {
    warningReasons.push('F 功能键在部分键盘/远程桌面环境下触发不稳定。');
  }

  return {
    blockedReasons,
    warningReasons,
    normalizedAccelerator: normalized,
  };
}

export function normalizeToggleToRecordConfig(value: unknown): ToggleToRecordConfig {
  const raw =
    value && typeof value === 'object' ? (value as Partial<ToggleToRecordConfig>) : undefined;
  const macMode = raw?.macMode === 'custom' ? 'custom' : 'default';
  const macAccelerator = normalizeAccelerator(raw?.macAccelerator || DEFAULT_TOGGLE_TO_RECORD.macAccelerator);
  const winAccelerator = normalizeAccelerator(raw?.winAccelerator || DEFAULT_TOGGLE_TO_RECORD.winAccelerator);
  return {
    macMode,
    macAccelerator: macAccelerator || DEFAULT_TOGGLE_TO_RECORD.macAccelerator,
    winAccelerator: winAccelerator || DEFAULT_TOGGLE_TO_RECORD.winAccelerator,
  };
}
