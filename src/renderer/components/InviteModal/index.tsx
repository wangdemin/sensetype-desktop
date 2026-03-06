import { useEffect, useRef } from 'react';
import styles from './index.module.scss';
import InvitationTitleIcon from '@/assets/icons/invitation-title.svg?react';
import InvitationCodeIcon from '@/assets/icons/invitation-code.svg?react';
import InvitationMoneyIcon from '@/assets/icons/invitation-money-coins.svg?react';
import InvitationUserIcon from '@/assets/icons/invitation-user.svg?react';
import InvitationActivityIcon from '@/assets/icons/invitation-active.svg?react';
import CloseIcon from '@/assets/icons/close.svg?react';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import { formatPoints } from '@/utils/format';
import type { InviteFriendsResponse } from '@/services/user/types';

export type InviteModalProps = {
  open: boolean;
  inviteInfo: InviteFriendsResponse | null;
  inviteLoading: boolean;
  shareLink: string;
  copyState: 'idle' | 'copied' | 'failed';
  onClose: () => void;
  onCopyLink: () => void;
};

const InviteModal = ({
  open,
  inviteInfo,
  inviteLoading,
  shareLink,
  copyState,
  onClose,
  onCopyLink,
}: InviteModalProps) => {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const { isMac } = useHoldToRecordKeyLabel();

  useEffect(() => {
    if (!open) return;
    // 打开时把焦点放在关闭按钮上，和 ConfirmDialog 的键盘体验保持一致
    closeBtnRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.inviteOverlay} role="presentation" onMouseDown={onClose}>
      <div className={isMac ? styles.inviteModalWrapperMac : styles.inviteModalWrapperWin}>
        <div
          className={styles.inviteModal}
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.inviteCloseButton}
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseIcon className={styles.inviteCloseIcon} aria-hidden="true" />
          </button>
          <div className={styles.inviteHeader}>
            <InvitationTitleIcon className={styles.inviteTitleIcon} aria-hidden="true" />
            <p className={styles.inviteSubtitle}>
              每成功邀请1位好友注册，双方均可获得10万积分 <br />
            </p>
          </div>
          <div className={styles.inviteStats}>
            <div className={styles.inviteStatItem}>
              <div className={styles.inviteStatText}>
                <InvitationUserIcon className={styles.inviteStatIcon} aria-hidden="true" />
                <span className={styles.inviteStatLabel}>累计邀请</span>
                <span className={styles.inviteStatValue}>
                  {formatPoints(inviteInfo?.count ?? 0)}
                </span>
              </div>
            </div>
            <span className={styles.inviteStatDivider} />
            <div className={styles.inviteStatItem}>
              <div className={styles.inviteStatText}>
                <InvitationMoneyIcon className={styles.inviteStatIcon} aria-hidden="true" />
                <span className={styles.inviteStatLabel}>获得的积分</span>
                <span className={styles.inviteStatValue}>
                  {formatPoints(inviteInfo?.points ?? 0)}
                </span>
              </div>
            </div>
          </div>
          <div className={styles.inviteCodeBlock}>
            <div className={styles.inviteCodeLabelRow}>
              <InvitationCodeIcon className={styles.inviteCodeIcon} aria-hidden="true" />
            </div>
            <span className={styles.inviteCode}>{inviteInfo?.code || '--'}</span>
          </div>
          <button
            type="button"
            className={styles.inviteCopyButton}
            onClick={onCopyLink}
            disabled={!shareLink}
          >
            {inviteLoading
              ? '加载中...'
              : copyState === 'copied'
                ? '已复制'
                : copyState === 'failed'
                  ? '复制失败'
                  : '复制分享链接'}
          </button>
          <div className={styles.inviteRules}>
            <p className={styles.inviteRulesTitle}>
              <InvitationActivityIcon className={styles.inviteActivityIcon} aria-hidden="true" />
            </p>
            <ul className={styles.inviteRulesList}>
              <li>
                活动期间，新用户通过您的邀请码注册成功，新用户可获得20万积分（10万注册积分，10万为邀请码额外积分），您可获得10万积分。
              </li>
              <li>活动奖励无上限，奖励积分有效期为1个月，积分不可提现。</li>
              <li>本次活动时间具体以官方页面展示为准，最终解释权归官方所有。</li>
              <li>
                积分为SenseAudio通用积分，支持在产品各功能中（含AI语音输入法）使用，如分享的好友已注册SenseAudio，积分不再重复发放。
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InviteModal;
