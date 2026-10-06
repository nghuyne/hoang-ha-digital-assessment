-- Nguồn sự thật của tồn kho. CHECK đảm bảo DB tự từ chối bán vượt, kể cả khi tầng trên có lỗi.
-- sold = số đơn đang giữ suất (RESERVED + PAID). Đơn hết hạn thanh toán trả suất lại (sold - 1).
CREATE TABLE IF NOT EXISTS inventory (
    event_id VARCHAR(64) PRIMARY KEY,
    total    INT NOT NULL CHECK (total >= 0),
    sold     INT NOT NULL DEFAULT 0,
    CONSTRAINT sold_within_total CHECK (sold >= 0 AND sold <= total)
);

CREATE TABLE IF NOT EXISTS orders (
    id         UUID PRIMARY KEY,                 -- orderId sinh ở Redis gate: worker xử lý lại vẫn idempotent
    event_id   VARCHAR(64) NOT NULL,
    user_id    VARCHAR(64) NOT NULL,
    status     VARCHAR(32) NOT NULL,             -- RESERVED | PAID | EXPIRED | REJECTED_NO_STOCK
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT one_order_per_user UNIQUE (event_id, user_id)
);

-- Nâng cấp bảng đã tạo từ phiên bản demo trước (CREATE TABLE IF NOT EXISTS không thêm cột mới)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;   -- hạn thanh toán
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at    TIMESTAMPTZ;

-- Job hết hạn chỉ quét đơn RESERVED theo hạn: index một phần, nhỏ và rẻ
CREATE INDEX IF NOT EXISTS orders_reserved_by_expiry ON orders (event_id, expires_at) WHERE status = 'RESERVED';
