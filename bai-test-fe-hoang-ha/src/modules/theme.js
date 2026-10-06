import { $, reduceMotion } from '../lib/env.js';

// Giao diện sáng/tối. Giá trị ban đầu do script nhỏ trong <head> đặt trước lần vẽ đầu tiên (không nháy màu);
// module này lo nút bấm, ghi nhớ lựa chọn và hiệu ứng chuyển bằng View Transitions API.
const THEME_COLOR = { light: '#f6f8fc', dark: '#050f24' };

export function initTheme() {
  const root = document.documentElement;
  const button = $('[data-theme-toggle]');
  const meta = $('meta[name="theme-color"]');
  const system = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = (theme) => {
    root.dataset.theme = theme;
    meta?.setAttribute('content', THEME_COLOR[theme]);
    button?.setAttribute('aria-pressed', String(theme === 'dark'));
    button?.setAttribute('aria-label', theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
    document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  };
  apply(root.dataset.theme === 'dark' ? 'dark' : 'light');

  // Người dùng chưa tự chọn thì đi theo cài đặt hệ điều hành, kể cả khi đổi lúc đang mở trang
  system.addEventListener('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* chế độ riêng tư */ }
    if (!saved) apply(e.matches ? 'dark' : 'light');
  });

  button?.addEventListener('click', (e) => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch { /* chế độ riêng tư */ }

    if (reduceMotion || !document.startViewTransition) { apply(next); return; }

    // Lan hình tròn từ đúng vị trí nút bấm ra góc xa nhất của màn hình
    const r = button.getBoundingClientRect();
    const x = e.clientX || r.left + r.width / 2;
    const y = e.clientY || r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-transition');
    const transition = document.startViewTransition(() => apply(next));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.16, 1, .3, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
    transition.finished.finally(() => root.classList.remove('theme-transition'));
  });
}
