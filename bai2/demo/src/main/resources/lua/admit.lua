-- Cấp "lượt mua" (lease) theo đúng thứ tự hàng đợi. Đây là ĐƯỜNG GHI của phòng chờ: chỉ bộ hẹn giờ
-- (AdmissionScheduler) gọi script này, vài lần mỗi giây, KHÔNG phải mỗi request của 100.000 người.
-- Nhiều instance cùng gọi vẫn đúng vì script nguyên tử và bất biến luôn được giữ, nên không cần bầu leader.
--
-- Bất biến: số lượt đang mở + số đã bán <= tồn kho. Người có lượt được GIỮ một suất trong leaseMs,
-- nên bấm chậm vài giây vẫn mua được: tốc độ sau khi vào không còn quyết định ai thắng.
-- Lượt quá hạn mà không mua thì suất quay lại, con trỏ đi tiếp tới người kế tiếp trong hàng.
--
-- KEYS[1] = fs:{ev}:queue   (ZSET userId -> thứ tự)
-- KEYS[2] = fs:{ev}:leases  (ZSET userId -> hạn lượt, ms)
-- KEYS[3] = fs:{ev}:stock
-- KEYS[4] = fs:{ev}:buyers  (HASH userId -> orderId)
-- KEYS[5] = fs:{ev}:cursor  (số vị trí đầu hàng đã được mời)
-- KEYS[6] = fs:{ev}:meta
-- Trả về {số lượt vừa cấp, cursor}

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local startAt = tonumber(redis.call('HGET', KEYS[6], 'startAt'))
if not startAt or now < startAt then return {0, 0} end   -- chưa có sự kiện hoặc chưa tới giờ G
local leaseMs = tonumber(redis.call('HGET', KEYS[6], 'leaseMs'))

redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)       -- lượt quá hạn: trả suất lại
local stock = tonumber(redis.call('GET', KEYS[3]) or '0')
local free = stock - redis.call('ZCARD', KEYS[2])
local cursor = tonumber(redis.call('GET', KEYS[5]) or '0')
local size = redis.call('ZCARD', KEYS[1])
local admitted = 0
while free > 0 and cursor < size do                        -- tối đa = số suất trống (+ người đã mua bị bỏ qua)
  local u = redis.call('ZRANGE', KEYS[1], cursor, cursor)[1]
  cursor = cursor + 1
  if redis.call('HEXISTS', KEYS[4], u) == 0 then
    redis.call('ZADD', KEYS[2], now + leaseMs, u)
    free = free - 1
    admitted = admitted + 1
  end
end
redis.call('SET', KEYS[5], cursor)
return {admitted, cursor}
