#include "../src/intercept_policy.h"

#include <cstdlib>
#include <iostream>

namespace {

void Expect(bool condition, const char* message) {
  if (!condition) {
    std::cerr << "FAILED: " << message << std::endl;
    std::exit(1);
  }
}

}  // namespace

int main() {
  Expect(!ShouldReportHookRunning(true, 0), "pending hook must not report running");
  Expect(!ShouldReportHookRunning(true, -1), "failed hook must not report running");
  Expect(ShouldReportHookRunning(true, 1), "installed hook must report running");

  Expect(ShouldSwallowKeyboardEvent({0, false, false, true, false}),
         "alt keydown must be swallowed immediately");
  Expect(ShouldSwallowKeyboardEvent({3, false, false, true, false}),
         "win keydown must be swallowed immediately");
  Expect(!ShouldSwallowKeyboardEvent({5, false, false, true, false}),
         "right ctrl hold keydown should not be force-swallowed");

  Expect(ShouldSwallowKeyboardEvent({6, true, false, false, true}),
         "right alt implicit ctrl must be swallowed during pending hold");
  Expect(ShouldSwallowKeyboardEvent({3, true, false, false, false}),
         "win hold should swallow companion keys before start");
  Expect(!ShouldSwallowKeyboardEvent({5, true, false, false, false}),
         "non-system hold should not swallow other keys before start");

  Expect(ShouldSwallowKeyboardEvent({5, true, true, false, false}),
         "started recording should swallow other keys");
  Expect(!ShouldSwallowKeyboardEvent({6, false, false, false, false}),
         "no active hold should not swallow unrelated keys");

  std::cout << "intercept_policy_test passed" << std::endl;
  return 0;
}
