import { describe, expect, it } from 'vitest';
import { markdownExcerpt, markdownToPlainText } from './markdown-text';

describe('markdownToPlainText', () => {
  it('removes Markdown structure while keeping readable text', () => {
    const markdown = [
      '# 标题',
      '',
      '这是 **重点** 与 `代码`，还有[链接](https://example.com)。',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '```bash',
      'kubectl get pods',
      '```',
      '',
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| API | Ready |',
    ].join('\n');
    const text = markdownToPlainText(markdown);
    expect(text).toContain('标题');
    expect(text).toContain('重点');
    expect(text).toContain('链接');
    expect(text).toContain('第一项');
    expect(text).toContain('API');
    expect(text).toContain('Ready');
    expect(text).not.toContain('**');
    expect(text).not.toContain('```');
    expect(text).not.toContain('https://example.com');
  });

  it('handles empty input and HTML safely', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText('  \n\n')).toBe('');
    const fromHtml = markdownToPlainText('<script>alert(1)</script>正文');
    expect(fromHtml).toContain('正文');
    expect(fromHtml).not.toContain('<script>');
  });

  it('truncates excerpts without cutting through Markdown source', () => {
    const markdown = `## 原理\n\n${'状态机负责协调期望状态。'.repeat(30)}`;
    const excerpt = markdownExcerpt(markdown, 40);
    expect(excerpt.length).toBeLessThanOrEqual(41);
    expect(excerpt).not.toContain('##');
    expect(markdownExcerpt('')).toBe('');
  });
});
