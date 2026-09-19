import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Library build for the published package. The three in-repo consumers do NOT
// use this: each aliases `@agent-scope/graph-canvas` straight at `src/index.ts`,
// so they compile the source and this config only exists for `npm publish`.
//
// Bundled rather than transpiled file-by-file because the source uses
// extension-less relative imports, which is correct TypeScript and invalid ESM.
// Bundling resolves them; emitting them verbatim would produce a package that
// works under a bundler and fails under Node.
//
// Everything a consumer already has is external. Inlining React or d3 here would
// ship a second copy of each into every app that installs this.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: {
      external: [
        /^react($|\/)/,
        /^react-dom($|\/)/,
        /^d3-/,
        /^@react-spring\//,
        /^lodash-es($|\/)/,
      ],
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
