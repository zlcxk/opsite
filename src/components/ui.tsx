import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X, type LucideIcon } from 'lucide-react';
import { useClickOutside } from '../lib/hooks';

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
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  return (
    <div className="dropdown" ref={ref} onClick={(event) => event.stopPropagation()}>
      <button
        className={trigger ? '' : 'more-btn'}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div className="menu" role="menu">
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
        </div>
      )}
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="error-note">{message}</div>;
}
