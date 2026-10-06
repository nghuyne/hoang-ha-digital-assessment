-- Vào phòng chờ. Thứ tự trong hàng đợi = score của ZSET (nhỏ hơn được vào trước).
--
-- KEYS[1] = fs:{ev}:queue (ZSET userId -> score)
-- KEYS[2] = fs:{ev}:meta  (HASH startAt, fairness, preQueueMs, ...)
-- ARGV[1] = userId, ARGV[2] = số ngẫu nhiên trong [0, 1) do server sinh bằng SecureRandom

local t = redis.call('TIME')                           -- giờ của Redis: mọi instance dùng chung một đồng hồ
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local startAt = tonumber(redis.call('HGET', KEYS[2], 'startAt'))
local fairness = redis.call('HGET', KEYS[2], 'fairness')
local preQueueMs = tonumber(redis.call('HGET', KEYS[2], 'preQueueMs'))

if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return {1, 'ALREADY_IN_QUEUE'}                       -- không cho vào lại để "quay số" lần nữa
end

local score
if fairness == 'FIFO' then
  -- Cách làm ngây thơ (để so sánh): mở đúng giờ G, ai nhanh hơn vài ms đứng trước
  if now < startAt then return {0, 'NOT_STARTED'} end
  score = 1 + (now - startAt)
else
  if now < startAt - preQueueMs then return {0, 'NOT_OPEN'} end
  if now < startAt then
    score = tonumber(ARGV[2])                          -- vào trước giờ G: thứ tự ngẫu nhiên, tốc độ vô nghĩa
  else
    score = 1 + (now - startAt)                        -- đến sau giờ G: xếp sau cả nhóm trước, theo thứ tự đến
  end
end

redis.call('ZADD', KEYS[1], score, ARGV[1])
return {1, 'JOINED'}
