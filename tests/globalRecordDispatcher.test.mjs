import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchGlobalRecord,
  setGlobalRecordListenerReady,
} from '../src/main/common/globalRecordDispatcher.ts';

class MockWebContents {
  #loading = false;
  #destroyed = false;
  #events = new Map();
  sent = [];
  backgroundThrottling = [];

  constructor({ loading = false } = {}) {
    this.#loading = loading;
  }

  isDestroyed() {
    return this.#destroyed;
  }

  isLoading() {
    return this.#loading;
  }

  setLoading(value) {
    this.#loading = value;
  }

  setBackgroundThrottling(value) {
    this.backgroundThrottling.push(value);
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  once(event, handler) {
    this.#events.set(event, handler);
  }

  emit(event) {
    const handler = this.#events.get(event);
    if (!handler) return;
    this.#events.delete(event);
    handler();
  }

  destroy() {
    this.#destroyed = true;
    this.emit('destroyed');
  }
}

class MockBrowserWindow {
  #destroyed = false;

  constructor(webContents) {
    this.webContents = webContents;
  }

  isDestroyed() {
    return this.#destroyed;
  }
}

test('dispatches immediately when renderer listener is ready', () => {
  const wc = new MockWebContents();
  const win = new MockBrowserWindow(wc);

  setGlobalRecordListenerReady(wc, true);
  const sent = dispatchGlobalRecord(win, { action: 'start', hotkeyMode: 'single' });

  assert.equal(sent, true);
  assert.deepEqual(wc.sent, [
    {
      channel: 'global-record',
      payload: { action: 'start', hotkeyMode: 'single' },
    },
  ]);
});

test('queues latest payload until renderer listener reports ready', () => {
  const wc = new MockWebContents();
  const win = new MockBrowserWindow(wc);

  assert.equal(dispatchGlobalRecord(win, { action: 'start' }), false);
  assert.equal(dispatchGlobalRecord(win, { action: 'stop' }), false);
  assert.equal(wc.sent.length, 0);

  setGlobalRecordListenerReady(wc, true);

  assert.deepEqual(wc.sent, [
    {
      channel: 'global-record',
      payload: { action: 'stop' },
    },
  ]);
});

test('flushes pending event after load completes when listener is ready', () => {
  const wc = new MockWebContents({ loading: true });
  const win = new MockBrowserWindow(wc);

  assert.equal(dispatchGlobalRecord(win, { action: 'start' }), false);
  assert.equal(dispatchGlobalRecord(win, { action: 'cancel' }), false);
  assert.equal(wc.sent.length, 0);

  setGlobalRecordListenerReady(wc, true);
  assert.equal(wc.sent.length, 0);

  wc.setLoading(false);
  wc.emit('did-finish-load');

  assert.deepEqual(wc.sent, [
    {
      channel: 'global-record',
      payload: { action: 'cancel' },
    },
  ]);
});

test('disables background throttling before start dispatch when requested', () => {
  const wc = new MockWebContents();
  const win = new MockBrowserWindow(wc);

  setGlobalRecordListenerReady(wc, true);
  dispatchGlobalRecord(win, { action: 'start' }, { disableBackgroundThrottlingForStart: true });

  assert.deepEqual(wc.backgroundThrottling, [false]);
  assert.equal(wc.sent.length, 1);
});
