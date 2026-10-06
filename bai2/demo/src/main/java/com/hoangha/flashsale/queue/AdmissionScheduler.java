package com.hoangha.flashsale.queue;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Nhịp cấp lượt của phòng chờ. Mỗi instance đều chạy; admit.lua nguyên tử và giữ bất biến
 * "lượt đang mở + đã bán <= tồn kho", nên chạy song song không cấp thừa và không cần bầu leader.
 */
@Component
class AdmissionScheduler {

    private static final Logger log = LoggerFactory.getLogger(AdmissionScheduler.class);

    private final WaitingRoomService waitingRoom;

    AdmissionScheduler(WaitingRoomService waitingRoom) {
        this.waitingRoom = waitingRoom;
    }

    @Scheduled(fixedDelayString = "${flashsale.admission-tick-ms:100}")
    void tick() {
        try {
            waitingRoom.admit();
        } catch (Exception e) {
            // Redis tạm lỗi: nhịp sau thử lại. Không ai được cấp lượt trong lúc lỗi, tức là lỗi theo hướng an toàn.
            log.debug("Admission tick failed: {}", e.toString());
        }
    }
}
