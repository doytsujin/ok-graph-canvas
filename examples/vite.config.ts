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
    alias: {
      '@agent-scope-ca/graph-canvas': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
