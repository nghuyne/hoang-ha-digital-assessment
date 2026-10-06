package com.hoangha.flashsale.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.hoangha.flashsale.config.Fairness;
import com.hoangha.flashsale.config.FlashSaleProperties;
import com.hoangha.flashsale.config.Keys;
import com.hoangha.flashsale.event.EventService;
import com.hoangha.flashsale.event.EventService.EventState;
import com.hoangha.flashsale.order.OrderStore;
import com.hoangha.flashsale.order.OrderWorker;
import com.hoangha.flashsale.order.PurchaseService;
import com.hoangha.flashsale.queue.WaitingRoomService;
import com.hoangha.flashsale.security.PowService;
import com.hoangha.flashsale.security.RiskService.Signals;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

/**
 * Demo: danh tính người dùng lấy từ header X-User-Id cho gọn. Thực tế lấy từ JWT đã xác thực
 * (tài khoản đã xác minh SĐT), không bao giờ tin một header do client tự đặt.
 */
@RestController
@RequestMapping("/api")
public class ApiController {

    private static final Pattern USER_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final EventService events;
    private final WaitingRoomService waitingRoom;
    private final PurchaseService purchases;
    private final PowService pow;
    private final OrderStore orders;
    private final StringRedisTemplate redis;
    private final Keys keys;
    private final FlashSaleProperties props;
    private final MeterRegistry meters;

    public ApiController(EventService events, WaitingRoomService waitingRoom, PurchaseService purchases,
                         PowService pow, OrderStore orders, StringRedisTemplate redis, Keys keys,
                         FlashSaleProperties props, MeterRegistry meters) {
        this.events = events;
        this.waitingRoom = waitingRoom;
        this.purchases = purchases;
        this.pow = pow;
        this.orders = orders;
        this.redis = redis;
        this.keys = keys;
        this.props = props;
        this.meters = meters;
    }

    public record JoinRequest(String challenge, String nonce) { }

    public record BuyRequest(String token, Signals signals) { }

    public record ResetRequest(Integer startInSeconds, Fairness fairness, Integer totalStock, Integer powBits,
                               Integer leaseSeconds, Integer paymentSeconds) { }

    @GetMapping("/event")
    public Map<String, Object> event() {
        EventState s = events.state();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("eventId", s.eventId());
        m.put("serverTime", s.now());
        m.put("startAt", s.startAt());
        m.put("joinOpensAt", s.fairness() == Fairness.FIFO ? s.startAt() : s.startAt() - s.preQueueMs());
        m.put("fairness", s.fairness());
        m.put("totalStock", s.totalStock());
        m.put("leaseSeconds", s.leaseMs() / 1000);
        m.put("paymentSeconds", s.paymentMs() / 1000);
        m.put("remaining", Math.max(0, events.remainingInRedis()));
        return m;
    }

    @GetMapping("/pow/challenge")
    public PowService.Challenge challenge(@RequestHeader("X-User-Id") String userId) {
        requireUser(userId);
        EventState s = events.state();
        return pow.issue(userId, s.powBits(), s.now());
    }

    @PostMapping("/queue/join")
    public ResponseEntity<Map<String, Object>> join(@RequestHeader("X-User-Id") String userId,
                                                    @RequestBody JoinRequest req) {
        requireUser(userId);
        if (!pow.verify(userId, req.challenge(), req.nonce(), events.redisNowMs())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("result", "POW_INVALID"));
        }
        String result = waitingRoom.join(userId);
        HttpStatus http = switch (result) {
            case "JOINED", "ALREADY_IN_QUEUE" -> HttpStatus.OK;
            default -> HttpStatus.CONFLICT;   // NOT_OPEN, NOT_STARTED
        };
        return ResponseEntity.status(http).body(Map.of("result", result));
    }

    @GetMapping("/queue/status")
    public WaitingRoomService.Status status(@RequestHeader("X-User-Id") String userId) {
        requireUser(userId);
        return waitingRoom.status(userId);
    }

    /**
     * Tiến độ chung của hàng chờ, không phụ thuộc người hỏi: CDN cache 1 giây, app cache 500 ms.
     * 100.000 người theo dõi endpoint này thay vì gọi status riêng, nên Redis chỉ thấy vài lệnh/giây.
     */
    @GetMapping("/queue/progress")
    public ResponseEntity<WaitingRoomService.Progress> progress() {
        return ResponseEntity.ok()
                .cacheControl(org.springframework.http.CacheControl.maxAge(java.time.Duration.ofSeconds(1)).cachePublic())
                .body(waitingRoom.progress());
    }

    @PostMapping("/buy")
    public ResponseEntity<Map<String, Object>> buy(@RequestHeader("X-User-Id") String userId,
                                                   @RequestBody BuyRequest req) {
        requireUser(userId);
        PurchaseService.Result r = purchases.buy(userId, req.token(), req.signals());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("result", r.outcome());
        if (r.orderId() != null) body.put("orderId", r.orderId());
        if (r.payBy() != null) body.put("payBy", r.payBy());
        return ResponseEntity.status(r.outcome().http).body(body);
    }

    @GetMapping("/orders/me")
    public Map<String, Object> myOrder(@RequestHeader("X-User-Id") String userId) {
        requireUser(userId);
        Map<String, Object> row = orders.findByUser(props.eventId(), userId);
        if (row != null) return row;
        // Redis đã giữ suất nhưng worker chưa ghi DB xong
        Object pending = redis.opsForHash().get(keys.buyers(), userId);
        return pending == null ? Map.of("status", "NONE") : Map.of("id", pending, "status", "PENDING");
    }

    /**
     * Giả lập webhook "thanh toán thành công". Thực tế: cổng thanh toán gọi về, server kiểm chữ ký HMAC,
     * đối chiếu số tiền/mã đơn với đơn trong DB, idempotent theo paymentId.
     */
    @PostMapping("/orders/me/pay")
    public ResponseEntity<Map<String, Object>> pay(@RequestHeader("X-User-Id") String userId) {
        requireUser(userId);
        OrderStore.PayResult r = orders.pay(props.eventId(), userId);
        meters.counter("flashsale.payment", "result", r.name()).increment();
        HttpStatus http = switch (r) {
            case PAID, ALREADY_PAID -> HttpStatus.OK;
            case EXPIRED -> HttpStatus.GONE;
            case NOT_FOUND -> HttpStatus.CONFLICT;   // có thể đơn còn PENDING (worker chưa ghi DB): thử lại sau
        };
        return ResponseEntity.status(http).body(Map.of("result", r));
    }

    @PostMapping("/admin/reset")
    public Map<String, Object> reset(@RequestHeader("X-Admin-Key") String adminKey, @RequestBody ResetRequest req) {
        requireAdmin(adminKey);
        events.reset(
                req.startInSeconds() == null ? props.startDelaySeconds() : req.startInSeconds(),
                req.fairness() == null ? props.fairness() : req.fairness(),
                req.totalStock() == null ? props.totalStock() : req.totalStock(),
                req.powBits() == null ? props.powDifficultyBits() : req.powBits(),
                req.leaseSeconds() == null ? props.leaseSeconds() : req.leaseSeconds(),
                req.paymentSeconds() == null ? props.paymentWindowSeconds() : req.paymentSeconds());
        return event();
    }

    @GetMapping("/admin/stats")
    public Map<String, Object> stats(@RequestHeader("X-Admin-Key") String adminKey) {
        requireAdmin(adminKey);
        Map<String, Object> m = new LinkedHashMap<>(orders.stats(props.eventId()));
        m.put("redisRemaining", events.remainingInRedis());
        m.put("redisBuyers", redis.opsForHash().size(keys.buyers()));
        m.put("queueSize", redis.opsForZSet().zCard(keys.queue()));
        m.put("activeLeases", redis.opsForZSet().zCard(keys.leases()));
        m.put("streamLength", redis.opsForStream().size(keys.orders()));
        m.put("streamPending", streamPending());
        m.put("deadLetters", redis.opsForStream().size(keys.deadLetters()));
        m.put("purchaseOutcomes", counterTotals("flashsale.purchase", "outcome"));
        m.put("rateLimited", counterTotals("flashsale.rate_limited", "group"));
        m.put("holders", orders.holders(props.eventId()));
        m.put("winners", orders.winners(props.eventId()));
        return m;
    }

    private long streamPending() {
        try {
            return redis.opsForStream().pending(keys.orders(), OrderWorker.GROUP).getTotalPendingMessages();
        } catch (Exception e) {
            return 0;   // stream/nhóm chưa có (chưa ai mua)
        }
    }

    private Map<String, Double> counterTotals(String name, String tag) {
        Map<String, Double> out = new TreeMap<>();
        for (Counter c : meters.find(name).counters()) {
            out.merge(c.getId().getTag(tag), c.count(), Double::sum);
        }
        return out;
    }

    private void requireUser(String userId) {
        if (userId == null || !USER_ID.matcher(userId).matches()) {
            throw new BadRequest("X-User-Id không hợp lệ");
        }
    }

    private void requireAdmin(String key) {
        // So sánh thời gian hằng: không lộ độ dài phần khớp qua thời gian phản hồi
        if (key == null || !MessageDigest.isEqual(props.adminKey().getBytes(StandardCharsets.UTF_8),
                key.getBytes(StandardCharsets.UTF_8))) {
            throw new Forbidden();
        }
    }

    static class BadRequest extends RuntimeException {
        BadRequest(String msg) { super(msg); }
    }

    static class Forbidden extends RuntimeException { }

    @ExceptionHandler(BadRequest.class)
    ResponseEntity<Map<String, String>> onBadRequest(BadRequest e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(EventService.NotReadyException.class)
    ResponseEntity<Map<String, String>> onNotReady() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "EVENT_NOT_READY"));
    }

    /**
     * Redis là cổng quyết định ai được mua. Redis lỗi thì NGỪNG bán (503) thay vì ghi thẳng DB:
     * đúng đắn quan trọng hơn sẵn sàng trong vài chục giây failover.
     */
    @ExceptionHandler({RedisConnectionFailureException.class, RedisSystemException.class})
    ResponseEntity<Map<String, String>> onRedisDown() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, "2")
                .body(Map.of("error", "TEMPORARILY_UNAVAILABLE"));
    }

    @ExceptionHandler(Forbidden.class)
    ResponseEntity<Void> onForbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }
}
