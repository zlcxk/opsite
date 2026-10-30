import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';

// Sanitize runs before highlighting. Highlight.js only adds class names to
// trusted nodes, so no raw HTML from the document ever reaches the DOM.
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    li: [...(defaultSchema.attributes?.li ?? []), 'className'],
    ul: [...(defaultSchema.attributes?.ul ?? []), 'className'],
    ol: [...(defaultSchema.attributes?.ol ?? []), 'className'],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      'type',
      'checked',
      'disabled',
    ],
  },
};

function isExternal(href: string | undefined): boolean {
  return Boolean(href && /^https?:\/\//i.test(href));
}

export function MarkdownPreview({
  content,
  empty = '还没有内容。',
  className = '',
}: {
  content: string;
  empty?: string;
  className?: string;
}) {
  if (!content.trim()) {
    return <div className={`md-empty ${className}`}>{empty}</div>;
  }

  return (
    <div className={`md-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeSanitize, schema],
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={{
          a({ href, children, ...props }) {
            const external = isExternal(href);
            return (
              <a
                {...props}
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
