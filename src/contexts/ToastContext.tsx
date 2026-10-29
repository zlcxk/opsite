import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastContextValue {
  push: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: Tone = 'success') => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div className={`toast toast-${item.tone}`} key={item.id}>
            <span className="toast-icon">
              {item.tone === 'success' ? <CheckCircle2 size={16} /> : item.tone === 'error' ? <CircleAlert size={16} /> : <Info size={16} />}
            </span>
            <span>{item.message}</span>
            <button
              className="toast-close"
              aria-label="关闭提示"
              onClick={() => setItems((prev) => prev.filter((entry) => entry.id !== item.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
