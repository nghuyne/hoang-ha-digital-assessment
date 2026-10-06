package com.hoangha.flashsale.order;

import java.util.List;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.hoangha.flashsale.config.FlashSaleProperties;
import com.hoangha.flashsale.config.Keys;
import com.hoangha.flashsale.event.EventService;
import com.hoangha.flashsale.security.PurchaseTokenService;
import com.hoangha.flashsale.security.PurchaseTokenService.PurchaseToken;
import com.hoangha.flashsale.security.RiskService;
import com.hoangha.flashsale.security.RiskService.Signals;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/**
 * Luồng "Mua ngay": các bước rẻ chạy trước, bước trừ kho nguyên tử chạy sau cùng.
 * Request đến đây KHÔNG ghi DB: chỉ một lệnh Lua trên Redis, rồi trả 202 ngay.
 */
@Service
@SuppressWarnings("rawtypes")
public class PurchaseService {

    public enum Outcome {
        RESERVED(HttpStatus.ACCEPTED),
        ALREADY_RESERVED(HttpStatus.OK),
        SOLD_OUT(HttpStatus.GONE),
        INVALID_TOKEN(HttpStatus.UNAUTHORIZED),
        TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED),
        TOKEN_REUSED(HttpStatus.CONFLICT),
        WRONG_USER(HttpStatus.FORBIDDEN),
        NOT_ADMITTED(HttpStatus.FORBIDDEN),
        TOO_FAST(HttpStatus.TOO_MANY_REQUESTS),
        CHALLENGE_REQUIRED(HttpStatus.FORBIDDEN);

        public final HttpStatus http;

        Outcome(HttpStatus http) { this.http = http; }
    }

    public record Result(Outcome outcome, String orderId, Long payBy) {
        Result(Outcome outcome) { this(outcome, null, null); }
    }

    /** Sau khi Redis báo hết hàng, instance này tự trả lời "hết" trong khoảng này mà không gọi Redis. */
    private static final long SOLD_OUT_CACHE_MS = 1_000;

    // Cache có hạn thay vì cờ vĩnh viễn: đơn quá hạn thanh toán trả suất lại, nên "hết" có thể hết hiệu lực.
    // Mỗi instance tự hết hạn cache, không cần đồng bộ qua pub/sub; sai lệch tối đa 1 giây.
    private volatile long soldOutUntil;

    private final StringRedisTemplate redis;
    private final RedisScript<List> reserveScript;
    private final Keys keys;
    private final EventService events;
    private final PurchaseTokenService tokens;
    private final RiskService risk;
    private final FlashSaleProperties props;
    private final MeterRegistry meters;
    private final Timer reserveTimer;

    public PurchaseService(StringRedisTemplate redis, RedisScript<List> reserveScript, Keys keys,
                           EventService events, PurchaseTokenService tokens, RiskService risk,
                           FlashSaleProperties props, MeterRegistry meters) {
        this.redis = redis;
        this.reserveScript = reserveScript;
        this.keys = keys;
        this.events = events;
        this.tokens = tokens;
        this.risk = risk;
        this.props = props;
        this.meters = meters;
        this.reserveTimer = Timer.builder("flashsale.reserve.latency")
                .description("Thời gian chạy reserve.lua (trừ kho nguyên tử)")
                .publishPercentiles(0.5, 0.99)
                .register(meters);
    }

    public Result buy(String userId, String rawToken, Signals signals) {
        Result r = decide(userId, rawToken, signals);
        meters.counter("flashsale.purchase", "outcome", r.outcome().name()).increment();
        return r;
    }

    private Result decide(String userId, String rawToken, Signals signals) {
        // 1. Hết hàng thì trả lời ngay trong bộ nhớ: phần lớn request còn lại không tốn I/O
        if (System.currentTimeMillis() < soldOutUntil) return new Result(Outcome.SOLD_OUT);

        // 2. Token phòng chờ: không đi qua phòng chờ thì không mua được
        PurchaseToken t = tokens.parse(rawToken);
        if (t == null || !props.eventId().equals(t.eventId())) return new Result(Outcome.INVALID_TOKEN);
        if (!t.userId().equals(userId)) return new Result(Outcome.WRONG_USER);
        long now = events.redisNowMs();
        if (now > t.expiresAt()) return new Result(Outcome.TOKEN_EXPIRED);

        // 3. Thời gian phản ứng do SERVER đo (token cấp lúc nào, request mua đến lúc nào).
        //    Người thật cần vài trăm ms để thấy nút và bấm; nhanh hơn thế là script.
        if (now - t.issuedAt() < props.minReactionMs()) return new Result(Outcome.TOO_FAST);

        // 4. Tín hiệu trình duyệt: điểm cao thì đòi thử thách (thực tế: CAPTCHA), không chặn cứng
        if (risk.score(signals) >= RiskService.CHALLENGE_THRESHOLD) {
            return new Result(Outcome.CHALLENGE_REQUIRED);
        }

        // 5. Trừ kho nguyên tử trong Redis (xem lua/reserve.lua)
        String orderId = UUID.randomUUID().toString();
        List<?> r = reserveTimer.record(() -> redis.execute(reserveScript,
                List.of(keys.stock(), keys.buyers(), keys.jti(t.jti()), keys.orders(), keys.leases(), keys.meta()),
                userId, orderId, Integer.toString(props.tokenTtlSeconds()), props.eventId()));
        Outcome outcome = Outcome.valueOf((String) r.get(1));
        if (outcome == Outcome.SOLD_OUT) soldOutUntil = System.currentTimeMillis() + SOLD_OUT_CACHE_MS;
        return new Result(outcome, r.size() > 2 ? (String) r.get(2) : null, r.size() > 3 ? (Long) r.get(3) : null);
    }

    public void resetLocalState() {
        soldOutUntil = 0;
    }
}
