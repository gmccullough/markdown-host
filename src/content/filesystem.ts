import { watch, type FSWatcher } from "chokidar";
import matter from "gray-matter";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { ContentSource, FileContent, Frontmatter, NavNode } from "./types";

/**
 * Find the git root by walking up from a given path
 * Returns null if no git root is found
 */
function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath);
  const root = resolve("/");

  while (current !== root) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Known acronyms that contain vowels (consonant-only ones are auto-detected)
 */
const VOWEL_ACRONYMS = new Set([
  "ai", "api", "ui", "ux", "uri", "url", "io", "os",
  "aws", "gcp", "ide", "oauth", "saas", "paas", "iaas",
  "uuid", "guid", "yaml", "toml",
  "html", "css", "json", "xml", "sql", "graphql", "rest",
  "http", "https", "tcp", "udp", "ip", "dns", "ssl", "tls",
  "jwt", "ssh", "seo", "cms", "crm", "erp", "iot",
  "pdf", "svg", "png", "gif", "jpg", "jpeg", "csv", "md",
]);

/**
 * Check if a word should be fully capitalized as an acronym
 * - Known vowel-containing acronyms from explicit list
 * - 2-3 letter words with no vowels (likely acronyms: ml, db, vm, cdn, etc.)
 */
function isAcronym(word: string): boolean {
  const lower = word.toLowerCase();

  // Check explicit list (for vowel-containing acronyms)
  if (VOWEL_ACRONYMS.has(lower)) return true;

  // 2-3 letter words with no vowels are likely acronyms
  if (lower.length >= 2 && lower.length <= 3 && !/[aeiou]/.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Humanize a filename into a display name
 * e.g., "provider-authentication" -> "Provider Authentication"
 * e.g., "headless-ui" -> "Headless UI"
 * e.g., "ml-models" -> "ML Models"
 */
function humanize(filename: string): string {
  return filename
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b\w+\b/g, (word) =>
      isAcronym(word) ? word.toUpperCase() : word
    );
}

/**
 * Convert a file path to a URL path
 * e.g., "guides/setup.md" -> "/guides/setup"
 */
function filePathToUrlPath(filePath: string): string {
  let urlPath = filePath.replace(/\.md$/i, "");

  // Handle index files
  if (urlPath.endsWith("/index") || urlPath === "index") {
    urlPath = urlPath.replace(/\/?index$/, "") || "/";
  }

  return urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
}

/**
 * Content source that reads from the local filesystem
 */
export class FilesystemSource implements ContentSource {
  private rootPath: string;
  private gitRoot: string | null;
  private docsRelativePath: string | null; // Path from git root to docs (e.g., "docs/api")
  private watcher: FSWatcher | null = null;
  private pathMap: Map<string, string> = new Map(); // URL path -> file path
  private navTree: NavNode[] | null = null;
  private siteTitle: string | null = null;

  constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);
    this.gitRoot = findGitRoot(this.rootPath);

    // Calculate relative path from git root to docs directory
    if (this.gitRoot && this.rootPath !== this.gitRoot) {
      this.docsRelativePath = relative(this.gitRoot, this.rootPath);
    } else {
      this.docsRelativePath = null;
    }
  }

  async getTree(): Promise<NavNode[]> {
    if (this.navTree) {
      return this.navTree;
    }

    this.pathMap.clear();
    this.navTree = await this.scanDirectory(this.rootPath, "");
    return this.navTree;
  }

  private async scanDirectory(
    dirPath: string,
    relativePath: string
  ): Promise<NavNode[]> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const nodes: NavNode[] = [];

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith(".")) continue;

      const entryPath = join(dirPath, entry.name);
      const entryRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        const children = await this.scanDirectory(entryPath, entryRelativePath);
        if (children.length > 0) {
          nodes.push({
            name: humanize(entry.name),
            path: `/${entryRelativePath}`,
            type: "directory",
            children,
          });
        }
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        const content = await this.readFileContent(entryPath);
        const nameWithoutExt = basename(entry.name, ".md");
        const urlPath = filePathToUrlPath(entryRelativePath);

        // Store mapping
        this.pathMap.set(urlPath, entryPath);

        // Also map parent directory path to index files (but still show in nav)
        const lowerName = nameWithoutExt.toLowerCase();
        if (lowerName === "index") {
          const parentPath = urlPath === "/" ? "/" : urlPath;
          this.pathMap.set(parentPath, entryPath);
        }

        nodes.push({
          name: content?.frontmatter.title || humanize(nameWithoutExt),
          path: urlPath,
          type: "file",
          order: content?.frontmatter.order,
        });
      }
    }

    // Sort: index files first, then directories, then by order, then alphabetically
    const indexNames = ["index", "readme", "overview"];

    return nodes.sort((a, b) => {
      // Check if either is an index file
      const aIsIndex = a.type === "file" && indexNames.includes(a.path.split("/").pop()?.toLowerCase() || "");
      const bIsIndex = b.type === "file" && indexNames.includes(b.path.split("/").pop()?.toLowerCase() || "");

      // Index files come first
      if (aIsIndex && !bIsIndex) return -1;
      if (bIsIndex && !aIsIndex) return 1;

      // Among index files, sort by priority (index > readme > overview)
      if (aIsIndex && bIsIndex) {
        const aIdx = indexNames.indexOf(a.path.split("/").pop()?.toLowerCase() || "");
        const bIdx = indexNames.indexOf(b.path.split("/").pop()?.toLowerCase() || "");
        return aIdx - bIdx;
      }

      // Directories before regular files
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }

      // By order if both have it
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }

      // Items with order come first
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;

      // Alphabetically
      return a.name.localeCompare(b.name);
    });
  }

  private async readFileContent(filePath: string): Promise<FileContent | null> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const { data, content } = matter(raw);
      return {
        raw,
        frontmatter: data as Frontmatter,
        body: content,
      };
    } catch {
      return null;
    }
  }

  async getContent(urlPath: string): Promise<FileContent | null> {
    // Ensure tree is loaded (populates pathMap)
    await this.getTree();

    // Normalize path
    const normalizedPath = urlPath === "" ? "/" : urlPath;

    // Direct lookup
    let filePath = this.pathMap.get(normalizedPath);

    // Try with trailing slash variations
    if (!filePath && normalizedPath !== "/") {
      filePath = this.pathMap.get(normalizedPath + "/");
    }

    // For root or directory paths, try index.md, README.md, overview.md
    if (!filePath) {
      const dirPath =
        normalizedPath === "/"
          ? this.rootPath
          : join(this.rootPath, normalizedPath.slice(1));

      try {
        const stats = await stat(dirPath);
        if (stats.isDirectory()) {
          // Try fallback files in order of priority
          const fallbacks = ["index.md", "README.md", "overview.md"];
          for (const fallback of fallbacks) {
            const fallbackPath = join(dirPath, fallback);
            try {
              await stat(fallbackPath);
              filePath = fallbackPath;
              break;
            } catch {
              // Try next fallback
            }
          }
        }
      } catch {
        // Path doesn't exist
      }
    }

    if (!filePath) {
      return null;
    }

    return this.readFileContent(filePath);
  }

  async exists(urlPath: string): Promise<boolean> {
    const content = await this.getContent(urlPath);
    return content !== null;
  }

  watch(callback: () => void): void {
    this.watcher = watch(this.rootPath, {
      ignored: /(^|[\/\\])\../, // Ignore hidden files
      persistent: true,
      ignoreInitial: true,
    });

    const handleChange = () => {
      // Invalidate cache
      this.navTree = null;
      this.siteTitle = null;
      callback();
    };

    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("unlink", handleChange);
    this.watcher.on("addDir", handleChange);
    this.watcher.on("unlinkDir", handleChange);
  }

  unwatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Get a URL-safe slug for this source
   * e.g., "api-docs" from "/path/to/api-docs"
   */
  getSlug(): string {
    return basename(this.rootPath).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  async getTitle(): Promise<string> {
    if (this.siteTitle) {
      return this.siteTitle;
    }

    // Try to get title from index.md or README.md frontmatter
    const content = await this.getContent("/");
    if (content?.frontmatter.title) {
      this.siteTitle = content.frontmatter.title;
      return this.siteTitle;
    }

    // Use git repo name if available
    if (this.gitRoot) {
      const repoName = humanize(basename(this.gitRoot));

      // Add breadcrumb for docs subdirectory (e.g., "My Repo › api")
      if (this.docsRelativePath) {
        // Use the last segment of the relative path for context
        const pathSegments = this.docsRelativePath.split("/").filter(Boolean);
        const lastSegment = pathSegments[pathSegments.length - 1];
        this.siteTitle = `${repoName} › ${humanize(lastSegment)}`;
      } else {
        this.siteTitle = repoName;
      }
      return this.siteTitle;
    }

    // Fall back to directory name (non-git case)
    this.siteTitle = humanize(basename(this.rootPath));
    return this.siteTitle;
  }
}
