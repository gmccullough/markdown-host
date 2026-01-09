export interface NavNode {
  /** Display name (from frontmatter title or humanized filename) */
  name: string;
  /** URL path (e.g., /guides/setup) */
  path: string;
  /** Whether this is a file or directory */
  type: "file" | "directory";
  /** Child nodes for directories */
  children?: NavNode[];
  /** Sort order from frontmatter */
  order?: number;
}

export interface FileContent {
  /** Raw file content */
  raw: string;
  /** Parsed frontmatter */
  frontmatter: Frontmatter;
  /** Markdown body without frontmatter */
  body: string;
}

export interface Frontmatter {
  title?: string;
  order?: number;
  [key: string]: unknown;
}

export interface ContentSource {
  /** Get the navigation tree */
  getTree(): Promise<NavNode[]>;

  /** Get file content by URL path */
  getContent(urlPath: string): Promise<FileContent | null>;

  /** Check if a path exists */
  exists(urlPath: string): Promise<boolean>;

  /** Watch for file changes */
  watch(callback: () => void): void;

  /** Stop watching */
  unwatch(): void;

  /** Get the site title */
  getTitle(): Promise<string>;

  /** Get URL-safe slug for this source */
  getSlug(): string;
}
