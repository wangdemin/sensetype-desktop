import type React from 'react';
import { ensureLamejsLoaded } from '@/renderer/voice/audioMp3';

type MutableRef<T> = React.MutableRefObject<T>;

export function createWindowsPreloader(args: {
  audioContextRef: MutableRef<AudioContext | null>;
  micPermissionGrantedRef: MutableRef<boolean | null>;
  micPermissionCheckedAtRef: MutableRef<number>;
  preferredMicDeviceIdRef: MutableRef<string | null>;
  ensureWarmMicStream: (reason: 'startup' | 'after-stop' | 'manual') => Promise<void>;
}) {
  const {
    audioContextRef,
    micPermissionGrantedRef,
    micPermissionCheckedAtRef,
    preferredMicDeviceIdRef,
    ensureWarmMicStream,
  } = args;
  return async () => {
    try {
      ensureLamejsLoaded().catch(() => {});
      if (window.AudioContext || (window as any).webkitAudioContext) {
        try {
          const Ctx = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new Ctx();
          audioContextRef.current = ctx;
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        } catch {
          //
        }
      }
      try {
        const perms: any = (navigator as any)?.permissions;
        const query: any = perms?.query;
        if (typeof query === 'function') {
          const res = await query.call(perms, { name: 'microphone' });
          const state = res?.state;
          if (state === 'granted') {
            micPermissionGrantedRef.current = true;
            micPermissionCheckedAtRef.current = Date.now();
            void ensureWarmMicStream('startup');
          } else if (state === 'denied') {
            micPermissionGrantedRef.current = false;
            micPermissionCheckedAtRef.current = Date.now();
          } else {
            let usedHistoricalGrant = false;
            try {
              const everGranted = localStorage.getItem('SENSETYPE_MIC_GRANTED') === '1';
              if (everGranted) {
                usedHistoricalGrant = true;
                micPermissionGrantedRef.current = true;
                micPermissionCheckedAtRef.current = Date.now();
                void ensureWarmMicStream('startup');
              }
            } catch {
              //
            }
            if (!usedHistoricalGrant) micPermissionGrantedRef.current = null;
          }
        } else {
          try {
            const everGranted = localStorage.getItem('SENSETYPE_MIC_GRANTED') === '1';
            if (everGranted) {
              micPermissionGrantedRef.current = true;
              micPermissionCheckedAtRef.current = Date.now();
              void ensureWarmMicStream('startup');
            }
          } catch {
            //
          }
        }
      } catch {
        //
      }

      try {
        const ipc = (window as any)?.electronAPI?.ipcRenderer;
        if (ipc?.invoke) {
          const v = (await ipc.invoke('settings-get-preferred-mic')) as any;
          const d = typeof v?.deviceId === 'string' ? v.deviceId.trim() : '';
          preferredMicDeviceIdRef.current = d || null;
        }
      } catch {
        //
      }
    } catch {
      //
    }
  };
}

export function createMacPreloader(args: {
  audioContextRef: MutableRef<AudioContext | null>;
  micPermissionGrantedRef: MutableRef<boolean | null>;
  micPermissionCheckedAtRef: MutableRef<number>;
  ensureWarmMicStream: (reason: 'startup' | 'after-stop' | 'manual') => Promise<void>;
}) {
  const {
    audioContextRef,
    micPermissionGrantedRef,
    micPermissionCheckedAtRef,
    ensureWarmMicStream,
  } = args;
  return async (stoppedRef: { current: boolean }) => {
    try {
      ensureLamejsLoaded().catch(() => undefined);
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctx && !audioContextRef.current) {
          const ctx = new Ctx();
          audioContextRef.current = ctx;
          if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
        }
      } catch {
        //
      }
      try {
        const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
        if (ipcRenderer?.invoke) {
          const res = (await ipcRenderer.invoke('check-microphone-permission')) as
            | { granted?: unknown; status?: unknown }
            | undefined;
          if (stoppedRef.current) return;
          const granted = res?.granted === true;
          micPermissionGrantedRef.current = granted;
          micPermissionCheckedAtRef.current = Date.now();
          if (granted) {
            try {
              localStorage.setItem('SENSETYPE_MIC_GRANTED', '1');
            } catch {
              //
            }
            void ensureWarmMicStream('startup');
          }
        } else {
          try {
            const everGranted = localStorage.getItem('SENSETYPE_MIC_GRANTED') === '1';
            if (!stoppedRef.current && everGranted) {
              micPermissionGrantedRef.current = true;
              micPermissionCheckedAtRef.current = Date.now();
              void ensureWarmMicStream('startup');
            }
          } catch {
            //
          }
        }
      } catch {
        //
      }
    } catch {
      //
    }
  };
}
