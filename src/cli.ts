#!/usr/bin/env bun

import { parseArgs } from "util";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { watch } from "chokidar";
import { FilesystemSource } from "./content/filesystem";
import { createServer, warmUp } from "./server";

const HELP = `
markdown-host - Serve markdown documentation with mermaid support

USAGE:
  markdown-host <path> [options]

ARGUMENTS:
  <path>              Path to the markdown documentation root

OPTIONS:
  -p, --port <port>   Port to listen on (default: 3000)
  -a, --auth <creds>  Basic auth credentials (format: user:password)
  -o, --open          Open browser on start
  -h, --help          Show this help message

EXAMPLES:
  markdown-host ./docs
  markdown-host ./docs --port 8080
  markdown-host ./docs --auth admin:secret

ENVIRONMENT:
  MARKDOWN_HOST_AUTH  Basic auth credentials (alternative to --auth)
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "3000" },
      auth: { type: "string", short: "a" },
      open: { type: "boolean", short: "o", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const docPath = positionals[0];

  if (!docPath) {
    console.error("Error: No path provided\n");
    console.log(HELP);
    process.exit(1);
  }

  const absolutePath = resolve(docPath);

  if (!existsSync(absolutePath)) {
    console.error(`Error: Path does not exist: ${absolutePath}`);
    process.exit(1);
  }

  const port = parseInt(values.port!, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port: ${values.port}`);
    process.exit(1);
  }

  const auth = values.auth || process.env.MARKDOWN_HOST_AUTH;

  // Load Tailwind CSS - use function for hot reload support
  const cssPath = new URL("./styles/output.css", import.meta.url).pathname;
  let hasCss = existsSync(cssPath);

  if (!hasCss) {
    console.warn("Warning: Compiled CSS not found. Run 'bun run build:css' for full styling.");
  }

  // Return a function that re-reads CSS on each request for hot reload
  const getStyles = () => {
    if (hasCss) {
      try {
        return readFileSync(cssPath, "utf-8");
      } catch {
        return getMinimalStyles();
      }
    }
    return getMinimalStyles();
  };

  console.log("Starting markdown-host...");
  console.log(`  Path: ${absolutePath}`);

  // Warm up the highlighter
  await warmUp();

  // Create content source
  const contentSource = new FilesystemSource(absolutePath);

  // Create server
  const { app, websocket, broadcastReload } = createServer({
    contentSource,
    auth,
    styles: getStyles,
  });

  // Start server
  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });

  // Watch CSS file for hot reload
  let cssWatcher: ReturnType<typeof watch> | null = null;
  if (hasCss) {
    cssWatcher = watch(cssPath, { ignoreInitial: true });
    cssWatcher.on("change", () => {
      console.log("CSS change detected, reloading...");
      broadcastReload();
    });
  }

  console.log(`  URL: http://localhost:${server.port}`);
  if (auth) {
    console.log("  Auth: enabled");
  }
  console.log("\nPress Ctrl+C to stop\n");

  // Open browser if requested
  if (values.open) {
    const url = `http://localhost:${server.port}`;
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";

    Bun.spawn([command, url]);
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    contentSource.unwatch();
    cssWatcher?.close();
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    contentSource.unwatch();
    cssWatcher?.close();
    server.stop();
    process.exit(0);
  });
}

function getMinimalStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; line-height: 1.6; }
    .flex { display: flex; }
    .h-screen { height: 100vh; }
    aside { width: 16rem; border-right: 1px solid #e5e7eb; padding: 1rem; overflow-y: auto; }
    main { flex: 1; padding: 2rem; overflow-y: auto; }
    article { max-width: 65ch; margin: 0 auto; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
    code { font-family: monospace; }
    a { color: #2563eb; }
    h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
    h1 { font-size: 2em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    p { margin-bottom: 1em; }
    ul, ol { margin-bottom: 1em; padding-left: 1.5em; }
    table { border-collapse: collapse; margin-bottom: 1em; }
    th, td { border: 1px solid #e5e7eb; padding: 0.5rem; }
    .nav-item { display: block; padding: 0.25rem 0.5rem; border-radius: 0.25rem; text-decoration: none; color: inherit; }
    .nav-item:hover { background: #f3f4f6; }
    .nav-item.active { background: #dbeafe; color: #1d4ed8; }
    .mermaid-container { border: 1px solid #e5e7eb; border-radius: 0.5rem; margin: 1rem 0; }
    .mermaid-controls { display: flex; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
    .mermaid-controls button { padding: 0.25rem 0.5rem; border: none; background: #e5e7eb; border-radius: 0.25rem; cursor: pointer; }
    .mermaid-viewport { padding: 1rem; overflow: auto; }
  `;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
