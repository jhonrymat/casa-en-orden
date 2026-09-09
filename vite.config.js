import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Durante desarrollo local (npm run dev), reenvía las llamadas /api
    // al servidor Express que corre en el puerto 3001 (npm run dev:server).
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
