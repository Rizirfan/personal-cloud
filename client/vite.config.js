import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/storage': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
      '/search': 'http://localhost:3000',
      '/session': 'http://localhost:3000',
      '/firebase': 'http://localhost:3000',
      '/logout': 'http://localhost:3000',
      '/upload-item': 'http://localhost:3000',
      '/upload-item-stream': 'http://localhost:3000',
      '/upload-progress': 'http://localhost:3000',
      '/create-folder': 'http://localhost:3000',
      '/delete-item': 'http://localhost:3000',
      '/copy-item': 'http://localhost:3000',
      '/move-item': 'http://localhost:3000',
      '/open-file': 'http://localhost:3000'
    }
  }
})
