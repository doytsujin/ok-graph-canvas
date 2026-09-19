import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

// The examples build against the package SOURCE, not its dist, so the site can
// never show a version of the renderer that the repository does not contain.
//
// `base` is set for a GitHub Pages project site, which serves from a
// subdirectory rather than a domain root. It is overridable because a custom
// domain would serve from `/`, and a wrong base is a page of 404s for every
// asset while the HTML itself loads fine.
export default defineConfig({
  base: process.env.SITE_BASE ?? '/ok-graph-canvas/',
  plugins: [react()],
  resolve: {
    // Array form, and the order matters: the stylesheet subpath has to match
    // before the bare specifier, or `@agent-scope-ca/graph-canvas/styles.css`
    // resolves to `src/index.ts/styles.css` and the build fails on ENOTDIR.
    // A real consumer gets both from the package's own exports map; here they
    // are two aliases because the examples build against source.
    alias: [
      {
        find: '@agent-scope-ca/graph-canvas/styles.css',
        replacement: fileURLToPath(new URL('../styles.css', import.meta.url)),
      },
      {
        find: '@agent-scope-ca/graph-canvas',
        replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      },
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
