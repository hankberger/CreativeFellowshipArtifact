import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The API server reads PORT from .env; point the dev proxy at the same port so
  // `npm run dev` and `npm run dev:server` work together out of the box.
  const env = loadEnv(mode, process.cwd(), '')
  const target = `http://localhost:${env.PORT || 3000}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': target,
        '/images': target,
      },
    },
  }
})
