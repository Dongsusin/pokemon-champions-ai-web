import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Isolated recording server: source saves must not reload a shot mid-take.
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1', port: 5184, strictPort: true, hmr: false } })
