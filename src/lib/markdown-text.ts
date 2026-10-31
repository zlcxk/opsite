/**
 * Turn Markdown into a compact single-line excerpt for list views.
 * The real rendering still goes through MarkdownPreview; this helper only
 * removes syntax that reads poorly when shown as plain text.
 */
export function markdownToPlainText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, '\n');
  // Keep fenced code content, but drop the fence lines and language marker.
  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, ' $1 ');
  text = text.replace(/~~~[^\n]*\n?([\s\S]*?)~~~/g, ' $1 ');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+[.)]\s+/gm, '');
  // Table separator rows (|---|---|) carry no readable information.
  text = text.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '');
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  text = text.replace(/\|/g, ' ');
  text = text.replace(/[*_~`]/g, '');
  text = text.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function markdownExcerpt(markdown: string, length = 120): string {
  const text = markdownToPlainText(markdown);
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
