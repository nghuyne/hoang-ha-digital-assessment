package com.hoangha.flashsale.queue;

import java.security.SecureRandom;
import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;

import com.hoangha.flashsale.config.Keys;
import com.hoangha.flashsale.security.PurchaseTokenService;

import io.micrometer.core.instrument.MeterRegistry;

/**
 * Phòng chờ: 100.000 người đứng ngoài, chỉ người được cấp "lượt mua" mới vào trang mua.
 * - Thứ tự: ai vào trước giờ G được xáo ngẫu nhiên (chế độ RANDOM), nên bấm nhanh hơn vài ms vô nghĩa.
 * - Phân bổ: số lượt đang mở + số đã bán không vượt tồn kho, và người có lượt được giữ suất trong
 *   lease-seconds giây. Nhờ vậy tốc độ bấm SAU khi vào cũng không quyết định ai thắng (xem lua/admit.lua).
 * - Tách đọc/ghi: {@link #admit()} (ghi) do bộ hẹn giờ gọi vài lần mỗi giây; {@link #status} (chỉ đọc)
 *   là thứ 100.000 người gọi, và trả kèm gợi ý nhịp hỏi để người ở cuối hàng không dội server.
 */
@Service
@SuppressWarnings("rawtypes")
public class WaitingRoomService {

    public enum State { NOT_IN_QUEUE, WAITING_FOR_START, WAITING, ADMITTED, MISSED, PURCHASED, SOLD_OUT }

    /** {@code rank}: vị trí cố định của người này trong hàng (0 = đầu hàng), chỉ có khi WAITING. */
    public record Status(State state, Long ahead, String token, Long leaseExpiresAt, long serverTime,
                         long pollAfterMs, Long rank) { }

    /**
     * Tiến độ chung của hàng chờ: GIỐNG NHAU cho mọi người, nên cache được ở CDN và trong bộ nhớ.
     * Client biết rank của mình thì tự tính "còn bao nhiêu người phía trước" = rank - cursor + 1,
     * và chỉ gọi lại status (tốn Redis) khi con trỏ đã tới gần lượt mình.
     */
    public record Progress(long cursor, long remaining, long cachedAt) { }

    /** Mọi request trong khoảng này dùng chung một lần đọc Redis: tải Redis không tăng theo số người chờ. */
    public static final long PROGRESS_CACHE_MS = 500;

    private volatile Progress progress = new Progress(0, 0, 0);

    private final SecureRandom random = new SecureRandom();
    private final StringRedisTemplate redis;
    private final RedisScript<List> joinScript;
    private final RedisScript<List> admitScript;
    private final RedisScript<List> statusScript;
    private final Keys keys;
    private final PurchaseTokenService tokens;
    private final MeterRegistry meters;

    public WaitingRoomService(StringRedisTemplate redis, RedisScript<List> joinScript,
                              RedisScript<List> admitScript, RedisScript<List> statusScript, Keys keys,
                              PurchaseTokenService tokens, MeterRegistry meters) {
        this.redis = redis;
        this.joinScript = joinScript;
        this.admitScript = admitScript;
        this.statusScript = statusScript;
        this.keys = keys;
        this.tokens = tokens;
        this.meters = meters;
    }

    /** Trả về mã kết quả của join.lua: JOINED, ALREADY_IN_QUEUE, NOT_OPEN, NOT_STARTED. */
    public String join(String userId) {
        List<?> r = redis.execute(joinScript, List.of(keys.queue(), keys.meta()),
                userId, Double.toString(random.nextDouble()));
        String result = (String) r.get(1);
        meters.counter("flashsale.queue.join", "result", result).increment();
        return result;
    }

    /** Cấp lượt cho người kế tiếp trong hàng nếu còn suất trống. Trả về số lượt vừa cấp. */
    public long admit() {
        List<?> r = redis.execute(admitScript, lifecycleKeys());
        long admitted = (Long) r.get(0);
        if (admitted > 0) meters.counter("flashsale.queue.admitted").increment(admitted);
        return admitted;
    }

    public Status status(String userId) {
        List<?> r = redis.execute(statusScript, lifecycleKeys(), userId);
        State state = State.valueOf((String) r.get(0));
        long ahead = (Long) r.get(1);
        long leaseExpiresAt = (Long) r.get(2);
        long now = (Long) r.get(3);
        long startAt = (Long) r.get(4);
        return switch (state) {
            case ADMITTED -> new Status(state, 0L, tokens.issue(userId, now, leaseExpiresAt), leaseExpiresAt, now, 0, null);
            case WAITING -> new Status(state, ahead, null, null, now, pollAfterWaiting(ahead), (Long) r.get(5));
            case WAITING_FOR_START -> new Status(state, null, null, null, now, pollAfterStart(startAt - now), null);
            // Hết suất tạm thời: đơn chưa thanh toán có thể hết hạn và suất quay lại hàng chờ
            case SOLD_OUT, MISSED -> new Status(state, null, null, null, now, 5_000, null);
            default -> new Status(state, null, null, null, now, 0, null);
        };
    }

    /** Một lệnh MGET mỗi {@link #PROGRESS_CACHE_MS}, bất kể bao nhiêu người đang hỏi. */
    public Progress progress() {
        Progress p = progress;
        long now = System.currentTimeMillis();
        if (now - p.cachedAt() < PROGRESS_CACHE_MS) return p;
        List<String> v = redis.opsForValue().multiGet(List.of(keys.cursor(), keys.stock()));
        p = new Progress(parse(v, 0), Math.max(0, parse(v, 1)), now);
        progress = p;
        return p;
    }

    private static long parse(List<String> values, int i) {
        return values == null || values.get(i) == null ? 0 : Long.parseLong(values.get(i));
    }

    /**
     * Người càng xa đầu hàng càng hỏi thưa: 100.000 người hỏi mỗi giây là 100.000 req/s, còn theo bậc
     * này phần lớn hỏi mỗi 5 giây. Thêm nhiễu ngẫu nhiên để các client không hỏi cùng một nhịp.
     */
    private long pollAfterWaiting(long ahead) {
        long base = ahead > 1_000 ? 5_000 : ahead > 100 ? 2_000 : 1_000;
        return base + random.nextLong(base / 4);
    }

    /** Trước giờ G: hỏi thưa, nhưng thức dậy đúng lúc mở bán (cộng nhiễu để không dồn vào cùng mili-giây). */
    private long pollAfterStart(long untilStartMs) {
        return Math.max(500, Math.min(5_000, untilStartMs)) + random.nextLong(500);
    }

    private List<String> lifecycleKeys() {
        return List.of(keys.queue(), keys.leases(), keys.stock(), keys.buyers(), keys.cursor(), keys.meta());
    }
}
