#include <napi.h>

Napi::Object CreateApi(Napi::Env env);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports = CreateApi(env);
  return exports;
}

NODE_API_MODULE(sensetype_keyhook, Init)


