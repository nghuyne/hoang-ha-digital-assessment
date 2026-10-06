// Nền "mạng lưới điểm nút" cho hero — lấy cảm hứng từ biểu tượng logo.
const BLUE = [47, 125, 225];
const GOLD = [242, 165, 46];

export function initNetwork(canvas, { reduceMotion = false } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const mouse = { x: -9999, y: -9999 };
  let width = 0;
  let height = 0;
  let nodes = [];
  let running = false;
  let frame = 0;

  const linkDistance = () => (width < 640 ? 110 : 150);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const widthChanged = rect.width !== width;
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Thanh địa chỉ mobile chỉ làm đổi chiều cao: giữ nguyên các điểm nút để tránh giật
    if (!widthChanged && nodes.length) { if (!running) draw(); return; }

    const count = Math.min(width < 640 ? 38 : 90, Math.round((width * height) / 16000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.8 + 1.2,
      color: Math.random() < 0.2 ? GOLD : BLUE,
    }));
    if (!running) draw();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const maxDist = linkDistance();

    for (const n of nodes) {
      if (running) {
        // hút nhẹ về phía con trỏ để tạo cảm giác tương tác
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const d = Math.hypot(dx, dy);
        if (d < 200 && d > 1) {
          n.vx += (dx / d) * 0.012;
          n.vy += (dy / d) * 0.012;
        }
        n.vx *= 0.985;
        n.vy *= 0.985;
        // giữ chuyển động tối thiểu
        if (Math.abs(n.vx) < 0.05) n.vx += (Math.random() - 0.5) * 0.05;
        if (Math.abs(n.vy) < 0.05) n.vy += (Math.random() - 0.5) * 0.05;
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < maxDist) {
          ctx.strokeStyle = `rgba(${BLUE.join(',')},${(1 - d / maxDist) * 0.28})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const md = Math.hypot(a.x - mouse.x, a.y - mouse.y);
      if (md < 190) {
        ctx.strokeStyle = `rgba(${GOLD.join(',')},${(1 - md / 190) * 0.6})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }

    for (const n of nodes) {
      ctx.fillStyle = `rgba(${n.color.join(',')},.85)`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (running) frame = requestAnimationFrame(draw);
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    frame = requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  const host = canvas.parentElement;
  host.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });
  host.addEventListener('pointerleave', () => { mouse.x = -9999; mouse.y = -9999; });

  // chỉ chạy khi hero đang hiển thị để tiết kiệm CPU
  new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop())).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  resize();
}
