// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TechNode } from '@shared/types';
import type { TechDocEditorHandle } from './TechDocEditor';

vi.mock('./markdown/MarkdownWorkspace', () => ({
  MarkdownWorkspace: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="markdown"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ push: vi.fn() }),
}));

vi.mock('../lib/api', () => ({
  api: {
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../lib/api';
import { TechDocEditor } from './TechDocEditor';

function makeNode(overrides: Partial<TechNode> = {}): TechNode {
  return {
    id: 'node-1',
    domainId: 'domain-1',
    parentId: null,
    name: '测试节点',
    nodeType: 'concept',
    summary: null,
    status: 'active',
    masteryStatus: 'learning',
    focusLevel: 'normal',
    contentStatus: 'draft',
    hasContent: true,
    sortOrder: 0,
    childCount: 0,
    updatedAt: '2026-10-31T00:00:00.000Z',
    description: null,
    technicalRole: null,
    corePrinciple: null,
    solvedProblem: null,
    keyMechanism: null,
    useCases: null,
    commonIssues: null,
    docsUrl: null,
    repoUrl: null,
    referenceLinks: [],
    researchQuestions: null,
    personalNotes: null,
    contentMarkdown: '# 基础',
    contentSource: 'official',
    applicableVersions: 'Kubernetes 1.34',
    contentUpdatedAt: '2026-10-31T00:00:00.000Z',
    contentVerifiedAt: null,
    verifiedVersion: null,
    createdAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('TechDocEditor save and discard', () => {
  it('waits for an in-flight save, then discards only the remaining local edits', async () => {
    const ref = createRef<TechDocEditorHandle>();
    const node = makeNode();
    render(<TechDocEditor ref={ref} node={node} autoSave={false} />);

    fireEvent.change(screen.getByTestId('markdown'), { target: { value: '# 未保存的修改' } });
    expect(ref.current!.isDirty()).toBe(true);
    expect(ref.current!.isBusy()).toBe(false);

    const request = deferred<TechNode>();
    vi.mocked(api.patch).mockReturnValueOnce(request.promise);
    let saveResult!: Promise<boolean>;
    act(() => {
      saveResult = ref.current!.save();
    });
    await waitFor(() => expect(ref.current!.isBusy()).toBe(true));

    let discarded: boolean | null = null;
    const discardPromise = ref.current!.discard().then((value) => {
      discarded = value;
      return value;
    });
    await Promise.resolve();
    expect(discarded).toBeNull();

    request.resolve(makeNode({ contentMarkdown: '# 未保存的修改' }));
    await act(async () => {
      await saveResult;
    });
    await expect(discardPromise).resolves.toBe(true);
    expect((screen.getByTestId('markdown') as HTMLTextAreaElement).value).toBe('# 未保存的修改');
    expect(ref.current!.isDirty()).toBe(false);
  });

  it('keeps local edits when the pending save fails', async () => {
    const ref = createRef<TechDocEditorHandle>();
    render(<TechDocEditor ref={ref} node={makeNode()} autoSave={false} />);

    fireEvent.change(screen.getByTestId('markdown'), { target: { value: '# 保存失败也要保留' } });
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('network unavailable'));
    await act(async () => {
      await expect(ref.current!.save()).resolves.toBe(false);
    });

    expect((screen.getByTestId('markdown') as HTMLTextAreaElement).value).toBe('# 保存失败也要保留');
    expect(ref.current!.isDirty()).toBe(true);
  });

  it('does not discard while verification is in progress', async () => {
    const ref = createRef<TechDocEditorHandle>();
    render(<TechDocEditor ref={ref} node={makeNode()} autoSave={false} />);

    fireEvent.change(screen.getByPlaceholderText('如 1.34'), { target: { value: '1.34' } });
    const verification = deferred<TechNode>();
    vi.mocked(api.post).mockReturnValueOnce(verification.promise);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /验证知识/ }));
      await Promise.resolve();
    });
    await waitFor(() => expect(ref.current!.isVerifying()).toBe(true));
    expect(ref.current!.isBusy()).toBe(true);
    await expect(ref.current!.discard()).resolves.toBe(false);

    await act(async () => {
      verification.resolve(
        makeNode({ contentStatus: 'complete', verifiedVersion: '1.34', contentVerifiedAt: '2026-10-31T01:00:00.000Z' }),
      );
      await verification.promise;
    });
    await waitFor(() => expect(ref.current!.isVerifying()).toBe(false));
  });

  it('cancels the pending autosave debounce when discarding', async () => {
    vi.useFakeTimers();
    const ref = createRef<TechDocEditorHandle>();
    render(<TechDocEditor ref={ref} node={makeNode()} autoSave />);

    fireEvent.change(screen.getByTestId('markdown'), { target: { value: '# 会被放弃' } });
    await act(async () => {
      await ref.current!.discard();
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(api.patch).not.toHaveBeenCalled();
    expect((screen.getByTestId('markdown') as HTMLTextAreaElement).value).toBe('# 基础');
    expect(ref.current!.isDirty()).toBe(false);
  });
});
