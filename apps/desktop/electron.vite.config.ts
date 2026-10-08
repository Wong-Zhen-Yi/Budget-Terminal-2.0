import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Direct npm dev/preview commands must launch the desktop runtime too.
for (const key of Object.keys(process.env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete process.env[key]
}

const root = __dirname

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(root, 'electron/main.ts') },
    },
    resolve: {
      alias: { '@shared': resolve(root, 'electron/shared') },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(root, 'electron/preload.ts') },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } },
    },
    resolve: {
      alias: { '@shared': resolve(root, 'electron/shared') },
    },
  },
  renderer: {
    root: resolve(root, 'src'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        '@shared': resolve(root, 'electron/shared'),
      },
    },
    build: {
      outDir: resolve(root, 'out/renderer'),
      // Keep the complete theme available before the lazy browser entry opens pages.
      cssCodeSplit: false,
      rollupOptions: { input: resolve(root, 'src/index.html') },
    },
  },
})
