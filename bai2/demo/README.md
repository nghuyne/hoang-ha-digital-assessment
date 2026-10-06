# Demo Flash Sale

Spring Boot 3.5 (Java 21) + Redis 7 + PostgreSQL 16. Thiết kế và giải thích: [../README.md](../README.md).

## Yêu cầu

- JDK 21
- Docker (Docker Desktop trên Windows/macOS)
- Node.js 18+ (chỉ cần cho script mô phỏng và đo tải)

Không cần cài Maven: dùng `./mvnw` (Windows: `mvnw.cmd`).

## Chạy

```bash
# 1. Redis (cổng 16379) + PostgreSQL (cổng 15432). Cổng lệch mặc định để không đụng dịch vụ có sẵn.
docker compose up -d

# 2. App tại http://localhost:8080
./mvnw spring-boot:run
```

| Trang | Dùng để |
|---|---|
| `http://localhost:8080` | Luồng người mua: đếm ngược, PoW, phòng chờ, mua, thanh toán |
| `http://localhost:8080/admin.html` | Dashboard vận hành: các bất biến, ai đang giữ suất, kết quả request, hàng đợi ghi DB |
| `http://localhost:8080/actuator/health` | Health check Redis + DB |
| `http://localhost:8080/actuator/prometheus` | Metrics cho Prometheus/Grafana |

Sự kiện mặc định mở bán sau 2 phút. Dùng **Bảng điều khiển demo** ở cuối trang mua để đặt lại (ví dụ mở bán sau 30 giây, hạn thanh toán 60 giây). Bấm **Đổi tài khoản** hoặc mở thêm tab ẩn danh để thử nhiều người.

## Mô phỏng bot (app phải đang chạy)

Mở `admin.html` trong lúc chạy để xem dashboard cập nhật trực tiếp.

```bash
node tools/simulate.mjs                       # 200 người thật + 200 bot, chạy FIFO rồi RANDOM (~3 phút)
node tools/simulate.mjs --humans 300 --bots 100
```

Kết quả tham khảo (một lần chạy, có dao động do ngẫu nhiên; đếm đơn đã thanh toán):

```
Chế độ   Người thật   Bot tinh vi   Bot lười   Đơn bỏ ngang -> người sau   Request bị 429   DB đã bán   Bán vượt?
FIFO          0           100           0                0                   19737           100        không
RANDOM       55            45           0                6                   58638           100        không

Tấn công gọi thẳng API mua (300 request): { INVALID_TOKEN: 300 }
```

## Đo tải đường đọc

```bash
node tools/bench-status.mjs --users 20000 --seconds 10
# Một tiến trình Node chỉ dùng 1 core: chạy song song nhiều tiến trình với --prefix khác nhau để đo cao hơn
```

## Test

```bash
./mvnw test     # Testcontainers tự dựng Redis + PostgreSQL, cần Docker đang chạy (~30 giây)
```

| Test | Kiểm tra |
|---|---|
| `neverOversellsWith10000ConcurrentBuyRequests` | 5.000 người × 2 lần bấm, đồng thời: đúng 100 đơn, 100 người khác nhau, Redis = 0, DB `sold` = 100 |
| `databaseStillCapsAt100WhenRedisStockIsWrong` | Redis bị lệch thành 130: DB vẫn chỉ bán 100, từ chối 30 |
| `purchaseGatesRejectBotsAndBypasses` | Không token / token giả / token người khác / quá nhanh / headless / hết hạn / không có lượt; bấm lại thì nhận đúng đơn cũ |
| `purchaseTokenIsSingleUse` | Token mua dùng một lần |
| `leasesNeverExceedStockAndExpiredOnesPassToNextInLine` | Số lượt đang mở không vượt tồn kho; lượt quá hạn chuyển người kế tiếp |
| `statusIsReadOnlyAndOnlyTheAdmissionTickGrantsTurns` | Hỏi trạng thái không cấp lượt; gọi `admit` lặp lại (nhiều instance) không cấp thừa; gợi ý nhịp hỏi |
| `sharedProgressIsCacheableAndLetsClientsComputeTheirPosition` | Endpoint tiến độ chung có `Cache-Control`; `rank − cursor + 1` khớp vị trí riêng |
| `randomModeMakesArrivalSpeedIrrelevant` | 100 người vào nhanh nhất không chiếm top 100 |
| `fifoModeRewardsTheFastest` | Đối chứng: FIFO thì người nhanh nhất chiếm hết |
| `lateJoinersQueueBehindEveryoneWhoCameBeforeStart` | Đến sau giờ G xếp sau nhóm trước giờ G |
| `proofOfWorkMustBeSolvedAndIsSingleUse` | PoW sai / của người khác / dùng lại đều bị từ chối |
| `workerReclaimsOrdersLeftUnackedByACrashedInstance` | Instance nhận message rồi chết: worker khác `XCLAIM` và ghi DB, PEL sạch |
| `poisonMessageGoesToDeadLetterInsteadOfBlockingTheQueue` | Message hỏng thử 3 lần rồi vào dead-letter, đơn hợp lệ phía sau vẫn chạy |
| `unpaidReservationExpiresAndTheUnitGoesToTheNextPersonInLine` | Đơn không thanh toán hết hạn, suất về đúng người kế tiếp; webhook lặp idempotent; thanh toán sau hạn bị từ chối |
| `burstsFromOneUserAreRateLimitedWithRetryAfter` | Dội request bị `429 + Retry-After`, người khác không bị ảnh hưởng |

## API

Danh tính demo lấy từ header `X-User-Id` (thực tế: JWT đã xác thực).

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/event` | Giờ server, giờ mở bán, chế độ, thời hạn lượt và thanh toán, tồn kho còn lại |
| GET | `/api/pow/challenge` | Lấy challenge PoW |
| POST | `/api/queue/join` | `{challenge, nonce}`: vào phòng chờ |
| GET | `/api/queue/status` | Trạng thái riêng: `WAITING_FOR_START`, `WAITING` (kèm `ahead`, `rank`), `ADMITTED` (kèm token + hạn lượt), `MISSED`, `PURCHASED`, `SOLD_OUT`; luôn kèm `pollAfterMs` |
| GET | `/api/queue/progress` | Tiến độ chung `{cursor, remaining}`, `Cache-Control: max-age=1, public` |
| POST | `/api/buy` | `{token, signals}`: giữ suất, trả `202` + `orderId` + `payBy` |
| GET | `/api/orders/me` | Đơn của tôi: `PENDING`, `RESERVED` (kèm `expires_at`), `PAID`, `EXPIRED`, `REJECTED_NO_STOCK` |
| POST | `/api/orders/me/pay` | Giả lập webhook thanh toán thành công: `PAID`, `ALREADY_PAID`, `EXPIRED` (410) |
| POST | `/api/admin/reset` | Header `X-Admin-Key`; `{startInSeconds, fairness: RANDOM\|FIFO, totalStock, powBits, leaseSeconds, paymentSeconds}` |
| GET | `/api/admin/stats` | Số đã bán/thanh toán/hết hạn, tồn kho Redis, hàng đợi, Stream, dead-letter, phân bố kết quả |

Lỗi chung: `429 RATE_LIMITED` (kèm `Retry-After`), `503 TEMPORARILY_UNAVAILABLE` khi Redis lỗi.

## Cấu trúc

```
src/main/resources/lua/
  join.lua         vào phòng chờ: bốc thăm (RANDOM) hoặc FIFO
  admit.lua        ĐƯỜNG GHI: cấp lượt theo thứ tự, không vượt tồn kho (bộ hẹn giờ gọi)
  status.lua       ĐƯỜNG ĐỌC: trạng thái một người, chỉ đọc (flags=no-writes, chạy được trên replica)
  reserve.lua      trừ kho nguyên tử + ghi Stream trong cùng bước
  rate_limit.lua   rate limit cửa sổ cố định
src/main/java/com/hoangha/flashsale/
  queue/WaitingRoomService      phòng chờ: join, status, tiến độ chung (cache), cấp token khi đến lượt
  queue/AdmissionScheduler      nhịp cấp lượt (mọi instance chạy, không cần leader)
  order/PurchaseService         luồng "Mua ngay": các cổng kiểm tra rồi gọi reserve.lua
  order/OrderWorker             Stream -> PostgreSQL: ACK sau commit, XCLAIM, dead-letter
  order/OrderStore              chốt chặn cuối ở DB, thanh toán, hết hạn (SKIP LOCKED)
  order/OrderExpiryJob          trả suất của đơn quá hạn về hàng chờ
  security/PowService           proof-of-work
  security/PurchaseTokenService token mua (HMAC, dùng một lần)
  security/RiskService          chấm điểm tín hiệu trình duyệt
  web/RateLimitInterceptor      rate limit theo user + nhóm endpoint
  event/EventService            trạng thái sự kiện, giờ lấy từ Redis TIME
src/main/resources/static/      trang mua (PoW chạy trong Web Worker) + admin.html (dashboard)
tools/simulate.mjs              mô phỏng người thật và bot
tools/bench-status.mjs          đo thông lượng đường đọc
```

## Cấu hình chính (`application.yml`)

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `flashsale.total-stock` | 100 | Số sản phẩm |
| `flashsale.fairness` | RANDOM | `RANDOM` (bốc thăm) hoặc `FIFO` (đối chứng) |
| `flashsale.lease-seconds` | 60 | Thời gian giữ lượt mua cho người đến lượt |
| `flashsale.payment-window-seconds` | 600 | Hạn thanh toán sau khi giữ suất |
| `flashsale.admission-tick-ms` | 100 | Nhịp cấp lượt |
| `flashsale.rate-limit-per-second` | 5 | Mỗi user, mỗi nhóm endpoint |
| `flashsale.worker-reclaim-idle-ms` | 30000 | Message chưa ACK quá lâu thì worker khác nhận về |
| `flashsale.worker-max-deliveries` | 5 | Quá số lần thử thì chuyển dead-letter |

## Dọn dẹp

```bash
docker compose down -v
```
