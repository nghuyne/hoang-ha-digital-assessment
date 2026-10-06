package com.hoangha.flashsale.config;

/** Cách xếp thứ tự người vào phòng chờ. */
public enum Fairness {
    /** Vào trước giờ G thì được xáo ngẫu nhiên: nhanh hơn vài ms không còn lợi thế. */
    RANDOM,
    /** Ai bấm sớm hơn đứng trước. Chỉ để so sánh: bot luôn thắng. */
    FIFO
}
