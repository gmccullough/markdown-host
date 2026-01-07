import { Marked, type Tokens } from "marked";
import { highlightCode } from "./highlight";

export interface RenderOptions {
  /** Current page's URL path (for resolving relative links) */
  currentPath: string;
}

/**
 * Resolve a relative link to an absolute URL path
 */
function resolveLink(href: string, currentPath: string): string {
  // External links - leave unchanged
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }

  // Anchor links - leave unchanged
  if (href.startsWith("#")) {
    return href;
  }

  // Already absolute
  if (href.startsWith("/")) {
    return href.replace(/\.md$/i, "");
  }

  // Resolve relative path
  const currentDir = currentPath === "/" ? "" : currentPath.replace(/\/[^/]*$/, "");
  let resolved: string;

  if (href.startsWith("./")) {
    resolved = `${currentDir}/${href.slice(2)}`;
  } else if (href.startsWith("../")) {
    const parts = currentDir.split("/").filter(Boolean);
    let hrefParts = href.split("/");

    while (hrefParts[0] === "..") {
      parts.pop();
      hrefParts.shift();
    }

    resolved = "/" + [...parts, ...hrefParts].join("/");
  } else {
    resolved = `${currentDir}/${href}`;
  }

  // Remove .md extension
  resolved = resolved.replace(/\.md$/i, "");

  // Handle anchor in the path
  const [path, anchor] = resolved.split("#");
  const cleanPath = path.replace(/\/+/g, "/") || "/";

  return anchor ? `${cleanPath}#${anchor}` : cleanPath;
}

/**
 * Generate a slug from heading text for anchor links
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Create a configured Marked instance for rendering markdown
 */
export function createMarkdownRenderer(options: RenderOptions): Marked {
  const marked = new Marked();

  // Track code blocks that need async processing
  const codeBlocks: Array<{
    placeholder: string;
    code: string;
    lang: string;
    isMermaid: boolean;
  }> = [];
  let blockCounter = 0;

  marked.use({
    renderer: {
      // Handle code blocks
      code({ text, lang }: Tokens.Code): string {
        const language = lang || "plaintext";
        const isMermaid = language.toLowerCase() === "mermaid";

        if (isMermaid) {
          // Mermaid blocks get special treatment - rendered client-side
          const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<pre class="mermaid-source" data-diagram="${escaped.replace(/"/g, "&quot;")}">${escaped}</pre>`;
        }

        // Regular code blocks need syntax highlighting
        // Use placeholder that will be replaced after async processing
        const placeholder = `__CODE_BLOCK_${blockCounter++}__`;
        codeBlocks.push({ placeholder, code: text, lang: language, isMermaid: false });
        return placeholder;
      },

      // Handle links
      link({ href, title, tokens }: Tokens.Link): string {
        const resolvedHref = resolveLink(href, options.currentPath);
        const text = this.parser!.parseInline(tokens);
        const titleAttr = title ? ` title="${title}"` : "";
        return `<a href="${resolvedHref}"${titleAttr}>${text}</a>`;
      },

      // Handle headings with anchor links (except h1 which is the page title)
      heading({ tokens, depth }: Tokens.Heading): string {
        const text = this.parser!.parseInline(tokens);
        const slug = slugify(text);

        // H1 is the page title - no anchor needed
        if (depth === 1) {
          return `<h1>${text}</h1>`;
        }

        // Other headings get anchor links for navigation
        return `<h${depth} id="${slug}"><a class="anchor" href="#${slug}">${text}</a></h${depth}>`;
      },
    },
  });

  // Store codeBlocks on marked instance for later processing
  (marked as any).__codeBlocks = codeBlocks;

  return marked;
}

/**
 * Render markdown to HTML
 */
export async function renderMarkdown(
  markdown: string,
  options: RenderOptions
): Promise<string> {
  const marked = createMarkdownRenderer(options);
  let html = await marked.parse(markdown);

  // Process code blocks with syntax highlighting
  const codeBlocks = (marked as any).__codeBlocks as Array<{
    placeholder: string;
    code: string;
    lang: string;
    isMermaid: boolean;
  }>;

  for (const block of codeBlocks) {
    const highlighted = await highlightCode(block.code, block.lang);
    html = html.replace(block.placeholder, highlighted);
  }

  return html;
}
