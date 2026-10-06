import gsap from 'gsap';
import { $, $$, reduceMotion, whenIdle } from '../lib/env.js';

// Intro của hero chạy hoàn toàn bằng CSS ngay khung hình đầu (xem "Hero intro" trong styles.css).
// Module này lo phần cần JS: bộ đếm số và nền WebGL.
export function initHero() {
  initCounters();
  if (reduceMotion) return;
  // Nền động là phần trang trí: chỉ tải khi người dùng bắt đầu tương tác (di chuột, chạm, cuộn, phím).
  // Lần tải đầu vì vậy không phải gánh WebGL; trước đó lớp aurora CSS và orbit đã lấp đầy hero.
  const events = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown'];
  const start = () => {
    events.forEach((e) => window.removeEventListener(e, start));
    whenIdle(loadBackground, 500);
  };
  events.forEach((e) => window.addEventListener(e, start, { passive: true, once: true }));
}

// HTML chứa sẵn số cuối (đúng cả khi không có JS). Chỉ đếm từ 0 khi khối số liệu còn chưa hiện
// (CSS cho nó hiện ở ~0,8 giây): JS tải muộn hơn thì giữ nguyên số, không để số nhảy về 0 trước mắt người xem.
function initCounters() {
  const counters = $$('.hero-stats [data-count]');
  if (reduceMotion || performance.now() > 700) return;
  counters.forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const obj = { v: 0 };
    el.textContent = (0).toFixed(decimals);
    gsap.to(obj, {
      v: target, duration: 2, delay: 0.9, ease: 'power3.out',
      onUpdate: () => { el.textContent = obj.v.toFixed(decimals); },
    });
  });
}

// Nền hero: WebGL (mạng lưới điểm nút 3D + dải sáng shader), chunk JS riêng tải theo nhu cầu.
// Không có WebGL, GPU giả lập bằng CPU, máy yếu hoặc bật tiết kiệm dữ liệu: dùng canvas 2D nhẹ hơn.
async function loadBackground() {
  let canvas = $('[data-network]');
  if (!canvas) return;
  const saveData = navigator.connection?.saveData;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;

  if (!reduceMotion && !saveData && !lowEnd) {
    try {
      const { initHeroGL } = await import('../hero-gl.js');
      if (initHeroGL(canvas)) {
        canvas.classList.add('is-ready');
        canvas.closest('.hero').classList.add('has-gl');
        return;
      }
    } catch (err) {
      console.warn('WebGL hero unavailable, using 2D fallback', err);
    }
    // Canvas đã từng tạo context WebGL thì không lấy được context 2D nữa: thay bằng canvas mới
    const fresh = canvas.cloneNode();
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  const { initNetwork } = await import('../network.js');
  initNetwork(canvas, { reduceMotion });
  canvas.classList.add('is-ready');
}
