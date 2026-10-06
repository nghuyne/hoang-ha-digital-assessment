package com.hoangha.flashsale.config;

import org.springframework.stereotype.Component;

/**
 * Tên key Redis của một sự kiện. Mọi key dùng chung hash tag {eventId} nên nằm cùng một slot:
 * script Lua chạy được cả trên Redis Cluster.
 */
@Component
public class Keys {

    private final String prefix;

    public Keys(FlashSaleProperties props) {
        this.prefix = "fs:{" + props.eventId() + "}:";
    }

    public String meta() { return prefix + "meta"; }

    public String stock() { return prefix + "stock"; }

    public String buyers() { return prefix + "buyers"; }

    public String queue() { return prefix + "queue"; }

    public String orders() { return prefix + "orders"; }

    public String leases() { return prefix + "leases"; }

    public String cursor() { return prefix + "cursor"; }

    public String jti(String jti) { return prefix + "jti:" + jti; }

    public String pow(String challengeHash) { return prefix + "pow:" + challengeHash; }

    /** Đơn không xử lý được sau nhiều lần thử: chờ người kiểm tra, không chặn hàng đợi chính. */
    public String deadLetters() { return prefix + "orders:dlq"; }

    /**
     * Key rate limit KHÔNG dùng hash tag của sự kiện: nếu dùng, mọi bộ đếm của 100.000 người dồn vào
     * cùng một slot với tồn kho trên Redis Cluster. Băm theo userId để trải đều.
     */
    public static String rateLimit(String userId, String group) { return "rl:{" + userId + "}:" + group; }
}
