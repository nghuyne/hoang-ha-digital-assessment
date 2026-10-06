#!/usr/bin/env node
// Đo thông lượng đường đọc của phòng chờ (GET /api/queue/status) trên MỘT instance.
//
//   node tools/bench-status.mjs [--base http://localhost:8080] [--users 2000] [--concurrency 200] [--seconds 10]
//
// Mỗi user hỏi tối đa 1 lần/giây (đúng hành vi client thật), nên rate limit không cắt số đo.
// Kết quả phụ thuộc máy; dùng để ước lượng cần bao nhiêu instance cho 100.000 người.

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const BASE = args.base || 'http://localhost:8080';
const USERS = Number(args.users || 2000);
const CONCURRENCY = Number(args.concurrency || 200);
const SECONDS = Number(args.seconds || 10);
const PREFIX = args.prefix || 'bench-';   // chạy song song nhiều tiến trình: mỗi tiến trình một tiền tố để không chung user

const latencies = [];
const codes = {};
let next = 0;
const lastAsked = new Map();
const end = Date.now() + SECONDS * 1000;

async function worker() {
  while (Date.now() < end) {
    const user = PREFIX + (next++ % USERS);
    const wait = (lastAsked.get(user) || 0) + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAsked.set(user, Date.now());
    const t = performance.now();
    const res = await fetch(BASE + '/api/queue/status', { headers: { 'X-User-Id': user } });
    await res.arrayBuffer();
    latencies.push(performance.now() - t);
    codes[res.status] = (codes[res.status] || 0) + 1;
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))].toFixed(1);
console.log({
  requests: latencies.length,
  rps: Math.round(latencies.length / SECONDS),
  p50ms: pct(0.5),
  p99ms: pct(0.99),
  status: codes,
});
