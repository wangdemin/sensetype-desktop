type GlobalRecordPayload = {
  action?: 'start' | 'stop' | 'cancel';
  eventSeq?: number;
  eventAt?: number;
  source?: string;
};

type SimState = {
  lastSeq: number;
  lastStamp: string;
  accepted: number[];
};

function handleEvent(state: SimState, payload: GlobalRecordPayload): boolean {
  const action = payload.action;
  if (action !== 'start' && action !== 'stop' && action !== 'cancel') return false;
  if (payload.source === 'native-keyhook') {
    const incomingSeq = Number(payload.eventSeq || 0);
    if (incomingSeq > 0) {
      if (incomingSeq <= state.lastSeq) return false;
      state.lastSeq = incomingSeq;
    } else {
      const stamp = `${action}:${String(payload.eventAt || 0)}`;
      if (stamp === state.lastStamp) return false;
      state.lastStamp = stamp;
    }
  }
  state.accepted.push(Number(payload.eventSeq || 0));
  return true;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

function run() {
  const state: SimState = { lastSeq: 0, lastStamp: '', accepted: [] };
  const events: GlobalRecordPayload[] = [
    { action: 'start', source: 'native-keyhook', eventSeq: 1, eventAt: 1000 },
    { action: 'start', source: 'native-keyhook', eventSeq: 1, eventAt: 1001 }, // dup
    { action: 'stop', source: 'native-keyhook', eventSeq: 2, eventAt: 1100 },
    { action: 'start', source: 'native-keyhook', eventSeq: 4, eventAt: 1300 },
    { action: 'cancel', source: 'native-keyhook', eventSeq: 3, eventAt: 1200 }, // out-of-order
    { action: 'start', source: 'native-keyhook', eventAt: 2000 },
    { action: 'start', source: 'native-keyhook', eventAt: 2000 }, // stamp dup
    { action: 'stop', source: 'native-keyhook', eventAt: 2100 },
  ];

  const acceptedMask = events.map((e) => handleEvent(state, e));
  assert(
    JSON.stringify(acceptedMask) === JSON.stringify([true, false, true, true, false, true, false, true]),
    `accepted mask mismatch: ${JSON.stringify(acceptedMask)}`,
  );
  assert(state.lastSeq === 4, `lastSeq expected 4 got ${state.lastSeq}`);
  console.log('[hotkey-seq-sim] ok', { acceptedMask, acceptedSeq: state.accepted });
}

run();
