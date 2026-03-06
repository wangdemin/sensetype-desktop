{
  "targets": [
    {
      "target_name": "sensetype_keyhook",
      "sources": [
        "src/addon.cc",
        "src/js_api.cc",
        "src/win_keyhook.cc",
        "src/win_utils.cc"
      ],
      "defines": [ "SENSETYPE_KEYHOOK_WIN=1" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "libraries": [ "User32.lib" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/utf-8" ]
        }
      }
    }
  ]
}


