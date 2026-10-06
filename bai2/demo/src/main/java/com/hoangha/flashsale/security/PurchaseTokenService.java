package com.hoangha.flashsale.security;

import org.springframework.stereotype.Service;

import com.hoangha.flashsale.config.FlashSaleProperties;

/**
 * Token mua hàng: chỉ cấp cho người đã đến lượt trong phòng chờ. Gọi thẳng API mua mà không đi qua
 * phòng chờ thì không có token. Token gắn với userId, có hạn, dùng một lần (jti), và mang thời điểm
 * lượt được cấp để server tự đo thời gian phản ứng (không tin số liệu client gửi lên).
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

    /**
     * Token hết hạn cùng lúc với lượt mua (lease) của người đó. jti suy ra từ (user, sự kiện, hạn lượt),
     * không ngẫu nhiên: mỗi lượt chỉ có đúng MỘT token, hỏi trạng thái nhiều lần không sinh thêm token mới.
     */
    public String issue(String userId, long issuedAtMs, long expiresAtMs) {
        String jti = Signer.sha256Hex(String.join("|", userId, props.eventId(), Long.toString(expiresAtMs)))
                .substring(0, 32);
        String payload = String.join("|", userId, props.eventId(), Long.toString(issuedAtMs),
                Long.toString(expiresAtMs), jti);
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
