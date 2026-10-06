-- Rate limit cửa sổ cố định: tối đa ARGV[1] request trong ARGV[2] ms cho mỗi key.
-- Nguyên tử: INCR và đặt hạn trong cùng một bước, không có khe hở "đã tăng nhưng chưa đặt hạn".
--
-- KEYS[1] = rl:{userId}:<nhóm endpoint>
-- ARGV[1] = số request tối đa, ARGV[2] = độ dài cửa sổ (ms)
-- Trả về {1, 0} nếu cho qua, {0, số ms đến khi cửa sổ mở lại} nếu vượt ngưỡng

local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2])) end
if c > tonumber(ARGV[1]) then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then                                   -- phòng hờ key mất hạn: đặt lại, không khóa vĩnh viễn
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
    ttl = tonumber(ARGV[2])
  end
  return {0, ttl}
end
return {1, 0}
