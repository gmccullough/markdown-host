import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Get or create the Shiki highlighter instance
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "typescript",
        "javascript",
        "json",
        "bash",
        "shell",
        "markdown",
        "html",
        "css",
        "yaml",
        "python",
        "go",
        "rust",
        "sql",
        "graphql",
        "jsx",
        "tsx",
        "diff",
        "plaintext",
      ],
    });
  }

  return highlighterPromise;
}

/**
 * Highlight code using Shiki
 */
export async function highlightCode(
  code: string,
  lang: string
): Promise<string> {
  const highlighter = await getHighlighter();
  const validLangs = highlighter.getLoadedLanguages();

  // Fall back to plaintext if language not supported
  const language = validLangs.includes(lang as any) ? lang : "plaintext";

  try {
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    });
  } catch {
    // If highlighting fails, return escaped code
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre><code class="language-${language}">${escaped}</code></pre>`;
  }
}
