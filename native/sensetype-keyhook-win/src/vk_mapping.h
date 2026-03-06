#pragma once

// 按键 ID 到 Windows 虚拟键码 (VK) 的统一映射。
// 消除 IsHoldKey / IsHoldPhysicallyDown / IsHoldKeyDown / ResolvePollHoldVks 中的重复映射逻辑。
//
// 按键 ID 定义:
//   0 = Alt (左/右)
//   1 = Control (左/右)
//   2 = Shift (左/右)
//   3 = Win (左/右)
//   4 = 右 Shift
//   5 = 右 Ctrl
//   6 = 右 Alt
//   7 = 左 Alt
//   8 = 左 Ctrl
//   9 = 左 Shift
//  10 = 左 Win

#if defined(SENSETYPE_KEYHOOK_WIN)

#include <Windows.h>
#include <cstdint>

// 一组关联的虚拟键码，用于轮询和物理按键状态检测。
struct VkSet {
  DWORD primary;    // 主 VK 码（用于检测按键按下）
  DWORD secondary;  // 备选 VK 码（部分驱动会映射到通用键，也用于检测）
  DWORD tertiary;   // 第三备选（0 表示无，用于检测）
  DWORD sibling;    // 同族键（0 表示无）——仅用于 AnyOtherKeyDown 排除，不用于检测按下
};

// 根据按键 ID 解析对应的 VK 码集合。
// 返回 false 表示 key 无效。
// sibling: 右侧单键模式需要排除同族的左侧键，
// 因为 Windows 按右 Ctrl 时 GetAsyncKeyState(VK_LCONTROL) 可能也返回按下。
inline bool ResolveVkSet(uint32_t key, VkSet& out) {
  switch (key) {
    case 0: out = {VK_LMENU,    VK_RMENU,   VK_MENU,    0};          return true;
    case 1: out = {VK_LCONTROL, VK_RCONTROL, VK_CONTROL, 0};          return true;
    case 2: out = {VK_LSHIFT,   VK_RSHIFT,   VK_SHIFT,   0};          return true;
    case 3: out = {VK_LWIN,     VK_RWIN,     0,          0};          return true;
    case 4: out = {VK_RSHIFT,   VK_SHIFT,    0,          VK_LSHIFT};  return true;
    case 5: out = {VK_RCONTROL, VK_CONTROL,  0,          VK_LCONTROL};return true;
    case 6: out = {VK_RMENU,    VK_MENU,     0,          VK_LMENU};   return true;
    case 7: out = {VK_LMENU,    VK_MENU,     0,          VK_RMENU};   return true;
    case 8: out = {VK_LCONTROL, VK_CONTROL,  0,          VK_RCONTROL};return true;
    case 9: out = {VK_LSHIFT,   VK_SHIFT,    0,          VK_RSHIFT};  return true;
    case 10:out = {VK_LWIN,     0,           0,          VK_RWIN};    return true;
    default: out = {0, 0, 0, 0}; return false;
  }
}

// 通过 GetAsyncKeyState 检查指定 VK 是否物理按下。
inline bool IsVkDown(int vk) {
  return (GetAsyncKeyState(vk) & 0x8000) != 0;
}

// 检查 VkSet 中任一键是否物理按下。
// 对于有 sibling 的单侧键（如右 Ctrl），通用 VK（如 VK_CONTROL）在对侧键按下时
// 也会被 GetAsyncKeyState 报告为按下，因此当 sibling 存在且 sibling 按下时，
// 不能信任 secondary/tertiary 的结果——必须只看 primary。
inline bool IsAnyVkDown(const VkSet& vks) {
  if (IsVkDown((int)vks.primary)) return true;
  if (vks.sibling && IsVkDown((int)vks.sibling)) {
    return false;
  }
  if (vks.secondary && IsVkDown((int)vks.secondary)) return true;
  if (vks.tertiary && IsVkDown((int)vks.tertiary)) return true;
  return false;
}

// 根据按键 ID 判断长按键是否物理按下。
// 对右 Alt (key=6) 做了特殊处理：优先检查锁存的 VK，并宽松匹配以兼容 AltGr。
inline bool IsHoldVkDown(uint32_t key, DWORD latchedVk = 0) {
  if (key == 6) {
    // 右 Alt 模式：优先使用锁存的 VK（可能是 VK_RMENU 或 VK_MENU，取决于驱动）
    if (latchedVk && IsVkDown((int)latchedVk)) return true;
    if (IsVkDown(VK_RMENU)) return true;
    if (IsVkDown(VK_MENU)) return true;
    return false;
  }
  VkSet vks;
  if (!ResolveVkSet(key, vks)) return false;
  return IsAnyVkDown(vks);
}

// 白名单：只检查真正对应物理按键的 VK 码。
// 盲扫 0x08~0xFE 不可靠——各种驱动/IME/OEM 软件会让未分配的 VK 码
// （如 0x85 VK_BROWSER_FORWARD）的 GetAsyncKeyState 返回"幽灵"按下状态。
// 锁定键（Caps/Num/Scroll Lock）也不在此列表中，因为 GetAsyncKeyState
// 对它们返回的高位 bit 反映的是切换状态而非物理按下。
static const int kPhysicalVks[] = {
  // 字母 A-Z
  0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,
  0x4E,0x4F,0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,
  // 数字 0-9
  0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,
  // F1-F12（F13-F24 不检查：大多数键盘不存在，部分驱动会污染其 GetAsyncKeyState）
  VK_F1,VK_F2,VK_F3,VK_F4,VK_F5,VK_F6,VK_F7,VK_F8,VK_F9,VK_F10,
  VK_F11,VK_F12,
  // 小键盘
  VK_NUMPAD0,VK_NUMPAD1,VK_NUMPAD2,VK_NUMPAD3,VK_NUMPAD4,
  VK_NUMPAD5,VK_NUMPAD6,VK_NUMPAD7,VK_NUMPAD8,VK_NUMPAD9,
  VK_MULTIPLY,VK_ADD,VK_SEPARATOR,VK_SUBTRACT,VK_DECIMAL,VK_DIVIDE,
  // 编辑/导航
  VK_BACK,VK_TAB,VK_RETURN,VK_ESCAPE,VK_SPACE,
  VK_PRIOR,VK_NEXT,VK_END,VK_HOME,
  VK_LEFT,VK_UP,VK_RIGHT,VK_DOWN,
  VK_INSERT,VK_DELETE,
  // 修饰键（会被 holdVks 排除）
  VK_LSHIFT,VK_RSHIFT,VK_LCONTROL,VK_RCONTROL,VK_LMENU,VK_RMENU,
  VK_SHIFT,VK_CONTROL,VK_MENU,VK_LWIN,VK_RWIN,
  // OEM 符号键
  VK_OEM_1,VK_OEM_PLUS,VK_OEM_COMMA,VK_OEM_MINUS,VK_OEM_PERIOD,
  VK_OEM_2,VK_OEM_3,VK_OEM_4,VK_OEM_5,VK_OEM_6,VK_OEM_7,VK_OEM_8,
  VK_OEM_102,
  // 其他常用
  VK_SNAPSHOT,VK_PAUSE,VK_APPS,
};
static const int kPhysicalVksCount = sizeof(kPhysicalVks) / sizeof(kPhysicalVks[0]);

inline bool IsRightAltVkSet(const VkSet& holdVks) {
  return holdVks.primary == VK_RMENU && holdVks.secondary == VK_MENU && holdVks.sibling == VK_LMENU;
}

inline bool IsModifierVk(DWORD vk) {
  return vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL ||
         vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU ||
         vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT ||
         vk == VK_LWIN || vk == VK_RWIN;
}

// 判断是否有除长按键以外的其他键被按下（用于组合键检测）。
// 使用白名单而非盲扫，避免驱动/IME 导致的幽灵按键误判。
inline bool AnyOtherKeyDown(const VkSet& holdVks) {
  const bool rightAltMode = IsRightAltVkSet(holdVks);
  for (int i = 0; i < kPhysicalVksCount; i++) {
    const DWORD vk = (DWORD)kPhysicalVks[i];
    if (vk == holdVks.primary || vk == holdVks.secondary ||
        vk == holdVks.tertiary || (holdVks.sibling && vk == holdVks.sibling))
      continue;
    // AltGr 兼容：右 Alt 模式下忽略所有修饰键，避免输入法/布局带来的隐式修饰键误判。
    if (rightAltMode && IsModifierVk(vk)) {
      continue;
    }
    if (IsVkDown((int)vk)) return true;
  }
  return false;
}

// 调试版本：返回第一个被检测为按下的"其他键" VK 码（0 表示无）。
inline DWORD AnyOtherKeyDownDebug(const VkSet& holdVks) {
  const bool rightAltMode = IsRightAltVkSet(holdVks);
  for (int i = 0; i < kPhysicalVksCount; i++) {
    const DWORD vk = (DWORD)kPhysicalVks[i];
    if (vk == holdVks.primary || vk == holdVks.secondary ||
        vk == holdVks.tertiary || (holdVks.sibling && vk == holdVks.sibling))
      continue;
    if (rightAltMode && IsModifierVk(vk)) {
      continue;
    }
    if (IsVkDown((int)vk)) return vk;
  }
  return 0;
}

// 便捷查询函数
inline bool IsDedicatedRightAltMode(uint32_t key) { return key == 6; }
inline bool IsDedicatedLeftAltMode(uint32_t key) { return key == 7; }
inline bool IsAnyAltHoldMode(uint32_t key) { return key == 0 || key == 6 || key == 7; }
inline bool IsWinMode(uint32_t key) { return key == 3 || key == 10; }

// 所有键统一使用轮询模式——WH_KEYBOARD_LL 在锁屏/焦点切换等场景不可靠，
// 且部分修饰键的 keyup 事件容易丢失。轮询模式通过 GetAsyncKeyState 直接检测物理状态。
inline bool ShouldUsePollMode(uint32_t key) { return key <= 10; }

#endif
