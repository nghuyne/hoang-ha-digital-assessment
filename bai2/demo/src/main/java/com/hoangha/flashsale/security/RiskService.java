package com.hoangha.flashsale.security;

import org.springframework.stereotype.Service;

/**
 * Chấm điểm rủi ro từ tín hiệu trình duyệt. Các tín hiệu này do client gửi nên bot tinh vi giả được;
 * chúng chỉ loại bot "lười" (Selenium/Puppeteer mặc định, script gọi thẳng API). Công bằng thật sự
 * đến từ phòng chờ xáo ngẫu nhiên + giới hạn 1 suất/danh tính, không phải từ tầng này.
 * Thực tế: thay bằng Cloudflare Turnstile / reCAPTCHA v3 + bot score ở edge (JA3/JA4, ASN).
 */
@Service
public class RiskService {

    public static final int CHALLENGE_THRESHOLD = 50;

    public record Signals(Boolean webdriver, Integer pointerMoves, Boolean trustedClick, Integer screenWidth) { }

    public int score(Signals s) {
        if (s == null) return 100;                                         // không gửi gì: gần như chắc là script
        int score = 0;
        if (Boolean.TRUE.equals(s.webdriver())) score += 60;               // navigator.webdriver = true
        if (!Boolean.TRUE.equals(s.trustedClick())) score += 50;           // click do script tạo (isTrusted = false)
        if (s.pointerMoves() == null || s.pointerMoves() == 0) score += 20; // không có chuột/chạm nào
        if (s.screenWidth() == null || s.screenWidth() == 0) score += 20;  // headless thường không có màn hình
        return score;
    }
}
