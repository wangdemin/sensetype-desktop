import type { MicOption } from './hooks/useRecording';

export const MIC_OPTIONS: { value: MicOption; label: string }[] = [
  { value: 'inner+outer', label: '麦克风与系统音频' },
  { value: 'inner', label: '仅系统音频' },
  { value: 'outer', label: '仅麦克风' },
];

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: '英语' },
  { value: 'zh', label: '中文（普通话）' },
  { value: 'ar', label: '阿拉伯语' },
  { value: 'de', label: '德语' },
  { value: 'ru', label: '俄语' },
  { value: 'fr', label: '法语' },
  { value: 'ko', label: '韩语' },
  { value: 'nl', label: '荷兰语' },
  { value: 'ms', label: '马来语' },
  { value: 'pt', label: '葡萄牙语' },
  { value: 'ja', label: '日语' },
  { value: 'th', label: '泰语' },
  { value: 'tr', label: '土耳其语' },
  { value: 'ur', label: '乌尔都语' },
  { value: 'es', label: '西班牙语' },
  { value: 'id', label: '印尼语' },
  { value: 'it', label: '意大利语' },
  { value: 'yue', label: '粤语' },
  { value: 'vi', label: '越南语' },
];

export const PAGE_SIZE = 20;
