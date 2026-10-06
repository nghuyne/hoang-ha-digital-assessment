package com.hoangha.flashsale.order;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import com.hoangha.flashsale.config.FlashSaleProperties;

/**
 * Chốt chặn cuối ở DB. Kể cả khi Redis sai (mất dữ liệu khi failover, lỗi vận hành), DB vẫn không
 * bán vượt nhờ UPDATE có điều kiện + CHECK (sold <= total) + UNIQUE (event_id, user_id).
 *
 * Vòng đời đơn: RESERVED -> PAID | EXPIRED. REJECTED_NO_STOCK khi Redis cho qua nhưng DB đã đủ hàng.
 */
@Repository
public class OrderStore {

    public enum PersistResult { CREATED, DUPLICATE, REJECTED_NO_STOCK }

    public enum PayResult { PAID, ALREADY_PAID, EXPIRED, NOT_FOUND }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final int minPaymentSeconds;

    public OrderStore(JdbcTemplate jdbc, TransactionTemplate tx, FlashSaleProperties props) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.minPaymentSeconds = props.minPaymentSeconds();
    }

    /**
     * @param payByMs     hạn thanh toán Redis đã báo cho khách lúc giữ suất
     * @param paymentMs   thời hạn thanh toán của sự kiện; thời gian tối thiểu còn lại không vượt quá nó
     */
    public PersistResult persist(UUID orderId, String userId, String eventId, long payByMs, long paymentMs) {
        Timestamp payBy = new Timestamp(payByMs);
        double minRemainingSeconds = Math.min(minPaymentSeconds, paymentMs / 1000.0);
        PersistResult r = tx.execute(status -> {
            // ON CONFLICT: worker xử lý lại cùng một message (sau khi sập) không tạo đơn thứ hai.
            // GREATEST: nếu worker ghi trễ (DB chậm/sập lâu hơn hạn thanh toán), khách vẫn còn tối thiểu
            // min(min-payment-seconds, hạn thanh toán) kể từ lúc đơn vào DB, thay vì bị job hết hạn hủy ngay.
            int inserted = jdbc.update("""
                    INSERT INTO orders (id, event_id, user_id, status, expires_at)
                    VALUES (?, ?, ?, 'RESERVED', GREATEST(?, now() + make_interval(secs => ?)))
                    ON CONFLICT DO NOTHING
                    """, orderId, eventId, userId, payBy, minRemainingSeconds);
            if (inserted == 0) return PersistResult.DUPLICATE;

            // Trừ kho có điều kiện: một câu lệnh, nguyên tử ở mức hàng, không đọc-rồi-ghi
            int updated = jdbc.update(
                    "UPDATE inventory SET sold = sold + 1 WHERE event_id = ? AND sold < total", eventId);
            if (updated == 0) {
                status.setRollbackOnly();
                return PersistResult.REJECTED_NO_STOCK;
            }
            return PersistResult.CREATED;
        });
        if (r == PersistResult.REJECTED_NO_STOCK) {
            // Ghi lại để báo khách và đối soát (Redis đã cho qua nhưng DB hết hàng)
            jdbc.update("""
                    INSERT INTO orders (id, event_id, user_id, status) VALUES (?, ?, ?, 'REJECTED_NO_STOCK')
                    ON CONFLICT DO NOTHING
                    """, orderId, eventId, userId);
        }
        return r;
    }

    /**
     * Ghi nhận thanh toán thành công (thực tế: webhook cổng thanh toán đã kiểm chữ ký và số tiền).
     * Thanh toán và job hết hạn cùng sửa một dòng: khóa dòng của PostgreSQL xếp chúng nối tiếp, và cả hai
     * đều có điều kiện status = 'RESERVED', nên không thể vừa PAID vừa EXPIRED. Gọi lại thì idempotent.
     */
    public PayResult pay(String eventId, String userId) {
        int updated = jdbc.update("""
                UPDATE orders SET status = 'PAID', paid_at = now()
                WHERE event_id = ? AND user_id = ? AND status = 'RESERVED' AND expires_at > now()
                """, eventId, userId);
        if (updated == 1) return PayResult.PAID;
        Map<String, Object> row = findByUser(eventId, userId);
        if (row == null) return PayResult.NOT_FOUND;
        return switch ((String) row.get("status")) {
            case "PAID" -> PayResult.ALREADY_PAID;
            case "EXPIRED", "RESERVED" -> PayResult.EXPIRED;   // RESERVED mà không cập nhật được = đã quá hạn
            default -> PayResult.NOT_FOUND;
        };
    }

    /**
     * Đơn quá hạn thanh toán: chuyển EXPIRED và trả suất trong DB, trong cùng một transaction.
     * FOR UPDATE SKIP LOCKED: nhiều instance chạy job cùng lúc thì mỗi đơn chỉ một instance xử lý.
     * Trả về số suất được trả lại; bên gọi cộng số này vào tồn kho Redis SAU khi commit.
     */
    public int expireDue(String eventId, int batchSize) {
        Integer n = tx.execute(status -> {
            List<UUID> expired = jdbc.queryForList("""
                    WITH due AS (
                        SELECT id FROM orders
                        WHERE event_id = ? AND status = 'RESERVED' AND expires_at <= now()
                        ORDER BY expires_at
                        LIMIT ?
                        FOR UPDATE SKIP LOCKED)
                    UPDATE orders o SET status = 'EXPIRED' FROM due WHERE o.id = due.id
                    RETURNING o.id
                    """, UUID.class, eventId, batchSize);
            if (!expired.isEmpty()) {
                jdbc.update("UPDATE inventory SET sold = sold - ? WHERE event_id = ?", expired.size(), eventId);
            }
            return expired.size();
        });
        return n == null ? 0 : n;
    }

    public Map<String, Object> findByUser(String eventId, String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, status, created_at, expires_at, paid_at FROM orders WHERE event_id = ? AND user_id = ?",
                eventId, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public Map<String, Object> stats(String eventId) {
        return jdbc.queryForMap("""
                SELECT i.total, i.sold,
                       count(*) FILTER (WHERE o.status = 'RESERVED')          AS reserved,
                       count(*) FILTER (WHERE o.status = 'PAID')              AS paid,
                       count(*) FILTER (WHERE o.status = 'EXPIRED')           AS expired,
                       count(*) FILTER (WHERE o.status = 'REJECTED_NO_STOCK') AS rejected
                FROM inventory i LEFT JOIN orders o ON o.event_id = i.event_id
                WHERE i.event_id = ?
                GROUP BY i.total, i.sold
                """, eventId);
    }

    /** Người đang giữ suất (đã thanh toán hoặc còn trong hạn thanh toán). */
    public List<Map<String, Object>> holders(String eventId) {
        return jdbc.queryForList("""
                SELECT user_id, status FROM orders
                WHERE event_id = ? AND status IN ('RESERVED', 'PAID')
                ORDER BY created_at
                """, eventId);
    }

    public List<String> winners(String eventId) {
        return holders(eventId).stream().map(r -> (String) r.get("user_id")).toList();
    }
}
