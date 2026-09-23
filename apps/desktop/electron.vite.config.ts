import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = __dirname

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(root, 'electron/main.ts') },
    },
    resolve: {
      alias: { '@shared': resolve(root, 'electron/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
      rollupOptions: { input: resolve(root, 'src/index.html') },
    },
  },
})
