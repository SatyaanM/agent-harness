'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (/^(?:https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("#")) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  return undefined;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body min-w-0 break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const isInline = !match && !codeClassName;

            if (isInline) {
              return (
                <code
                  className="rounded bg-gray-300 px-1.5 py-0.5 text-xs font-mono text-gray-800"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <div className="relative my-2">
                {match && (
                  <div className="absolute top-0 right-0 rounded-bl rounded-tr bg-gray-600 px-2 py-0.5 text-[10px] text-gray-300">
                    {match[1]}
                  </div>
                )}
                <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                  <code className={codeClassName} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          a({ children, href, ...props }) {
            const safe = safeHref(href);
            if (!safe) {
              return <span className="text-gray-700">{children}</span>;
            }
            return (
              <a
                href={safe}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
                {...props}
              >
                {children}
              </a>
            );
          },
          table({ children, ...props }) {
            return (
              <div className="my-2 overflow-x-auto">
                <table className="border-collapse border border-gray-300 text-xs" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          th({ children, ...props }) {
            return (
              <th className="border border-gray-300 bg-gray-200 px-2 py-1 text-left font-semibold" {...props}>
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="border border-gray-300 px-2 py-1" {...props}>
                {children}
              </td>
            );
          },
          ul({ children, ...props }) {
            return (
              <ul className="my-1 list-disc pl-5 text-sm" {...props}>
                {children}
              </ul>
            );
          },
          ol({ children, ...props }) {
            return (
              <ol className="my-1 list-decimal pl-5 text-sm" {...props}>
                {children}
              </ol>
            );
          },
          li({ children, ...props }) {
            return (
              <li className="my-0.5" {...props}>
                {children}
              </li>
            );
          },
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className="my-2 border-l-4 border-gray-400 pl-3 text-sm text-gray-600 italic"
                {...props}
              >
                {children}
              </blockquote>
            );
          },
          h1({ children, ...props }) {
            return <h1 className="my-2 text-lg font-bold" {...props}>{children}</h1>;
          },
          h2({ children, ...props }) {
            return <h2 className="my-2 text-base font-bold" {...props}>{children}</h2>;
          },
          h3({ children, ...props }) {
            return <h3 className="my-1 text-sm font-bold" {...props}>{children}</h3>;
          },
          p({ children, ...props }) {
            return <p className="my-1 text-sm leading-relaxed" {...props}>{children}</p>;
          },
          hr({ ...props }) {
            return <hr className="my-3 border-gray-300" {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
