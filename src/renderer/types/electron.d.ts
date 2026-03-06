declare global {
  interface Window {
    electronAPI: any; // preload 暴露的 API，先用 any 兜底
    sensetype: any; // 现有 sensetype API 保持 any
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export {};
