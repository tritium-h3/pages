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
      '/api': {
        target: 'http://localhost:5174',
        // http-proxy does not propagate a client disconnect to the upstream for
        // long-lived streaming responses (e.g. the /api/image-hunt SSE stream).
        // Without this, the backend never sees req 'close', so its scan loop runs
        // forever after the browser stops/reloads and zombie loops pile up and
        // flood Ollama. Destroy the upstream request when the browser-facing
        // request closes. (For an active SSE, req 'close' only fires on a real
        // disconnect; for normal completed requests the upstream is already done,
        // so destroy() is a harmless no-op. Note: keying off res 'close' +
        // writableFinished does NOT work here — writableFinished reads true even on
        // mid-stream client disconnect, so the destroy would never fire.)
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            req.on('close', () => proxyReq.destroy());
          });
        },
      },
      '/ws': { target: 'ws://localhost:5174', ws: true },
    },
  },
})
