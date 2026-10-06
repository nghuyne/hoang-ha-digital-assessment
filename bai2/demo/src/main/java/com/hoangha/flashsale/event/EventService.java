package com.hoangha.flashsale.event;

import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.hoangha.flashsale.config.Fairness;
import com.hoangha.flashsale.config.FlashSaleProperties;
import com.hoangha.flashsale.config.Keys;

/**
 * Trạng thái sự kiện (giờ mở bán, chế độ công bằng, tồn kho) lưu trong Redis để mọi instance
 * thấy giống nhau. Giờ luôn lấy từ Redis TIME, không dùng đồng hồ của từng máy app hay của client.
 */
@Service
public class EventService {

    private static final List<String> META_FIELDS =
            List.of("startAt", "fairness", "total", "powBits", "preQueueMs", "leaseMs", "paymentMs");

    private final StringRedisTemplate redis;
    private final JdbcTemplate jdbc;
    private final Keys keys;
    private final FlashSaleProperties props;

    public EventService(StringRedisTemplate redis, JdbcTemplate jdbc, Keys keys, FlashSaleProperties props) {
        this.redis = redis;
        this.jdbc = jdbc;
        this.keys = keys;
        this.props = props;
    }

    public record EventState(String eventId, long now, long startAt, Fairness fairness,
                             int totalStock, int powBits, long preQueueMs, long leaseMs, long paymentMs) {
        public boolean started() { return now >= startAt; }
    }

    /** Sự kiện chưa được khởi tạo (app vừa khởi động). */
    public static class NotReadyException extends RuntimeException { }

    public long redisNowMs() {
        Long t = redis.execute((RedisCallback<Long>) c -> c.serverCommands().time(TimeUnit.MILLISECONDS));
        return t == null ? System.currentTimeMillis() : t;
    }

    public EventState state() {
        Map<Object, Object> m = redis.opsForHash().entries(keys.meta());
        if (!m.keySet().containsAll(META_FIELDS)) throw new NotReadyException();
        long now = redisNowMs();
        return new EventState(
                props.eventId(),
                now,
                Long.parseLong((String) m.get("startAt")),
                Fairness.valueOf((String) m.get("fairness")),
                Integer.parseInt((String) m.get("total")),
                Integer.parseInt((String) m.get("powBits")),
                Long.parseLong((String) m.get("preQueueMs")),
                Long.parseLong((String) m.get("leaseMs")),
                Long.parseLong((String) m.get("paymentMs")));
    }

    public long remainingInRedis() {
        String v = redis.opsForValue().get(keys.stock());
        return v == null ? 0 : Long.parseLong(v);
    }

    public EventState reset(int startInSeconds, Fairness fairness, int totalStock, int powBits, int leaseSeconds) {
        return reset(startInSeconds, fairness, totalStock, powBits, leaseSeconds, props.paymentWindowSeconds());
    }

    /** Khởi tạo lại sự kiện (demo/test). Thực tế: tồn kho nạp vào Redis từ DB trước giờ mở bán. */
    public EventState reset(int startInSeconds, Fairness fairness, int totalStock, int powBits, int leaseSeconds,
                            int paymentSeconds) {
        redis.delete(List.of(keys.meta(), keys.stock(), keys.buyers(), keys.queue(), keys.orders(),
                keys.leases(), keys.cursor(), keys.deadLetters()));

        jdbc.update("DELETE FROM orders WHERE event_id = ?", props.eventId());
        jdbc.update("""
                INSERT INTO inventory (event_id, total, sold) VALUES (?, ?, 0)
                ON CONFLICT (event_id) DO UPDATE SET total = EXCLUDED.total, sold = 0
                """, props.eventId(), totalStock);

        long startAt = redisNowMs() + startInSeconds * 1000L;
        redis.opsForHash().putAll(keys.meta(), Map.of(
                "startAt", Long.toString(startAt),
                "fairness", fairness.name(),
                "total", Integer.toString(totalStock),
                "powBits", Integer.toString(powBits),
                "preQueueMs", Long.toString(props.preQueueWindowSeconds() * 1000L),
                "leaseMs", Long.toString(leaseSeconds * 1000L),
                "paymentMs", Long.toString(paymentSeconds * 1000L)));
        redis.opsForValue().set(keys.stock(), Integer.toString(totalStock));
        return state();
    }
}
