// Nền hero bằng WebGL (OGL, ~10 KB). Ba lớp vẽ trên cùng một canvas:
//  1. Shader toàn màn hình: dải sáng xanh/vàng chuyển động + lưới chấm hiện ra quanh con trỏ.
//  2. Đường nối giữa các điểm nút gần nhau (gl.LINES), mờ dần theo khoảng cách.
//  3. Điểm nút (gl.POINTS) trong không gian 3D, phối cảnh thật, xoay theo chuột và theo cuộn.
// Hiệu ứng "phát sáng quanh con trỏ" tính trong vertex shader (GPU), JS chỉ cập nhật vị trí điểm.
import { Renderer, Camera, Transform, Program, Mesh, Geometry, Triangle } from 'ogl';

const BLUE = [47 / 255, 125 / 255, 225 / 255];
const GOLD = [242 / 255, 165 / 255, 46 / 255];
const BOX = [3.4, 2.1, 1.4]; // kích thước khối chứa điểm nút (đơn vị thế giới)

const backgroundVertex = /* glsl */ `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

const backgroundFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;       // pixel, gốc trái dưới; ngoài màn hình = (-1e4, -1e4)
  uniform float uDark;
  uniform float uDpr;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // Đốm sáng mềm có viền gợn theo noise, tâm trôi chậm theo thời gian
  float blob(vec2 uv, vec2 center, float radius, float seed) {
    vec2 d = uv - center;
    float wobble = noise(d * 2.2 + uTime * 0.08 + seed) * 0.35;
    return exp(-dot(d, d) / (radius * radius) * (1.0 - wobble));
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = vec2(vUv.x * aspect, vUv.y);
    float t = uTime * 0.05;

    vec3 blue = vec3(${BLUE.join(', ')});
    vec3 gold = vec3(${GOLD.join(', ')});
    float b1 = blob(uv, vec2(aspect * (0.80 + 0.06 * sin(t * 3.0)), 0.92 + 0.05 * cos(t * 2.0)), 0.42, 1.0);
    float b2 = blob(uv, vec2(aspect * (0.62 + 0.08 * cos(t * 2.4)), 0.10 + 0.06 * sin(t * 3.1)), 0.34, 7.0);
    float b3 = blob(uv, vec2(aspect * (0.05 + 0.05 * sin(t * 2.7)), 0.55 + 0.08 * cos(t * 1.9)), 0.36, 13.0);

    // Màu = trung bình có trọng số của các đốm; độ phủ = tổng trọng số (chặn 1) x cường độ.
    // Màn hình dọc (mobile) các đốm phủ gần hết bề ngang nên giảm cường độ để chữ vẫn dễ đọc.
    float w1 = b1, w2 = b2 * 0.85, w3 = b3 * 0.8;
    float weight = w1 + w2 + w3;
    vec3 color = (blue * w1 + gold * w2 + mix(blue, vec3(0.35, 0.64, 0.94), 0.5) * w3) / max(weight, 1e-3);
    float strength = mix(0.30, 0.34, uDark) * mix(0.6, 1.0, step(1.0, aspect));
    float alpha = clamp(weight, 0.0, 1.0) * strength;

    // Lưới chấm: chỉ hiện trong quầng sáng quanh con trỏ, như đèn pin quét qua bề mặt
    float spacing = 26.0 * uDpr;
    vec2 cell = fract(gl_FragCoord.xy / spacing) - 0.5;
    float dotMask = 1.0 - smoothstep(0.06, 0.06 + 1.2 / spacing, length(cell));
    vec2 toMouse = (gl_FragCoord.xy - uMouse) / uDpr;
    float light = exp(-dot(toMouse, toMouse) / (2.0 * 170.0 * 170.0));
    vec3 dotColor = mix(vec3(0.12, 0.37, 0.77), gold, smoothstep(0.55, 1.0, light));
    float dotAlpha = dotMask * light * mix(0.55, 0.8, uDark);

    // Chồng lớp chấm lên lớp đốm (phép "over"), xuất alpha nhân sẵn (premultiplied)
    vec3 premul = dotColor * dotAlpha + color * alpha * (1.0 - dotAlpha);
    float outAlpha = dotAlpha + alpha * (1.0 - dotAlpha);
    gl_FragColor = vec4(premul, outAlpha);
  }
`;

// Vertex dùng chung cho điểm và đường: chiếu ra màn hình, so khoảng cách tới con trỏ để làm sáng
const projectNearMouse = /* glsl */ `
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform vec2 uMouseNdc;
  uniform float uAspect;
  float nearMouse(vec4 clip) {
    vec2 ndc = clip.xy / clip.w;
    vec2 d = (ndc - uMouseNdc) * vec2(uAspect, 1.0);
    return exp(-dot(d, d) / 0.045);
  }
`;

const pointVertex = /* glsl */ `
  attribute vec3 position;
  attribute float size;
  attribute float gold;
  uniform float uDpr;
  ${projectNearMouse}
  varying float vGold;
  varying float vGlow;
  varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vGlow = nearMouse(gl_Position);
    vGold = max(gold, vGlow);
    vDepth = clamp((-mv.z - 3.0) / 3.0, 0.0, 1.0); // xa hơn thì mờ hơn
    gl_PointSize = size * uDpr * (1.0 + vGlow * 1.4) * (6.0 / -mv.z);
  }
`;

const pointFragment = /* glsl */ `
  precision highp float;
  uniform float uDark;
  varying float vGold;
  varying float vGlow;
  varying float vDepth;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = 1.0 - smoothstep(0.18, 0.26, d);
    float halo = (1.0 - smoothstep(0.0, 0.5, d)) * 0.45 * (0.4 + vGlow);
    vec3 color = mix(vec3(${BLUE.join(', ')}), vec3(${GOLD.join(', ')}), vGold);
    float alpha = (core + halo) * mix(0.95, 0.35, vDepth) * mix(0.9, 1.0, uDark);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const lineVertex = /* glsl */ `
  attribute vec3 position;
  attribute float strength;
  ${projectNearMouse}
  varying float vStrength;
  varying float vGlow;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vGlow = nearMouse(gl_Position);
    vStrength = strength;
  }
`;

const lineFragment = /* glsl */ `
  precision highp float;
  uniform float uDark;
  varying float vStrength;
  varying float vGlow;
  void main() {
    vec3 color = mix(vec3(${BLUE.join(', ')}), vec3(${GOLD.join(', ')}), vGlow);
    float alpha = vStrength * (mix(0.30, 0.38, uDark) + vGlow * 0.55);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

export function initHeroGL(canvas) {
  let renderer;
  try {
    renderer = new Renderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, dpr: Math.min(window.devicePixelRatio || 1, 1.75) });
  } catch {
    return false;
  }
  const { gl } = renderer;
  if (!gl) return false;
  // GPU giả lập bằng CPU (máy ảo, driver lỗi, Chrome tắt tăng tốc phần cứng): shader toàn màn hình sẽ
  // chiếm luồng chính, nên nhường cho bản canvas 2D
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return false;
  }
  gl.clearColor(0, 0, 0, 0);

  const host = canvas.parentElement;
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  const count = mobile ? 46 : 96;
  const linkDistance = mobile ? 1.05 : 0.92;
  const maxLines = count * 10;
  const dark = () => (document.documentElement.dataset.theme === 'dark' ? 1 : 0);

  const camera = new Camera(gl, { fov: 40, near: 0.1, far: 30 });
  camera.position.set(0, 0, 6);
  const scene = new Transform();

  /* ---------- Lớp 1: nền shader ---------- */
  const bgProgram = new Program(gl, {
    vertex: backgroundVertex,
    fragment: backgroundFragment,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: [1, 1] },
      uMouse: { value: [-1e4, -1e4] },
      uDark: { value: dark() },
      uDpr: { value: renderer.dpr },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const background = new Mesh(gl, { geometry: new Triangle(gl), program: bgProgram });

  /* ---------- Điểm nút ---------- */
  const nodes = Array.from({ length: count }, () => ({
    p: BOX.map((s) => (Math.random() - 0.5) * s),
    v: BOX.map(() => (Math.random() - 0.5) * 0.0035),
  }));
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count).map(() => 5 + Math.random() * 6);
  const golds = new Float32Array(count).map(() => (Math.random() < 0.2 ? 1 : 0));

  const shared = { uMouseNdc: { value: [9, 9] }, uAspect: { value: 1 }, uDark: { value: dark() } };
  const pointGeometry = new Geometry(gl, {
    position: { size: 3, data: positions },
    size: { size: 1, data: sizes },
    gold: { size: 1, data: golds },
  });
  const pointProgram = new Program(gl, {
    vertex: pointVertex,
    fragment: pointFragment,
    uniforms: { ...shared, uDpr: { value: renderer.dpr } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Mesh(gl, { mode: gl.POINTS, geometry: pointGeometry, program: pointProgram });

  /* ---------- Đường nối ---------- */
  const linePositions = new Float32Array(maxLines * 2 * 3);
  const lineStrength = new Float32Array(maxLines * 2);
  const lineGeometry = new Geometry(gl, {
    position: { size: 3, data: linePositions },
    strength: { size: 1, data: lineStrength },
  });
  const lineProgram = new Program(gl, {
    vertex: lineVertex,
    fragment: lineFragment,
    uniforms: shared,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new Mesh(gl, { mode: gl.LINES, geometry: lineGeometry, program: lineProgram });

  // Alpha nhân sẵn: blend ONE / ONE_MINUS_SRC_ALPHA đúng cho cả nền sáng lẫn tối
  [bgProgram, pointProgram, lineProgram].forEach((p) => p.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA));

  const network = new Transform();
  points.setParent(network);
  lines.setParent(network);
  network.setParent(scene);

  /* ---------- Tương tác ---------- */
  const pointer = { x: 0, y: 0, active: false, px: -1e4, py: -1e4 };
  const rot = { x: 0, y: 0 };
  host.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    pointer.px = (e.clientX - r.left) * renderer.dpr;
    pointer.py = (r.height - (e.clientY - r.top)) * renderer.dpr;
    pointer.active = true;
  });
  host.addEventListener('pointerleave', () => { pointer.active = false; });
  document.addEventListener('themechange', () => {
    bgProgram.uniforms.uDark.value = dark();
    shared.uDark.value = dark();
  });

  function resize() {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.perspective({ aspect: width / height });
    bgProgram.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
    shared.uAspect.value = width / height;
    if (!running) frame(performance.now());
  }

  /* ---------- Vòng lặp ---------- */
  let running = false;
  let raf = 0;
  let last = performance.now();
  const glow = { x: 9, y: 9, px: -1e4, py: -1e4 };

  function update(dt) {
    for (const n of nodes) {
      for (let k = 0; k < 3; k++) {
        n.p[k] += n.v[k] * dt;
        const half = BOX[k] / 2;
        if (n.p[k] < -half || n.p[k] > half) n.v[k] *= -1;
      }
    }
    nodes.forEach((n, i) => positions.set(n.p, i * 3));
    pointGeometry.attributes.position.needsUpdate = true;

    // Khoảng cách không đổi khi xoay cả khối, nên tính cặp gần nhau trong hệ toạ độ của khối
    let l = 0;
    for (let i = 0; i < count && l < maxLines; i++) {
      const a = nodes[i].p;
      for (let j = i + 1; j < count && l < maxLines; j++) {
        const b = nodes[j].p;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > linkDistance) continue;
        const s = (1 - d / linkDistance) ** 1.5;
        linePositions.set(a, l * 6);
        linePositions.set(b, l * 6 + 3);
        lineStrength[l * 2] = s;
        lineStrength[l * 2 + 1] = s;
        l++;
      }
    }
    lineGeometry.attributes.position.needsUpdate = true;
    lineGeometry.attributes.strength.needsUpdate = true;
    lineGeometry.setDrawRange(0, l * 2);
  }

  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.67); // chuẩn hoá theo 60 fps, chặn khi tab vừa quay lại
    last = now;
    if (running) update(dt);

    // Xoay khối theo chuột (làm mượt) + trôi chậm theo thời gian + nghiêng theo tiến độ cuộn
    const scroll = Math.min(1, window.scrollY / Math.max(1, host.offsetHeight));
    rot.y += ((pointer.active ? pointer.x * 0.35 : 0) - rot.y) * 0.04;
    rot.x += ((pointer.active ? -pointer.y * 0.22 : 0) - rot.x) * 0.04;
    network.rotation.y = rot.y + now * 0.00004;
    network.rotation.x = rot.x + scroll * 0.6;
    network.position.y = scroll * 0.8;

    // Quầng sáng con trỏ cũng đi theo có độ trễ, nhìn mềm hơn
    const target = pointer.active ? pointer : { x: 9, y: 9, px: -1e4, py: -1e4 };
    const ease = pointer.active ? 0.18 : 1;
    glow.x += (target.x - glow.x) * ease;
    glow.y += (target.y - glow.y) * ease;
    glow.px += (target.px - glow.px) * ease;
    glow.py += (target.py - glow.py) * ease;
    shared.uMouseNdc.value = [glow.x, glow.y];
    bgProgram.uniforms.uMouse.value = [glow.px, glow.py];
    bgProgram.uniforms.uTime.value = now / 1000;

    renderer.render({ scene: background, clear: true });
    renderer.render({ scene, camera, clear: false });
    if (running) raf = requestAnimationFrame(frame);
  }

  const start = () => {
    if (running || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  // Chỉ chạy khi hero đang trên màn hình và tab đang mở: không tốn GPU khi người dùng đã cuộn đi
  let visible = false;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : visible && start()));
  new ResizeObserver(resize).observe(host);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });

  update(0);
  resize();
  return true;
}
