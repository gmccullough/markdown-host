# markdown-host: Initial Build Work Plan

## Overview

Build a self-contained CLI webserver that serves markdown documentation with mermaid diagram support, collapsible navigation, and basic authentication.

## Technology Stack

- **Runtime**: Bun
- **Web Framework**: Hono
- **Styling**: Tailwind CSS
- **Client Interactivity**: Alpine.js
- **Markdown**: marked + gray-matter (frontmatter)
- **Syntax Highlighting**: Shiki
- **Mermaid**: Client-side mermaid.js with panzoom

---

## Phase 1: Project Scaffolding

### 1.1 Initialize Project

- [ ] Create `package.json` with Bun as runtime
- [ ] Configure TypeScript (`tsconfig.json`)
- [ ] Set up project structure:
  ```
  src/
    cli.ts
    server.ts
    content/
    middleware/
    routes/
    render/
    client/
  ```

### 1.2 Install Dependencies

```json
{
  "dependencies": {
    "hono": "^4.x",
    "marked": "^11.x",
    "gray-matter": "^4.x",
    "shiki": "^1.x",
    "chokidar": "^3.x"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "tailwindcss": "^3.x",
    "typescript": "^5.x"
  }
}
```

### 1.3 Configure Tailwind

- [ ] Create `tailwind.config.js` with dark mode support (`class` strategy)
- [ ] Set up input CSS with Tailwind directives
- [ ] Configure content paths for purging

---

## Phase 2: Content Source Layer

### 2.1 Define Content Source Interface

```typescript
// src/content/types.ts
interface ContentSource {
  getTree(): Promise<NavNode[]>;
  getContent(path: string): Promise<FileContent | null>;
  exists(path: string): Promise<boolean>;
  watch(callback: () => void): void;
}

interface NavNode {
  name: string;        // Display name
  path: string;        // URL path
  type: 'file' | 'directory';
  children?: NavNode[];
  order?: number;      // From frontmatter
}

interface FileContent {
  raw: string;
  frontmatter: Record<string, unknown>;
  body: string;
}
```

### 2.2 Implement Filesystem Source

- [ ] `src/content/filesystem.ts`
- [ ] Recursive directory scanning
- [ ] Build navigation tree with alphabetical sorting
- [ ] Parse frontmatter from each file for metadata
- [ ] Humanize filenames for display names
- [ ] Implement file watching with chokidar

### 2.3 URL Path Resolution

- [ ] Strip root directory from paths
- [ ] Remove `.md` extension
- [ ] Handle `index.md` → `/` and `dir/index.md` → `/dir`
- [ ] Build path-to-file mapping for lookups

---

## Phase 3: Markdown Rendering Pipeline

### 3.1 Configure Marked

- [ ] `src/render/markdown.ts`
- [ ] Custom renderer for:
  - Mermaid code blocks → `<pre class="mermaid-source" data-diagram="...">`
  - Fenced code blocks → Shiki highlighted HTML
  - Internal links → rewritten URLs (strip `.md`, make relative to root)
  - Headings → add anchor IDs

### 3.2 Shiki Integration

- [ ] Load Shiki highlighter at startup (async)
- [ ] Support common languages: typescript, javascript, json, bash, markdown
- [ ] Use theme that works for both light/dark modes (or dual themes)

### 3.3 Link Rewriting

- [ ] Detect internal markdown links: `[text](./file.md)`, `[text](../other/file.md)`
- [ ] Resolve relative to current file's directory
- [ ] Convert to absolute URL path (e.g., `/other/file`)
- [ ] Preserve external links unchanged
- [ ] Handle anchor links (`#section`)

---

## Phase 4: HTML Layout & Templates

### 4.1 Base Layout

- [ ] `src/render/layout.ts`
- [ ] Full HTML document template with:
  - Tailwind CSS (inline or linked)
  - Alpine.js from CDN
  - Mermaid.js from CDN
  - Panzoom from CDN
  - Hot reload WebSocket client script
  - Dark mode class on `<html>` element

### 4.2 Page Structure

```html
<body class="flex h-screen">
  <!-- Sidebar -->
  <aside class="w-64 border-r overflow-y-auto">
    <nav x-data="navigation()">
      <!-- Collapsible tree -->
    </nav>
  </aside>

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto">
    <article class="prose dark:prose-invert max-w-4xl mx-auto p-8">
      <!-- Rendered markdown -->
    </article>
  </main>
</body>
```

### 4.3 Styling

- [ ] Use Tailwind Typography plugin (`@tailwindcss/typography`) for prose styling
- [ ] Style navigation tree (indentation, icons, hover states)
- [ ] Style mermaid containers with controls
- [ ] Responsive: sidebar collapses to hamburger on mobile
- [ ] Dark mode styles for all components

---

## Phase 5: Client-Side Interactivity

### 5.1 Navigation Component (Alpine.js)

- [ ] `src/client/nav.ts` (inlined in layout)
- [ ] Collapsible tree with expand/collapse
- [ ] Persist expanded state in localStorage
- [ ] Highlight current page
- [ ] Keyboard navigation support

### 5.2 Dark Mode Toggle

- [ ] Toggle button in header
- [ ] Persist preference in localStorage
- [ ] Apply `dark` class to `<html>` element
- [ ] Transition animation

### 5.3 Mermaid Initialization

- [ ] `src/client/mermaid-init.ts` (inlined in layout)
- [ ] Find all `.mermaid-source` elements
- [ ] Wrap each in container with controls
- [ ] Render diagram with mermaid.render()
- [ ] Handle render errors gracefully

### 5.4 Mermaid Zoom/Fullscreen Controls

- [ ] Zoom levels: 50%, 75%, 100%, 125%, 150%, 200%
- [ ] Zoom buttons with current level display
- [ ] Apply CSS `transform: scale()` to diagram
- [ ] Fullscreen button using Fullscreen API
- [ ] Initialize panzoom for drag-to-pan when zoomed
- [ ] Reset zoom on fullscreen exit
- [ ] ESC key to exit fullscreen

---

## Phase 6: Server Routes

### 6.1 Page Routes

- [ ] `src/routes/pages.ts`
- [ ] `GET /` → serve index.md, README.md, or generated index
- [ ] `GET /*` → match path to markdown file, render and serve
- [ ] 404 page for missing files
- [ ] Pass navigation tree to layout for rendering

### 6.2 Static Assets

- [ ] `GET /assets/styles.css` → compiled Tailwind CSS
- [ ] Consider inlining CSS in HTML for true single-file serving

### 6.3 Hot Reload Endpoint

- [ ] `GET /ws` → WebSocket upgrade for hot reload
- [ ] Broadcast reload message on file changes
- [ ] Client reconnects on disconnect

---

## Phase 7: Middleware

### 7.1 Basic Authentication

- [ ] `src/middleware/auth.ts`
- [ ] Parse credentials from `--auth user:pass` or `MARKDOWN_HOST_AUTH` env
- [ ] Implement HTTP Basic Auth challenge/response
- [ ] Skip auth if no credentials configured
- [ ] Secure comparison to prevent timing attacks

### 7.2 Error Handling

- [ ] Global error handler middleware
- [ ] Friendly error pages
- [ ] Log errors to console

---

## Phase 8: CLI Interface

### 8.1 Argument Parsing

- [ ] `src/cli.ts`
- [ ] Positional argument: docs root path (required)
- [ ] `--port, -p` → port number (default: 3000)
- [ ] `--auth, -a` → basic auth credentials (user:pass)
- [ ] `--title, -t` → site title
- [ ] `--open, -o` → open browser on start
- [ ] `--help, -h` → show usage

### 8.2 Startup Sequence

1. Parse and validate arguments
2. Verify docs path exists
3. Initialize content source (scan files)
4. Initialize Shiki highlighter
5. Create Hono app with routes
6. Start file watcher
7. Start server
8. Print startup message with URL
9. Optionally open browser

### 8.3 Graceful Shutdown

- [ ] Handle SIGINT/SIGTERM
- [ ] Close file watchers
- [ ] Close WebSocket connections
- [ ] Exit cleanly

---

## Phase 9: Generated Index Page

### 9.1 When No index.md or README.md

- [ ] Generate HTML listing all documents
- [ ] Group by directory
- [ ] Show document titles from frontmatter
- [ ] Link to each document

---

## Phase 10: Testing & Polish

### 10.1 Test with Example Docs

- [ ] Run against `/Users/greg/repos/moxit-wonderschool-web/specs/current`
- [ ] Verify all 57 mermaid diagrams render
- [ ] Test zoom and fullscreen on diagrams
- [ ] Verify internal links work
- [ ] Test navigation expand/collapse
- [ ] Test dark mode toggle
- [ ] Test hot reload on file changes
- [ ] Test basic auth

### 10.2 Edge Cases

- [ ] Empty directories
- [ ] Files with no frontmatter
- [ ] Deeply nested directories
- [ ] Special characters in filenames
- [ ] Large files
- [ ] Invalid mermaid syntax (graceful error)
- [ ] Missing linked files (broken links)

### 10.3 Performance

- [ ] Cache rendered markdown in memory (invalidate on file change)
- [ ] Lazy-load Shiki highlighter
- [ ] Minimize client-side JS bundle

---

## Phase 11: Packaging

### 11.1 npm Package

- [ ] Configure `package.json` bin entry
- [ ] Add shebang to cli.ts: `#!/usr/bin/env bun`
- [ ] Test with `bunx` and `npx`
- [ ] Write README with usage instructions

### 11.2 Standalone Binary (Optional)

- [ ] `bun build --compile` for single executable
- [ ] Test on macOS (darwin-arm64, darwin-x64)
- [ ] Document build process

---

## Future: Cloudflare Pages Deployment

*Not in scope for initial build, but design supports it:*

- [ ] `src/content/github.ts` - GitHubSource implementation
- [ ] Cloudflare Pages Functions entry point
- [ ] GitHub OAuth or Cloudflare Access for auth
- [ ] Caching layer with Cloudflare KV
- [ ] Build/deploy scripts

---

## File Checklist

```
src/
├── cli.ts                    # CLI entry point
├── server.ts                 # Hono app factory
├── content/
│   ├── types.ts              # Interfaces
│   └── filesystem.ts         # Local file source
├── middleware/
│   └── auth.ts               # Basic auth
├── routes/
│   └── pages.ts              # Page rendering
├── render/
│   ├── markdown.ts           # Markdown → HTML
│   ├── layout.ts             # HTML template
│   └── highlight.ts          # Shiki wrapper
├── client/
│   ├── nav.ts                # Navigation JS
│   ├── mermaid.ts            # Mermaid init + controls
│   └── theme.ts              # Dark mode toggle
├── styles/
│   └── main.css              # Tailwind input
package.json
tsconfig.json
tailwind.config.js
README.md
```

---

## Success Criteria

1. `bunx markdown-host ./docs` starts server and serves docs
2. Navigation tree reflects directory structure
3. All mermaid diagrams render with zoom/fullscreen
4. Internal `.md` links work correctly
5. Dark/light mode toggle works and persists
6. Hot reload refreshes browser on file changes
7. Basic auth protects the site when configured
8. Works with the example docs at `/Users/greg/repos/moxit-wonderschool-web/specs/current`
