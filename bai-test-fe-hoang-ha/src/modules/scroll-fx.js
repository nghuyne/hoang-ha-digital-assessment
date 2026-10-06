import { $, $$, scrollDriven } from '../lib/env.js';

/**
 * Hiệu ứng theo cuộn. Trình duyệt hỗ trợ scroll-driven animations: toàn bộ nằm trong CSS (styles.css,
 * khối @supports animation-timeline), JS chỉ đo khoảng cuộn ngang của mục Quy trình. Không hỗ trợ: dùng
 * GSAP ScrollTrigger cho cùng các hiệu ứng.
 */
export function initScrollFx(lenis) {
  markVisible();
  if (scrollDriven) {
    initProcessDistance();
    return;
  }
  // GSAP ScrollTrigger (~17 KB gzip) chỉ tải ở trình duyệt cần dự phòng, không nằm trong bundle chính
  import('./scroll-fallback.js').then(({ initScrollFallback }) => initScrollFallback(lenis));
}

// Lớp .is-visible cho hiệu ứng chạy một lần theo thời gian (thanh tiến độ trong thẻ "Tư vấn chuyển đổi số")
function markVisible() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
}

// Quy trình cuộn ngang bằng CSS (sticky + view-timeline): CSS không biết track dài bao nhiêu, nên JS đo một
// lần (và khi đổi kích thước) rồi đưa vào biến --distance. Chiều cao section = 100vh + quãng trượt ngang.
function initProcessDistance() {
  const section = $('.process');
  const track = $('[data-process-track]');
  if (!section || !track) return;
  const desktop = window.matchMedia('(min-width: 981px)');
  const measure = () => {
    const distance = desktop.matches ? Math.max(0, track.scrollWidth - window.innerWidth) : 0;
    section.style.setProperty('--distance', `${distance}px`);
  };
  measure();
  new ResizeObserver(measure).observe(track);
  desktop.addEventListener('change', measure);
}
