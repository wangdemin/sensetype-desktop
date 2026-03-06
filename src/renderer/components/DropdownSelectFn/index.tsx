import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ArrowDownIcon from '@/assets/icons/settings-top.svg?react';
import styles from './index.module.scss';

export type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function DropdownSelectFn({
  value,
  options,
  onChange,
  disabled,
  readOnly,
  showCaret,
  ariaLabel,
  title,
  className,
  triggerClassName,
  menuClassName,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  showCaret?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const [optimisticValue, setOptimisticValue] = useState<string | null>(null);

  const effectiveValue = optimisticValue ?? value;

  const selected = useMemo(
    () => options.find((o) => o.value === effectiveValue) ?? null,
    [effectiveValue, options],
  );

  const shouldShowCaret = showCaret ?? !readOnly;

  // 外部 value 更新后，清理乐观值（避免一直卡在 optimistic）
  useEffect(() => {
    if (optimisticValue === null) return;
    if (value === optimisticValue) setOptimisticValue(null);
  }, [optimisticValue, value]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    if (disabled || readOnly) return;
    setOpen((v) => !v);
  }, [disabled, readOnly]);

  const computeMenuStyle = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const gap = 8;

    const width = Math.max(160, Math.round(rect.width));
    const left = Math.min(
      Math.max(8, Math.round(rect.left)),
      Math.max(8, window.innerWidth - width - 8),
    );
    const top = Math.min(Math.round(rect.bottom + gap), Math.max(8, window.innerHeight - 8 - 280));
    return { left, top, width };
  }, []);

  useEffect(() => {
    if (!open) return;
    setMenuStyle(computeMenuStyle());
    const onMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      const menuEl = menuRef.current;
      if (!(e.target instanceof Node)) return;
      if (el && el.contains(e.target)) return;
      if (menuEl && menuEl.contains(e.target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onReflow = () => setMenuStyle(computeMenuStyle());
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReflow, true);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReflow, true);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [close, computeMenuStyle, open]);

  const onPick = useCallback(
    (next: string, optionDisabled?: boolean) => {
      if (disabled || readOnly || optionDisabled) return;
      setOptimisticValue(next);
      close();
      if (next !== value) {
        // 先关闭菜单并让 UI 先绘制一帧，再触发外部 onChange（避免切换时的“卡一下”体感）
        try {
          requestAnimationFrame(() => onChange(next));
        } catch {
          setTimeout(() => onChange(next), 0);
        }
      }
    },
    [close, disabled, onChange, readOnly, value],
  );

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`}>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.trigger} ${disabled ? styles.triggerDisabled : ''} ${
          readOnly ? styles.triggerReadOnly : ''
        } ${triggerClassName ?? styles.triggerDefault}`}
        onClick={toggle}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || readOnly}
        disabled={disabled}
      >
        <span className={styles.value}>{selected?.label ?? '-'}</span>
        {shouldShowCaret ? (
          <span>
            <ArrowDownIcon />
          </span>
        ) : null}
      </button>

      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className={`${styles.menu} ${menuClassName ?? ''}`}
              role="listbox"
              style={menuStyle}
            >
              {options.map((o) => {
                const isSelected = o.value === effectiveValue;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${
                      o.disabled ? styles.optionDisabled : ''
                    }`}
                    onMouseDown={(e) => {
                      // mousedown 触发更“跟手”，避免等待 click 造成的延迟体感
                      e.preventDefault();
                      onPick(o.value, o.disabled);
                    }}
                    disabled={o.disabled}
                  >
                    <span>{o.label}</span>
                    {isSelected ? <span className={styles.check} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
