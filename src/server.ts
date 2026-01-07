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
} from "./render/layout";
import { getHighlighter } from "./render/highlight";

export interface ServerOptions {
  contentSource: ContentSource;
  auth?: string;
  styles: string | (() => string);
}

interface WSData {
  id: string;
}

export function createServer(options: ServerOptions) {
  const { contentSource, auth, styles } = options;
  const { upgradeWebSocket, websocket } = createBunWebSocket<WSData>();

  const app = new Hono();

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

  // Set up file watching
  contentSource.watch(() => {
    console.log("File change detected, reloading...");
    broadcastReload();
  });

  // Serve pages
  app.get("*", async (c) => {
    const path = c.req.path;

    // Skip WebSocket path
    if (path === "/__ws") {
      return c.text("WebSocket endpoint", 400);
    }

    // Resolve styles - call function if it's a function (for hot reload)
    const resolvedStyles = typeof styles === "function" ? styles() : styles;

    const siteTitle = await contentSource.getTitle();
    const nav = await contentSource.getTree();

    // Try to get content for this path
    let content = await contentSource.getContent(path);

    // If no content and this is the root, generate an index
    if (!content && path === "/") {
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
      })
    );
  });

  return { app, websocket, broadcastReload };
}

/**
 * Pre-warm the highlighter for faster first page load
 */
export async function warmUp() {
  await getHighlighter();
}
