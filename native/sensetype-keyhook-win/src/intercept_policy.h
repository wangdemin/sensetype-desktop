#pragma once

#include <cstdint>

struct InterceptDecisionInput {
  uint32_t key = 0;
  bool holdActive = false;
  bool started = false;
  bool isHoldKeyEvent = false;
  bool isImplicitCtrlForRightAlt = false;
};

inline bool IsSystemInterceptionMode(uint32_t key) {
  return key == 0 || key == 3 || key == 6 || key == 7 || key == 10;
}

inline bool ShouldReportHookRunning(bool running, int hookInstallState) {
  return running && hookInstallState == 1;
}

inline bool ShouldSwallowKeyboardEvent(const InterceptDecisionInput& input) {
  if (input.isHoldKeyEvent) {
    return IsSystemInterceptionMode(input.key);
  }
  if (!input.holdActive) {
    return false;
  }
  if (input.started) {
    return true;
  }
  if (input.isImplicitCtrlForRightAlt) {
    return true;
  }
  return IsSystemInterceptionMode(input.key);
}
