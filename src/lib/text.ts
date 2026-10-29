/**
 * Release notes arrive as Markdown from GitHub. We display them as a short
 * plain-text excerpt rather than injecting HTML, so links and emphasis are
 * reduced to their readable text.
 */
export function formatReleaseNotes(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/\*\*|__/g, '')
    .replace(/(^|\s)[*_](?=\S)/g, '$1')
    .replace(/(\S)[*_](?=\s|$)/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
