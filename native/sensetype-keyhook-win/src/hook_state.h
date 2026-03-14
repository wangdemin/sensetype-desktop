#pragma once

// 键盘钩子的全部运行时状态，封装为单一结构体。
// 替代原来散落在文件作用域的 30+ 个全局 atomic 变量。

#if defined(SENSETYPE_KEYHOOK_WIN)

#include <Windows.h>
#include <atomic>
#include <thread>
#include <cstdint>

class EventBridge; // 前向声明，避免循环依赖

struct HookState {
  // ─── 核心运行状态 ───
  HHOOK hook = nullptr;
  std::atomic<bool> running{false};
  std::atomic<int>  hookInstallState{0}; // 0=待定, 1=安装成功, -1=安装失败
  std::thread hookThread;
  DWORD hookThreadId = 0;

  // ─── 长按键状态 ───
  std::atomic<bool> holdDown{false};        // 长按键是否按下（原 g_altDown）
  std::atomic<bool> started{false};         // 是否已触发录音开始
  std::atomic<bool> inCombo{false};         // 是否检测到组合键（取消录音）
  std::atomic<int>  otherKeyDownCount{0};   // 非长按键的按下计数（原 g_nonAltDownCount）
  std::atomic<uint64_t> holdDownTick{0};    // 长按键按下时的 tick（原 g_altDownTick）
  std::atomic<uint64_t> seq{0};             // 序列号，用于取消待定的延迟启动
  std::atomic<DWORD> holdVk{0};             // 锁存的长按键 VK 码（用于稳健的 keyup 匹配）
  std::atomic<bool> holdKeyInjected{false}; // 是否注入过 Alt 键事件（原 g_altInjected）
  std::atomic<bool> systemHoldInterceptActive{false}; // hook 侧立即拦截 Alt/Win 组合，避免等轮询线程

  // ─── 配置 ───
  std::atomic<uint32_t> delayMs{120};
  std::atomic<uint32_t> key{0}; // 0=alt,1=ctrl,2=shift,3=win,4=rshift,5=rctrl,6=ralt
  std::atomic<bool> comboEnabled{true};

  // ─── Ctrl+Win 切换录音状态 ───
  std::atomic<bool> ctrlDown{false};
  std::atomic<bool> winDown{false};
  std::atomic<bool> ctrlWinChord{false};
  std::atomic<bool> ctrlWinSuppressStart{false};
  std::atomic<bool> ctrlWinToggleActive{false};

  // ─── 事件桥接 ───
  EventBridge* bridge = nullptr;

  // ─── 辅助线程 ───
  std::thread pollThread;
  std::atomic<bool> pollRunning{false};
  std::thread holdStateThread;
  std::atomic<bool> holdStateRunning{false};
  std::thread ctrlWinPollThread;
  std::atomic<bool> ctrlWinPollRunning{false};

  // ─── 重置方法 ───

  // 仅重置长按键相关状态（录音会话结束时调用）
  void ResetHold() {
    holdDown.store(false);
    started.store(false);
    inCombo.store(false);
    otherKeyDownCount.store(0);
    holdDownTick.store(0);
    holdVk.store(0);
    systemHoldInterceptActive.store(false);
  }

  // 完全重置所有状态（停止钩子或强制重置时调用）
  void ResetAll() {
    ResetHold();
    holdKeyInjected.store(false);
    ctrlDown.store(false);
    winDown.store(false);
    ctrlWinChord.store(false);
    ctrlWinSuppressStart.store(false);
    ctrlWinToggleActive.store(false);
  }

  // 停止所有辅助线程并等待退出
  void JoinAllThreads() {
    pollRunning.store(false);
    holdStateRunning.store(false);
    ctrlWinPollRunning.store(false);

    if (hookThreadId != 0) {
      PostThreadMessageW(hookThreadId, WM_QUIT, 0, 0);
    }
    if (hookThread.joinable()) hookThread.join();
    if (pollThread.joinable()) pollThread.join();
    if (holdStateThread.joinable()) holdStateThread.join();
    if (ctrlWinPollThread.joinable()) ctrlWinPollThread.join();
    hookThreadId = 0;
  }
};

#endif
