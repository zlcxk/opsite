import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X, type LucideIcon } from 'lucide-react';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <div className="page-head-sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  count,
  subtitle,
  action,
}: {
  title: string;
  count?: number | string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <div className="section-head-left">
          <h2>{title}</h2>
          {count !== undefined && <span className="section-count">{count}</span>}
        </div>
        {subtitle && <div className="section-sub">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="empty-state" style={compact ? { minHeight: 150, padding: 20 } : undefined}>
      <span className="empty-mark">
        <Icon size={17} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function LoadingBlock({ count = 1 }: { count?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: count > 1 ? `repeat(${count}, minmax(0,1fr))` : undefined }}>
      {Array.from({ length: count }).map((_, index) => (
        <div className="loading-block" key={index} />
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', handler);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="close-btn" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

export function ActionMenu({
  items,
  label = '更多操作',
  trigger,
}: {
  items: MenuItem[];
  label?: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Menus are rendered in a portal so table/card overflow never clips the
  // last row's actions. Position them against the trigger on every open.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const place = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const menuWidth = menuRef.current?.offsetWidth ?? 178;
      const menuHeight = menuRef.current?.offsetHeight ?? items.length * 32 + 10;
      const margin = 8;
      const left = Math.max(
        margin,
        Math.min(triggerRect.right - menuWidth, window.innerWidth - menuWidth - margin),
      );
      const below = triggerRect.bottom + 5;
      const top =
        below + menuHeight <= window.innerHeight - margin
          ? below
          : Math.max(margin, triggerRect.top - menuHeight - 5);
      setPosition({ top, left });
    };

    place();
    const close = () => setOpen(false);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, items.length]);

  return (
    <div className="dropdown" ref={wrapperRef} onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        className={trigger ? '' : 'more-btn'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu menu-portal"
            role="menu"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? 'visible' : 'hidden',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={`${item.label}-${index}`}>
                  {item.separator && <div className="menu-sep" />}
                  <button
                    role="menuitem"
                    className={item.danger ? 'danger' : ''}
                    onClick={() => {
                      setOpen(false);
                      item.onClick();
                    }}
                  >
                    {Icon && <Icon size={13} />}
                    {item.label}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="error-note">{message}</div>;
}
