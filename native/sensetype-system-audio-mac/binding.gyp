{
  "targets": [
    {
      "target_name": "sensetype_system_audio",
      "sources": [
        "src/addon.cc",
        "src/js_api.cc",
        "src/mac_sck.mm"
      ],
      "defines": [ "NODE_ADDON_API_CPP_EXCEPTIONS" ],
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
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "OTHER_CPLUSPLUSFLAGS": [ "-std=c++17" ],
        "OTHER_LDFLAGS": [
          "-framework", "Foundation",
          "-framework", "ScreenCaptureKit",
          "-framework", "CoreMedia",
          "-framework", "CoreAudio",
          "-framework", "AVFoundation"
        ]
      },
      "cflags": [
        "-isysroot",
        "<!(xcrun --sdk macosx --show-sdk-path)"
      ],
      "cflags_cc": [
        "-fexceptions",
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

