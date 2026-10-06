import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { $, $$ } from '../lib/env.js';

// Dự phòng cho trình duyệt chưa có scroll-driven animations (Firefox): cùng các hiệu ứng như khối
// @supports (animation-timeline) trong effects.css, dựng bằng GSAP ScrollTrigger.
export function initScrollFallback(lenis) {
  gsap.registerPlugin(ScrollTrigger);
  // Thanh địa chỉ trên mobile co giãn liên tục: không cần tính lại mọi trigger
  ScrollTrigger.config({ ignoreMobileResize: true });
  lenis?.on('scroll', ScrollTrigger.update);
  gsapFallback();
}

function gsapFallback() {
  document.documentElement.classList.add('gsap-scroll');

  // Tiêu đề section: chữ trồi lên từng từ (chữ đã được tách sẵn lúc build)
  $$('.section-title[data-split]').forEach((el) => {
    gsap.from($$('.split-inner', el), {
      yPercent: 115, rotate: 5, duration: 1.1, ease: 'expo.out', stagger: 0.04,
      scrollTrigger: { trigger: el, start: 'top 85%' },
    });
  });

  ScrollTrigger.batch('.reveal', {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1, overwrite: true }),
  });

  const scrub = $('[data-scrub]');
  if (scrub) {
    gsap.to($$('.w', scrub), {
      opacity: 1, stagger: 0.1, ease: 'none',
      scrollTrigger: { trigger: scrub, start: 'top 82%', end: 'bottom 45%', scrub: true },
    });
  }

  gsap.from('.mock-phone', {
    y: 80, opacity: 0, duration: 1.2, ease: 'expo.out',
    scrollTrigger: { trigger: '.svc-feature', start: 'top 70%' },
  });

  const progress = $('[data-progress]');
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (self) => { if (progress) progress.style.transform = `scaleX(${self.progress})`; },
  });

  const mm = gsap.matchMedia();
  mm.add('(min-width: 981px)', () => {
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

  gsap.from('[data-mega]', {
    yPercent: 50, opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.site-footer', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });
}
