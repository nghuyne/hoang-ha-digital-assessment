// Giải Proof-of-Work trong Web Worker để giao diện không bị đứng.
// Tìm nonce sao cho SHA-256(challenge + ":" + nonce) có ít nhất `bits` bit 0 ở đầu.
self.onmessage = async (e) => {
  const { challenge, bits } = e.data;
  const enc = new TextEncoder();
  const started = performance.now();
  for (let nonce = 0; ; nonce++) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(challenge + ':' + nonce)));
    if (leadingZeroBits(hash) >= bits) {
      self.postMessage({ nonce: String(nonce), ms: Math.round(performance.now() - started), tries: nonce + 1 });
      return;
    }
  }
};

function leadingZeroBits(bytes) {
  let bits = 0;
  for (const b of bytes) {
    if (b === 0) { bits += 8; continue; }
    bits += Math.clz32(b) - 24;
    break;
  }
  return bits;
}
