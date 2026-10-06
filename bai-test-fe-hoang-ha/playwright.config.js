import { defineConfig, devices } from '@playwright/test';

// Test trên bản build production (vite preview), đúng thứ người dùng nhận được.
// Firefox chưa hỗ trợ scroll-driven animations: chạy Firefox là để kiểm tra luôn đường dự phòng GSAP.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Firefox + WebGL khá nặng: ít worker hơn để test không chập chờn vì máy quá tải
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
