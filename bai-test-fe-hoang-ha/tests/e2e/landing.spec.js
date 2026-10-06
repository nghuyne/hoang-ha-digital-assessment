import { test, expect } from '@playwright/test';

const isMobile = (testInfo) => testInfo.project.name.includes('mobile');

test.describe('Trang chủ', () => {
  test('tải không lỗi JS, có tiêu đề và nội dung chính', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    await expect(page).toHaveTitle(/Hoàng Hà Digital/);
    // Tiêu đề được tách chữ lúc build: trình đọc màn hình vẫn đọc nguyên câu qua aria-label
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('Kiến tạo giải pháp số giúp doanh nghiệp bứt phá.');
    await expect(page.locator('.hero-stats')).toContainText('99.9');
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  test('nền động chỉ tải khi có tương tác, rồi khởi tạo không lỗi', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForTimeout(1000);
    await expect(page.locator('.hero-canvas')).not.toHaveClass(/is-ready/);

    await page.mouse.move(400, 300);
    await page.mouse.move(600, 400);
    // WebGL nếu có GPU thật, ngược lại canvas 2D dự phòng: cả hai đều gắn .is-ready
    await expect(page.locator('.hero-canvas')).toHaveClass(/is-ready/, { timeout: 10000 });
    expect(errors).toEqual([]);
  });

  test('không cuộn ngang ở bất kỳ kích thước nào', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('bấm menu thì cuộn tới đúng section', async ({ page }, testInfo) => {
    await page.goto('/');
    if (isMobile(testInfo)) {
      await page.getByRole('button', { name: 'Mở menu' }).click();
      await page.getByRole('navigation', { name: 'Điều hướng di động' }).getByRole('link', { name: /Dịch vụ/ }).click();
    } else {
      await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Dịch vụ' }).click();
    }
    await expect(page.locator('#services')).toBeInViewport({ ratio: 0.2, timeout: 5000 });
  });

  test('form báo lỗi khi thiếu dữ liệu, gửi hợp lệ thì hiện thông báo', async ({ page }) => {
    await page.goto('/#contact');
    const form = page.locator('[data-form]');
    await form.getByRole('button', { name: /Gửi yêu cầu/ }).click();
    await expect(page.getByLabel('Họ và tên *')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Họ và tên *')).toBeFocused();

    await page.getByLabel('Họ và tên *').fill('Nguyễn Văn A');
    await page.getByLabel('Số điện thoại *').fill('0912 345 678');
    await form.getByRole('button', { name: /Gửi yêu cầu/ }).click();
    await expect(page.getByRole('status')).toContainText('Bản demo', { timeout: 5000 });
  });
});

test.describe('Giao diện sáng / tối', () => {
  test('đổi giao diện, ghi nhớ sau khi tải lại', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');

    const toggle = page.getByRole('button', { name: 'Chuyển sang giao diện tối' });
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('lần đầu vào theo cài đặt hệ điều hành', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('Menu di động', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'Menu toàn màn hình chỉ có trên mobile');
  });

  test('mở, khóa cuộn, đóng bằng Esc và trả focus về nút', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('[data-menu-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mobile-menu')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/menu-open/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-menu')).toBeHidden();
    await expect(toggle).toBeFocused();
  });
});

test.describe('Giảm chuyển động', () => {
  test.use({ reducedMotion: 'reduce' });

  test('mọi nội dung hiện ngay, không phụ thuộc hiệu ứng', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/no-motion/);
    const hidden = await page.locator('.reveal').evaluateAll((els) =>
      els.filter((el) => Number(getComputedStyle(el).opacity) < 1).length);
    expect(hidden).toBe(0);
  });
});

test.describe('SEO và chia sẻ', () => {
  test('có thẻ Open Graph, canonical và JSON-LD hợp lệ', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-image\.jpg$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\//);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    expect(ld['@type']).toBe('Organization');
    expect(ld.taxID).toBe('0601330926');
    for (const path of ['og-image.jpg', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'favicon-32.png']) {
      expect((await request.get(`/${path}`)).ok(), path).toBeTruthy();
    }
  });
});
