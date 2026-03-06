const nightly = 'nightly.';
const staging = 'staging.';
const preview = 'preview.';
const prod = '';

const env = staging;

export default {
  apiBaseUrl: `https://${env}platform.senseaudio.cn`, //接口的地址
  webBaseUrl: `https://${env}senseaudio.cn`, //配置登录网页的跳转地址
  posthogKey: 'phc_oCmQt3UeCVj5VBqt8De534ovs10SkbZmMU2RBfm4t1D', //埋点的key
  posthogHost: 'https://posthog.audiozen.cn',
  wsBaseUrl: `ws://${env}platform.senseaudio.cn`, //ws的地址
  devTools: true, //是否开启开发工具
};
