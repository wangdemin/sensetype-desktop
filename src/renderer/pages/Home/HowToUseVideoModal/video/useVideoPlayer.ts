import { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';

type UseVideoPlayerParams = {
  open: boolean;
  videoSrc: string;
  options: Record<string, unknown>;
};

// 轻量封装 video.js 初始化/销毁逻辑，方便维护与复用
const useVideoPlayer = ({ open, videoSrc, options }: UseVideoPlayerParams) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const [isEnded, setIsEnded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !videoElRef.current || !videoSrc) {
      // 如果没有视频源，显示加载状态
      setIsLoading(!open ? false : !videoSrc);
      return;
    }

    if (!playerRef.current) {
      playerRef.current = videojs(videoElRef.current, options);
    }

    const player = playerRef.current;
    player.src(videoSrc);
    player.load();
    player.currentTime(0);
    player.pause();
    setIsEnded(false);

    // 监听播放结束与再次播放
    const handleEnded = () => {
      setIsEnded(true);
      setIsPlaying(false);
      setIsLoading(false);
    };
    // play 触发时不一定已开始播放（弱网），先进入 loading
    const handlePlay = () => {
      setIsEnded(false);
      setIsPlaying(false);
      setIsLoading(true);
    };
    const handlePlaying = () => {
      setIsEnded(false);
      setIsPlaying(true);
      setIsLoading(false);
    };
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => {
      setIsPlaying(false);
      setIsLoading(true);
    };
    const handleCanPlay = () => setIsLoading(false);
    const handleError = () => {
      setIsPlaying(false);
      setIsLoading(false);
    };
    player.on('ended', handleEnded);
    player.on('play', handlePlay);
    player.on('playing', handlePlaying);
    player.on('pause', handlePause);
    player.on('waiting', handleWaiting);
    player.on('canplay', handleCanPlay);
    player.on('error', handleError);

    return () => {
      player.off('ended', handleEnded);
      player.off('play', handlePlay);
      player.off('playing', handlePlaying);
      player.off('pause', handlePause);
      player.off('waiting', handleWaiting);
      player.off('canplay', handleCanPlay);
      player.off('error', handleError);
    };
  }, [open, videoSrc, options]);

  useEffect(() => {
    if (open) return;
    // 关闭时释放实例，避免内存占用
    playerRef.current?.dispose();
    playerRef.current = null;
    // 关闭时重置状态，避免下次打开按钮残留为暂停
    setIsEnded(false);
    setIsPlaying(false);
    setIsLoading(false);
  }, [open]);

  useEffect(
    () => () => {
      // 组件卸载兜底释放资源
      playerRef.current?.dispose();
      playerRef.current = null;
    },
    [],
  );

  return {
    videoElRef,
    playerRef,
    isEnded,
    setIsEnded,
    isPlaying,
    setIsPlaying,
    isLoading,
  };
};

export default useVideoPlayer;
