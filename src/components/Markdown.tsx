import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Safe Markdown rendering for user notes. Raw HTML is never rendered (react-markdown escapes it),
 * unsafe URL schemes such as javascript: are stripped, images are not loaded (no remote
 * tracking pixels in notes), and links open in a new tab without referrer.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={{
          a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{c}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
