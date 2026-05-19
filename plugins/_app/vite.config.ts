import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [react()],
    ...(isLib
      ? {
          // BUILD: genera dist/component.mjs (React como external)
          build: {
            lib: {
              entry: './src/index.tsx',
              formats: ['es'],
              fileName: 'component',
            },
            rollupOptions: {
              external: ['react', 'react-dom', 'react/jsx-runtime'],
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        }
      : {
          // DEV: servidor React completo para desarrollo aislado
          server: {
            port: 5180,
            proxy: {
              '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
              },
            },
          },
        }),
  }
})
