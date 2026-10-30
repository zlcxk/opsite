import { useState } from 'react';
import { Columns, Eye, Pencil } from 'lucide-react';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';

type ViewMode = 'edit' | 'split' | 'preview';

export function MarkdownWorkspace({
  value,
  onChange,
  placeholder,
  minHeight = 360,
  onSave,
  empty = '还没有内容。',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  onSave?: () => void;
  empty?: string;
}) {
  const [mode, setMode] = useState<ViewMode>('split');
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');

  return (
    <div className="md-workspace" data-mode={mode} data-mobile-tab={mobileTab}>
      <div className="md-workspace-bar">
        <div className="md-mobile-tabs" role="tablist" aria-label="Markdown 视图">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'edit'}
            className={mobileTab === 'edit' ? 'active' : ''}
            onClick={() => setMobileTab('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'preview'}
            className={mobileTab === 'preview' ? 'active' : ''}
            onClick={() => setMobileTab('preview')}
          >
            预览
          </button>
        </div>
        <div className="segmented md-view-switch" aria-label="视图模式">
          <button
            type="button"
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => setMode('edit')}
          >
            <Pencil size={11} /> 编辑
          </button>
          <button
            type="button"
            className={mode === 'split' ? 'active' : ''}
            onClick={() => setMode('split')}
          >
            <Columns size={11} /> 分栏
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'active' : ''}
            onClick={() => setMode('preview')}
          >
            <Eye size={11} /> 预览
          </button>
        </div>
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
