package com.hoangha.flashsale.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.hoangha.flashsale.config.FlashSaleProperties;

/** Lần đầu chạy: tạo sự kiện mặc định, mở bán sau start-delay-seconds giây. */
@Component
class EventBootstrap {

    private static final Logger log = LoggerFactory.getLogger(EventBootstrap.class);

    private final EventService events;
    private final FlashSaleProperties props;

    EventBootstrap(EventService events, FlashSaleProperties props) {
        this.events = events;
        this.props = props;
    }

    @EventListener(ApplicationReadyEvent.class)
    void init() {
        EventService.EventState state;
        try {
            state = events.state();
        } catch (EventService.NotReadyException e) {   // chưa có sự kiện, hoặc dữ liệu từ phiên bản cũ
            state = events.reset(props.startDelaySeconds(), props.fairness(), props.totalStock(),
                    props.powDifficultyBits(), props.leaseSeconds(), props.paymentWindowSeconds());
        }
        log.info("Flash sale '{}' ready: {}", props.eventId(), state);
    }
}
