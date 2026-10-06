package com.hoangha.flashsale.order;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.hoangha.flashsale.config.FlashSaleProperties;
import com.hoangha.flashsale.config.Keys;

import io.micrometer.core.instrument.MeterRegistry;

/**
 * Trả suất của đơn quá hạn thanh toán về hàng chờ. Suất KHÔNG mở cho ai nhanh tay nhất: nó làm tồn kho
 * Redis tăng, rồi admit.lua cấp lượt cho người kế tiếp trong hàng.
 *
 * Thứ tự: commit DB trước, cộng Redis sau. Sập giữa hai bước thì Redis thiếu suất (bán ít hơn), không
 * bao giờ thừa (bán vượt): lỗi theo hướng an toàn, đối soát sau sẽ bù lại.
 */
@Component
public class OrderExpiryJob {

    private static final Logger log = LoggerFactory.getLogger(OrderExpiryJob.class);
    private static final int BATCH = 100;

    private final OrderStore store;
    private final StringRedisTemplate redis;
    private final Keys keys;
    private final FlashSaleProperties props;
    private final MeterRegistry meters;

    public OrderExpiryJob(OrderStore store, StringRedisTemplate redis, Keys keys, FlashSaleProperties props,
                          MeterRegistry meters) {
        this.store = store;
        this.redis = redis;
        this.keys = keys;
        this.props = props;
        this.meters = meters;
    }

    @Scheduled(fixedDelayString = "${flashsale.expiry-sweep-ms:1000}")
    void scheduled() {
        try {
            expireDue();
        } catch (Exception e) {
            log.warn("Expiry sweep failed, retrying next tick: {}", e.toString());
        }
    }

    /** Trả về tổng số suất được trả lại trong lần quét này. */
    public int expireDue() {
        int total = 0;
        int n;
        do {
            n = store.expireDue(props.eventId(), BATCH);
            if (n > 0) {
                redis.opsForValue().increment(keys.stock(), n);
                meters.counter("flashsale.orders.expired").increment(n);
                total += n;
            }
        } while (n == BATCH);
        if (total > 0) log.info("Released {} unpaid reservation(s) back to the waiting room", total);
        return total;
    }
}
