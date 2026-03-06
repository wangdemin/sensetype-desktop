#include "win_utils.h"

#if defined(SENSETYPE_KEYHOOK_WIN)

#include <vector>

// ─── 修饰键管理 ───

void ReleaseAllModifiersToOS() {
  // 安全阀：确保所有修饰键都被释放，即使我们在某处吞掉了 keyup。
  // 对 Alt / 右 Alt (AltGr) 场景尤为重要，否则 OS/应用会表现异常。
  INPUT ins[12] = {};
  int n = 0;
  auto addUp = [&](WORD vk) {
    INPUT in = {};
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = KEYEVENTF_KEYUP;
    ins[n++] = in;
  };
  addUp(VK_LMENU);
  addUp(VK_RMENU);
  addUp(VK_MENU);
  addUp(VK_LCONTROL);
  addUp(VK_RCONTROL);
  addUp(VK_CONTROL);
  addUp(VK_LSHIFT);
  addUp(VK_RSHIFT);
  addUp(VK_SHIFT);
  addUp(VK_LWIN);
  addUp(VK_RWIN);
  SendInput(n, ins, sizeof(INPUT));
}

void InjectAltUpToOS() {
  INPUT in = {};
  in.type = INPUT_KEYBOARD;
  in.ki.wVk = VK_MENU;
  in.ki.dwFlags = KEYEVENTF_KEYUP;
  SendInput(1, &in, sizeof(INPUT));
}

// ─── 快捷键模拟 ───

bool SendCtrlCombo(WORD keyVk) {
  INPUT ins[4] = {};
  int n = 0;
  auto add = [&](WORD vk, DWORD flags) {
    INPUT in = {};
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = flags;
    ins[n++] = in;
  };
  add(VK_CONTROL, 0);
  add(keyVk, 0);
  add(keyVk, KEYEVENTF_KEYUP);
  add(VK_CONTROL, KEYEVENTF_KEYUP);
  return SendInput(n, ins, sizeof(INPUT)) == (UINT)n;
}

// ─── 宽字符转 UTF-8 ───

std::string WideToUtf8(const wchar_t* str, int len) {
  if (!str || len <= 0) return std::string();
  const int outLen = WideCharToMultiByte(CP_UTF8, 0, str, len, nullptr, 0, nullptr, nullptr);
  if (outLen <= 0) return std::string();
  std::string out(static_cast<size_t>(outLen), '\0');
  WideCharToMultiByte(CP_UTF8, 0, str, len, &out[0], outLen, nullptr, nullptr);
  return out;
}

std::string WideToUtf8(const std::wstring& w) {
  return WideToUtf8(w.c_str(), static_cast<int>(w.size()));
}

// ─── 前台窗口信息 ───

// 内部 helper：获取前台窗口进程的完整映像路径（宽字符）。
// 使用 MAX_PATH 缓冲区，不足时自动扩容到堆上。
static std::wstring QueryForegroundProcessImagePathW() {
  HWND hwnd = GetForegroundWindow();
  if (!hwnd) return std::wstring();

  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (!pid) return std::wstring();

  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return std::wstring();

  // 先用栈上 MAX_PATH 大小的缓冲区尝试
  wchar_t stackBuf[MAX_PATH] = {0};
  DWORD bufSize = MAX_PATH;
  if (QueryFullProcessImageNameW(h, 0, stackBuf, &bufSize) && bufSize > 0) {
    CloseHandle(h);
    return std::wstring(stackBuf, bufSize);
  }

  // MAX_PATH 不够时，用堆缓冲区重试（极少见，如长路径）
  const DWORD heapSize = 4096;
  std::wstring heapBuf(heapSize, L'\0');
  bufSize = heapSize;
  BOOL ok = QueryFullProcessImageNameW(h, 0, &heapBuf[0], &bufSize);
  CloseHandle(h);
  if (ok && bufSize > 0) {
    heapBuf.resize(bufSize);
    return heapBuf;
  }
  return std::wstring();
}

std::string GetForegroundProcessImagePath() {
  std::wstring path = QueryForegroundProcessImagePathW();
  if (path.empty()) return std::string();
  return WideToUtf8(path);
}

// ─── api.h 中声明的公共接口实现 ───

#include "api.h"

bool SendPasteShortcut() {
  return SendCtrlCombo(static_cast<WORD>(0x56) /* 'V' */);
}

bool SendCopyShortcut() {
  return SendCtrlCombo(static_cast<WORD>(0x43) /* 'C' */);
}

bool SendShiftEnterToActiveApp() {
  INPUT ins[4] = {};
  int n = 0;
  auto add = [&](WORD vk, DWORD flags) {
    INPUT in = {};
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = flags;
    ins[n++] = in;
  };
  add(VK_SHIFT, 0);
  add(VK_RETURN, 0);
  add(VK_RETURN, KEYEVENTF_KEYUP);
  add(VK_SHIFT, KEYEVENTF_KEYUP);
  return SendInput(n, ins, sizeof(INPUT)) == (UINT)n;
}

bool SendTextToActiveApp(const std::u16string& text) {
  if (text.empty()) return true;

  // 使用 KEYEVENTF_UNICODE 绕过修饰键/键盘布局/IME。
  // 每个 UTF-16 码元生成一对 keydown + keyup 事件。
  //
  // 重要（修复微信/钉钉标点重复/丢字 bug）：
  // keyup 事件的 wScan 必须为 0，不能复制 keydown 的扫描码。
  // 某些应用（微信、钉钉）会错误地将 keyup 的扫描码当作字符输入，导致标点重复。
  //
  // Windows SendInput 单次调用有约 10000 个 INPUT 的限制，
  // 对超长文本分批发送。
  static constexpr size_t kBatchSize = 4096;
  std::vector<INPUT> ins;
  ins.reserve((std::min)(text.size(), kBatchSize) * 2);

  for (size_t offset = 0; offset < text.size(); offset += kBatchSize) {
    const size_t end = (std::min)(offset + kBatchSize, text.size());
    ins.clear();
    for (size_t i = offset; i < end; i++) {
      INPUT down = {};
      down.type = INPUT_KEYBOARD;
      down.ki.wScan = static_cast<WORD>(text[i]);
      down.ki.dwFlags = KEYEVENTF_UNICODE;
      INPUT up = {};
      up.type = INPUT_KEYBOARD;
      up.ki.wScan = 0; // 故意置零 — 防止 Chromium 系应用字符重复
      up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      ins.push_back(down);
      ins.push_back(up);
    }
    const UINT sent = SendInput(static_cast<UINT>(ins.size()), ins.data(), sizeof(INPUT));
    if (sent != static_cast<UINT>(ins.size())) return false;
  }
  return true;
}

// 替代注入方式：通过 PostMessage(WM_CHAR) 直接发送字符消息。
// 绕过整个 KEYEVENTF_UNICODE / VK_PACKET / TranslateMessage 管线。
//
// 为什么能修复微信/钉钉标点 bug：
// KEYEVENTF_UNICODE 会产生 WM_KEYDOWN(VK_PACKET) + WM_CHAR + WM_KEYUP(VK_PACKET)。
// 目标应用可能误解 VK_PACKET 序列，导致某些字符（尤其是中文标点）被重复插入。
// 直接 PostMessage WM_CHAR 时，应用只收到字符消息，没有 keydown/keyup 可误解。
//
// JS 层对检测到的聊天应用（微信、钉钉、企业微信、飞书）使用此方式。
bool SendTextViaWmChar(const std::u16string& text) {
  if (text.empty()) return true;

  HWND fg = GetForegroundWindow();
  if (!fg) return false;

  // 附加到前台窗口线程以获取焦点子窗口。
  // 必须这样做，因为 GetFocus() 只返回调用线程消息队列内的焦点。
  DWORD fgTid = GetWindowThreadProcessId(fg, nullptr);
  DWORD myTid = GetCurrentThreadId();

  BOOL attached = AttachThreadInput(myTid, fgTid, TRUE);
  HWND focused = GetFocus();
  if (attached) AttachThreadInput(myTid, fgTid, FALSE);

  // 如果无法确定焦点子窗口，回退到顶层前台窗口
  if (!focused) focused = fg;

  for (size_t i = 0; i < text.size(); i++) {
    if (!PostMessageW(focused, WM_CHAR, static_cast<WPARAM>(text[i]), 0)) {
      return false;
    }
  }
  return true;
}

std::string GetForegroundProcessNameUtf8() {
  std::wstring path = QueryForegroundProcessImagePathW();
  if (path.empty()) return std::string();
  // 提取文件名
  size_t pos = path.find_last_of(L"\\/");
  std::wstring base = (pos == std::wstring::npos) ? path : path.substr(pos + 1);
  return WideToUtf8(base);
}

std::string GetForegroundProcessPathUtf8() {
  return GetForegroundProcessImagePath();
}

std::string GetForegroundWindowClassNameUtf8() {
  HWND hwnd = GetForegroundWindow();
  if (!hwnd) return std::string();
  wchar_t cls[256] = {0};
  int len = GetClassNameW(hwnd, cls, 256);
  if (len <= 0) return std::string();
  return WideToUtf8(cls, len);
}

#endif
