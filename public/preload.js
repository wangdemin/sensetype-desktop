/* global require, window, sensetype */
/* eslint-disable @typescript-eslint/no-require-imports */
const { ipcRenderer, shell } = require('electron');
const os = require('os');
const { screen, app } = require('@electron/remote');

const randomHex = (bytes) => {
  const arr = new Uint8Array(bytes);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const createTraceparent = () => `00-${randomHex(16)}-${randomHex(8)}-01`;

const getIpcEndpoint = (channel, args) => {
  const first = args && args.length ? args[0] : null;
  if (channel === 'msg-trigger' && first && typeof first === 'object' && first.type) {
    return String(first.type);
  }
  if (first && typeof first === 'object' && first.url) {
    return String(first.url);
  }
  return channel;
};

const appendTraceparentToArgs = (args, traceparent) => {
  if (!args || !args.length) return args;
  const [first, ...rest] = args;
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const existing = typeof first.traceparent === 'string' ? first.traceparent.trim() : '';
    return [{ ...first, traceparent: existing || traceparent }, ...rest];
  }
  return args;
};

const logTraceparent = (channel, endpoint, traceparent) => {
  console.log(`[traceparent][IPC] ${channel} ${endpoint} -> ${traceparent}`);
};

const tracedIpcRenderer = {
  // EventEmitter methods live on ipcRenderer's prototype and are not enumerable.
  // Expose bound versions explicitly so renderer code can safely call on/off/once.
  on(channel, listener) {
    return ipcRenderer.on(channel, listener);
  },
  off(channel, listener) {
    return ipcRenderer.off(channel, listener);
  },
  once(channel, listener) {
    return ipcRenderer.once(channel, listener);
  },
  removeListener(channel, listener) {
    return ipcRenderer.removeListener(channel, listener);
  },
  send(channel, ...args) {
    const first = args && args.length ? args[0] : null;
    const existing = first && typeof first === 'object' ? String(first.traceparent || '').trim() : '';
    const traceparent = existing || createTraceparent();
    const endpoint = getIpcEndpoint(channel, args);
    logTraceparent(channel, endpoint, traceparent);
    const nextArgs = appendTraceparentToArgs(args, traceparent);
    return ipcRenderer.send(channel, ...nextArgs);
  },
  sendSync(channel, ...args) {
    const first = args && args.length ? args[0] : null;
    const existing = first && typeof first === 'object' ? String(first.traceparent || '').trim() : '';
    const traceparent = existing || createTraceparent();
    const endpoint = getIpcEndpoint(channel, args);
    logTraceparent(channel, endpoint, traceparent);
    const nextArgs = appendTraceparentToArgs(args, traceparent);
    return ipcRenderer.sendSync(channel, ...nextArgs);
  },
  invoke(channel, ...args) {
    const first = args && args.length ? args[0] : null;
    const existing = first && typeof first === 'object' ? String(first.traceparent || '').trim() : '';
    const traceparent = existing || createTraceparent();
    const endpoint = getIpcEndpoint(channel, args);
    logTraceparent(channel, endpoint, traceparent);
    const nextArgs = appendTraceparentToArgs(args, traceparent);
    return ipcRenderer.invoke(channel, ...nextArgs);
  },
};

const ipcSend = (type, data) => {
  tracedIpcRenderer.send('msg-trigger', { type, data });
};
const ipcSendSync = (type, data) => {
  const returnValue = tracedIpcRenderer.sendSync('msg-trigger', {
    type,
    data,
  });
  if (returnValue instanceof Error) throw returnValue;
  return returnValue;
};

// Electron API for sensetype recognition
/** @type {any} */ (window).electronAPI = {
  ipcRenderer: tracedIpcRenderer,
  // sensetype recognition events will be handled through ipcRenderer.on/off
};

// Existing sensetype API
/** @type {any} */ (window).sensetype = {
  hooks: {},
  __event__: {},

  // 窗口交互
  hideMainWindow() {
    ipcSendSync('hideMainWindow');
  },
  showMainWindow() {
    ipcSendSync('showMainWindow');
  },
  showOpenDialog(options) {
    return ipcSendSync('showOpenDialog', options);
  },
  showSaveDialog(options) {
    return ipcSendSync('showSaveDialog', options);
  },

  setExpendHeight(height) {
    ipcSendSync('setExpendHeight', height);
  },

  showNotification(body, clickFeatureCode) {
    ipcSend('showNotification', { body, clickFeatureCode });
  },

  db: {
    put: (data) => ipcSendSync('dbPut', { data }),
    get: (id) => ipcSendSync('dbGet', { id }),
    remove: (doc) => ipcSendSync('dbRemove', { doc }),
    bulkDocs: (docs) => ipcSendSync('dbBulkDocs', { docs }),
    allDocs: (key) => ipcSendSync('dbAllDocs', { key }),
    postAttachment: (docId, attachment, type) =>
      ipcSendSync('dbPostAttachment', { docId, attachment, type }),
    getAttachment: (docId) => ipcSendSync('dbGetAttachment', { docId }),
    getAttachmentType: (docId) => ipcSendSync('dbGetAttachmentType', { docId }),
  },
  dbStorage: {
    setItem: (key, value) => {
      const target = { _id: String(key) };
      const result = ipcSendSync('dbGet', { id: target._id });
      if (result) {
        target._rev = result._rev;
      }
      target.value = value;
      const res = ipcSendSync('dbPut', { data: target });
      if (res.error) throw new Error(res.message);
    },
    getItem: (key) => {
      const res = ipcSendSync('dbGet', { id: key });
      return res && 'value' in res ? res.value : null;
    },
    removeItem: (key) => {
      const res = ipcSendSync('dbGet', { id: key });
      if (res) {
        ipcSendSync('dbRemove', { doc: res });
      }
    },
  },
  isDarkColors() {
    return false;
  },
  getFeatures() {
    return ipcSendSync('getFeatures');
  },
  setFeature(feature) {
    return ipcSendSync('setFeature', { feature });
  },
  screenCapture(cb) {
    if (typeof cb === 'function') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      window.sensetype.hooks.onScreenCapture = ({ data }) => {
        cb(data);
      };
    }
    ipcSendSync('screenCapture');
  },
  removeFeature(code) {
    return ipcSendSync('removeFeature', { code });
  },

  // 系统
  shellOpenExternal(url) {
    shell.openExternal(url);
  },

  isMacOs() {
    return os.type() === 'Darwin';
  },

  isWindows() {
    return os.type() === 'Windows_NT';
  },

  isLinux() {
    return os.type() === 'Linux';
  },

  getArch() {
    return os.arch();
  },

  redirect: (label, payload) => {
    // todo
  },

  shellBeep: () => {
    ipcSend('shellBeep');
  },

  getCursorScreenPoint: () => {
    return screen.getCursorScreenPoint();
  },

  getDisplayNearestPoint: (point) => {
    return screen.getDisplayNearestPoint(point);
  },
};
