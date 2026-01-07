import type { NavNode } from "../content/types";

export interface LayoutOptions {
  title: string;
  siteTitle: string;
  content: string;
  nav: NavNode[];
  currentPath: string;
  styles: string;
}

/**
 * Check if a folder path should be open based on the current page path
 */
function shouldBeOpen(folderPath: string, currentPath: string): boolean {
  return currentPath.startsWith(folderPath + "/") || currentPath === folderPath;
}

/**
 * Render navigation tree as HTML
 * Server-side renders the correct open/closed state to prevent flicker
 */
function renderNav(nodes: NavNode[], currentPath: string, depth = 0): string {
  if (nodes.length === 0) return "";

  const items = nodes
    .map((node) => {
      const isActive = currentPath === node.path;
      const hasChildren = node.type === "directory" && node.children?.length;

      if (node.type === "directory") {
        // Pre-compute if this folder should be open
        const isOpen = shouldBeOpen(node.path, currentPath);
        const escapedPath = node.path.replace(/'/g, "\\'");

        return `
          <div class="nav-folder-container">
            <div
              class="nav-item nav-folder"
              @click="toggle('${escapedPath}')"
            >
              <svg
                class="w-4 h-4 transition-transform"
                :class="{ 'rotate-90': isOpen('${escapedPath}') }"
                style="${isOpen ? 'transform: rotate(90deg);' : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
              <span>${node.name}</span>
            </div>
            <div
              class="nav-children"
              x-show="isOpen('${escapedPath}')"
              ${isOpen ? '' : 'style="display: none;"'}
            >
              ${hasChildren ? renderNav(node.children!, currentPath, depth + 1) : ""}
            </div>
          </div>
        `;
      } else {
        return `
          <a
            href="${node.path}"
            class="nav-item ${isActive ? "active" : ""}"
          >
            <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span>${node.name}</span>
          </a>
        `;
      }
    })
    .join("");

  return items;
}

/**
 * Generate the client-side JavaScript for interactivity
 */
function getClientScript(): string {
  return `
    // Navigation state management
    function navigation() {
      const storageKey = 'markdown-host-nav-state';
      const currentPath = window.location.pathname;

      let savedState = {};
      try {
        savedState = JSON.parse(localStorage.getItem(storageKey) || '{}');
      } catch {}

      return {
        // Make state a reactive property so Alpine tracks changes
        state: savedState,

        isOpen(path) {
          // Check explicit state first (allows user to override auto-open)
          if (path in this.state) {
            return this.state[path];
          }
          // Auto-open paths leading to current page
          if (currentPath.startsWith(path + '/') || currentPath === path) {
            return true;
          }
          return false;
        },

        toggle(path) {
          this.state[path] = !this.isOpen(path);
          try {
            localStorage.setItem(storageKey, JSON.stringify(this.state));
          } catch {}
        }
      };
    }

    // Dark mode management
    function darkMode() {
      return {
        dark: localStorage.getItem('markdown-host-theme') !== 'light',
        init() {
          this.$watch('dark', (value) => {
            localStorage.setItem('markdown-host-theme', value ? 'dark' : 'light');
            document.documentElement.classList.toggle('dark', value);
          });
          document.documentElement.classList.toggle('dark', this.dark);
        },
        toggle() {
          this.dark = !this.dark;
        }
      };
    }

    // Mobile menu
    function mobileMenu() {
      return {
        open: false,
        toggle() {
          this.open = !this.open;
        }
      };
    }

    // Mermaid diagram controller (vanilla JS for dynamic content)
    class MermaidController {
      constructor(container) {
        this.container = container;
        this.viewport = container.querySelector('.mermaid-viewport');
        this.diagram = container.querySelector('.mermaid-diagram');
        this.zoomDisplay = container.querySelector('.zoom-display');
        this.zoomInBtn = container.querySelector('.zoom-in-btn');
        this.zoomOutBtn = container.querySelector('.zoom-out-btn');
        this.fitBtn = container.querySelector('.fit-btn');
        this.fullscreenBtn = container.querySelector('.fullscreen-btn');

        this.zoom = 100;
        this.minZoom = 10;
        this.maxZoom = 500;
        this.isFullscreen = false;
        this.naturalSvgWidth = 0;
        this.naturalSvgHeight = 0;

        this.bindEvents();
      }

      bindEvents() {
        this.zoomInBtn?.addEventListener('click', () => this.zoomBy(25));
        this.zoomOutBtn?.addEventListener('click', () => this.zoomBy(-25));
        this.fitBtn?.addEventListener('click', () => this.fitToView());
        this.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());

        // Scroll wheel zoom
        this.viewport?.addEventListener('wheel', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -10 : 10;
            this.zoomBy(delta);
          }
        }, { passive: false });

        // Also allow scroll without modifier for convenience
        this.viewport?.addEventListener('wheel', (e) => {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -15 : 15;
            this.zoomBy(delta);
          }
        }, { passive: false });

        // Resize observer for fit-to-view updates
        this.resizeObserver = new ResizeObserver(() => {
          // Refit if we were at fit-to-view zoom
          if (this._wasFitted) {
            this.fitToView();
          }
        });
        this.resizeObserver.observe(this.viewport);

        // Fullscreen change handler
        document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
      }

      setZoom(zoom) {
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        this.diagram.style.transform = 'scale(' + (this.zoom / 100) + ')';
        this.zoomDisplay.textContent = Math.round(this.zoom) + '%';
        this.zoomOutBtn.disabled = this.zoom <= this.minZoom;
        this.zoomInBtn.disabled = this.zoom >= this.maxZoom;
        this._wasFitted = false;
      }

      zoomBy(delta) {
        this.setZoom(this.zoom + delta);
      }

      measureSvg() {
        const svg = this.diagram.querySelector('svg');
        if (!svg) return false;

        // Only measure once - store natural dimensions
        if (this.naturalSvgWidth && this.naturalSvgHeight) {
          return true;
        }

        // Temporarily reset transform to measure true dimensions
        const oldTransform = this.diagram.style.transform;
        this.diagram.style.transform = 'none';
        void svg.offsetHeight; // Force reflow

        // Get SVG's natural dimensions
        const widthAttr = svg.getAttribute('width');
        const heightAttr = svg.getAttribute('height');

        let svgWidth = 0;
        let svgHeight = 0;

        // Parse width/height, handling "123.45px" or "123.45" formats
        if (widthAttr && !widthAttr.includes('%')) {
          svgWidth = parseFloat(widthAttr);
        }
        if (heightAttr && !heightAttr.includes('%')) {
          svgHeight = parseFloat(heightAttr);
        }

        // If no valid attributes, use the rendered size at scale(1)
        if (!svgWidth || !svgHeight || svgWidth < 10 || svgHeight < 10) {
          const rect = svg.getBoundingClientRect();
          svgWidth = rect.width;
          svgHeight = rect.height;
        }

        // Last resort - viewBox
        if (!svgWidth || !svgHeight || svgWidth < 10 || svgHeight < 10) {
          const viewBox = svg.viewBox?.baseVal;
          if (viewBox && viewBox.width && viewBox.height) {
            svgWidth = viewBox.width;
            svgHeight = viewBox.height;
          }
        }

        // Restore transform
        this.diagram.style.transform = oldTransform;

        if (svgWidth > 10 && svgHeight > 10) {
          this.naturalSvgWidth = svgWidth;
          this.naturalSvgHeight = svgHeight;
          return true;
        }

        return false;
      }

      fitToView() {
        if (!this.measureSvg()) {
          this.setZoom(100);
          return;
        }

        const svgWidth = this.naturalSvgWidth;
        const svgHeight = this.naturalSvgHeight;

        const viewportRect = this.viewport.getBoundingClientRect();
        const padding = 32;
        const availableWidth = viewportRect.width - padding;
        const availableHeight = viewportRect.height - padding;

        if (availableWidth <= 0 || availableHeight <= 0) {
          this.setZoom(100);
          return;
        }

        // Calculate scale to fit
        const scaleX = availableWidth / svgWidth;
        const scaleY = availableHeight / svgHeight;
        let scale = Math.min(scaleX, scaleY);

        let targetZoom = scale * 100;

        // Sanity check - clamp to min/max
        if (!isFinite(targetZoom) || targetZoom < this.minZoom) {
          targetZoom = this.minZoom;
        } else if (targetZoom > this.maxZoom) {
          targetZoom = this.maxZoom;
        }

        this.zoom = targetZoom;
        this.diagram.style.transform = 'scale(' + (this.zoom / 100) + ')';
        this.zoomDisplay.textContent = Math.round(this.zoom) + '%';
        this.zoomOutBtn.disabled = this.zoom <= this.minZoom;
        this.zoomInBtn.disabled = this.zoom >= this.maxZoom;
        this._wasFitted = true;
      }

      toggleFullscreen() {
        if (!this.isFullscreen) {
          if (this.container.requestFullscreen) {
            this.container.requestFullscreen();
          } else if (this.container.webkitRequestFullscreen) {
            this.container.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      }

      handleFullscreenChange() {
        this.isFullscreen = document.fullscreenElement === this.container ||
                           document.webkitFullscreenElement === this.container;

        // Update button icon
        const expandIcon = this.fullscreenBtn.querySelector('.expand-icon');
        const collapseIcon = this.fullscreenBtn.querySelector('.collapse-icon');
        if (expandIcon) expandIcon.style.display = this.isFullscreen ? 'none' : 'block';
        if (collapseIcon) collapseIcon.style.display = this.isFullscreen ? 'block' : 'none';

        // Force the viewport to recalculate its size
        if (this.isFullscreen) {
          // In fullscreen, viewport should fill available space
          this.viewport.style.height = 'calc(100vh - 48px)';
          this.viewport.style.maxHeight = 'none';
          this.viewport.style.width = '100vw';
        } else {
          // Reset to CSS defaults
          this.viewport.style.height = '';
          this.viewport.style.maxHeight = '';
          this.viewport.style.width = '';
        }

        // Wait for layout to fully settle, then refit
        // Use a longer delay for fullscreen transitions
        setTimeout(() => {
          requestAnimationFrame(() => {
            this.fitToView();
          });
        }, 150);
      }
    }

    // Initialize mermaid diagrams after page load
    document.addEventListener('DOMContentLoaded', async () => {
      const sources = document.querySelectorAll('.mermaid-source');

      if (sources.length === 0) return;

      // Render each diagram
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const diagram = source.dataset.diagram;

        // Create container structure
        const container = document.createElement('div');
        container.className = 'mermaid-container';
        container.innerHTML = \`
          <div class="mermaid-controls">
            <button class="zoom-out-btn" title="Zoom out (scroll down)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
              </svg>
            </button>
            <span class="zoom-display text-gray-600 dark:text-gray-400 min-w-[3rem] text-center">100%</span>
            <button class="zoom-in-btn" title="Zoom in (scroll up)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
            <button class="fit-btn ml-2" title="Fit to view">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
              </svg>
            </button>
            <div class="flex-1"></div>
            <button class="fullscreen-btn" title="Toggle fullscreen">
              <svg class="expand-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
              </svg>
              <svg class="collapse-icon w-4 h-4" style="display:none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9L4 4m0 0v4m0-4h4m6 0l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4m6 0l5 5m0 0v-4m0 4h-4"/>
              </svg>
            </button>
          </div>
          <div class="mermaid-viewport scrollbar-thin">
            <div class="mermaid-diagram">
              <div class="mermaid-render"></div>
            </div>
          </div>
        \`;

        source.parentNode.replaceChild(container, source);

        // Render the mermaid diagram
        try {
          const { svg } = await mermaid.render('mermaid-' + i, diagram);
          container.querySelector('.mermaid-render').innerHTML = svg;

          // Initialize controller and fit to view after SVG is fully rendered
          const controller = new MermaidController(container);

          // Wait for the SVG to be fully laid out before fitting
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              controller.fitToView();
            });
          });
        } catch (err) {
          container.querySelector('.mermaid-render').innerHTML =
            '<div class="text-red-500 p-4">Error rendering diagram: ' + err.message + '</div>';
        }
      }
    });

    // Hot reload WebSocket
    (function() {
      let ws;
      let reconnectTimer;

      function connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(protocol + '//' + location.host + '/__ws');

        ws.onmessage = (event) => {
          if (event.data === 'reload') {
            location.reload();
          }
        };

        ws.onclose = () => {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 1000);
        };

        ws.onerror = () => {
          ws.close();
        };
      }

      connect();
    })();
  `;
}

/**
 * Render the full HTML page
 */
export function renderLayout(options: LayoutOptions): string {
  const { title, siteTitle, content, nav, currentPath, styles } = options;
  const navHtml = renderNav(nav, currentPath);
  const clientScript = getClientScript();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${siteTitle}</title>
  <style>${styles}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.x.x/dist/cdn.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose'
    });
  </script>
</head>
<body class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  <div class="flex h-screen" x-data="mobileMenu()">
    <!-- Mobile menu button -->
    <button
      class="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-gray-100 dark:bg-gray-800"
      @click="toggle()"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path x-show="!open" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
        <path x-show="open" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>

    <!-- Sidebar -->
    <aside
      class="fixed lg:static inset-y-0 left-0 z-40 w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform lg:transform-none overflow-hidden flex flex-col"
      :class="open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
    >
      <!-- Header -->
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <a href="/" class="font-semibold text-lg">${siteTitle}</a>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-y-auto p-4 scrollbar-thin" x-data="navigation()">
        ${navHtml}
      </nav>

      <!-- Footer with dark mode toggle -->
      <div class="p-3 border-t border-gray-200 dark:border-gray-700" x-data="darkMode()" x-init="init()">
        <button
          @click="toggle()"
          class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          title="Toggle dark mode"
        >
          <svg x-show="!dark" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
          </svg>
          <svg x-show="dark" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
          </svg>
          <span x-text="dark ? 'Light mode' : 'Dark mode'"></span>
        </button>
      </div>
    </aside>

    <!-- Backdrop for mobile -->
    <div
      class="fixed inset-0 bg-black/50 z-30 lg:hidden"
      x-show="open"
      x-transition:enter="transition ease-out duration-200"
      x-transition:enter-start="opacity-0"
      x-transition:enter-end="opacity-100"
      x-transition:leave="transition ease-in duration-150"
      x-transition:leave-start="opacity-100"
      x-transition:leave-end="opacity-0"
      @click="open = false"
    ></div>

    <!-- Main content -->
    <main class="flex-1 overflow-y-auto">
      <article class="prose dark:prose-invert prose-slate max-w-4xl mx-auto p-8 lg:p-12">
        ${content}
      </article>
    </main>
  </div>

  <script>${clientScript}</script>
</body>
</html>`;
}

/**
 * Render a 404 page
 */
export function render404(siteTitle: string, styles: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found - ${siteTitle}</title>
  <style>${styles}</style>
</head>
<body class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-6xl font-bold text-gray-300 dark:text-gray-600">404</h1>
    <p class="mt-4 text-xl text-gray-600 dark:text-gray-400">Page not found</p>
    <a href="/" class="mt-6 inline-block text-blue-600 dark:text-blue-400 hover:underline">
      Go back home
    </a>
  </div>
</body>
</html>`;
}

/**
 * Render a generated index page when no index.md or README.md exists
 */
export function renderGeneratedIndex(
  nav: NavNode[],
  siteTitle: string,
  styles: string
): string {
  function renderLinks(nodes: NavNode[], depth = 0): string {
    return nodes
      .map((node) => {
        const indent = "  ".repeat(depth);
        if (node.type === "directory") {
          return `${indent}- **${node.name}**\n${node.children ? renderLinks(node.children, depth + 1) : ""}`;
        } else {
          return `${indent}- [${node.name}](${node.path})`;
        }
      })
      .join("\n");
  }

  const markdown = `# ${siteTitle}\n\n## Documents\n\n${renderLinks(nav)}`;

  return markdown;
}
