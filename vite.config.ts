import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: the workflow sets VITE_BASE to "/<repo>/"
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  plugins: [react()],
  base,
})
