// sensetype-keyhook-win 的 TypeScript 类型定义。
// 消除调用方在每个使用处重复声明接口的问题。

export interface KeyhookOptions {
  /** 长按触发延迟（毫秒），默认 120 */
  delayMs?: number;
  /**
   * 长按键选择。
   * 字符串值: "alt" | "ralt" | "rightalt" | "right_alt" | "rmenu"
   *          | "control" | "ctrl" | "rctrl" | "rightctrl" | "right_ctrl"
   *          | "shift" | "rshift" | "rightshift" | "right_shift"
   *          | "win" | "command" | "cmd"
   *          | "lalt" | "leftalt" | "left_alt"
   *          | "lctrl" | "leftctrl" | "left_ctrl"
   *          | "lshift" | "leftshift" | "left_shift"
   *          | "lwin" | "leftwin" | "left_win"
   * 数字值: 0=alt, 1=ctrl, 2=shift, 3=win, 4=右shift, 5=右ctrl, 6=右alt,
   *         7=左alt, 8=左ctrl, 9=左shift, 10=左win
   */
  key?: string | number;
  /** 是否启用 Ctrl+Win 组合键切换录音，默认 true */
  comboEnabled?: boolean;
  /** 初始切换状态（用于跨重启保持），默认 false */
  initialToggleState?: boolean;
}

export interface KeyhookEvent {
  type: 'start' | 'stop' | 'cancel';
}

/** 启动全局键盘钩子。返回是否成功。 */
export function start(options: KeyhookOptions, onEvent: (event: KeyhookEvent) => void): boolean;

/** 停止全局键盘钩子。 */
export function stop(): void;

/** 钩子是否正在运行。 */
export function isRunning(): boolean;

/** 长按键是否物理按下（通过 GetAsyncKeyState 检测）。 */
export function isHoldDown(): boolean;

/** 模拟 Ctrl+V 粘贴到前台应用。 */
export function sendPaste(): boolean;

/** 模拟 Ctrl+C 从前台应用复制。 */
export function sendCopy(): boolean;

/** 通过 KEYEVENTF_UNICODE 注入文本到前台应用。 */
export function sendText(text: string): boolean;

/** 通过 PostMessage(WM_CHAR) 注入文本（适用于微信/钉钉等聊天应用）。 */
export function sendTextWmChar(text: string): boolean;

/** 模拟 Shift+Enter（聊天应用中换行而不发送）。 */
export function sendShiftEnter(): boolean;

/** 获取前台窗口进程名（如 "WeChat.exe"）。 */
export function getForegroundProcessName(): string;

/** 获取前台窗口进程完整路径。 */
export function getForegroundProcessPath(): string;

/** 获取前台窗口类名（如 "WeChatMainWndForPC"）。 */
export function getForegroundWindowClassName(): string;

/** 强制重置内部状态并释放所有修饰键。 */
export function forceReset(): boolean;

/** 返回编译时版本字符串。 */
export function version(): string;
