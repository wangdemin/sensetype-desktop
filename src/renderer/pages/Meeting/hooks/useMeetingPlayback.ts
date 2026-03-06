import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import config from '@/config';
import { getToken } from '@/utils/auth';
import type { Segment, Word } from '../detail/types';

type UseMeetingPlaybackParams = {
  mode: 'recording' | 'playback';
  duration: number;
  segments: Segment[];
  audioUrl?: string;
};

const CURRENT_TIME_THROTTLE_MS = 100;

function toAbsoluteAudioUrl(rawUrl?: string): string {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url) || /^blob:/i.test(url)) {
    return url;
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  if (url.startsWith('/')) {
    return `${config.apiBaseUrl}${url}`;
  }
  return `${config.apiBaseUrl}/${url.replace(/^\/+/, '')}`;
}

function appendTokenToAudioUrl(rawUrl?: string): string {
  const absolute = toAbsoluteAudioUrl(rawUrl);
  if (!absolute) return '';
  const token = String(getToken() || '').trim();
  if (!token) return absolute;

  try {
    const parsed = new URL(absolute);
    if (!parsed.searchParams.get('token')) {
      parsed.searchParams.set('token', token);
    }
    return parsed.toString();
  } catch {
    const separator = absolute.includes('?') ? '&' : '?';
    return `${absolute}${separator}token=${encodeURIComponent(token)}`;
  }
}

export function useMeetingPlayback({ mode, duration, segments, audioUrl }: UseMeetingPlaybackParams) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCurrentTimeRef = useRef(0);
  const lastCurrentTimeCommitAtRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playableAudioUrl = appendTokenToAudioUrl(audioUrl);
  const hasAudio = mode === 'playback' && Boolean(playableAudioUrl);
  const resolvedDuration = Math.max(duration, mediaDuration, 0);

  const clearCurrentTimeTimer = useCallback(() => {
    if (!currentTimeTimerRef.current) return;
    clearTimeout(currentTimeTimerRef.current);
    currentTimeTimerRef.current = null;
  }, []);

  const commitCurrentTime = useCallback(
    (nextTime: number) => {
      clearCurrentTimeTimer();
      pendingCurrentTimeRef.current = nextTime;
      lastCurrentTimeCommitAtRef.current = Date.now();
      setCurrentTime(nextTime);
    },
    [clearCurrentTimeTimer],
  );

  const scheduleCurrentTimeUpdate = useCallback(
    (nextTime: number) => {
      pendingCurrentTimeRef.current = nextTime;
      const elapsed = Date.now() - lastCurrentTimeCommitAtRef.current;
      if (elapsed >= CURRENT_TIME_THROTTLE_MS) {
        commitCurrentTime(nextTime);
        return;
      }
      if (currentTimeTimerRef.current) return;
      currentTimeTimerRef.current = setTimeout(() => {
        currentTimeTimerRef.current = null;
        lastCurrentTimeCommitAtRef.current = Date.now();
        setCurrentTime(pendingCurrentTimeRef.current);
      }, CURRENT_TIME_THROTTLE_MS - elapsed);
    },
    [commitCurrentTime],
  );

  useEffect(() => {
    if (!hasAudio || !playableAudioUrl) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setMediaDuration(0);
      clearCurrentTimeTimer();
      return;
    }

    const audio = new Audio(playableAudioUrl);
    audio.preload = 'auto';
    audio.playbackRate = speed;
    audio.volume = 1;
    commitCurrentTime(0);

    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setMediaDuration(audio.duration);
      }
    };
    const onTimeUpdate = () => {
      scheduleCurrentTimeUpdate(audio.currentTime || 0);
    };
    const onEnded = () => {
      setIsPlaying(false);
      commitCurrentTime(audio.duration || 0);
    };
    const onError = () => {
      setIsPlaying(false);
      console.error('[meeting-playback] 音频加载失败:', playableAudioUrl);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
      clearCurrentTimeTimer();
    };
  }, [hasAudio, playableAudioUrl, clearCurrentTimeTimer, commitCurrentTime, scheduleCurrentTimeUpdate]);

  useEffect(() => {
    if (mode !== 'playback') {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (hasAudio && audioRef.current) {
      if (!isPlaying) {
        audioRef.current.pause();
      }
      return;
    }

    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + 0.1 * speed;
          if (next >= resolvedDuration) {
            setIsPlaying(false);
            return resolvedDuration;
          }
          return next;
        });
      }, 100);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [mode, hasAudio, isPlaying, speed, resolvedDuration]);

  useEffect(() => {
    if (hasAudio && audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [hasAudio, speed]);

  useEffect(
    () => () => {
      clearCurrentTimeTimer();
    },
    [clearCurrentTimeTimer],
  );

  const setTime = useCallback((nextTime: number) => {
    const safeMax = resolvedDuration > 0 ? resolvedDuration : nextTime;
    const safeTime = Math.max(0, Math.min(nextTime, safeMax));
    commitCurrentTime(safeTime);
    if (hasAudio && audioRef.current) {
      audioRef.current.currentTime = safeTime;
    }
  }, [resolvedDuration, commitCurrentTime, hasAudio]);

  const togglePlay = useCallback(() => {
    const isPlaybackFinished = resolvedDuration > 0 && currentTime >= resolvedDuration - 0.05;

    if (hasAudio && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        return;
      }
      if (isPlaybackFinished) {
        setTime(0);
      }
      void audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((error) => {
          console.error('[meeting-playback] 播放失败:', error);
          setIsPlaying(false);
        });
      return;
    }
    if (isPlaybackFinished) {
      setTime(0);
    }
    setIsPlaying((prev) => !prev);
  }, [resolvedDuration, currentTime, hasAudio, isPlaying, setTime]);

  const seek = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setTime(Number(e.target.value));
  }, [setTime]);

  const activeSegmentId = useMemo(
    () =>
      mode === 'playback'
        ? segments.find((seg) => currentTime >= seg.start && currentTime < seg.end)?.id ?? null
        : null,
    [mode, segments, currentTime],
  );

  const seekToWord = useCallback((word: Word) => {
    setTime(word.start);
    if (hasAudio && audioRef.current) {
      void audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((error) => {
          console.error('[meeting-playback] 词跳转后播放失败:', error);
          setIsPlaying(false);
        });
      return;
    }
    setIsPlaying(true);
  }, [hasAudio, setTime]);

  const seekToSegment = useCallback((start: number) => {
    setTime(start);
  }, [setTime]);

  const progress = resolvedDuration > 0 ? (currentTime / resolvedDuration) * 100 : 0;

  const toggleSpeedMenu = useCallback(() => setShowSpeedMenu((v) => !v), []);
  const selectSpeed = useCallback((nextSpeed: number) => {
    setSpeed(nextSpeed);
    setShowSpeedMenu(false);
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    speed,
    showSpeedMenu,
    toggleSpeedMenu,
    selectSpeed,
    togglePlay,
    seek,
    activeSegmentId,
    seekToWord,
    seekToSegment,
    progress,
    duration: resolvedDuration,
  };
}
