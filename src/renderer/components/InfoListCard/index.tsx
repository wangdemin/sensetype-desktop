import type { ReactNode } from 'react';
import styles from './index.module.scss';

export type InfoListItemProps = {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
};

export const InfoListCard = ({
  children,
  className,
  role = 'list',
}: {
  children: ReactNode;
  className?: string;
  role?: string;
}) => {
  return (
    <div className={`${styles.card} ${className ?? ''}`} role={role}>
      {children}
    </div>
  );
};

export const InfoListItem = ({ title, desc, action }: InfoListItemProps) => {
  return (
    <div className={styles.item} role="listitem">
      <div className={styles.itemLeft}>
        <div className={styles.itemTitle}>{title}</div>
        {desc !== undefined && desc !== null ? <div className={styles.itemDesc}>{desc}</div> : null}
      </div>
      {action ? <div className={styles.itemAction}>{action}</div> : null}
    </div>
  );
};

export const InfoButton = ({
  variant = 'secondary',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'dangerOutline';
}) => {
  const variantClass =
    variant === 'primary'
      ? styles.buttonPrimary
      : variant === 'dangerOutline'
        ? styles.buttonDangerOutline
        : styles.buttonSecondary;

  return (
    <button
      type="button"
      className={`${styles.button} ${variantClass} ${className ?? ''}`}
      {...rest}
    />
  );
};
