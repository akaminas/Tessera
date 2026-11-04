import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

/**
 * Safe Markdown: react-markdown does not render raw HTML, and links are
 * restricted to http(s)/mailto. Mentions written as @[Name](user:uuid) render
 * as plain highlighted names.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('md text-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^(https?:|mailto:|user:)/i.test(url) ? url : '')}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('user:')) return <span className="rounded-[3px] bg-teal-tint px-1 text-teal-deep">@{children}</span>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span className="text-secondary">[image: {alt}]</span>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
