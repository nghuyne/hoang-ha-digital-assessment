package com.hoangha.flashsale.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("flashsale")
public record FlashSaleProperties(
        String eventId,
        int totalStock,
        int startDelaySeconds,
        Fairness fairness,
        int preQueueWindowSeconds,
        int leaseSeconds,
        int paymentWindowSeconds,
        int minPaymentSeconds,
        int tokenTtlSeconds,
        long minReactionMs,
        int powDifficultyBits,
        int rateLimitPerSecond,
        long workerReclaimIdleMs,
        int workerMaxDeliveries,
        String workerName,
        String hmacSecret,
        String adminKey) {
}
