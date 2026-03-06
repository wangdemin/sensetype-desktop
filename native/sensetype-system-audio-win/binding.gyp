{
  "targets": [
    {
      "target_name": "sensetype_system_audio",
      "sources": [
        "src/addon.cc",
        "src/js_api.cc",
        "src/win_loopback.cc"
      ],
      "defines": [ ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "libraries": [
        "Ole32.lib",
        "Avrt.lib"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/utf-8" ]
        }
      }
    }
  ]
}

