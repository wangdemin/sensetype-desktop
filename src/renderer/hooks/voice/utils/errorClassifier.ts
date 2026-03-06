export type VoiceErrorClassification = {
  isOffline: boolean;
  isNetworkError: boolean;
  isEmptyRecognition: boolean;
  isInsufficientPoints: boolean;
  toastMessage: string;
  toastStatus: 'notice' | 'error';
};

const NETWORK_ERROR_RE =
  /Network Error|网络错误|无网络连接|网络|offline|ERR_NETWORK|Failed to fetch|Load failed|net::|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|超时/i;

export function classifyVoiceError(message: string): VoiceErrorClassification {
  const msg = String(message || '');
  const isOffline =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine === false
      : false;
  const isNetworkError = isOffline || NETWORK_ERROR_RE.test(msg);
  const isEmptyRecognition = /未识别到内容/.test(msg);
  const isInsufficientPoints = /积分不足/.test(msg);
  const toastMessage = isEmptyRecognition
    ? '未识别到内容'
    : isInsufficientPoints
      ? '积分不足'
      : isNetworkError
        ? '无网络连接'
        : '语音识别失败，请重试';

  return {
    isOffline,
    isNetworkError,
    isEmptyRecognition,
    isInsufficientPoints,
    toastMessage,
    toastStatus: isNetworkError || isInsufficientPoints ? 'error' : 'notice',
  };
}
