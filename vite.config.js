import { defineConfig } from 'vite';

// Đường dẫn tương đối: chạy được cả ở domain gốc (Vercel) lẫn thư mục con (GitHub Pages)
export default defineConfig({
  base: './',
});
