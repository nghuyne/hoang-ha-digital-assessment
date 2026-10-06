import { $$ } from '../lib/env.js';

// Nhãn kỹ thuật (eyebrow, mono-label) "giải mã" từ ký tự ngẫu nhiên thành chữ thật khi cuộn tới.
// Hiệu ứng ngắn (<1 giây) và chỉ chạy một lần mỗi nhãn, sau đó nội dung là chữ thật.
const GLYPHS = 'ABCDEFGHIKLMNOPQRSTUVXY0123456789#%&*+/<>';

function scramble(node, finalText, onDone, duration = 900) {
  const start = performance.now();
  const chars = [...finalText];
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const revealed = Math.floor(progress * chars.length);
    node.textContent = chars
      .map((c, i) => (i < revealed || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
      .join('');
    if (progress < 1) requestAnimationFrame(tick);
    else onDone();
  };
  requestAnimationFrame(tick);
}

export function initScramble() {
  const targets = $$('.eyebrow, .mono-label').map((el) => {
    // Node chữ cuối cùng là phần nhãn (eyebrow có thêm <span> số thứ tự phía trước)
    const node = [...el.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    return node && { el, node, text: node.textContent };
  }).filter(Boolean);

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const t = targets.find((x) => x.el === entry.target);
      io.unobserve(entry.target);
      // Khóa chiều rộng trong lúc xáo: ký tự ngẫu nhiên rộng hẹp khác nhau sẽ làm giật layout
      t.el.style.width = `${t.el.getBoundingClientRect().width}px`;
      t.el.style.whiteSpace = 'nowrap';
      scramble(t.node, t.text, () => { t.el.style.width = ''; t.el.style.whiteSpace = ''; });
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  targets.forEach((t) => io.observe(t.el));
}
