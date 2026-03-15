import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env['E2E_API_PORT'] ?? '3919';
const UI_PORT = Number(process.env['VITE_PORT'] ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: UI_PORT,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  build: { outDir: 'dist' },
});
