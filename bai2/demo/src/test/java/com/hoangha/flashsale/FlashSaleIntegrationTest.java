package com.hoangha.flashsale;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations.TypedTuple;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.testcontainers.utility.DockerImageName;

import com.hoangha.flashsale.config.Fairness;
import com.hoangha.flashsale.config.Keys;
import com.hoangha.flashsale.event.EventService;
import com.hoangha.flashsale.order.OrderExpiryJob;
import com.hoangha.flashsale.order.OrderStore;
import com.hoangha.flashsale.order.OrderStore.PayResult;
import com.hoangha.flashsale.order.OrderWorker;
import com.hoangha.flashsale.order.PurchaseService;
import com.hoangha.flashsale.order.PurchaseService.Outcome;
import com.hoangha.flashsale.queue.WaitingRoomService;
import com.hoangha.flashsale.queue.WaitingRoomService.State;
import com.hoangha.flashsale.security.PowService;
import com.hoangha.flashsale.security.PurchaseTokenService;
import com.hoangha.flashsale.security.RiskService.Signals;
import com.hoangha.flashsale.security.Signer;

// Tắt các bộ hẹn giờ (đặt nhịp 1 giờ) để test tự gọi admit()/expireDue() và kết quả không phụ thuộc thời điểm.
@SpringBootTest(properties = {
        "flashsale.admission-tick-ms=3600000",
        "flashsale.expiry-sweep-ms=3600000",
        "flashsale.worker-name=test-worker",
        "flashsale.worker-reclaim-idle-ms=1000",
        "flashsale.worker-max-deliveries=3"
})
@AutoConfigureMockMvc
@Testcontainers
class FlashSaleIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    @ServiceConnection(name = "redis")
    static GenericContainer<?> redisContainer =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine")).withExposedPorts(6379);

    static final Signals HUMAN = new Signals(false, 42, true, 1920);
    static final Signals HEADLESS = new Signals(true, 0, false, 0);

    @Autowired EventService events;
    @Autowired PurchaseService purchases;
    @Autowired PurchaseTokenService tokens;
    @Autowired WaitingRoomService waitingRoom;
    @Autowired PowService pow;
    @Autowired OrderStore orders;
    @Autowired StringRedisTemplate redis;
    @Autowired Keys keys;
    @Autowired OrderWorker worker;
    @Autowired OrderExpiryJob expiryJob;
    @Autowired MockMvc mvc;

    @BeforeEach
    void resetEvent() {
        events.reset(-1, Fairness.RANDOM, 100, 4, 60);   // đã mở bán, 100 sản phẩm, lượt mua 60s
        purchases.resetLocalState();
    }

    // ---- Câu 1: không bao giờ bán vượt ----------------------------------------------------------

    @Test
    void neverOversellsWith10000ConcurrentBuyRequests() throws Exception {
        int users = 5_000;
        // Cố tình cấp lượt cho cả 5.000 người (như thể phòng chờ bị lỗi, mở cửa cho tất cả):
        // tầng trừ kho vẫn phải đứng vững một mình.
        Map<Outcome, AtomicInteger> counts = runConcurrentBuyers(users, 2);   // mỗi người bấm 2 lần

        assertThat(counts.get(Outcome.RESERVED).get()).isEqualTo(100);
        assertThat(counts.get(Outcome.SOLD_OUT).get() + counts.get(Outcome.ALREADY_RESERVED).get()
                + counts.get(Outcome.RESERVED).get()).isEqualTo(users * 2);

        Map<String, Object> stats = awaitDbProcessed(100);
        assertThat(stats.get("sold")).isEqualTo(100);
        assertThat(((Number) stats.get("reserved")).intValue()).isEqualTo(100);
        assertThat(((Number) stats.get("rejected")).intValue()).isZero();
        assertThat(events.remainingInRedis()).isZero();
        assertThat(Set.copyOf(orders.winners("iphone-drop"))).hasSize(100);   // 100 người khác nhau
    }

    @Test
    void databaseStillCapsAt100WhenRedisStockIsWrong() throws Exception {
        // Giả lập Redis bị lệch (vd. failover mất các lệnh DECR chưa kịp replicate): Redis tưởng còn 130
        redis.opsForValue().set(keys.stock(), "130");

        Map<Outcome, AtomicInteger> counts = runConcurrentBuyers(300, 1);
        assertThat(counts.get(Outcome.RESERVED).get()).isEqualTo(130);   // Redis cho qua 130

        Map<String, Object> stats = awaitDbProcessed(130);
        assertThat(stats.get("sold")).isEqualTo(100);                    // DB vẫn chỉ bán 100
        assertThat(((Number) stats.get("reserved")).intValue()).isEqualTo(100);
        assertThat(((Number) stats.get("rejected")).intValue()).isEqualTo(30);
    }

    // ---- Câu 2: cổng chặn bot và công bằng ------------------------------------------------------

    @Test
    void purchaseGatesRejectBotsAndBypasses() throws Exception {
        long now = events.redisNowMs();
        grantLeases(List.of("alice"));
        String okToken = token("alice", now - 1_000);

        assertThat(purchases.buy("alice", null, HUMAN).outcome()).isEqualTo(Outcome.INVALID_TOKEN);
        assertThat(purchases.buy("alice", okToken + "x", HUMAN).outcome()).isEqualTo(Outcome.INVALID_TOKEN);
        assertThat(purchases.buy("mallory", okToken, HUMAN).outcome()).isEqualTo(Outcome.WRONG_USER);
        assertThat(purchases.buy("alice", token("alice", now), HUMAN).outcome()).isEqualTo(Outcome.TOO_FAST);
        assertThat(purchases.buy("alice", okToken, HEADLESS).outcome()).isEqualTo(Outcome.CHALLENGE_REQUIRED);
        assertThat(purchases.buy("alice", okToken, null).outcome()).isEqualTo(Outcome.CHALLENGE_REQUIRED);
        assertThat(purchases.buy("alice", tokens.issue("alice", now - 600_000, now - 480_000), HUMAN).outcome())
                .isEqualTo(Outcome.TOKEN_EXPIRED);
        // Token thật nhưng không có lượt mua (chưa tới lượt / đã hết lượt)
        assertThat(purchases.buy("eve", token("eve", now - 1_000), HUMAN).outcome()).isEqualTo(Outcome.NOT_ADMITTED);

        PurchaseService.Result first = purchases.buy("alice", okToken, HUMAN);
        assertThat(first.outcome()).isEqualTo(Outcome.RESERVED);
        PurchaseService.Result again = purchases.buy("alice", token("alice", now - 1_000), HUMAN);
        assertThat(again.outcome()).isEqualTo(Outcome.ALREADY_RESERVED);
        assertThat(again.orderId()).isEqualTo(first.orderId());          // idempotent: cùng một đơn
        awaitDbProcessed(1);                                             // không để worker ghi lẫn sang test sau
    }

    @Test
    void purchaseTokenIsSingleUse() {
        grantLeases(List.of("bob"));
        redis.opsForValue().set(keys.stock(), "0");
        String token = token("bob", events.redisNowMs() - 1_000);
        assertThat(purchases.buy("bob", token, HUMAN).outcome()).isEqualTo(Outcome.SOLD_OUT);
        purchases.resetLocalState();
        assertThat(purchases.buy("bob", token, HUMAN).outcome()).isEqualTo(Outcome.TOKEN_REUSED);
    }

    @Test
    void leasesNeverExceedStockAndExpiredOnesPassToNextInLine() throws Exception {
        events.reset(-1, Fairness.FIFO, 3, 4, 1);    // 3 sản phẩm, lượt mua 1 giây
        for (int i = 0; i < 8; i++) {
            waitingRoom.join("u" + i);
            Thread.sleep(2);
        }
        waitingRoom.admit();
        Map<String, State> s = statuses(8);
        assertThat(s.values().stream().filter(x -> x == State.ADMITTED)).hasSize(3);   // = tồn kho
        assertThat(s).containsEntry("u0", State.ADMITTED).containsEntry("u2", State.ADMITTED)
                .containsEntry("u3", State.WAITING);

        // u0 mua: suất của u0 đã dùng, KHÔNG mở thêm lượt (3 - 1 đã bán = 2 lượt đang mở là đủ)
        Thread.sleep(400);
        assertThat(purchases.buy("u0", token("u0", events.redisNowMs() - 1_000), HUMAN).outcome())
                .isEqualTo(Outcome.RESERVED);
        waitingRoom.admit();
        assertThat(waitingRoom.status("u3").state()).isEqualTo(State.WAITING);

        // u1, u2 để quá hạn: suất của họ chuyển cho u3, u4
        Thread.sleep(1_000);
        waitingRoom.admit();
        assertThat(waitingRoom.status("u3").state()).isEqualTo(State.ADMITTED);
        assertThat(waitingRoom.status("u4").state()).isEqualTo(State.ADMITTED);
        assertThat(waitingRoom.status("u5").state()).isEqualTo(State.WAITING);
        assertThat(waitingRoom.status("u1").state()).isEqualTo(State.MISSED);
        assertThat(waitingRoom.status("u0").state()).isEqualTo(State.PURCHASED);
        awaitDbProcessed(1);
    }

    @Test
    void randomModeMakesArrivalSpeedIrrelevant() {
        events.reset(60, Fairness.RANDOM, 100, 4, 60);   // mở bán sau 60s, phòng chờ đã mở
        for (int i = 0; i < 1_000; i++) {
            assertThat(waitingRoom.join("early-" + i)).isEqualTo("JOINED");
        }
        // 100 người vào sớm nhất chỉ chiếm ~10% trong top 100, không phải 100%
        long fastestInTop100 = topOfQueue(100).stream()
                .filter(u -> Integer.parseInt(u.substring("early-".length())) < 100).count();
        assertThat(fastestInTop100).isLessThan(30);
        assertThat(waitingRoom.join("early-0")).isEqualTo("ALREADY_IN_QUEUE");   // không được quay số lại
        assertThat(waitingRoom.status("early-0").state()).isEqualTo(State.WAITING_FOR_START);
    }

    @Test
    void fifoModeRewardsTheFastest() {
        events.reset(-1, Fairness.FIFO, 100, 4, 60);
        for (int i = 0; i < 300; i++) {
            waitingRoom.join(String.format("u-%03d", i));
            sleepMs(1);
        }
        assertThat(topOfQueue(100)).allMatch(u -> Integer.parseInt(u.substring(2)) < 100);
    }

    @Test
    void lateJoinersQueueBehindEveryoneWhoCameBeforeStart() throws Exception {
        events.reset(1, Fairness.RANDOM, 100, 4, 60);
        waitingRoom.join("before-1");
        waitingRoom.join("before-2");
        Thread.sleep(1_200);                          // qua giờ G
        waitingRoom.join("after-1");
        assertThat(redis.opsForZSet().rank(keys.queue(), "after-1")).isEqualTo(2L);
    }

    @Test
    void proofOfWorkMustBeSolvedAndIsSingleUse() {
        long now = events.redisNowMs();
        PowService.Challenge c = pow.issue("carol", 12, now);
        String nonce = solve(c.challenge(), 12);

        assertThat(pow.verify("carol", c.challenge(), "wrong", now)).isFalse();
        assertThat(pow.verify("dave", c.challenge(), nonce, now)).isFalse();      // challenge của người khác
        assertThat(pow.verify("carol", c.challenge(), nonce, now)).isTrue();
        assertThat(pow.verify("carol", c.challenge(), nonce, now)).isFalse();     // dùng lại
    }


    // ---- Phòng chờ: tách đường đọc / đường ghi -------------------------------------------------

    @Test
    void statusIsReadOnlyAndOnlyTheAdmissionTickGrantsTurns() {
        events.reset(-1, Fairness.FIFO, 1, 4, 60);
        waitingRoom.join("first");
        sleepMs(2);
        waitingRoom.join("second");

        // Hỏi trạng thái bao nhiêu lần cũng không cấp lượt: status.lua chỉ đọc
        for (int i = 0; i < 5; i++) assertThat(waitingRoom.status("first").state()).isEqualTo(State.WAITING);
        assertThat(redis.opsForZSet().zCard(keys.leases())).isZero();

        assertThat(waitingRoom.admit()).isEqualTo(1);                 // chỉ 1 suất nên chỉ 1 lượt
        assertThat(waitingRoom.admit()).isZero();                     // gọi lại (nhiều instance) không cấp thừa
        assertThat(waitingRoom.status("first").state()).isEqualTo(State.ADMITTED);
        WaitingRoomService.Status second = waitingRoom.status("second");
        assertThat(second.state()).isEqualTo(State.WAITING);
        assertThat(second.ahead()).isEqualTo(1L);
        assertThat(second.pollAfterMs()).isBetween(1_000L, 1_250L);   // gần đầu hàng: hỏi mỗi ~1 giây
        assertThat(second.rank()).isEqualTo(1L);
    }

    @Test
    void sharedProgressIsCacheableAndLetsClientsComputeTheirPosition() throws Exception {
        events.reset(-1, Fairness.FIFO, 2, 4, 60);
        for (int i = 0; i < 5; i++) {
            waitingRoom.join("p" + i);
            sleepMs(2);
        }
        waitingRoom.admit();                                           // p0, p1 có lượt; con trỏ = 2
        Thread.sleep(WaitingRoomService.PROGRESS_CACHE_MS + 100);        // bỏ cache của test trước

        MvcResult r = mvc.perform(MockMvcRequestBuilders.get("/api/queue/progress")).andReturn();
        assertThat(r.getResponse().getHeader("Cache-Control")).contains("max-age=1").contains("public");
        assertThat(r.getResponse().getContentAsString()).contains("\"cursor\":2").contains("\"remaining\":2");

        // Client tự tính vị trí từ rank (hỏi một lần) và cursor (dùng chung): khớp với status riêng
        WaitingRoomService.Status p4 = waitingRoom.status("p4");
        assertThat(p4.rank() - waitingRoom.progress().cursor() + 1).isEqualTo(p4.ahead()).isEqualTo(3L);
    }

    // ---- Worker: không mất đơn khi một instance chết ------------------------------------------

    @Test
    void workerReclaimsOrdersLeftUnackedByACrashedInstance() throws Exception {
        String orderId = java.util.UUID.randomUUID().toString();
        worker.stop();
        try {
            createGroup();
            redis.opsForStream().add(keys.orders(), Map.of("orderId", orderId, "userId", "ghost",
                    "eventId", "iphone-drop", "payBy", Long.toString(events.redisNowMs() + 600_000)));
            // Instance "dead-worker" nhận message rồi chết trước khi ghi DB và ACK
            var taken = redis.opsForStream().read(Consumer.from(OrderWorker.GROUP, "dead-worker"),
                    StreamReadOptions.empty().count(10), StreamOffset.create(keys.orders(), ReadOffset.lastConsumed()));
            assertThat(taken).hasSize(1);
        } finally {
            worker.start();
        }

        Map<String, Object> stats = awaitDbProcessed(1);                // XCLAIM sau ~1 giây idle
        assertThat(((Number) stats.get("reserved")).intValue()).isEqualTo(1);
        assertThat(orders.findByUser("iphone-drop", "ghost").get("id").toString()).isEqualTo(orderId);
        awaitPendingCleared();
    }

    @Test
    void poisonMessageGoesToDeadLetterInsteadOfBlockingTheQueue() throws Exception {
        redis.opsForStream().add(keys.orders(), Map.of("orderId", "not-a-uuid", "userId", "broken",
                "eventId", "iphone-drop", "payBy", "0"));
        for (int i = 0; i < 100 && sizeOf(keys.deadLetters()) == 0; i++) Thread.sleep(100);

        assertThat(sizeOf(keys.deadLetters())).isEqualTo(1);           // sau 3 lần thử thì ra dead-letter
        awaitPendingCleared();                                         // và được ACK, không kẹt trong PEL

        // Hàng đợi vẫn chạy bình thường cho đơn hợp lệ phía sau
        grantLeases(List.of("after-poison"));
        assertThat(purchases.buy("after-poison", token("after-poison", events.redisNowMs() - 1_000), HUMAN)
                .outcome()).isEqualTo(Outcome.RESERVED);
        awaitDbProcessed(1);
    }

    // ---- Vòng đời đơn: thanh toán / hết hạn trả suất cho người kế tiếp -------------------------

    @Test
    void unpaidReservationExpiresAndTheUnitGoesToTheNextPersonInLine() throws Exception {
        events.reset(-1, Fairness.FIFO, 2, 4, 60, 2);   // 2 sản phẩm, 2 giây để thanh toán
        for (String u : List.of("anna", "bao", "chi")) {
            waitingRoom.join(u);
            sleepMs(2);
        }
        waitingRoom.admit();
        long now = events.redisNowMs();
        assertThat(purchases.buy("anna", token("anna", now - 1_000), HUMAN).outcome()).isEqualTo(Outcome.RESERVED);
        assertThat(purchases.buy("bao", token("bao", now - 1_000), HUMAN).outcome()).isEqualTo(Outcome.RESERVED);
        awaitDbProcessed(2);

        assertThat(orders.pay("iphone-drop", "anna")).isEqualTo(PayResult.PAID);
        assertThat(orders.pay("iphone-drop", "anna")).isEqualTo(PayResult.ALREADY_PAID);   // webhook gửi lặp
        assertThat(waitingRoom.status("chi").state()).isEqualTo(State.SOLD_OUT);          // tạm hết

        Thread.sleep(2_200);                                           // Bảo không thanh toán
        assertThat(expiryJob.expireDue()).isEqualTo(1);
        assertThat(expiryJob.expireDue()).isZero();                    // quét lại không trả suất hai lần
        assertThat(orders.pay("iphone-drop", "bao")).isEqualTo(PayResult.EXPIRED);
        assertThat(events.remainingInRedis()).isEqualTo(1);

        // Suất quay lại hàng chờ: người KẾ TIẾP (Chi) được mời, không phải ai bấm nhanh nhất
        waitingRoom.admit();
        assertThat(waitingRoom.status("chi").state()).isEqualTo(State.ADMITTED);
        assertThat(waitingRoom.status("bao").state()).isEqualTo(State.PURCHASED);           // không được mua lại
        assertThat(purchases.buy("bao", token("bao", events.redisNowMs() - 1_000), HUMAN).outcome())
                .isEqualTo(Outcome.ALREADY_RESERVED);
        assertThat(purchases.buy("chi", token("chi", events.redisNowMs() - 1_000), HUMAN).outcome())
                .isEqualTo(Outcome.RESERVED);

        Map<String, Object> stats = awaitDbProcessed(3);
        assertThat(stats.get("sold")).isEqualTo(2);
        assertThat(((Number) stats.get("paid")).intValue()).isEqualTo(1);
        assertThat(((Number) stats.get("reserved")).intValue()).isEqualTo(1);
        assertThat(((Number) stats.get("expired")).intValue()).isEqualTo(1);
    }

    // ---- Rate limit ------------------------------------------------------------------------------

    @Test
    void burstsFromOneUserAreRateLimitedWithRetryAfter() throws Exception {
        int ok = 0;
        int limited = 0;
        String retryAfter = null;
        for (int i = 0; i < 12; i++) {
            MvcResult r = mvc.perform(MockMvcRequestBuilders.get("/api/queue/status").header("X-User-Id", "spammer"))
                    .andReturn();
            if (r.getResponse().getStatus() == 200) ok++;
            if (r.getResponse().getStatus() == 429) {
                limited++;
                retryAfter = r.getResponse().getHeader("Retry-After");
            }
        }
        assertThat(ok).isLessThanOrEqualTo(10);          // 5/giây (tối đa 2 cửa sổ nếu chạy chậm qua mốc giây)
        assertThat(limited).isGreaterThanOrEqualTo(2);
        assertThat(retryAfter).isEqualTo("1");
        // Người khác không bị ảnh hưởng
        assertThat(mvc.perform(MockMvcRequestBuilders.get("/api/queue/status").header("X-User-Id", "neighbour"))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    // ---------------------------------------------------------------------------------------------

    private String token(String userId, long issuedAt) {
        return tokens.issue(userId, issuedAt, issuedAt + 120_000);
    }

    private void grantLeases(List<String> users) {
        long until = events.redisNowMs() + 60_000;
        Set<TypedTuple<String>> tuples = new HashSet<>();
        for (String u : users) tuples.add(TypedTuple.of(u, (double) until));
        redis.opsForZSet().add(keys.leases(), tuples);
    }

    private Map<String, State> statuses(int n) {
        Map<String, State> m = new java.util.HashMap<>();
        for (int i = 0; i < n; i++) m.put("u" + i, waitingRoom.status("u" + i).state());
        return m;
    }

    private Map<Outcome, AtomicInteger> runConcurrentBuyers(int users, int clicksPerUser) throws Exception {
        Map<Outcome, AtomicInteger> counts = new EnumMap<>(Outcome.class);
        for (Outcome o : Outcome.values()) counts.put(o, new AtomicInteger());
        Set<String> orderIds = ConcurrentHashMap.newKeySet();
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < users; i++) ids.add("user-" + i);
        grantLeases(ids);
        long issuedAt = events.redisNowMs() - 5_000;
        CountDownLatch go = new CountDownLatch(1);

        try (var exec = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> futures = new ArrayList<>();
            for (String uid : ids) {
                for (int k = 0; k < clicksPerUser; k++) {
                    String token = token(uid, issuedAt);
                    futures.add(exec.submit(() -> {
                        go.await();                       // mọi request xuất phát cùng lúc
                        PurchaseService.Result r = purchases.buy(uid, token, HUMAN);
                        counts.get(r.outcome()).incrementAndGet();
                        if (r.outcome() == Outcome.RESERVED) orderIds.add(r.orderId());
                        return null;
                    }));
                }
            }
            go.countDown();
            for (Future<?> f : futures) f.get();
        }
        assertThat(orderIds).hasSize(counts.get(Outcome.RESERVED).get());
        return counts;
    }

    private Map<String, Object> awaitDbProcessed(int expectedRows) throws InterruptedException {
        for (int i = 0; i < 200; i++) {
            Map<String, Object> s = orders.stats("iphone-drop");
            long rows = 0;
            for (String k : List.of("reserved", "paid", "expired", "rejected")) rows += ((Number) s.get(k)).longValue();
            if (rows >= expectedRows) return s;
            Thread.sleep(100);
        }
        throw new AssertionError("Worker chưa ghi đủ " + expectedRows + " đơn vào DB");
    }

    private void createGroup() {
        try {
            redis.execute((RedisCallback<String>) c -> c.streamCommands().xGroupCreate(
                    keys.orders().getBytes(StandardCharsets.UTF_8), OrderWorker.GROUP, ReadOffset.from("0"), true));
        } catch (Exception e) {
            // BUSYGROUP: worker đã tạo
        }
    }

    private long sizeOf(String stream) {
        Long n = redis.opsForStream().size(stream);
        return n == null ? 0 : n;
    }

    private void awaitPendingCleared() throws InterruptedException {
        for (int i = 0; i < 50; i++) {
            if (redis.opsForStream().pending(keys.orders(), OrderWorker.GROUP).getTotalPendingMessages() == 0) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Vẫn còn message chưa ACK trong pending list");
    }

    private List<String> topOfQueue(int n) {
        return new ArrayList<>(redis.opsForZSet().range(keys.queue(), 0, n - 1));
    }

    private static String solve(String challenge, int bits) {
        for (long n = 0; ; n++) {
            byte[] h = Signer.sha256(challenge + ":" + n);
            int zeros = 0;
            for (byte b : h) {
                if (b == 0) { zeros += 8; continue; }
                zeros += Integer.numberOfLeadingZeros(b & 0xff) - 24;
                break;
            }
            if (zeros >= bits) return Long.toString(n);
        }
    }

    private static void sleepMs(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
