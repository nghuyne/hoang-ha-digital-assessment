import gsap from 'gsap';
import { $, $$ } from './lib/env.js';

export function initInteractions({ lenis, reduceMotion, finePointer }) {
  const closeMenu = initMobileMenu(lenis, reduceMotion);
  initScrollSpy();
  initForm();
  if (!reduceMotion) initRipple();
  if (!reduceMotion && finePointer) {
    initMagnetic();
    initTilt();
    initSpotlight();
    initHeroParallax();
  }
  return { closeMenu };
}

/* Menu mobile toàn màn hình */
function initMobileMenu(lenis, reduceMotion) {
  const toggle = $('[data-menu-toggle]');
  const menu = $('[data-mobile-menu]');
  if (!toggle || !menu) return () => {};

  const setOpen = (open) => {
    if (open === !menu.hidden) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.sr-only').textContent = open ? 'Đóng menu' : 'Mở menu';
    document.body.classList.toggle('menu-open', open);
    menu.hidden = !open;
    if (open) {
      lenis?.stop();
      if (!reduceMotion) {
        gsap.fromTo(menu, { opacity: 0 }, { opacity: 1, duration: 0.3 });
        gsap.fromTo($$('nav a, .mobile-menu-foot > *', menu),
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'expo.out' });
      }
      $('a', menu)?.focus({ preventScroll: true });
    } else {
      lenis?.start();
    }
  };

  toggle.addEventListener('click', () => setOpen(menu.hidden));
  // Link "#..." được main.js đóng menu trước khi cuộn; còn lại (tel:) đóng tại đây
  $$('a:not([href^="#"])', menu).forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); toggle.focus(); }
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 980) setOpen(false); });
  return () => setOpen(false);
}

/* Scrollspy + viên "pill" trượt theo mục đang xem */
function initScrollSpy() {
  const nav = $('[data-nav]');
  const pill = $('[data-nav-pill]');
  if (!nav || !pill) return;
  const links = $$('a', nav);
  let active = null;

  const movePill = (link) => {
    if (!link) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '1';
    pill.style.width = `${link.offsetWidth}px`;
    pill.style.transform = `translateX(${link.offsetLeft}px)`;
  };

  const setActive = (link) => {
    active = link;
    links.forEach((l) => l.classList.toggle('is-active', l === link));
    if (link) link.setAttribute('aria-current', 'true');
    links.filter((l) => l !== link).forEach((l) => l.removeAttribute('aria-current'));
    movePill(link);
  };

  // Vạch giữa màn hình: section nào cắt qua vạch này là section đang xem. IntersectionObserver không lưu
  // sẵn toạ độ như ScrollTrigger, nên vẫn đúng khi layout đổi (font tải xong, ảnh, cuộn ngang bằng CSS).
  const bySection = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const link = bySection.get(entry.target);
      if (entry.isIntersecting) setActive(link);
      else if (active === link) setActive(null);
    });
  }, { rootMargin: '-50% 0px -50% 0px' });
  links.forEach((link) => {
    const section = $(link.getAttribute('href'));
    if (!section) return;
    bySection.set(section, link);
    io.observe(section);
    link.addEventListener('mouseenter', () => movePill(link));
  });
  nav.addEventListener('mouseleave', () => movePill(active));
  window.addEventListener('resize', () => movePill(active));
}

/* Nút "nam châm" hút theo con trỏ */
function initMagnetic() {
  $$('.magnetic').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.3);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.4);
    });
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, .4)' });
    });
  });
}

/* Card nghiêng 3D theo con trỏ */
function initTilt() {
  $$('.tilt').forEach((el) => {
    const max = el.classList.contains('svc-feature') ? 4 : 7;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(el, { rotationY: px * max, rotationX: -py * max, transformPerspective: 1200, duration: 0.6, ease: 'power3.out' });
    });
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { rotationY: 0, rotationX: 0, duration: 1, ease: 'expo.out' });
    });
  });
}

/* Ánh sáng viền đi theo con trỏ */
function initSpotlight() {
  $$('.spotlight').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
}

/* Các lớp trong hero di chuyển theo độ sâu khác nhau */
function initHeroParallax() {
  const hero = $('.hero');
  const layers = $$('[data-depth]').map((el) => ({
    depth: parseFloat(el.dataset.depth),
    x: gsap.quickTo(el, 'x', { duration: 1.2, ease: 'power3.out' }),
    y: gsap.quickTo(el, 'y', { duration: 1.2, ease: 'power3.out' }),
  }));
  hero.addEventListener('pointermove', (e) => {
    const nx = e.clientX / window.innerWidth - 0.5;
    const ny = e.clientY / window.innerHeight - 0.5;
    layers.forEach((l) => { l.x(nx * 40 * l.depth); l.y(ny * 40 * l.depth); });
  });
  hero.addEventListener('pointerleave', () => layers.forEach((l) => { l.x(0); l.y(0); }));
}

/* Gợn sáng lan ra từ đúng điểm bấm trên nút */
function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.setProperty('--rx', `${e.clientX - r.left}px`);
    ripple.style.setProperty('--ry', `${e.clientY - r.top}px`);
    btn.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

/* Form liên hệ: kiểm tra dữ liệu phía client + toast */
function initForm() {
  const form = $('[data-form]');
  const toast = $('[data-toast]');
  if (!form) return;

  const validate = (input) => {
    const field = input.closest('.field');
    const ok = input.checkValidity() && input.value.trim() !== '';
    field.classList.toggle('has-error', !ok);
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  };

  const required = $$('[required]', form);
  required.forEach((input) => {
    input.addEventListener('blur', () => { if (input.value) validate(input); });
    input.addEventListener('input', () => {
      if (input.closest('.field').classList.contains('has-error')) validate(input);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const results = required.map(validate);
    if (results.includes(false)) {
      required[results.indexOf(false)].focus();
      return;
    }
    const button = $('button[type="submit"]', form);
    const label = $('[data-submit-label]', form);
    button.disabled = true;
    label.textContent = 'Đang gửi…';
    // Mô phỏng gửi yêu cầu: bài test FE không có backend, dữ liệu không được gửi đi đâu
    setTimeout(() => {
      button.disabled = false;
      label.textContent = 'Gửi yêu cầu tư vấn';
      form.reset();
      showToast(toast, 'Bản demo: form chưa kết nối máy chủ nên dữ liệu không được gửi đi.');
    }, 1100);
  });
}

function showToast(toast, message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-show'), 4200);
}
