import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'

const { supportedNodeVersion, assertCertificateEnvironment } = createRequire(import.meta.url)('../../scripts/runtime.cjs')
if (!supportedNodeVersion(process.versions.node)) throw new Error('Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ (eMudhra certificate security update).')
assertCertificateEnvironment()

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
    plugins: [react(), tailwindcss(), {
      name: 'development-websocket-policy',
      apply: 'serve',
      // Only the dev server needs HMR sockets. Shipped HTML cannot contact local services.
      transformIndexHtml: html => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"),
    }],
    server: {
      host: '127.0.0.1',
      fs: {
        strict: true,
        allow: [resolve(root, 'src'), resolve(root, 'electron/shared'), resolve(root, '../../node_modules')],
        deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx}', '**/.git/**', '**/.mcp/**'],
      },
    },
    preview: { host: '127.0.0.1' },
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        '@shared': resolve(root, 'electron/shared'),
      },
    },
    build: {
      outDir: resolve(root, 'out/renderer'),
      // Keep one complete theme for the desktop shell and startup-loaded pages.
      cssCodeSplit: false,
      rollupOptions: { input: resolve(root, 'src/index.html') },
    },
  },
})
