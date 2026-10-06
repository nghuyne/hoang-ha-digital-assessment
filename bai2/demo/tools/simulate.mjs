#!/usr/bin/env node
// Mô phỏng đợt mở bán có cả người thật và bot, chạy 2 lần (FIFO rồi RANDOM) và so sánh ai mua được.
//
//   node tools/simulate.mjs [--base http://localhost:8080] [--humans 200] [--bots 200] [--pow 12]
//
// Ba loại tác nhân:
//   human-*      vào phòng chờ lúc tùy ý, phản ứng như người (0,5-2,5 s), hỏi trạng thái theo nhịp server gợi ý,
//                90% thanh toán sau khi giữ suất, 10% bỏ ngang (đơn hết hạn, suất chuyển người kế tiếp)
//   botpro-*     bot tinh vi (scalper): giả tín hiệu trình duyệt hoàn hảo, giải PoW, canh đúng giờ G,
//                hỏi trạng thái mỗi 50 ms bất kể gợi ý (bị rate limit), và LUÔN thanh toán (để bán lại)
//   botnaive-*   bot "lười" (Selenium/headless mặc định): navigator.webdriver = true, không có chuột
// Mở http://localhost:8080/admin.html trong lúc chạy để xem dashboard. Không cần thư viện ngoài (Node >= 18).

import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const BASE = args.base || 'http://localhost:8080';
const HUMANS = Number(args.humans || 200);
const BOTS = Number(args.bots || 200);
const POW_BITS = Number(args.pow || 12);
const ADMIN_KEY = args.admin || 'demo-admin-key';
const LEASE_S = 10;          // demo: giữ lượt 10 giây (thực tế 60)
const PAYMENT_S = 8;         // demo: 8 giây để thanh toán (thực tế 10 phút)
const ROUND_LIMIT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const rand = (a, b) => a + Math.random() * (b - a);

let rateLimitedCount = 0;
async function call(path, { method = 'GET', user, body, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-User-Id'] = user;
  if (admin) headers['X-Admin-Key'] = ADMIN_KEY;
  const res = await fetch(BASE + '/api' + path, { method, headers, body: body && JSON.stringify(body) });
  if (res.status === 429) rateLimitedCount++;
  let json = null;
  try { json = await res.json(); } catch (_) { }
  return { status: res.status, body: json, retryAfter: Number(res.headers.get('Retry-After')) || 0 };
}

function solvePow(challenge, bits) {
  for (let nonce = 0; ; nonce++) {
    const h = createHash('sha256').update(challenge + ':' + nonce).digest();
    let zeros = 0;
    for (const b of h) {
      if (b === 0) { zeros += 8; continue; }
      zeros += Math.clz32(b) - 24;
      break;
    }
    if (zeros >= bits) return String(nonce);
  }
}

const SIGNALS = {
  human: { webdriver: false, pointerMoves: 37, trustedClick: true, screenWidth: 1440 },
  botpro: { webdriver: false, pointerMoves: 41, trustedClick: true, screenWidth: 1920 },   // giả mạo hoàn hảo
  botnaive: { webdriver: true, pointerMoves: 0, trustedClick: false, screenWidth: 0 },
};

// Lấy challenge và giải PoW TRƯỚC (challenge sống 5 phút), để lúc join chỉ còn một request
async function solvedChallenge(id) {
  for (;;) {
    const ch = await call('/pow/challenge', { user: id });
    if (ch.status === 200) return { challenge: ch.body.challenge, nonce: solvePow(ch.body.challenge, ch.body.difficultyBits) };
    await sleep(ch.retryAfter * 1000 || 300);
  }
}

// Join đúng thời điểm joinAt; nếu tới hơi sớm (lệch đồng hồ) thì thử lại nhanh nhưng tôn trọng rate limit
async function joinAt(id, isBot, at, clock) {
  let solved = await solvedChallenge(id);
  await sleep(at - clock.now());
  for (;;) {
    const r = await call('/queue/join', { method: 'POST', user: id, body: solved });
    if (r.status === 429) { await sleep(r.retryAfter * 1000); continue; }
    if (r.body?.result !== 'NOT_STARTED' && r.body?.result !== 'NOT_OPEN') return r;
    await sleep(isBot ? 20 : 300);
    solved = await solvedChallenge(id);         // challenge đã bị dùng (dùng một lần), lấy cái mới
  }
}

async function buyAndPay(id, kind, token) {
  let result;
  for (let i = 0; i < 20; i++) {
    const r = await call('/buy', { method: 'POST', user: id, body: { token, signals: SIGNALS[kind] } });
    result = r.body?.result;
    if (result !== 'TOO_FAST' && result !== 'RATE_LIMITED') break;
    await sleep(r.retryAfter ? r.retryAfter * 1000 : 50);
  }
  if (result !== 'RESERVED' && result !== 'ALREADY_RESERVED') return result || 'ERROR';

  const willPay = kind === 'botpro' || (kind === 'human' && Math.random() < 0.9);
  if (!willPay) return 'ABANDONED';
  await sleep(kind === 'human' ? rand(1000, 3000) : 200);
  for (let i = 0; i < 20; i++) {                       // 409: worker chưa ghi đơn vào DB, thử lại
    const p = await call('/orders/me/pay', { method: 'POST', user: id });
    if (p.status !== 409 && p.status !== 429) return p.body?.result === 'EXPIRED' ? 'PAY_TOO_LATE' : 'PAID';
    await sleep(200);
  }
  return 'PAY_FAILED';
}

async function actor(id, kind, at, clock, round) {
  const isBot = kind !== 'human';
  await joinAt(id, isBot, at, clock);

  while (!round.over) {
    const s = await call('/queue/status', { user: id });
    if (s.status === 429) { await sleep(isBot ? 50 : s.retryAfter * 1000); continue; }
    const state = s.body?.state;
    if (state === 'PURCHASED' || state === 'MISSED') return state;
    if (state === 'ADMITTED') {
      await sleep(kind === 'human' ? rand(500, 2500) : kind === 'botpro' ? 320 : 0);
      return buyAndPay(id, kind, s.body.token);
    }
    // Người thật nghe theo nhịp server gợi ý; bot tinh vi phớt lờ và dội mỗi 50 ms
    await sleep(isBot ? 50 : (s.body?.pollAfterMs || 1000));
  }
  return 'ROUND_OVER';
}

async function runRound(fairness) {
  const startIn = fairness === 'FIFO' ? 6 : 15;
  const ev = (await call('/admin/reset', {
    method: 'POST', admin: true,
    body: { startInSeconds: startIn, fairness, totalStock: 100, powBits: POW_BITS, leaseSeconds: LEASE_S, paymentSeconds: PAYMENT_S },
  })).body;
  const offset = ev.serverTime - Date.now();
  const clock = { now: () => Date.now() + offset };
  const T = ev.startAt;
  rateLimitedCount = 0;

  const actors = [];
  for (let i = 0; i < HUMANS; i++) {
    // FIFO: người thấy đồng hồ về 0 rồi mới bấm. RANDOM: vào phòng chờ lúc nào cũng được, một số đến muộn.
    const joinAt = fairness === 'FIFO' ? T + rand(400, 4000) : T + rand(-12_000, 3_000);
    actors.push(['human-' + i, 'human', joinAt]);
  }
  for (let i = 0; i < BOTS; i++) {
    const kind = i % 2 === 0 ? 'botpro' : 'botnaive';
    actors.push([kind + '-' + i, kind, fairness === 'FIFO' ? T + rand(0, 30) : T - 1000]);
  }

  process.stdout.write(`\n[${fairness}] ${HUMANS} người thật + ${BOTS} bot, mở bán sau ${startIn}s ... `);
  // Vòng kết thúc khi cả 100 suất đã thanh toán (đơn bỏ ngang đã hết hạn và chuyển người kế tiếp), hoặc quá giờ
  const round = { over: false };
  const deadline = Date.now() + startIn * 1000 + ROUND_LIMIT_MS;
  const watcher = (async () => {
    while (!round.over && Date.now() < deadline) {
      await sleep(500);
      const st = (await call('/admin/stats', { admin: true })).body;
      if (st && st.paid >= st.total) round.over = true;
    }
    round.over = true;
  })();
  const outcomes = await Promise.all(actors.map(([id, kind, at]) => actor(id, kind, at, clock, round)));
  round.over = true;
  await watcher;
  await sleep(1000);
  const stats = (await call('/admin/stats', { admin: true })).body;
  console.log('xong');

  const paidBy = (prefix) => stats.holders.filter((h) => h.status === 'PAID' && h.user_id.startsWith(prefix)).length;
  return {
    fairness,
    human: paidBy('human-'),
    botpro: paidBy('botpro-'),
    botnaive: paidBy('botnaive-'),
    expired: stats.expired,
    paid: stats.paid,
    sold: stats.sold,
    blocked: outcomes.filter((o) => o === 'CHALLENGE_REQUIRED').length,
    rateLimited: rateLimitedCount,
    // Người thật vào trước giờ G mới được bốc thăm cùng bot; người đến sau xếp sau cả nhóm
    expectedHumanShare: actors.filter(([, k, at]) => k === 'human' && at < T).length
      / actors.filter(([, k, at]) => (k === 'human' && at < T) || k === 'botpro').length,
  };
}

async function directAttack() {
  // Bot bỏ qua giao diện, gọi thẳng API mua: không token / token giả
  const results = await Promise.all(Array.from({ length: 300 }, (_, i) =>
    call('/buy', {
      method: 'POST', user: 'raw-' + i,
      body: { token: i % 2 ? 'forged.' + Buffer.from('x').toString('base64url') : null, signals: SIGNALS.botpro },
    })));
  const byStatus = {};
  for (const r of results) byStatus[r.body?.result || r.status] = (byStatus[r.body?.result || r.status] || 0) + 1;
  return byStatus;
}

(async () => {
  console.log(`Flash sale simulation -> ${BASE}   (dashboard: ${BASE}/admin.html)`);
  const rounds = [];
  rounds.push(await runRound('FIFO'));
  rounds.push(await runRound('RANDOM'));

  console.log('\nKết quả (100 sản phẩm, đếm đơn ĐÃ THANH TOÁN):');
  console.table(rounds.map((r) => ({
    'Chế độ': r.fairness,
    'Người thật': r.human,
    'Bot tinh vi': r.botpro,
    'Bot lười': r.botnaive,
    'Đơn bỏ ngang -> chuyển người sau': r.expired,
    'Bot bị đòi CAPTCHA': r.blocked,
    'Request bị 429': r.rateLimited,
    'DB đã bán': r.sold,
    'Bán vượt?': r.sold > 100 ? 'CÓ' : 'không',
  })));
  const r = rounds.find((x) => x.fairness === 'RANDOM');
  console.log(`RANDOM: kỳ vọng người thật ~${(r.expectedHumanShare * 100).toFixed(0)}% `
    + '(= người thật vào trước giờ G / (họ + bot tinh vi)): mỗi tài khoản có cơ hội như nhau.');

  console.log('\nTấn công gọi thẳng API mua (300 request, không qua phòng chờ):');
  await call('/admin/reset', { method: 'POST', admin: true, body: { startInSeconds: -1, fairness: 'RANDOM', totalStock: 100, powBits: POW_BITS } });
  console.log(await directAttack());
})().catch((e) => {
  console.error('Lỗi: ' + e.message + '\nApp đã chạy chưa? (./mvnw spring-boot:run)');
  process.exit(1);
});
