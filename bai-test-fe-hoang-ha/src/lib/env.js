export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Scroll-driven animations (animation-timeline): hiệu ứng theo cuộn chạy hoàn toàn trong CSS, trên luồng
// compositor, không tốn JS mỗi khung hình. Trình duyệt chưa hỗ trợ (Firefox) dùng GSAP ScrollTrigger thay thế.
export const scrollDriven = !reduceMotion && CSS.supports('animation-timeline: view()');

/** Chạy khi trình duyệt rảnh, để việc phụ không tranh tài nguyên với lần vẽ đầu tiên. */
export const whenIdle = (fn, timeout = 1500) =>
  ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 200));
