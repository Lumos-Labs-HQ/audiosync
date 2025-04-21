import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist', // Will output compiled code into the `dist` folder
    rollupOptions: {
      input: './src/index.html',
    },
  },
})
