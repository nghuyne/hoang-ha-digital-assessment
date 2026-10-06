package com.hoangha.flashsale.config;

import java.util.List;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.script.RedisScript;

@Configuration
@SuppressWarnings("rawtypes")
public class RedisScripts {

    @Bean
    public RedisScript<List> reserveScript() {
        return RedisScript.of(new ClassPathResource("lua/reserve.lua"), List.class);
    }

    @Bean
    public RedisScript<List> admitScript() {
        return RedisScript.of(new ClassPathResource("lua/admit.lua"), List.class);
    }

    @Bean
    public RedisScript<List> statusScript() {
        return RedisScript.of(new ClassPathResource("lua/status.lua"), List.class);
    }

    @Bean
    public RedisScript<List> joinScript() {
        return RedisScript.of(new ClassPathResource("lua/join.lua"), List.class);
    }

    @Bean
    public RedisScript<List> rateLimitScript() {
        return RedisScript.of(new ClassPathResource("lua/rate_limit.lua"), List.class);
    }
}
