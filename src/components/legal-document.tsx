import ReactMarkdown from "react-markdown";
import type { ExtraProps } from "react-markdown";
import type { ComponentPropsWithoutRef } from "react";

type Props<T extends keyof React.JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> &
  ExtraProps;

export function LegalDocument({ content }: { content: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      <ReactMarkdown
        components={{
          h1: ({ node, ...props }: Props<"h1">) => (
            <h1
              className="mb-6 text-2xl font-semibold text-zinc-950 dark:text-zinc-50"
              {...props}
            />
          ),
          h2: ({ node, ...props }: Props<"h2">) => (
            <h2
              className="mb-3 mt-10 text-lg font-semibold text-zinc-950 dark:text-zinc-50"
              {...props}
            />
          ),
          p: ({ node, ...props }: Props<"p">) => (
            <p className="mb-3" {...props} />
          ),
          ul: ({ node, ...props }: Props<"ul">) => (
            <ul className="mb-3 list-disc space-y-1 pl-5" {...props} />
          ),
          ol: ({ node, ...props }: Props<"ol">) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5" {...props} />
          ),
          strong: ({ node, ...props }: Props<"strong">) => (
            <strong
              className="font-semibold text-zinc-900 dark:text-zinc-100"
              {...props}
            />
          ),
          a: ({ node, ...props }: Props<"a">) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:text-zinc-100"
            />
          ),
          table: ({ node, ...props }: Props<"table">) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-left" {...props} />
            </div>
          ),
          th: ({ node, ...props }: Props<"th">) => (
            <th
              className="border-b border-zinc-200 py-2 pr-4 font-medium text-zinc-500 dark:border-zinc-800"
              {...props}
            />
          ),
          td: ({ node, ...props }: Props<"td">) => (
            <td
              className="border-b border-zinc-100 py-2 pr-4 align-top dark:border-zinc-900"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
