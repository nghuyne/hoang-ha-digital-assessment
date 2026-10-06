package com.hoangha.flashsale.order;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.hoangha.flashsale.config.FlashSaleProperties;
import com.hoangha.flashsale.config.Keys;

import io.micrometer.core.instrument.MeterRegistry;

/**
 * Đọc đơn từ Redis Stream (consumer group) và ghi vào PostgreSQL theo nhịp của DB, không theo nhịp
 * của đám đông. Chỉ ~100 message đi qua đây, nên DB không bao giờ chịu 100.000 lệnh ghi đồng thời.
 *
 * Đảm bảo at-least-once, kết hợp ghi DB idempotent theo orderId thành "đúng một lần" về hiệu quả:
 * - ACK sau khi DB commit. Sập trước ACK thì message nằm trong pending list (PEL).
 * - Khởi động lại với cùng tên consumer: đọc lại PEL của chính mình.
 * - Instance khác chết hẳn: message của nó quá {@code worker-reclaim-idle-ms} thì được XCLAIM về đây.
 * - Message lỗi lặp lại (poison): quá {@code worker-max-deliveries} lần thì chuyển dead-letter stream
 *   và ACK, để một message hỏng không chặn đơn của người khác.
 */
@Component
public class OrderWorker implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(OrderWorker.class);
    public static final String GROUP = "order-writers";
    private static final int BATCH = 100;

    private final StringRedisTemplate redis;
    private final StreamOperations<String, Object, Object> streams;
    private final OrderStore store;
    private final Keys keys;
    private final MeterRegistry meters;
    private final String consumerName;
    private final Duration reclaimIdle;
    private final long reclaimEveryMs;
    private final int maxDeliveries;
    private volatile boolean running;
    private Thread thread;

    public OrderWorker(StringRedisTemplate redis, OrderStore store, Keys keys, FlashSaleProperties props,
                       MeterRegistry meters) {
        this.redis = redis;
        this.streams = redis.opsForStream();
        this.store = store;
        this.keys = keys;
        this.meters = meters;
        this.consumerName = props.workerName();
        this.reclaimIdle = Duration.ofMillis(props.workerReclaimIdleMs());
        this.reclaimEveryMs = Math.clamp(props.workerReclaimIdleMs() / 2, 200, 10_000);
        this.maxDeliveries = props.workerMaxDeliveries();
    }

    @Override
    public synchronized void start() {
        if (running) return;
        running = true;
        thread = Thread.ofVirtual().name("order-worker").start(this::loop);
    }

    @Override
    public synchronized void stop() {
        running = false;
        if (thread != null) {
            thread.interrupt();
            try {
                thread.join(2_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    private void loop() {
        String drainFrom = "0";         // khởi động: đọc lại message của chính mình đã nhận nhưng chưa ACK
        boolean groupReady = false;
        long lastReclaim = 0;
        while (running) {
            try {
                if (!groupReady) {
                    ensureGroup();      // stream có thể bị xóa khi reset sự kiện (NOGROUP), nên tạo lại khi lỗi
                    groupReady = true;
                }
                if (System.currentTimeMillis() - lastReclaim >= reclaimEveryMs) {
                    reclaimStale();
                    lastReclaim = System.currentTimeMillis();
                }
                ReadOffset offset = drainFrom != null ? ReadOffset.from(drainFrom) : ReadOffset.lastConsumed();
                List<MapRecord<String, Object, Object>> records = streams.read(
                        Consumer.from(GROUP, consumerName),
                        StreamReadOptions.empty().count(BATCH),
                        StreamOffset.create(keys.orders(), offset));
                if (records == null || records.isEmpty()) {
                    drainFrom = null;   // hết phần dở dang, chuyển sang đọc message mới
                    Thread.sleep(50);
                    continue;
                }
                for (MapRecord<String, Object, Object> rec : records) {
                    process(rec);
                }
                // Đọc PEL theo con trỏ tăng dần: message lỗi không bị đọc lại vô hạn ở đây, reclaimStale lo phần thử lại
                if (drainFrom != null) drainFrom = records.getLast().getId().getValue();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                if (!running) return;
                if (isNoGroup(e)) {
                    log.debug("Stream/group missing (event reset), recreating");
                } else {
                    log.warn("Order worker error, retrying: {}", e.toString());
                }
                drainFrom = "0";
                groupReady = false;
                sleepQuietly();
            }
        }
    }

    /** Một message lỗi không làm hỏng cả lô: không ACK, để lại trong PEL cho lần thử sau. */
    private void process(MapRecord<String, Object, Object> rec) {
        try {
            handle(rec);
        } catch (Exception e) {
            meters.counter("flashsale.orders.persist_failures").increment();
            log.warn("Order message {} failed, will retry: {}", rec.getId(), e.toString());
        }
    }

    private void handle(MapRecord<String, Object, Object> rec) {
        Map<Object, Object> v = rec.getValue();
        Object paymentMs = v.get("paymentMs");   // message từ phiên bản cũ có thể không có trường này
        OrderStore.PersistResult r = store.persist(
                UUID.fromString((String) v.get("orderId")), (String) v.get("userId"), (String) v.get("eventId"),
                Long.parseLong((String) v.get("payBy")),
                paymentMs == null ? Long.MAX_VALUE : Long.parseLong((String) paymentMs));
        meters.counter("flashsale.orders.persisted", "result", r.name()).increment();
        if (r == OrderStore.PersistResult.REJECTED_NO_STOCK) {
            // Redis đã cho qua nhưng DB hết hàng: Redis bị lệch, cần đối soát
            log.warn("Order {} rejected by DB: no stock left although Redis reserved it (reconcile Redis)",
                    v.get("orderId"));
        }
        streams.acknowledge(keys.orders(), GROUP, rec.getId());   // ACK sau khi DB commit
    }

    /** Nhận về message đã giao cho consumer khác (hoặc lần thử trước của mình) mà quá lâu chưa ACK. */
    private void reclaimStale() {
        PendingMessages pending = streams.pending(keys.orders(), GROUP, Range.unbounded(), BATCH);
        for (PendingMessage pm : pending) {
            if (pm.getElapsedTimeSinceLastDelivery().compareTo(reclaimIdle) < 0) continue;
            if (pm.getTotalDeliveryCount() >= maxDeliveries) {
                deadLetter(pm);
                continue;
            }
            // XCLAIM có minIdle: nếu instance khác vừa claim trước thì lệnh này không lấy được, không xử lý trùng
            for (MapRecord<String, Object, Object> rec :
                    streams.claim(keys.orders(), GROUP, consumerName, reclaimIdle, pm.getId())) {
                log.info("Reclaimed order message {} from {} (delivery #{})",
                        rec.getId(), pm.getConsumerName(), pm.getTotalDeliveryCount() + 1);
                process(rec);
            }
        }
    }

    private void deadLetter(PendingMessage pm) {
        RecordId id = pm.getId();
        List<MapRecord<String, Object, Object>> found =
                streams.range(keys.orders(), Range.closed(id.getValue(), id.getValue()));
        Map<Object, Object> body = new LinkedHashMap<>();
        if (found != null && !found.isEmpty()) body.putAll(found.getFirst().getValue());
        body.put("originalId", id.getValue());
        body.put("deliveries", Long.toString(pm.getTotalDeliveryCount()));
        // Ghi DLQ rồi mới ACK: sập giữa chừng thì DLQ có thể có bản trùng (lọc theo originalId), không mất đơn
        streams.add(keys.deadLetters(), body);
        streams.acknowledge(keys.orders(), GROUP, id);
        meters.counter("flashsale.orders.dead_lettered").increment();
        log.error("Order message {} moved to dead-letter after {} deliveries: {}", id, pm.getTotalDeliveryCount(), body);
    }

    private void ensureGroup() {
        try {
            redis.execute((RedisCallback<String>) c -> c.streamCommands().xGroupCreate(
                    keys.orders().getBytes(StandardCharsets.UTF_8), GROUP, ReadOffset.from("0"), true));
        } catch (Exception e) {
            // BUSYGROUP: nhóm đã tồn tại
        }
    }

    private static boolean isNoGroup(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains("NOGROUP")) return true;
        }
        return false;
    }

    private void sleepQuietly() {
        try {
            Thread.sleep(500);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }
}
