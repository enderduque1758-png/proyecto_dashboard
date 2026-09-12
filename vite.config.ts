import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/proyecto_dashboard/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
