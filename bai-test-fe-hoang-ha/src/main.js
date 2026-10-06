import './fonts.css';
import './styles.css';
import './effects.css';
import gsap from 'gsap';
import Lenis from 'lenis';
import { $, $$, reduceMotion, finePointer, whenIdle } from './lib/env.js';
import { initTheme } from './modules/theme.js';
import { initHero } from './modules/hero.js';
import { initScrollFx } from './modules/scroll-fx.js';
import { initScramble } from './modules/scramble.js';
import { initInteractions } from './interactions.js';

if (reduceMotion) document.documentElement.classList.add('no-motion');

initTheme();

/* ---------------------------------------------------------
   Smooth scroll (Lenis) đồng bộ với GSAP ticker.
   Lenis cuộn trang thật (window.scrollY) nên scroll-driven CSS vẫn bám đúng vị trí.
--------------------------------------------------------- */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

const headerOffset = () => -($('[data-header]')?.offsetHeight || 70) + 1;
const scrollToTarget = (target) => {
  // force: vẫn cuộn được kể cả khi Lenis vừa bị dừng (ví dụ lúc đóng menu mobile)
  if (lenis) lenis.scrollTo(target, { offset: target === 0 ? 0 : headerOffset(), duration: 1.4, force: true });
  else {
    const top = target === 0 ? 0 : target.getBoundingClientRect().top + window.scrollY + headerOffset();
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
};

/* ---------------------------------------------------------
   Gradient chạy liền mạch qua các từ đã tách (mỗi từ là một box riêng)
--------------------------------------------------------- */
function alignGradients() {
  // Đọc hết kích thước trước, ghi style sau: xen kẽ đọc/ghi sẽ ép trình duyệt tính lại layout mỗi từ
  const groups = $$('[data-split]').flatMap((el) => ['text-gradient', 'text-gradient-gold']
    .map((cls) => $$(`.split-inner.${cls}`, el))
    .filter((words) => words.length)
    .map((words) => ({ words, widths: words.map((w) => w.offsetWidth) })));
  groups.forEach(({ words, widths }) => {
    const total = widths.reduce((a, b) => a + b, 0);
    let offset = 0;
    words.forEach((w, i) => {
      w.style.backgroundSize = `${total}px 100%`;
      w.style.backgroundPosition = `${-offset}px 0`;
      offset += widths[i];
    });
  });
}
// Đo khi font đã sẵn sàng (đo sớm hơn thì sai vì font dự phòng có độ rộng khác)
(document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(alignGradients));
let gradientTimer;
window.addEventListener('resize', () => { clearTimeout(gradientTimer); gradientTimer = setTimeout(alignGradients, 150); });

/* ---------------------------------------------------------
   Header: trạng thái cuộn, tự ẩn khi cuộn xuống
--------------------------------------------------------- */
const header = $('[data-header]');
let lastY = 0;
let ticking = false;
const onScroll = () => {
  const y = window.scrollY;
  header.classList.toggle('is-scrolled', y > 20);
  header.classList.toggle('is-hidden', y > lastY && y > 500 && !document.body.classList.contains('menu-open'));
  lastY = y;
  ticking = false;
};
window.addEventListener('scroll', () => {
  if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
}, { passive: true });
onScroll();

/* ---------------------------------------------------------
   Tạm dừng animation trang trí (vòng lặp vô hạn) của section đang ở ngoài màn hình: mỗi animation
   chạy trên luồng chính buộc trình duyệt tính lại style ở mọi khung hình, kể cả khi không ai nhìn thấy.
   Lề 300px để animation chạy lại trước khi section kịp lộ ra.
--------------------------------------------------------- */
const pauseObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.target.classList.toggle('is-paused', !e.isIntersecting));
}, { rootMargin: '300px 0px' });
$$('main > section, .site-footer').forEach((el) => pauseObserver.observe(el));

/* ---------------------------------------------------------
   Marquee: nhân bản track để chạy vòng liền mạch
--------------------------------------------------------- */
$$('.marquee-row').forEach((row) => {
  const clone = $('.marquee-track', row).cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  row.append(clone);
});

/* ---------------------------------------------------------
   Khởi tạo các phần
--------------------------------------------------------- */
initHero();
const { closeMenu } = initInteractions({ lenis, reduceMotion, finePointer });

// Link nội trang: đóng menu mobile (mở khóa cuộn) TRƯỚC, rồi mới cuộn tới section
$$('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const id = link.getAttribute('href');
    e.preventDefault();
    if (id.length < 2) return; // link placeholder "#"
    const target = id === '#top' ? 0 : $(id);
    if (target === null) return;
    closeMenu();
    scrollToTarget(target);
  });
});

if (reduceMotion) {
  $$('.reveal').forEach((el) => el.classList.add('is-visible'));
} else {
  initScrollFx(lenis);
  whenIdle(initScramble);
}

const year = $('[data-year]');
if (year) year.textContent = new Date().getFullYear();
