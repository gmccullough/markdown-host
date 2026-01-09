#!/usr/bin/env bun

import { parseArgs } from "util";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { watch } from "chokidar";
import { FilesystemSource } from "./content/filesystem";
import { createServer, warmUp } from "./server";

const CONFIG_FILENAME = ".markdown-host.json";

interface Config {
  roots: (string | { path: string; name?: string })[];
  port?: number;
  auth?: string;
}

/**
 * Find config file by walking up from cwd
 */
function findConfig(startDir: string): string | null {
  let current = resolve(startDir);
  const root = resolve("/");

  while (current !== root) {
    const configPath = join(current, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      return configPath;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Load and parse config file, resolving relative paths
 */
function loadConfig(configPath: string): Config {
  const configDir = dirname(configPath);
  const raw = readFileSync(configPath, "utf-8");

  let config: Config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${configPath}: ${e}`);
  }

  if (!config.roots || !Array.isArray(config.roots) || config.roots.length === 0) {
    throw new Error(`Config must have a non-empty "roots" array`);
  }

  // Resolve relative paths from config file location
  config.roots = config.roots.map((root) => {
    if (typeof root === "string") {
      return resolve(configDir, root);
    } else {
      return { ...root, path: resolve(configDir, root.path) };
    }
  });

  return config;
}

/**
 * Generate a URL-safe slug from path segments
 */
function slugify(segments: string[]): string {
  return segments.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Generate unique slugs for paths, disambiguating by including parent directories when needed
 */
function generateUniqueSlugs(absolutePaths: string[]): Map<string, string> {
  const result = new Map<string, string>();

  // Split each path into segments (reversed for easy access from end)
  const pathSegments = absolutePaths.map(p => p.split("/").filter(Boolean).reverse());

  // Track how many segments we're using for each path (start with 1 = just basename)
  const segmentCounts = new Array(absolutePaths.length).fill(1);

  let hasConflicts = true;
  while (hasConflicts) {
    hasConflicts = false;

    // Generate current slugs
    const currentSlugs = pathSegments.map((segments, i) =>
      slugify(segments.slice(0, segmentCounts[i]).reverse())
    );

    // Find conflicts
    const slugGroups = new Map<string, number[]>();
    currentSlugs.forEach((slug, i) => {
      if (!slugGroups.has(slug)) slugGroups.set(slug, []);
      slugGroups.get(slug)!.push(i);
    });

    // Expand conflicting slugs
    for (const [, indices] of slugGroups) {
      if (indices.length > 1) {
        hasConflicts = true;
        for (const i of indices) {
          // Only expand if we have more segments available
          if (segmentCounts[i] < pathSegments[i].length) {
            segmentCounts[i]++;
          }
        }
      }
    }
  }

  // Build final result
  absolutePaths.forEach((path, i) => {
    const slug = slugify(pathSegments[i].slice(0, segmentCounts[i]).reverse());
    result.set(path, slug);
  });

  return result;
}

const HELP = `
markdown-host - Serve markdown documentation with mermaid support

USAGE:
  markdown-host [options]
  markdown-host <path>... [options]

ARGUMENTS:
  <path>...             One or more paths to markdown documentation roots
                        (if omitted, uses ${CONFIG_FILENAME})

OPTIONS:
  -c, --config <file>   Path to config file (default: find ${CONFIG_FILENAME})
  -p, --port <port>     Port to listen on (default: 3000)
  -a, --auth <creds>    Basic auth credentials (format: user:password)
  -o, --open            Open browser on start
  -h, --help            Show this help message

CONFIG FILE (${CONFIG_FILENAME}):
  {
    "roots": [
      "./relative/path",
      "/absolute/path",
      { "path": "./docs", "name": "Custom Name" }
    ],
    "port": 3000,
    "auth": "user:pass"
  }

EXAMPLES:
  markdown-host                           # Use config file
  markdown-host --port 8080               # Use config file, override port
  markdown-host ./docs                    # Explicit path (ignores config)
  markdown-host ./docs ./specs            # Multiple explicit paths
  markdown-host --config ~/my-config.json # Specific config file

ENVIRONMENT:
  MARKDOWN_HOST_AUTH  Basic auth credentials (alternative to --auth)
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config: { type: "string", short: "c" },
      port: { type: "string", short: "p" },
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

  let absolutePaths: string[] = [];
  let configPort: number | undefined;
  let configAuth: string | undefined;

  // If explicit paths provided, use them (skip config)
  if (positionals.length > 0) {
    for (const docPath of positionals) {
      const absolutePath = resolve(docPath);
      if (!existsSync(absolutePath)) {
        console.error(`Error: Path does not exist: ${absolutePath}`);
        process.exit(1);
      }
      absolutePaths.push(absolutePath);
    }
  } else {
    // No paths provided - look for config file
    const configPath = values.config
      ? resolve(values.config)
      : findConfig(process.cwd());

    if (!configPath) {
      console.error(`Error: No paths provided and no ${CONFIG_FILENAME} found\n`);
      console.log(HELP);
      process.exit(1);
    }

    if (!existsSync(configPath)) {
      console.error(`Error: Config file not found: ${configPath}`);
      process.exit(1);
    }

    console.log(`Using config: ${configPath}`);

    const config = loadConfig(configPath);
    configPort = config.port;
    configAuth = config.auth;

    // Validate all paths from config
    for (const root of config.roots) {
      const rootPath = typeof root === "string" ? root : root.path;
      if (!existsSync(rootPath)) {
        console.error(`Error: Path does not exist: ${rootPath}`);
        process.exit(1);
      }
      absolutePaths.push(rootPath);
    }
  }

  // CLI args override config values
  const portStr = values.port ?? configPort?.toString() ?? "3000";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port: ${portStr}`);
    process.exit(1);
  }

  const auth = values.auth || configAuth || process.env.MARKDOWN_HOST_AUTH;

  // Generate unique slugs (auto-disambiguates by including parent dirs when needed)
  const pathToSlug = generateUniqueSlugs(absolutePaths);

  // Create sources with their slugs
  const sources = new Map<string, FilesystemSource>();
  for (const absolutePath of absolutePaths) {
    const source = new FilesystemSource(absolutePath);
    const slug = pathToSlug.get(absolutePath)!;
    sources.set(slug, source);
  }

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
  for (const absolutePath of absolutePaths) {
    const slug = pathToSlug.get(absolutePath)!;
    console.log(`  /${slug}: ${absolutePath}`);
  }

  // Warm up the highlighter
  await warmUp();

  // Create server
  const { app, websocket, broadcastReload } = createServer({
    sources,
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
  const shutdown = () => {
    for (const source of sources.values()) {
      source.unwatch();
    }
    cssWatcher?.close();
    server.stop();
  };

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    shutdown();
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
