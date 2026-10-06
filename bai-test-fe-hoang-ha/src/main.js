import './styles.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { initNetwork } from './network.js';
import { initInteractions } from './interactions.js';

gsap.registerPlugin(ScrollTrigger);
// Thanh địa chỉ trên mobile co giãn liên tục — không cần tính lại mọi trigger
ScrollTrigger.config({ ignoreMobileResize: true });

// Luôn bắt đầu từ đầu trang để preloader + intro hero hiển thị đúng
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo(0, 0);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

if (reduceMotion) document.documentElement.classList.add('no-motion');

/* ---------------------------------------------------------
   Smooth scroll (Lenis) đồng bộ với GSAP ticker
--------------------------------------------------------- */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();
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
   Tách chữ để làm hiệu ứng reveal theo từng từ
--------------------------------------------------------- */
function splitWords(el) {
  const inners = [];
  const build = (node, extraClass = '') => {
    const out = document.createDocumentFragment();
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        // không tách tại &nbsp; để giữ các cụm từ đi liền nhau
        child.textContent.split(/([ \t\n\r]+)/).forEach((part) => {
          if (!part) return;
          if (/^[ \t\n\r]+$/.test(part)) { out.append(' '); return; }
          const word = document.createElement('span');
          word.className = 'split-word';
          const inner = document.createElement('span');
          inner.className = `split-inner ${extraClass}`.trim();
          inner.textContent = part;
          word.append(inner);
          out.append(word);
          inners.push(inner);
        });
      } else if (child.nodeName === 'BR') {
        out.append(child.cloneNode());
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        out.append(build(child, `${extraClass} ${child.className}`.trim()));
      }
    });
    return out;
  };
  const label = el.textContent.replace(/\s+/g, ' ').trim();
  const fragment = build(el);
  el.replaceChildren(fragment);
  el.setAttribute('aria-label', label);
  $$('.split-word', el).forEach((w) => w.setAttribute('aria-hidden', 'true'));
  return inners;
}

// Gradient chạy liền mạch qua các từ đã tách (mỗi từ là một box riêng)
function alignGradients() {
  $$('[data-split]').forEach((el) => {
    ['text-gradient', 'text-gradient-gold'].forEach((cls) => {
      const words = $$(`.split-inner.${cls}`, el);
      if (!words.length) return;
      const total = words.reduce((sum, w) => sum + w.offsetWidth, 0);
      let offset = 0;
      words.forEach((w) => {
        w.style.backgroundSize = `${total}px 100%`;
        w.style.backgroundPosition = `${-offset}px 0`;
        offset += w.offsetWidth;
      });
    });
  });
}

/* ---------------------------------------------------------
   Header: trạng thái cuộn, ẩn/hiện, thanh tiến trình
--------------------------------------------------------- */
const header = $('[data-header]');
const progress = $('[data-progress]');
let lastY = 0;
const onScroll = () => {
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  header.classList.toggle('is-scrolled', y > 20);
  const goingDown = y > lastY && y > 500;
  header.classList.toggle('is-hidden', goingDown && !document.body.classList.contains('menu-open'));
  lastY = y;
  if (progress) progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------------------------------------------------
   Marquee: nhân bản track để chạy vòng liền mạch
--------------------------------------------------------- */
$$('.marquee-row').forEach((row) => {
  const track = $('.marquee-track', row);
  const clone = track.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  row.append(clone);
});

/* ---------------------------------------------------------
   Hero: canvas mạng lưới
--------------------------------------------------------- */
initNetwork($('[data-network]'), { reduceMotion });

/* ---------------------------------------------------------
   Tương tác chung (menu, scrollspy, magnetic, tilt, form…)
--------------------------------------------------------- */
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

/* ---------------------------------------------------------
   Counter
--------------------------------------------------------- */
function animateCounter(el) {
  const target = parseFloat(el.dataset.count);
  const decimals = parseInt(el.dataset.decimals || '0', 10);
  if (reduceMotion) { el.textContent = target.toFixed(decimals); return; }
  const obj = { v: 0 };
  gsap.to(obj, {
    v: target,
    duration: 2,
    ease: 'power3.out',
    onUpdate: () => { el.textContent = obj.v.toFixed(decimals); },
  });
}

/* ---------------------------------------------------------
   Animation chính
--------------------------------------------------------- */
const heroTitleWords = splitWords($('.hero-title'));
const titleGroups = $$('.section-title[data-split]').map((el) => ({ el, words: splitWords(el) }));
alignGradients();
document.fonts?.ready.then(alignGradients);
window.addEventListener('resize', alignGradients);

function heroIntro() {
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.from('.site-header', { y: -40, opacity: 0, duration: 1 }, 0)
    .from('.hero-copy .badge', { y: 20, opacity: 0, duration: 1 }, 0.1)
    .from(heroTitleWords, { yPercent: 115, rotate: 6, duration: 1.2, stagger: 0.05 }, 0.15)
    .from('.hero-lead, .hero-ctas, .hero-checks', { y: 30, opacity: 0, duration: 1.1, stagger: 0.1 }, 0.55)
    .from('.hero-core', { scale: 0.4, opacity: 0, duration: 1.4, ease: 'back.out(1.6)' }, 0.3)
    .from('.orbit', { scale: 0.6, opacity: 0, duration: 1.6, stagger: 0.12 }, 0.3)
    .from('.float-card', { y: 50, opacity: 0, scale: 0.9, duration: 1.2, stagger: 0.12 }, 0.6)
    .to('.fc-line', { strokeDashoffset: 0, duration: 2, ease: 'power2.inOut' }, 0.9)
    .from('.fc-area', { opacity: 0, duration: 1.4 }, 1.4)
    .fromTo('.ring', { '--p': 0 }, { '--p': 98, duration: 1.8, ease: 'power3.out' }, 1)
    .from('.hero-stats', { y: 40, opacity: 0, duration: 1.2 }, 0.8)
    .add(() => $$('.hero-stats [data-count]').forEach(animateCounter), 0.9);
  return tl;
}

function setupScrollAnimations() {
  // Tiêu đề section: chữ trồi lên từng từ
  titleGroups.forEach(({ el, words }) => {
    gsap.from(words, {
      yPercent: 115,
      rotate: 5,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.04,
      scrollTrigger: { trigger: el, start: 'top 85%' },
    });
  });

  // Phần tử reveal theo batch
  ScrollTrigger.batch('.reveal', {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => {
      batch.forEach((el) => el.classList.add('is-visible'));
      gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1, overwrite: true });
    },
  });

  // Đoạn giới thiệu: chữ sáng dần theo tiến độ cuộn
  const scrub = $('[data-scrub]');
  if (scrub) {
    const words = scrub.textContent.trim().split(/\s+/);
    scrub.innerHTML = words.map((w) => `<span class="w">${w}</span>`).join(' ');
    gsap.to($$('.w', scrub), {
      opacity: 1,
      stagger: 0.1,
      ease: 'none',
      scrollTrigger: { trigger: scrub, start: 'top 82%', end: 'bottom 45%', scrub: true },
    });
  }


  // Mockup browser trong card dịch vụ chính
  gsap.from('.mock-phone', {
    y: 80, opacity: 0, duration: 1.2, ease: 'expo.out',
    scrollTrigger: { trigger: '.svc-feature', start: 'top 70%' },
  });

  // Quy trình: cuộn ngang trên desktop, xếp dọc trên mobile
  const mm = gsap.matchMedia();
  mm.add('(min-width: 981px)', () => {
    // Hero trôi lên & mờ dần khi cuộn qua (chỉ desktop, nơi hai cột nằm cạnh nhau)
    gsap.to('.hero-copy', {
      y: -80, opacity: 0.2, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });
    gsap.to('.hero-visual', {
      y: -140, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });

    const track = $('[data-process-track]');
    const bar = $('[data-process-bar]');
    const distance = () => track.scrollWidth - window.innerWidth;
    gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: '.process',
        pin: '[data-process-pin]',
        start: 'top top',
        end: () => `+=${distance()}`,
        scrub: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => { if (bar) bar.style.transform = `scaleX(${self.progress})`; },
      },
    });
  });
  mm.add('(max-width: 980px)', () => {
    $$('.step').forEach((step) => {
      gsap.from(step, {
        y: 50, opacity: 0, duration: 1, ease: 'expo.out',
        scrollTrigger: { trigger: step, start: 'top 90%' },
      });
    });
  });

  // Chữ lớn ở footer
  gsap.from('[data-mega]', {
    yPercent: 50, opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.site-footer', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });
}

/* ---------------------------------------------------------
   Preloader → intro
--------------------------------------------------------- */
const preloader = $('[data-preloader]');
const finishLoading = () => {
  document.body.classList.remove('is-loading');
  preloader?.remove();
  lenis?.start();
  ScrollTrigger.refresh();
};

if (reduceMotion) {
  finishLoading();
  $$('[data-count]').forEach(animateCounter);
  $$('.reveal').forEach((el) => el.classList.add('is-visible'));
} else {
  setupScrollAnimations();
  const count = $('[data-preloader-count]');
  const counter = { v: 0 };
  const pageReady = document.fonts ? document.fonts.ready : Promise.resolve();

  const tl = gsap.timeline({ paused: true });
  tl.to(counter, {
    v: 100,
    duration: 1.3,
    ease: 'power2.inOut',
    onUpdate: () => { count.textContent = Math.round(counter.v); },
  })
    .to('[data-preloader-bar]', { scaleX: 1, duration: 1.3, ease: 'power2.inOut' }, 0)
    .to('.preloader-inner', { y: -30, opacity: 0, duration: 0.5, ease: 'power2.in' })
    .to('.preloader-curtain', { scaleY: 1, duration: 0.6, ease: 'expo.inOut' }, '-=0.2')
    .set(preloader, { backgroundColor: 'transparent' })
    .to('.preloader-curtain', { scaleY: 0, transformOrigin: 'top', duration: 0.8, ease: 'expo.inOut' })
    .add(() => { heroIntro(); }, '-=0.55')
    .add(finishLoading);

  // Gỡ preloader sớm nếu tải font quá lâu
  Promise.race([pageReady, new Promise((r) => setTimeout(r, 1500))]).then(() => tl.play());
}

const year = $('[data-year]');
if (year) year.textContent = new Date().getFullYear();
