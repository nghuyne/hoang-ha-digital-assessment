package com.hoangha.flashsale.security;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;

import com.hoangha.flashsale.config.FlashSaleProperties;

/** Ký và kiểm tra chuỗi dạng "payload.signature" bằng HMAC-SHA256. */
@Component
public class Signer {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final SecretKeySpec key;

    public Signer(FlashSaleProperties props) {
        this.key = new SecretKeySpec(props.hmacSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    public String sign(String payload) {
        String body = B64.encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        return body + "." + B64.encodeToString(hmac(body));
    }

    /** Trả về payload nếu chữ ký hợp lệ, ngược lại null. */
    public String verify(String signed) {
        if (signed == null) return null;
        int dot = signed.lastIndexOf('.');
        if (dot <= 0) return null;
        String body = signed.substring(0, dot);
        byte[] sig;
        try {
            sig = B64D.decode(signed.substring(dot + 1));
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (!MessageDigest.isEqual(hmac(body), sig)) return null;   // so sánh thời gian hằng
        return new String(B64D.decode(body), StandardCharsets.UTF_8);
    }

    public static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String sha256Hex(String s) {
        return HexFormat.of().formatHex(sha256(s));
    }

    private byte[] hmac(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return mac.doFinal(body.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
