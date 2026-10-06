package com.hoangha.flashsale.security;

import java.util.UUID;

import org.springframework.stereotype.Service;

import com.hoangha.flashsale.config.FlashSaleProperties;

/**
 * Token mua hàng: chỉ cấp cho người đã đến lượt trong phòng chờ. Gọi thẳng API mua mà không đi qua
 * phòng chờ thì không có token. Token gắn với userId, có hạn, dùng một lần (jti), và mang thời điểm
 * cấp để server tự đo thời gian phản ứng (không tin số liệu client gửi lên).
 */
@Service
public class PurchaseTokenService {

    private final Signer signer;
    private final FlashSaleProperties props;

    public PurchaseTokenService(Signer signer, FlashSaleProperties props) {
        this.signer = signer;
        this.props = props;
    }

    public record PurchaseToken(String userId, String eventId, long issuedAt, long expiresAt, String jti) { }

    /** Token hết hạn cùng lúc với lượt mua (lease) của người đó. */
    public String issue(String userId, long issuedAtMs, long expiresAtMs) {
        String payload = String.join("|", userId, props.eventId(), Long.toString(issuedAtMs),
                Long.toString(expiresAtMs), UUID.randomUUID().toString());
        return signer.sign(payload);
    }

    /** Trả về token đã kiểm chữ ký, hoặc null nếu giả/hỏng. Hạn dùng do bên gọi kiểm với giờ Redis. */
    public PurchaseToken parse(String token) {
        String payload = signer.verify(token);
        if (payload == null) return null;
        String[] p = payload.split("\\|");
        if (p.length != 5) return null;
        return new PurchaseToken(p[0], p[1], Long.parseLong(p[2]), Long.parseLong(p[3]), p[4]);
    }
}
