import { useCallback, useMemo } from 'react';
import 'video.js/dist/video-js.css';
import styles from './index.module.scss';
import PlayIcon from '@/assets/icons/video/play.svg?react';
import PauseIcon from '@/assets/icons/video/pause.svg?react';
import LoadingIcon from '@/assets/icons/video/loading.svg?react';
import useVideoPlayer from '@/renderer/pages/Home/HowToUseVideoModal/video/useVideoPlayer';

export type HowToUseVideoModalProps = {
  open: boolean;
  onClose: () => void;
  videoSrc: string;
};

const HowToUseVideoModal = ({ open, onClose, videoSrc }: HowToUseVideoModalProps) => {
  const baseOptions = useMemo(
    () => ({
      autoplay: false,
      controls: true,
      preload: 'auto',
      fluid: false,
      fill: true,
      playsinline: true,
      controlBar: {
        pictureInPictureToggle: false,
        volumePanel: { inline: false },
        fullscreenToggle: false,
      },
    }),
    [],
  );

  const { videoElRef, playerRef, setIsEnded, isPlaying, isLoading } = useVideoPlayer({
    open,
    videoSrc,
    options: baseOptions,
  });

  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current) return;
    if (playerRef.current.paused()) {
      setIsEnded(false);
      playerRef.current.play();
      return;
    }
    playerRef.current.pause();
  }, [playerRef, setIsEnded]);

  const closeModal = useCallback(() => {
    playerRef.current?.pause();
    onClose();
  }, [onClose, playerRef]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={closeModal}
      onKeyDown={(e) => e.key === 'Escape' && closeModal()}
      role="dialog"
      aria-modal="true"
      aria-label="如何使用视频"
      tabIndex={-1}
    >
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <div className={styles.player}>
          <div data-vjs-player className={styles.playerInner}>
            <video
              ref={videoElRef}
              className="video-js vjs-big-play-centered"
              disablePictureInPicture
              disableRemotePlayback
              controls
            />
          </div>
          {!isLoading && (
            <button
              type="button"
              className={styles.customPlayButton}
              onClick={handleTogglePlay}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
            >
              <div className={styles.customPlayButtonInner}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </div>
            </button>
          )}
          {isLoading && (
            <div className={styles.loadingMask}>
              <LoadingIcon />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HowToUseVideoModal;
