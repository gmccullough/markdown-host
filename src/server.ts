import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import type { ContentSource } from "./content/types";
import { createAuthMiddleware } from "./middleware/auth";
import { renderMarkdown } from "./render/markdown";
import {
  render404,
  renderGeneratedIndex,
  renderLayout,
  renderHubPage,
} from "./render/layout";
import { getHighlighter } from "./render/highlight";

export interface ServerOptions {
  sources: Map<string, ContentSource>;
  auth?: string;
  styles: string | (() => string);
}

interface WSData {
  id: string;
}

export function createServer(options: ServerOptions) {
  const { sources, auth, styles } = options;
  const { upgradeWebSocket, websocket } = createBunWebSocket<WSData>();

  const app = new Hono();
  const isMultiRoot = sources.size > 1;

  // Track WebSocket connections for hot reload
  const connections = new Set<ServerWebSocket<WSData>>();

  // Auth middleware
  app.use("*", createAuthMiddleware(auth));

  // WebSocket for hot reload
  app.get(
    "/__ws",
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        connections.add(ws.raw as ServerWebSocket<WSData>);
      },
      onClose(_event, ws) {
        connections.delete(ws.raw as ServerWebSocket<WSData>);
      },
    }))
  );

  // Broadcast reload to all connected clients
  const broadcastReload = () => {
    for (const ws of connections) {
      try {
        ws.send("reload");
      } catch {
        connections.delete(ws);
      }
    }
  };

  // Set up file watching for all sources
  for (const source of sources.values()) {
    source.watch(() => {
      console.log("File change detected, reloading...");
      broadcastReload();
    });
  }

  // Serve pages
  app.get("*", async (c) => {
    const path = c.req.path;

    // Skip WebSocket path
    if (path === "/__ws") {
      return c.text("WebSocket endpoint", 400);
    }

    // Resolve styles
    const resolvedStyles = typeof styles === "function" ? styles() : styles;

    // Build sources info for layout
    const sourcesInfo = await Promise.all(
      Array.from(sources.entries()).map(async ([slug, source]) => ({
        slug,
        title: await source.getTitle(),
      }))
    );

    // Single source mode: original behavior
    if (!isMultiRoot) {
      const [slug, source] = Array.from(sources.entries())[0];
      return handleSingleSource(c, source, path, resolvedStyles);
    }

    // Multi-root mode
    // Root path shows hub page
    if (path === "/") {
      return c.html(renderHubPage(sourcesInfo, resolvedStyles));
    }

    // Parse slug from path: /:slug/rest/of/path
    const pathParts = path.split("/").filter(Boolean);
    const slug = pathParts[0];
    const source = sources.get(slug);

    if (!source) {
      return c.html(render404("Documentation", resolvedStyles), 404);
    }

    // Get content path (everything after slug)
    const contentPath = "/" + pathParts.slice(1).join("/") || "/";

    const siteTitle = await source.getTitle();
    const nav = await source.getTree();

    // Try to get content
    let content = await source.getContent(contentPath);

    // If no content and this is the root of the source, generate an index
    if (!content && contentPath === "/") {
      const indexMarkdown = renderGeneratedIndex(nav, siteTitle, resolvedStyles);
      const html = await renderMarkdown(indexMarkdown, { currentPath: path });

      return c.html(
        renderLayout({
          title: siteTitle,
          siteTitle,
          content: html,
          nav,
          currentPath: path,
          styles: resolvedStyles,
          sources: sourcesInfo,
          currentSlug: slug,
        })
      );
    }

    if (!content) {
      return c.html(render404(siteTitle, resolvedStyles), 404);
    }

    // Render markdown
    const html = await renderMarkdown(content.body, { currentPath: path });
    const pageTitle = content.frontmatter.title || siteTitle;

    return c.html(
      renderLayout({
        title: String(pageTitle),
        siteTitle,
        content: html,
        nav,
        currentPath: path,
        styles: resolvedStyles,
        sources: sourcesInfo,
        currentSlug: slug,
      })
    );
  });

  return { app, websocket, broadcastReload };
}

/**
 * Handle single source mode (original behavior, no URL prefix)
 */
async function handleSingleSource(
  c: any,
  source: ContentSource,
  path: string,
  styles: string
) {
  const siteTitle = await source.getTitle();
  const nav = await source.getTree();

  let content = await source.getContent(path);

  // If no content and this is the root, generate an index
  if (!content && path === "/") {
    const indexMarkdown = renderGeneratedIndex(nav, siteTitle, styles);
    const html = await renderMarkdown(indexMarkdown, { currentPath: path });

    return c.html(
      renderLayout({
        title: siteTitle,
        siteTitle,
        content: html,
        nav,
        currentPath: path,
        styles,
      })
    );
  }

  if (!content) {
    return c.html(render404(siteTitle, styles), 404);
  }

  const html = await renderMarkdown(content.body, { currentPath: path });
  const pageTitle = content.frontmatter.title || siteTitle;

  return c.html(
    renderLayout({
      title: String(pageTitle),
      siteTitle,
      content: html,
      nav,
      currentPath: path,
      styles,
    })
  );
}

/**
 * Pre-warm the highlighter for faster first page load
 */
export async function warmUp() {
  await getHighlighter();
}
