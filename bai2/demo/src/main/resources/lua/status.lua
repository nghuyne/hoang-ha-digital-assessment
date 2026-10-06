#!lua flags=no-writes
-- Trạng thái của MỘT người trong phòng chờ. Đây là ĐƯỜNG ĐỌC: 100.000 người hỏi định kỳ.
-- Script chỉ đọc (flags=no-writes, Redis 7+), nên chạy được trên replica để chia tải khỏi primary,
-- và độ phức tạp O(log N) (ZRANK). Việc cấp lượt nằm ở admit.lua, không nằm ở đây.
--
-- KEYS[1] = fs:{ev}:queue, KEYS[2] = fs:{ev}:leases, KEYS[3] = fs:{ev}:stock,
-- KEYS[4] = fs:{ev}:buyers, KEYS[5] = fs:{ev}:cursor, KEYS[6] = fs:{ev}:meta
-- ARGV[1] = userId
-- Trả về {state, ahead, leaseExpiresAt, now, startAt, rank}; với ADMITTED, phần tử cuối là lúc lượt được cấp

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local startAt = tonumber(redis.call('HGET', KEYS[6], 'startAt') or '0')

if redis.call('HEXISTS', KEYS[4], ARGV[1]) == 1 then return {'PURCHASED', 0, 0, now, startAt} end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if not rank then return {'NOT_IN_QUEUE', 0, 0, now, startAt} end
if now < startAt then return {'WAITING_FOR_START', 0, 0, now, startAt} end

local lease = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '0')
if lease > now then
  -- Lúc lượt được cấp = hạn lượt - leaseMs: cố định suốt lượt, nên token cấp lại vẫn y hệt
  local grantedAt = lease - tonumber(redis.call('HGET', KEYS[6], 'leaseMs'))
  return {'ADMITTED', 0, lease, now, startAt, grantedAt}
end
if tonumber(redis.call('GET', KEYS[3]) or '0') <= 0 then return {'SOLD_OUT', 0, 0, now, startAt} end
local cursor = tonumber(redis.call('GET', KEYS[5]) or '0')
if rank < cursor then return {'MISSED', 0, 0, now, startAt} end   -- đã được mời nhưng để quá hạn
return {'WAITING', rank - cursor + 1, 0, now, startAt, rank}
