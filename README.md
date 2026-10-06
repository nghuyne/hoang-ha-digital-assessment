# Bài test ứng viên — Công ty TNHH Giải pháp số Hoàng Hà

[![Deploy FE](https://github.com/nghuyne/hoang-ha-digital-assessment/actions/workflows/deploy.yml/badge.svg)](https://github.com/nghuyne/hoang-ha-digital-assessment/actions/workflows/deploy.yml)
[![Bai2 CI](https://github.com/nghuyne/hoang-ha-digital-assessment/actions/workflows/bai2-ci.yml/badge.svg)](https://github.com/nghuyne/hoang-ha-digital-assessment/actions/workflows/bai2-ci.yml)

Repo gồm ba bài, mỗi bài nằm trong một thư mục riêng và có README đầy đủ.

| Thư mục | Bài | Nội dung | Điểm chính |
|---|---|---|---|
| [`bai1/`](bai1/) | Chống "giữ ghế ảo" (seat hoarding) | Tài liệu thiết kế + sơ đồ chuỗi | 17 lỗ hổng (V1–V17), phòng thủ nhiều tầng với luật nghiệp vụ là tầng chính, Redis + Lua nguyên tử, PostgreSQL `UNIQUE` làm chốt cuối |
| [`bai2/`](bai2/) | Flash sale 100 sản phẩm / 100.000 người | Tài liệu thiết kế + demo chạy được | Phễu chặn traffic trước DB, trừ kho nguyên tử bằng Lua, ba lớp chống bán vượt, phòng chờ bốc thăm để bot mất lợi thế tốc độ, 17 test tích hợp |
| [`bai-test-fe-hoang-ha/`](bai-test-fe-hoang-ha/) | Landing page Hoàng Hà Digital | Front-end responsive | WebGL hero, scroll-driven CSS, View Transitions (sáng/tối), Vite + plugin build tự viết; test E2E Playwright, Lighthouse CI; Desktop 1440px và Mobile 390px. **Demo:** https://nghuyne.github.io/hoang-ha-digital-assessment/ |

## Cấu trúc

```
.
├── bai1/                     Bài 1: thiết kế chống giữ ghế ảo
│   ├── README.md
│   └── *.png                 sơ đồ chuỗi tấn công / phòng thủ
├── bai2/                     Bài 2: flash sale
│   ├── README.md             tài liệu thiết kế, trả lời câu hỏi 1 và 2
│   └── demo/                 Spring Boot 3.5 + Redis 7 + PostgreSQL 16
├── bai-test-fe-hoang-ha/     Bài FE: landing page
└── .github/workflows/
    ├── deploy.yml            lint, test E2E, Lighthouse CI rồi deploy FE lên GitHub Pages
    └── bai2-ci.yml           chạy test tích hợp của bài 2
```

## Chạy nhanh

**Bài 2: demo flash sale** (cần JDK 21 và Docker)

```bash
cd bai2/demo
docker compose up -d          # Redis + PostgreSQL
./mvnw spring-boot:run        # http://localhost:8080, dashboard: /admin.html
./mvnw test                   # 17 test tích hợp (Testcontainers)
node tools/simulate.mjs       # mô phỏng 200 người thật + 200 bot
```

Chi tiết: [bai2/demo/README.md](bai2/demo/README.md).

**Bài FE: landing page** (cần Node.js 20.19+)

```bash
cd bai-test-fe-hoang-ha
npm install
npm run dev                   # http://localhost:5173
npm test                      # lint + build + test E2E (lần đầu: npx playwright install chromium firefox)
```

Chi tiết: [bai-test-fe-hoang-ha/README.md](bai-test-fe-hoang-ha/README.md).

## CI/CD

- **Deploy FE:** mỗi lần push lên `main` có thay đổi trong `bai-test-fe-hoang-ha/`, GitHub Actions chạy ESLint, test E2E (Chromium + Firefox) và Lighthouse CI; đạt cả ba mới build và deploy lên GitHub Pages.
- **Bai2 CI:** mỗi lần push hoặc mở pull request có thay đổi trong `bai2/demo/`, GitHub Actions chạy toàn bộ test tích hợp trên Redis và PostgreSQL thật.
