{
  "targets": [
    {
      "target_name": "sensetype_keyhook",
      "sources": [
        "src/addon.cc",
        "src/js_api.cc",
        "src/mac_keyhook.mm"
      ],
      "defines": [ "SENSETYPE_KEYHOOK_MAC=1", "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<!(xcrun --sdk macosx --show-sdk-path)/usr/include/c++/v1"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": [ "-std=c++17" ],
        "OTHER_LDFLAGS": [
          "-framework", "ApplicationServices"
        ]
      },
      "cflags": [
        "-isysroot",
        "<!(xcrun --sdk macosx --show-sdk-path)"
      ],
      "cflags_cc": [
        "-isysroot",
        "<!(xcrun --sdk macosx --show-sdk-path)"
      ],
      "ldflags": [
        "-isysroot",
        "<!(xcrun --sdk macosx --show-sdk-path)"
      ]
    }
  ]
}


