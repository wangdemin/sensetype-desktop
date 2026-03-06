import DefaultAvatar from '@/assets/icons/default-avatar.svg?react';
import { useEffect, useMemo, useState } from 'react';
import styles from './index.module.scss';
import AvatarUploadModal from '@/renderer/components/AvatarUploadModal';
import {
  addAvatarUpdatedListener,
  avatarGet,
  getUserKeyFromUserInfo,
  type AvatarInfo,
} from '@/services/avatar';
import { useUserStore } from '@/renderer/store/useUserStore';

export type AvatarProps = {
  className?: string;
  size?: number;
  disabled?: boolean;
  ariaLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disableModal?: boolean;
};

export default function Avatar(props: AvatarProps) {
  const userInfo = useUserStore((s) => s.userInfo);
  const userKey = useMemo(() => getUserKeyFromUserInfo(userInfo), [userInfo]);
  const [internalOpen, setInternalOpen] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const isControlled = typeof props.open === 'boolean';
  const open = isControlled ? !!props.open : internalOpen;

  const setOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    props.onOpenChange?.(nextOpen);
  };

  const applyInfo = (info: AvatarInfo | null) => {
    if (info?.fileUrl) {
      setFileUrl(info.fileUrl);
      setHasExisting(true);
    } else {
      setFileUrl(null);
      setHasExisting(false);
    }
  };

  const fetchAndApply = async () => {
    applyInfo(await avatarGet(userKey));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await avatarGet(userKey);
      if (cancelled) return;
      applyInfo(info);
    })();
    return () => {
      cancelled = true;
    };
  }, [userKey]);

  useEffect(() => {
    return addAvatarUpdatedListener((detail) => {
      if (!detail || detail.userKey !== userKey) return;
      if (detail.fileUrl) {
        setFileUrl(detail.fileUrl);
        setHasExisting(true);
      } else if (detail.fileUrl === null) {
        setFileUrl(null);
        setHasExisting(false);
      } else {
        void fetchAndApply();
      }
    });
  }, [userKey]);

  const style = props.size ? ({ width: props.size, height: props.size } as const) : undefined;
  const disabled = !!props.disabled;
  const ariaLabel = props.ariaLabel ?? '设置头像';

  return (
    <>
      <button
        type="button"
        className={`${styles.avatarButton} ${props.className ?? ''}`}
        style={style}
        onClick={() => {
          if (disabled) return;
          if (props.disableModal) return;
          setOpen(true);
        }}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {fileUrl ? (
          <img className={styles.img} src={fileUrl} alt="" />
        ) : (
          <DefaultAvatar className={styles.fallback} />
        )}
      </button>

      <AvatarUploadModal
        open={open}
        onClose={() => setOpen(false)}
        userKey={userKey}
        hasExistingAvatar={hasExisting}
        onSaved={(nextUrl) => {
          setFileUrl(nextUrl);
          setHasExisting(true);
        }}
        onRemoved={() => {
          setFileUrl(null);
          setHasExisting(false);
        }}
      />
    </>
  );
}
