// Client người dùng thật. Mọi mốc thời gian lấy theo giờ server (không tin đồng hồ máy khách).
const $ = (id) => document.getElementById(id);

let userId = loadUser();
let event = null;
let clockOffset = 0;          // serverTime - Date.now()
let joined = false;
let admittedToken = null;
let pollTimer = null;
let orderTimer = null;
let pointerMoves = 0;
let myRank = null;            // vị trí cố định trong hàng, biết từ lần hỏi status gần nhất
let lastStatusAt = 0;

window.addEventListener('pointermove', () => { pointerMoves++; }, { passive: true });

function loadUser() {
  try {
    const saved = localStorage.getItem('fs-user');
    if (saved) return saved;
  } catch (_) { /* storage bị chặn: dùng id tạm */ }
  return newUserId();
}

function newUserId() {
  const id = 'web-' + Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem('fs-user', id); } catch (_) { }
  return id;
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, ...(options.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch (_) { }
  return { status: res.status, body, retryAfter: Number(res.headers.get('Retry-After')) || 0 };
}

function serverNow() { return Date.now() + clockOffset; }

function setStatus(html, cls = '') {
  const el = $('status');
  el.className = 'status ' + cls;
  el.innerHTML = html;
}

async function refreshEvent() {
  const { body } = await api('/event');
  if (!body) return;
  event = body;
  clockOffset = body.serverTime - Date.now();
  $('fairness').textContent = body.fairness === 'RANDOM' ? 'Bốc thăm công bằng' : 'Ai nhanh hơn thắng (FIFO)';
  $('remaining').textContent = body.remaining;
  $('total').textContent = body.totalStock;
  $('bar').style.width = (100 * body.remaining / body.totalStock) + '%';
}

function tick() {
  if (!event) return;
  const now = serverNow();
  const toStart = event.startAt - now;
  $('phaseLabel').textContent = toStart > 0 ? 'Mở bán sau' : 'Đã mở bán';
  $('countdown').textContent = toStart > 0 ? fmt(toStart) : '00:00';
  if (!joined) {
    const open = now >= event.joinOpensAt;
    $('joinBtn').disabled = !open;
    if (!open) {
      setStatus('Phòng chờ mở lúc ' + new Date(event.joinOpensAt - clockOffset).toLocaleTimeString() + '.');
    } else if ($('status').dataset.idle !== '0') {
      setStatus(event.fairness === 'RANDOM' && toStart > 0
        ? 'Phòng chờ đã mở. Vào bất cứ lúc nào trước giờ mở bán: thứ tự sẽ được <b>bốc thăm ngẫu nhiên</b>, vào sớm hay muộn đều như nhau.'
        : 'Bấm để vào hàng đợi.');
    }
  }
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

async function join() {
  $('joinBtn').disabled = true;
  $('status').dataset.idle = '0';
  setStatus('Đang xác minh trình duyệt (proof-of-work)…');
  const ch = await api('/pow/challenge');
  const solved = await solvePow(ch.body.challenge, ch.body.difficultyBits);
  const res = await api('/queue/join', {
    method: 'POST',
    body: JSON.stringify({ challenge: ch.body.challenge, nonce: solved.nonce }),
  });
  if (res.status !== 200) {
    $('joinBtn').disabled = false;
    $('status').dataset.idle = '';
    setStatus('Không vào được phòng chờ: <b>' + (res.body?.result || res.status) + '</b>', 'bad');
    return;
  }
  joined = true;
  $('joinBtn').hidden = true;
  setStatus('Đã vào phòng chờ (PoW ' + solved.ms + ' ms).', 'ok');
  pollStatus();
}

function solvePow(challenge, bits) {
  return new Promise((resolve) => {
    const w = new Worker('pow-worker.js');
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.postMessage({ challenge, bits });
  });
}

// Nhịp hỏi do server quyết định (pollAfterMs): người ở xa đầu hàng hỏi thưa hơn để server không bị dội.
async function pollStatus() {
  clearTimeout(pollTimer);
  const res = await api('/queue/status');
  const body = res.body;
  if (res.status === 429) { pollTimer = setTimeout(pollStatus, res.retryAfter * 1000 || 1000); return; }
  if (!body || res.status !== 200) { pollTimer = setTimeout(pollStatus, 2000); return; }
  switch (body.state) {
    case 'WAITING_FOR_START':
      setStatus('Đã vào phòng chờ. Lúc mở bán, thứ tự được bốc thăm; vị trí của bạn sẽ hiện ra sau đó.', 'ok');
      break;
    case 'WAITING':
      myRank = body.rank;
      lastStatusAt = Date.now();
      showAhead(body.ahead);
      return followProgress();
    case 'ADMITTED': {
      admittedToken = body.token;
      $('buyBtn').hidden = false;
      const secs = Math.max(0, Math.round((body.leaseExpiresAt - body.serverTime) / 1000));
      setStatus('Đến lượt bạn! Một suất đang được <b>giữ riêng cho bạn trong ' + secs + ' giây</b>: '
        + 'không cần tranh nhanh, cứ bấm <b>Mua ngay</b>.', 'ok');
      return;                                   // dừng hỏi lại: giữ token hiện tại
    }
    case 'MISSED':
      return setStatus('Bạn đã để quá thời gian giữ lượt, suất đã chuyển cho người kế tiếp.', 'bad');
    case 'PURCHASED':
      return showOrder();
    case 'SOLD_OUT':
      setStatus('Tạm hết suất. Nếu có người không thanh toán đúng hạn, suất sẽ chuyển cho <b>người kế tiếp trong hàng</b>, '
        + 'nên hãy giữ trang này mở.', 'warn');
      break;
    case 'NOT_IN_QUEUE':
      joined = false;
      $('joinBtn').hidden = false;
      $('status').dataset.idle = '';
      return;
  }
  pollTimer = setTimeout(pollStatus, body.pollAfterMs || 1000);
}

function showAhead(ahead) {
  setStatus('Còn <b>' + ahead + '</b> người phía trước. Giữ trang này mở, bạn không cần làm gì thêm.', 'warn');
}

// Trong lúc chờ, chỉ theo dõi tiến độ CHUNG của hàng (cache ở CDN/app, không tốn Redis theo đầu người).
// Chỉ hỏi lại trạng thái riêng khi con trỏ đã tới lượt mình, hết hàng, hoặc 30 giây một lần cho chắc.
async function followProgress() {
  clearTimeout(pollTimer);
  let ahead = null;
  try {
    const p = await (await fetch('/api/queue/progress')).json();
    ahead = myRank - p.cursor + 1;
    if (ahead <= 0 || p.remaining === 0 || Date.now() - lastStatusAt > 30_000) return pollStatus();
    showAhead(ahead);
  } catch (_) { /* mạng chập chờn: thử lại nhịp sau */ }
  pollTimer = setTimeout(followProgress, ahead > 1000 ? 3000 : 1000);
}

async function buy(e) {
  $('buyBtn').disabled = true;
  const signals = {
    webdriver: navigator.webdriver === true,
    pointerMoves,
    trustedClick: e.isTrusted,
    screenWidth: window.screen ? screen.width : 0,
  };
  const res = await api('/buy', { method: 'POST', body: JSON.stringify({ token: admittedToken, signals }) });
  const r = res.body?.result;
  if (r === 'RESERVED' || r === 'ALREADY_RESERVED') {
    $('buyBtn').hidden = true;
    return showOrder();
  }
  const msg = {
    SOLD_OUT: 'Rất tiếc, vừa hết hàng.',
    TOO_FAST: 'Thao tác quá nhanh, thử lại.',
    CHALLENGE_REQUIRED: 'Cần xác minh thêm (thực tế sẽ hiện CAPTCHA).',
    TOKEN_EXPIRED: 'Hết thời gian giữ lượt.',
    NOT_ADMITTED: 'Lượt mua của bạn đã hết hạn.',
    RATE_LIMITED: 'Bạn thao tác quá nhanh, thử lại sau giây lát.',
  }[r] || ('Lỗi: ' + (r || res.status));
  setStatus(msg, 'bad');
  if (r === 'TOO_FAST' || r === 'RATE_LIMITED') $('buyBtn').disabled = false;
}

async function showOrder() {
  clearTimeout(orderTimer);
  const { body } = await api('/orders/me');
  $('payBtn').hidden = body?.status !== 'RESERVED';
  switch (body?.status) {
    case 'PENDING':
      setStatus('Đã giữ suất, đang ghi đơn…', 'ok');
      orderTimer = setTimeout(showOrder, 500);
      return;
    case 'RESERVED': {
      const left = new Date(body.expires_at).getTime() - serverNow();
      setStatus('Đã giữ suất! Mã đơn <code>' + body.id + '</code>.<br>Thanh toán trong <b>' + fmt(left)
        + '</b>, quá hạn suất sẽ chuyển cho người kế tiếp.', 'ok');
      orderTimer = setTimeout(showOrder, 1000);
      return;
    }
    case 'PAID':
      return setStatus('Thanh toán thành công! Mã đơn <code>' + body.id + '</code>.', 'ok');
    case 'EXPIRED':
      return setStatus('Đơn đã hết hạn thanh toán, suất đã chuyển cho người kế tiếp trong hàng.', 'bad');
    case 'REJECTED_NO_STOCK':
      return setStatus('Rất tiếc, đơn không được xác nhận (hết hàng). Bạn sẽ không bị trừ tiền.', 'bad');
  }
}

async function pay() {
  $('payBtn').disabled = true;
  const res = await api('/orders/me/pay', { method: 'POST' });
  $('payBtn').disabled = false;
  if (res.status === 409) setStatus('Đơn đang được ghi, thử lại sau giây lát.', 'warn');
  showOrder();
}

$('joinBtn').addEventListener('click', join);
$('buyBtn').addEventListener('click', buy);
$('payBtn').addEventListener('click', pay);
$('switchUser').addEventListener('click', () => { userId = newUserId(); location.reload(); });
$('userId').textContent = userId;

$('adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const res = await fetch('/api/admin/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': f.get('adminKey') },
    body: JSON.stringify({
      startInSeconds: Number(f.get('startInSeconds')),
      fairness: f.get('fairness'),
      totalStock: Number(f.get('totalStock')),
      powBits: Number(f.get('powBits')),
      leaseSeconds: Number(f.get('leaseSeconds')),
      paymentSeconds: Number(f.get('paymentSeconds')),
    }),
  });
  if (res.ok) location.reload();
  else setStatus('Reset thất bại: HTTP ' + res.status, 'bad');
});

(async function start() {
  await refreshEvent();
  tick();
  setInterval(tick, 250);
  setInterval(refreshEvent, 3000);
  const { body } = await api('/queue/status');
  if (body && body.state && body.state !== 'NOT_IN_QUEUE') {
    joined = true;
    $('joinBtn').hidden = true;
    pollStatus();
  }
})();
