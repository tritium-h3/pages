import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'

// Vite plugin: HTTP→HTTPS redirect server on port 5172 (map external port 80 here)
function httpRedirectPlugin() {
  return {
    name: 'http-redirect',
    configureServer() {
      http.createServer((req, res) => {
        const host = req.headers.host?.replace(/:\d+$/, '') ?? 'samarkand.hopto.org'
        res.writeHead(301, { Location: `https://${host}${req.url}` })
        res.end()
      }).listen(5172, '0.0.0.0')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), httpRedirectPlugin()],
  server: {
    host: '0.0.0.0',
    https: {
      cert: '/etc/ssl/certs/samarkand_hopto_org.pem',
      key: '/home/tritium/myserver.key',
    },
    allowedHosts: ['torment-nexus.local', 'samarkand.hopto.org'],
    proxy: {
      '/api': 'http://localhost:5174',
      '/ws': { target: 'ws://localhost:5174', ws: true },
    },
  },
})
