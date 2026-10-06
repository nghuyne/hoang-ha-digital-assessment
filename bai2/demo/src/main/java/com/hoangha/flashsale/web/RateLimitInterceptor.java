package com.hoangha.flashsale.web;

import java.io.IOException;
import java.util.List;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import com.hoangha.flashsale.config.FlashSaleProperties;
import com.hoangha.flashsale.config.Keys;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Rate limit theo user và nhóm endpoint, bộ đếm dùng chung trong Redis để mọi instance cùng thấy.
 * Thực tế còn một lớp nữa ở gateway/CDN theo IP, subnet, ASN, thiết bị (chiều không phụ thuộc tài khoản).
 *
 * Rate limit là lớp bảo vệ, không phải lớp đúng đắn: Redis lỗi thì cho qua (fail-open), vì các cổng
 * phía sau (token phòng chờ, reserve.lua, DB) vẫn đảm bảo không bán vượt.
 */
@Component
class RateLimitInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(RateLimitInterceptor.class);
    private static final Pattern USER_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final long WINDOW_MS = 1_000;

    private final StringRedisTemplate redis;
    @SuppressWarnings("rawtypes")
    private final RedisScript<List> rateLimitScript;
    private final MeterRegistry meters;
    private final String limit;

    @SuppressWarnings("rawtypes")
    RateLimitInterceptor(StringRedisTemplate redis, RedisScript<List> rateLimitScript, MeterRegistry meters,
                         FlashSaleProperties props) {
        this.redis = redis;
        this.rateLimitScript = rateLimitScript;
        this.meters = meters;
        this.limit = Integer.toString(props.rateLimitPerSecond());
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws IOException {
        String user = req.getHeader("X-User-Id");
        String group = groupOf(req.getRequestURI());
        if (group == null || user == null || !USER_ID.matcher(user).matches()) return true;   // controller tự báo 400

        List<?> r;
        try {
            r = redis.execute(rateLimitScript, List.of(Keys.rateLimit(user, group)), limit, Long.toString(WINDOW_MS));
        } catch (Exception e) {
            log.debug("Rate limiter unavailable, failing open: {}", e.toString());
            return true;
        }
        if ((Long) r.get(0) == 1L) return true;

        long retryMs = (Long) r.get(1);
        meters.counter("flashsale.rate_limited", "group", group).increment();
        res.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        res.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(Math.max(1, (retryMs + 999) / 1000)));
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.getWriter().write("{\"result\":\"RATE_LIMITED\",\"retryAfterMs\":" + retryMs + "}");
        return false;
    }

    /** Mỗi nhóm có ngân sách riêng: hỏi trạng thái nhiều không làm mất quyền bấm mua. */
    private static String groupOf(String path) {
        return switch (path) {
            case "/api/queue/status" -> "status";
            case "/api/buy" -> "buy";
            case "/api/queue/join", "/api/pow/challenge" -> "join";
            case "/api/orders/me", "/api/orders/me/pay" -> "order";
            default -> null;
        };
    }
}
