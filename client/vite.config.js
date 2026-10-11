import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev-режиме проксируем сокеты и API на сервер (порт 3001)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': 'http://localhost:3001',
    },
  },
});
