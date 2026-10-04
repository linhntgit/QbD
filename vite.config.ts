import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  base: './', // relative path ensures seamless hosting on GitHub Pages, Vercel, or custom domains
  server: {
    watch: {
      ignored: ['**/*.pdf', '**/*.docx', '**/*.xlsx', '**/.git/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/katex')) {
            return 'katex-vendor';
          }
          if (id.includes('node_modules/docx')) {
            return 'docx-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons-vendor';
          }
          if (id.includes('node_modules/zod')) {
            return 'zod-vendor';
          }
        },
      },
    },
  },
})
