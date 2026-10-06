package com.hoangha.flashsale.security;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.hoangha.flashsale.config.Keys;

/**
 * Proof-of-Work: client phải tìm nonce sao cho SHA-256(challenge + ":" + nonce) có đủ số bit 0 ở đầu.
 * Người thật chỉ tốn ~1 giây CPU một lần; kẻ chạy 10.000 tài khoản phải trả 10.000 lần.
 * PoW không phân biệt người/bot, nó chỉ làm mỗi danh tính tốn chi phí.
 */
@Service
public class PowService {

    private static final Duration CHALLENGE_TTL = Duration.ofMinutes(5);
    private final SecureRandom random = new SecureRandom();
    private final Signer signer;
    private final StringRedisTemplate redis;
    private final Keys keys;

    public PowService(Signer signer, StringRedisTemplate redis, Keys keys) {
        this.signer = signer;
        this.redis = redis;
        this.keys = keys;
    }

    public record Challenge(String challenge, int difficultyBits) { }

    public Challenge issue(String userId, int bits, long nowMs) {
        byte[] r = new byte[16];
        random.nextBytes(r);
        String payload = String.join("|", userId, Long.toString(nowMs + CHALLENGE_TTL.toMillis()),
                Integer.toString(bits), Base64.getUrlEncoder().withoutPadding().encodeToString(r));
        return new Challenge(signer.sign(payload), bits);
    }

    /** Hợp lệ khi: chữ ký đúng, đúng user, chưa hết hạn, đủ độ khó và chưa từng dùng. */
    public boolean verify(String userId, String challenge, String nonce, long nowMs) {
        String payload = signer.verify(challenge);
        if (payload == null || nonce == null || nonce.length() > 32) return false;
        String[] p = payload.split("\\|");
        if (p.length != 4 || !p[0].equals(userId) || Long.parseLong(p[1]) < nowMs) return false;
        if (leadingZeroBits(Signer.sha256(challenge + ":" + nonce)) < Integer.parseInt(p[2])) return false;
        // Mỗi challenge chỉ dùng một lần: không giải một lần rồi dùng lại cho hàng nghìn tài khoản
        return Boolean.TRUE.equals(redis.opsForValue()
                .setIfAbsent(keys.pow(Signer.sha256Hex(challenge)), "1", CHALLENGE_TTL));
    }

    static int leadingZeroBits(byte[] hash) {
        int bits = 0;
        for (byte b : hash) {
            if (b == 0) {
                bits += 8;
                continue;
            }
            bits += Integer.numberOfLeadingZeros(b & 0xff) - 24;
            break;
        }
        return bits;
    }
}
