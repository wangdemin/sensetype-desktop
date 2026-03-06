import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ArrowDownIcon from '@/assets/icons/settings-top.svg?react';
import styles from './index.module.scss';

export type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function DropdownSelect({
  value,
  options,
  onChange,
  disabled,
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

  // 外部 value 更新后，清理乐观值（避免一直卡在 optimistic）
  useEffect(() => {
    if (optimisticValue === null) return;
    if (value === optimisticValue) setOptimisticValue(null);
  }, [optimisticValue, value]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((v) => !v);
  }, [disabled]);

  const computeMenuStyle = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 8;
    const viewportPadding = 8;
    const menuMaxHeight = Math.min(280, Math.max(120, viewportHeight - viewportPadding * 2));
    // 用选项数量估算菜单高度，避免只有少量选项时“向上展开”被抬得过高。
    const estimatedMenuHeight = Math.min(
      menuMaxHeight,
      Math.max(48, options.length * 40 + 12),
    );

    const width = Math.max(160, Math.round(rect.width));
    const left = Math.min(
      Math.max(viewportPadding, Math.round(rect.left)),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const spaceBelow = viewportHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;

    // 优先向下展开；空间不足时上翻，避免菜单“跳到底部”。
    const top =
      spaceBelow >= estimatedMenuHeight || spaceBelow >= spaceAbove
        ? Math.min(
            Math.round(rect.bottom + gap),
            Math.max(viewportPadding, viewportHeight - viewportPadding - estimatedMenuHeight),
          )
        : Math.max(viewportPadding, Math.round(rect.top - gap - estimatedMenuHeight));

    return { left, top, width, maxHeight: menuMaxHeight };
  }, [options.length]);

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
      if (disabled || optionDisabled) return;
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
    [close, disabled, onChange, value],
  );

  // 查找最近的 Modal overlay 元素（用于在 Modal 内部时渲染下拉菜单）
  const findModalOverlay = useCallback(() => {
    let element: HTMLElement | null = rootRef.current;
    while (element) {
      // 查找包含 Modal overlay 样式的父元素
      const overlay = element.closest('[role="dialog"]');
      if (overlay && overlay instanceof HTMLElement) {
        return overlay;
      }
      element = element.parentElement;
    }
    return null;
  }, []);

  const getPortalContainer = useCallback(() => {
    // 如果在 Modal 内部，渲染到 Modal overlay；否则渲染到 body
    const modalOverlay = findModalOverlay();
    return modalOverlay || document.body;
  }, [findModalOverlay]);

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`}>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.trigger} ${disabled ? styles.triggerDisabled : ''} ${
          triggerClassName ?? styles.triggerDefault
        }`}
        onClick={toggle}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className={styles.value}>{selected?.label ?? '-'}</span>
        <span>
          <ArrowDownIcon />
        </span>
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
            getPortalContainer(),
          )
        : null}
    </div>
  );
}
