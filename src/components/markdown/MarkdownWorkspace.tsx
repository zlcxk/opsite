import { useEffect, useRef, useState } from 'react';
import { Columns, Eye, Maximize2, Minimize2, Pencil } from 'lucide-react';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';

export type MarkdownViewMode = 'edit' | 'split' | 'preview';

/**
 * A preview of an empty document has nothing to show, so only use it when
 * there is content. Otherwise the author lands in a dead end and has to
 * switch tabs before typing.
 */
function resolveInitialMode(initialMode: MarkdownViewMode, value: string): MarkdownViewMode {
  return initialMode === 'preview' && !value.trim() ? 'edit' : initialMode;
}

export function MarkdownWorkspace({
  value,
  onChange,
  placeholder,
  minHeight = 360,
  onSave,
  empty = '还没有内容。',
  initialMode = 'split',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  onSave?: () => void;
  empty?: string;
  initialMode?: MarkdownViewMode;
}) {
  const [mode, setMode] = useState<MarkdownViewMode>(() =>
    resolveInitialMode(initialMode, value),
  );
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>(() =>
    resolveInitialMode(initialMode, value) === 'preview' ? 'preview' : 'edit',
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const isFullscreen = nativeFullscreen || fallbackFullscreen;
  const nativeSupported =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function';

  useEffect(() => {
    const sync = () => {
      setNativeFullscreen(
        Boolean(rootRef.current && document.fullscreenElement === rootRef.current),
      );
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFullscreen]);

  // Fallback fullscreen is an in-page overlay, so Esc is ours to handle. Keep
  // an enclosing modal from also closing on the same key press.
  useEffect(() => {
    if (!fallbackFullscreen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      setFallbackFullscreen(false);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [fallbackFullscreen]);

  const changeMode = (next: MarkdownViewMode) => {
    setMode(next);
    if (next !== 'split') setMobileTab(next);
  };

  const changeMobileTab = (next: 'edit' | 'preview') => {
    setMobileTab(next);
    setMode(next);
  };

  const toggleFullscreen = () => {
    const element = rootRef.current;
    if (!element) return;
    if (nativeFullscreen) {
      const exit = document.exitFullscreen?.();
      exit?.catch(() => setNativeFullscreen(false));
      return;
    }
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      return;
    }
    if (nativeSupported) {
      // The browser can refuse (embedded frames, permissions); the in-page
      // overlay keeps the feature usable when that happens.
      try {
        const request = element.requestFullscreen();
        request?.catch(() => setFallbackFullscreen(true));
      } catch {
        setFallbackFullscreen(true);
      }
      return;
    }
    setFallbackFullscreen(true);
  };

  return (
    <div
      ref={rootRef}
      className="md-workspace"
      data-mode={mode}
      data-mobile-tab={mobileTab}
      data-fullscreen={isFullscreen ? 'true' : undefined}
    >
      <div className="md-workspace-bar">
        <div className="md-mobile-tabs" role="tablist" aria-label="Markdown 视图">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'edit'}
            className={mobileTab === 'edit' ? 'active' : ''}
            onClick={() => changeMobileTab('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'preview'}
            className={mobileTab === 'preview' ? 'active' : ''}
            onClick={() => changeMobileTab('preview')}
          >
            预览
          </button>
        </div>
        <div className="segmented md-view-switch" aria-label="视图模式">
          <button
            type="button"
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => changeMode('edit')}
          >
            <Pencil size={11} /> 编辑
          </button>
          <button
            type="button"
            className={mode === 'split' ? 'active' : ''}
            onClick={() => changeMode('split')}
          >
            <Columns size={11} /> 分栏
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'active' : ''}
            onClick={() => changeMode('preview')}
          >
            <Eye size={11} /> 预览
          </button>
        </div>
        <button
          type="button"
          className="md-tool md-fullscreen-toggle"
          onClick={toggleFullscreen}
          title={isFullscreen ? '退出全屏（Esc）' : '全屏查看'}
          aria-label={isFullscreen ? '退出全屏' : '全屏查看'}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
      <div className="md-panes">
        <div className="md-pane md-pane-edit">
          <MarkdownEditor
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            minHeight={minHeight}
            onSave={onSave}
          />
        </div>
        <div className="md-pane md-pane-preview">
          <MarkdownPreview content={value} empty={empty} />
        </div>
      </div>
    </div>
  );
}
