import { defineConfig } from 'vite';
import { splitText } from './vite/split-text.js';
import { inlineCss } from './vite/inline-css.js';
import { preloadCriticalFonts } from './vite/preload-fonts.js';

// Đường dẫn tương đối: chạy được cả ở domain gốc (Vercel) lẫn thư mục con (GitHub Pages)
export default defineConfig({
  base: './',
  plugins: [splitText(), preloadCriticalFonts(), inlineCss()],
});
