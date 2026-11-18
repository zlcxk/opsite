// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({ value }: { value: string }) => (
    <textarea data-testid="editor" value={value} readOnly />
  ),
}));

vi.mock('./MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="preview">{content}</div>
  ),
}));

import { MarkdownWorkspace } from './MarkdownWorkspace';

const elementProto = Element.prototype as unknown as Record<string, unknown>;
const originalRequestFullscreen = elementProto.requestFullscreen;
const originalBodyOverflow = document.body.style.overflow;

function workspace(container: HTMLElement): HTMLElement {
  const element = container.querySelector('.md-workspace');
  if (!(element instanceof HTMLElement)) throw new Error('workspace not rendered');
  return element;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = originalBodyOverflow;
  if (originalRequestFullscreen === undefined) delete elementProto.requestFullscreen;
  else elementProto.requestFullscreen = originalRequestFullscreen;
});

describe('MarkdownWorkspace initial view', () => {
  it('opens content in preview when asked for a read-first surface', () => {
    const { container } = render(
      <MarkdownWorkspace value="# 已有正文" onChange={() => {}} initialMode="preview" />,
    );
    expect(workspace(container).dataset.mode).toBe('preview');
    expect(screen.getByTestId('preview').textContent).toContain('已有正文');
  });

  it('falls back to the editor when there is nothing to preview', () => {
    const { container } = render(
      <MarkdownWorkspace value="   " onChange={() => {}} initialMode="preview" />,
    );
    expect(workspace(container).dataset.mode).toBe('edit');
  });

  it('keeps split view as the default for explicit editing surfaces', () => {
    const { container } = render(<MarkdownWorkspace value="# 文档" onChange={() => {}} />);
    expect(workspace(container).dataset.mode).toBe('split');
  });
});

describe('MarkdownWorkspace fullscreen', () => {
  it('uses an in-page overlay when the browser rejects native fullscreen', async () => {
    elementProto.requestFullscreen = vi.fn(() =>
      Promise.reject(new Error('fullscreen blocked')),
    );
    const { container } = render(
      <MarkdownWorkspace value="# 长文档" onChange={() => {}} initialMode="preview" />,
    );

    fireEvent.click(screen.getByRole('button', { name: '全屏查看' }));

    await waitFor(() => expect(workspace(container).dataset.fullscreen).toBe('true'));
    expect(document.body.style.overflow).toBe('hidden');
    expect(
      screen.getByRole('button', { name: '退出全屏' }).getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(workspace(container).dataset.fullscreen).toBeUndefined());
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
