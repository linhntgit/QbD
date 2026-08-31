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
})
