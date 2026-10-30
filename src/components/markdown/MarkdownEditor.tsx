import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  Bold as BoldIcon,
  Code,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Table,
} from 'lucide-react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  onSave?: () => void;
}

function wrapSelection(view: EditorView, before: string, after = before, fallback = '文本') {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || fallback;
  const insert = `${before}${selected}${after}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

function prefixLines(view: EditorView, prefix: string, numbered = false) {
  const { from, to } = view.state.selection.main;
  const start = view.state.doc.lineAt(from).from;
  const end = view.state.doc.lineAt(to).to;
  const lines = view.state.sliceDoc(start, end).split('\n');
  const next = lines
    .map((line, index) => {
      const alreadyPrefixed = numbered
        ? /^\d+\.\s/.test(line)
        : line.startsWith(prefix);
      if (alreadyPrefixed) return line;
      return `${numbered ? `${index + 1}. ` : prefix}${line}`;
    })
    .join('\n');
  view.dispatch({ changes: { from: start, to: end, insert: next }, selection: { anchor: start + next.length } });
  view.focus();
}

function insertBlock(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  const before = from > 0 && view.state.doc.sliceString(from - 1, from) !== '\n' ? '\n' : '';
  view.dispatch({
    changes: { from, to, insert: `${before}${text}` },
    selection: { anchor: from + before.length + text.length },
  });
  view.focus();
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || '链接文本';
  const insert = `[${selected}](https://)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + selected.length + 3, head: from + insert.length - 1 },
  });
  view.focus();
}

const CODE_TABLE = '| 列 1 | 列 2 |\n| --- | --- |\n| 值 1 | 值 2 |';

export function MarkdownEditor({
  value,
  onChange,
  placeholder = '用 Markdown 写下定义、原理、配置示例与排查经验…',
  minHeight = 360,
  onSave,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const initialValue = useRef(value);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;
    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      {
        key: 'Mod-b',
        run: (view) => {
          wrapSelection(view, '**');
          return true;
        },
      },
      {
        key: 'Mod-i',
        run: (view) => {
          wrapSelection(view, '*');
          return true;
        },
      },
      {
        key: 'Mod-k',
        run: (view) => {
          insertLink(view);
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        basicSetup,
        saveKeymap,
        keymap.of([...defaultKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { fontSize: '0.8125rem' },
          '.cm-content': { fontFamily: 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)' },
          '.cm-scroller': { overflow: 'auto' },
        }),
        placeholderExtension(placeholder),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  const withView = (action: (view: EditorView) => void) => () => {
    const view = viewRef.current;
    if (view) action(view);
  };

  const tools = [
    { label: '标题', icon: Heading2, action: withView((view) => prefixLines(view, '## ')) },
    { label: '粗体', icon: BoldIcon, action: withView((view) => wrapSelection(view, '**')) },
    { label: '斜体', icon: Italic, action: withView((view) => wrapSelection(view, '*')) },
    { label: '无序列表', icon: List, action: withView((view) => prefixLines(view, '- ')) },
    { label: '有序列表', icon: ListOrdered, action: withView((view) => prefixLines(view, '', true)) },
    { label: '引用', icon: Quote, action: withView((view) => prefixLines(view, '> ')) },
    {
      label: '代码块',
      icon: Code,
      action: withView((view) => insertBlock(view, '~~~text\n\n~~~')),
    },
    { label: '链接', icon: Link, action: withView((view) => insertLink(view)) },
    { label: '表格', icon: Table, action: withView((view) => insertBlock(view, CODE_TABLE)) },
  ];

  return (
    <div className="md-editor">
      <div className="md-toolbar" role="toolbar" aria-label="Markdown 编辑工具栏">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.label}
              type="button"
              className="md-tool"
              title={tool.label}
              aria-label={tool.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.action}
            >
              <Icon size={14} />
            </button>
          );
        })}
        <span className="md-toolbar-hint">Markdown · ⌘S 保存</span>
      </div>
      <div ref={hostRef} className="md-editor-host" style={{ minHeight }} />
    </div>
  );
}
