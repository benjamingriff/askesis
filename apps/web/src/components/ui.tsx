import { Check, Loader2, X, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, type LinkProps } from 'react-router';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

// ---- Buttons -----------------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'plain';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  icon?: LucideIcon | undefined;
  busy?: boolean | undefined;
  block?: boolean | undefined;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  busy,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className)}
      {...rest}
    >
      {busy ? (
        <Loader2 className="spin" size={16} aria-hidden="true" />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 15 : 17} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon }) {
  return (
    <Link className={cx('btn', `btn-${variant}`, `btn-${size}`, className)} {...rest}>
      {Icon ? <Icon size={size === 'sm' ? 15 : 17} aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}

/** Icon-only control. The label is both its accessible name and its tooltip. */
export function IconButton({
  icon: Icon,
  label,
  tone = 'plain',
  size = 18,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon;
  label: string;
  tone?: 'plain' | 'filled' | 'accent' | undefined;
  size?: number | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('icon-btn', `icon-btn-${tone}`, className)}
      {...rest}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}

// ---- Surfaces ----------------------------------------------------------------------------------

export function Card({
  children,
  className,
  raised,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string | undefined;
  raised?: boolean | undefined;
  as?: 'section' | 'div' | 'article' | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  return (
    <Tag className={cx('card', raised && 'card-raised', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionHeader({
  title,
  action,
  id,
}: {
  title: ReactNode;
  action?: ReactNode | undefined;
  id?: string | undefined;
}) {
  return (
    <div className="section-header">
      <h2 id={id}>{title}</h2>
      {action}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>;
}

type Tone = 'neutral' | 'accent' | 'locked' | 'warning' | 'danger';

export function Pill({
  children,
  icon: Icon,
  tone = 'neutral',
  color,
  className,
  title,
}: {
  children: ReactNode;
  icon?: LucideIcon | undefined;
  tone?: Tone | undefined;
  color?: string | undefined;
  className?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <span
      className={cx('pill', `pill-${tone}`, className)}
      title={title}
      style={color ? ({ '--pill-color': color } as CSSProperties) : undefined}
    >
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  color,
}: {
  value: number;
  label?: string | undefined;
  color?: string | undefined;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <span style={{ width: `${clamped * 100}%`, background: color }} />
    </div>
  );
}

export function KindIcon({
  icon: Icon,
  color,
  size = 36,
}: {
  icon: LucideIcon;
  color: string;
  size?: number | undefined;
}) {
  return (
    <span
      className="kind-icon"
      style={{ width: size, height: size, '--kind': color } as CSSProperties}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <Loader2 className="spin" size={18} aria-label={label} />;
}

// ---- Feedback ----------------------------------------------------------------------------------

export function Notice({
  children,
  tone = 'neutral',
  icon: Icon,
  action,
  role,
  className,
}: {
  children: ReactNode;
  tone?: Tone | undefined;
  icon?: LucideIcon | undefined;
  action?: ReactNode | undefined;
  role?: 'status' | 'alert' | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cx('notice', `notice-${tone}`, className)} role={role}>
      {Icon ? <Icon size={18} aria-hidden="true" className="notice-icon" /> : null}
      <div className="notice-body">{children}</div>
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <p className="loading-state" role="status">
      <Loader2 className="spin" size={16} aria-hidden="true" /> {children}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice
      tone="danger"
      role="alert"
      action={
        onRetry ? (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  dashed,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode | undefined;
  action?: ReactNode | undefined;
  dashed?: boolean | undefined;
}) {
  return (
    <div className={cx('empty-state', dashed && 'empty-dashed')}>
      <span className="empty-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

// ---- Inputs ------------------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string; icon?: LucideIcon; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string | undefined;
}) {
  return (
    <div className={cx('segmented', className)} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            className={cx(active && 'active')}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={14} aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A large checkbox row used for human confirmations. */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <label className={cx('check-row', checked && 'checked')} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-box" aria-hidden="true">
        {checked ? <Check size={15} strokeWidth={3} /> : null}
      </span>
      <span className="check-copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

// ---- Overlays ----------------------------------------------------------------------------------

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog. Rendered as a sheet from the bottom on narrow screens and centred on desktop.
 * Escape and the backdrop close it unless `busy` is set.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  busy,
  size = 'md',
  className,
  style,
}: {
  className?: string | undefined;
  style?: CSSProperties | undefined;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  children?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  busy?: boolean | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        close.current();
      }
      if (event.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const firstItem = items[0]!;
        const lastItem = items.at(-1)!;
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, busy]);

  if (!open) return null;
  return createPortal(
    <div className="dialog-root">
      <div className="dialog-backdrop" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div
        ref={panel}
        className={cx('dialog', `dialog-${size}`, className)}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton icon={X} label="Close" tone="filled" disabled={busy} onClick={onClose} />
        </header>
        {children ? <div className="dialog-body">{children}</div> : null}
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export type MenuItem = {
  label: string;
  icon?: LucideIcon | undefined;
  onSelect: () => void;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
};

/** Overflow menu that closes on outside click, Escape or selection. */
export function Menu({
  label,
  icon,
  items,
  align = 'end',
}: {
  label: string;
  icon: LucideIcon;
  items: (MenuItem | 'divider' | null | false)[];
  align?: 'start' | 'end' | undefined;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const visible = items.filter(Boolean) as (MenuItem | 'divider')[];
  return (
    <div className="menu" ref={root}>
      <IconButton
        icon={icon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className={cx('menu-panel', `menu-${align}`)} role="menu" id={menuId}>
          {visible.map((item, index) =>
            item === 'divider' ? (
              <hr key={`divider-${index}`} />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={cx(item.danger && 'danger')}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon ? <item.icon size={16} aria-hidden="true" /> : null}
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export { cx };
