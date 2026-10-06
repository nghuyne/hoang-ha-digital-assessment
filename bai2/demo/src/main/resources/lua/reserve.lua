-- Trừ tồn kho nguyên tử: kiểm tra + trừ + ghi nhận người mua + đẩy đơn vào stream trong MỘT bước.
-- Redis chạy script đơn luồng, nên không thể có hai request cùng thấy "còn 1" rồi cùng trừ.
--
-- KEYS[1] = fs:{ev}:stock    (số còn lại)
-- KEYS[2] = fs:{ev}:buyers   (HASH userId -> orderId: 1 suất/người + idempotent khi client gửi lại)
-- KEYS[3] = fs:{ev}:jti:<id> (token mua dùng một lần)
-- KEYS[4] = fs:{ev}:orders   (STREAM: hàng đợi ghi DB)
-- KEYS[5] = fs:{ev}:leases   (ZSET userId -> hạn lượt mua, do admit.lua cấp)
-- KEYS[6] = fs:{ev}:meta     (paymentMs: thời hạn thanh toán)
-- ARGV[1] = userId, ARGV[2] = orderId mới, ARGV[3] = TTL khóa jti (giây), ARGV[4] = eventId
-- Trả về {ok, code, orderId, payBy}

local prev = redis.call('HGET', KEYS[2], ARGV[1])
if prev then
  return {1, 'ALREADY_RESERVED', prev}              -- gửi lại / bấm đúp: trả đúng đơn cũ, không trừ thêm
end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local lease = tonumber(redis.call('ZSCORE', KEYS[5], ARGV[1]) or '0')
if lease <= now then
  return {0, 'NOT_ADMITTED'}                        -- chưa tới lượt hoặc lượt đã hết hạn
end

if not redis.call('SET', KEYS[3], '1', 'NX', 'EX', tonumber(ARGV[3])) then
  return {0, 'TOKEN_REUSED'}
end

local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
if stock <= 0 then
  return {0, 'SOLD_OUT'}
end

-- Hạn thanh toán tính từ lúc khách được báo "giữ suất thành công", không từ lúc worker ghi DB
local paymentMs = tonumber(redis.call('HGET', KEYS[6], 'paymentMs'))
local payBy = now + paymentMs
redis.call('DECR', KEYS[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('ZREM', KEYS[5], ARGV[1])                -- lượt đã dùng: stock -1 và lease -1, số suất trống giữ nguyên
-- Ghi stream trong cùng script: không có khe hở "đã trừ kho nhưng mất đơn" như khi ghi Redis rồi mới gửi Kafka
redis.call('XADD', KEYS[4], '*', 'orderId', ARGV[2], 'userId', ARGV[1], 'eventId', ARGV[4], 'payBy', payBy,
  'paymentMs', paymentMs)
return {1, 'RESERVED', ARGV[2], payBy}
