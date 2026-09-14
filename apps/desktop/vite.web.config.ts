import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  define: { 'import.meta.env.BROWSER_MODE': 'true' },
  root: path('./src'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path('./src'), '@shared': path('./electron/shared') },
  },
  build: { outDir: path('./out/web'), emptyOutDir: true },
})
