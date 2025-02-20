import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import { ViteMinifyPlugin } from 'vite-plugin-minify';
import ViteRestart from 'vite-plugin-restart'

// https://vitejs.dev/config/
export default defineConfig({
  base: '',
  server: {
    host: '0.0.0.0'
  },
  plugins: [
    viteCommonjs(),
    envCompatible(),
    ViteMinifyPlugin(),
    ViteRestart({restart: ['core/**', 'app/**','kasmvnc-version.txt']}),
  ],
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        screen: './screen.html',
      },
      output: {
        entryFileNames: '[name].bundle.js'
      }
    }
  },
})
