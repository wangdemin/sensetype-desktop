#pragma once

// Windows 平台工具函数：文本注入、快捷键模拟、前台窗口检测、修饰键释放。
// 从 win_keyhook.cc 中提取，与钩子逻辑解耦。

#if defined(SENSETYPE_KEYHOOK_WIN)

#include <Windows.h>
#include <string>

// ─── 修饰键管理 ───

// 释放所有修饰键（Alt/Ctrl/Shift/Win），防止按键"卡住"。
void ReleaseAllModifiersToOS();

// 注入一个 Alt 键弹起事件到系统。
void InjectAltUpToOS();

// ─── 快捷键模拟 ───

// 发送 Ctrl+<keyVk> 组合键到前台应用（通过 SendInput，不依赖 PowerShell）。
bool SendCtrlCombo(WORD keyVk);

// ─── 宽字符转 UTF-8 ───

std::string WideToUtf8(const wchar_t* str, int len);
std::string WideToUtf8(const std::wstring& w);

// ─── 前台窗口信息 ───

// 获取前台窗口进程的完整路径（UTF-8）。
// 内部使用 MAX_PATH 大小的缓冲区，避免 64KB 栈分配。
std::string GetForegroundProcessImagePath();

#endif
