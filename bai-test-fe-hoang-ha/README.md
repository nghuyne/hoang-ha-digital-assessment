# Bài test FE — Hoàng Hà Digital

Landing page doanh nghiệp responsive (Desktop 1440px · Mobile 390px), xây dựng theo yêu cầu trong `Bài Test Ứng Viên FE.pdf`.

**🔗 Demo:** https://nghuyne.github.io/hoang-ha-digital-assessment/

## Chạy dự án

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # bản production trong dist/
npm run preview    # xem bản build tại http://localhost:4173
npm test           # lint + build + test E2E (Playwright: Chromium desktop/mobile, Firefox)
npm run assets     # sinh lại ảnh tối ưu, icon và ảnh chia sẻ từ logo (Node + sharp)
```

Lần đầu chạy test E2E cần tải trình duyệt: `npx playwright install chromium firefox`.

**CI/CD** ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) ở gốc repo): mỗi push hoặc pull request chạm vào thư mục này phải qua **ESLint → test E2E trên Chromium và Firefox → Lighthouse CI** (ngân sách trong [`lighthouserc.json`](lighthouserc.json): performance ≥ 80, accessibility ≥ 95, SEO = 100, CLS ≤ 0,05). Chỉ khi đạt cả ba, bản build trên `main` mới được deploy lên GitHub Pages.

## Luồng UX

| # | Section | Mục đích |
|---|---------|----------|
| 1 | **Header** | Logo, menu kèm scrollspy, hotline, nút đổi giao diện sáng/tối, nút **Liên hệ** |
| 2 | **Hero** | Thông điệp chính, 2 CTA, cam kết nhanh, chỉ số tin cậy |
| 3 | **Social proof** | Logo nền tảng và đối tác công nghệ (marquee 2 hàng) |
| 4 | **Về chúng tôi** | Câu chuyện thương hiệu, ý nghĩa logo, sứ mệnh/tầm nhìn, thông tin pháp lý |
| 5 | **Dịch vụ cốt lõi** | Bento grid gồm 6 dịch vụ |
| 6 | **Lợi thế cạnh tranh** | 6 lý do kèm bảng so sánh "thông thường và Hoàng Hà" |
| 7 | **Quy trình** (bổ sung) | 5 bước, cuộn ngang khi ghim màn hình (desktop) |
| 8 | **Liên hệ** | Form có kiểm tra dữ liệu, hotline, địa chỉ |
| 9 | **Footer** | Điều hướng, liên hệ, mạng xã hội, MST |

Luồng đi theo thứ tự: **thu hút → tạo niềm tin → giới thiệu → giải pháp → thuyết phục → minh bạch quy trình → chuyển đổi**.

## Design system

- **Màu sắc lấy từ logo:** Navy `#0B1D42` / `#16336B`, Blue `#2F7DE1`, Gold `#F2A52E`. Gradient thương hiệu chuyển từ blue sang gold.
- **Hai tầng token:** token gốc (bảng màu) và token ngữ nghĩa (`--heading`, `--surface`, `--glass`, `--accent`...). Thành phần chỉ dùng token ngữ nghĩa, nên **giao diện tối** chỉ là một bộ giá trị khác cho cùng các token.
- **Typography:** Be Vietnam Pro (hỗ trợ tiếng Việt tốt) và JetBrains Mono cho số/nhãn kỹ thuật.
- **Ngôn ngữ thị giác:** glassmorphism nhẹ, bo góc lớn, lưới nền, mạng lưới điểm nút gợi lại biểu tượng logo, lớp hạt nhiễu rất nhẹ tạo chiều sâu.

## Kỹ thuật nổi bật

| Kỹ thuật | Ở đâu | Vì sao |
|---|---|---|
| **WebGL** (OGL, shader tự viết) | Nền hero: mạng lưới điểm nút 3D xoay theo chuột và theo cuộn, dải sáng uốn lượn, lưới chấm sáng quanh con trỏ | Hiệu ứng ấn tượng nhưng chạy trên GPU. Chỉ tải khi người dùng bắt đầu tương tác; máy không có GPU thật (SwiftShader/llvmpipe) hoặc bật tiết kiệm dữ liệu thì dùng canvas 2D nhẹ hơn |
| **Scroll-driven animations** (`animation-timeline: view()` / `scroll()`) | Hiện dần theo cuộn, tiêu đề trồi chữ, đoạn giới thiệu sáng dần, thanh tiến trình, **mục Quy trình cuộn ngang bằng CSS sticky** | Chạy trên compositor, không tốn JS mỗi khung hình. Firefox chưa hỗ trợ: tự tải GSAP ScrollTrigger làm dự phòng (chunk riêng, không nằm trong bundle chính) |
| **View Transitions API** | Nút đổi giao diện sáng/tối: giao diện mới lan hình tròn từ vị trí nút | Chuyển trạng thái toàn trang mượt. Nhớ lựa chọn, lần đầu theo hệ điều hành; script nhỏ trong `<head>` đặt giao diện trước lần vẽ đầu nên không nháy màu |
| **Tách chữ lúc build** (plugin Vite tự viết) | Tiêu đề và đoạn giới thiệu được chia sẵn thành từng từ trong HTML | Intro chạy bằng CSS ngay khung hình đầu, không đợi JS, không reflow; trình đọc màn hình vẫn đọc nguyên câu qua `aria-label` |
| **CSS `@property`** | Viền gradient xoay quanh thẻ nổi bật, vòng điểm Performance tự đầy | Animate được biến CSS (góc, số) mà không cần JS |
| **Animation chồng lớp không xung đột** | Intro, trôi nổi, parallax, tilt | CSS dùng `translate` / `scale` / `rotate` riêng lẻ, GSAP ghi `transform`: hai bên cộng dồn thay vì đè nhau |
| Vi mô tương tác | Chữ "giải mã" ở nhãn kỹ thuật, gợn sáng khi bấm nút, nút nam châm, thẻ nghiêng 3D, spotlight viền theo con trỏ | Chi tiết nhỏ tạo cảm giác cao cấp; tất cả tắt khi bật giảm chuyển động |

Các tương tác cũ vẫn giữ: smooth scroll (Lenis), header tự ẩn khi cuộn xuống, viên nền trượt theo mục đang xem (scrollspy bằng `IntersectionObserver`), marquee 2 hàng, form có floating label, báo lỗi kèm rung, toast.

**Lưu ý:** form liên hệ chỉ là **mô phỏng** (bài test FE, không có backend). Dữ liệu được kiểm tra hợp lệ phía client nhưng **không gửi đi đâu**; toast báo rõ đây là bản demo.

## Hiệu năng

Lighthouse trên bản build production, chạy trên máy cá nhân (mobile = giả lập 4G chậm, CPU chậm 4 lần):

| | Bản đầu | Hiện tại |
|---|---|---|
| Performance mobile | 75 | 87–88 |
| Performance desktop | | 99 |
| Accessibility / Best Practices / SEO | 94 / 100 / 92 | 96 / 100 / 100 |
| CLS (layout nhảy) | 0,097 | 0 |
| First Contentful Paint (mobile) | 3,7 s | 2,6 s |
| JS bundle chính (gzip) | 55 KB | 38 KB |

Đo A/B xen kẽ trên cùng máy (CPU chậm 4 lần, 5 giây đầu sau khi tải): thời gian chạy script giảm từ ~890 ms xuống ~160 ms và tổng thời gian chặn luồng chính giảm khoảng một nửa so với bản đầu, dù trang có thêm WebGL, giao diện tối và nhiều hiệu ứng hơn.

Những gì đã làm:

- **Không có màn chờ:** nội dung hiện ngay, intro chạy bằng CSS trên chính hero; phần tử LCP (đoạn mô tả) hiện sớm.
- **CSS nhúng thẳng vào HTML** (plugin Vite tự viết): không còn request CSS chặn render.
- **Font tự host** (Fontsource), chỉ weight đang dùng và bộ ký tự latin/vietnamese; preload font của màn hình đầu; **font dự phòng cùng số đo** (`size-adjust`, `ascent/descent-override`) nên tiêu đề không nhảy khi font thật thay vào.
- **Tải theo nhu cầu:** WebGL (17 KB gzip) chỉ tải khi có tương tác; GSAP ScrollTrigger chỉ tải ở trình duyệt cần dự phòng; canvas 2D chỉ tải khi không dùng được WebGL.
- **Dừng animation ngoài màn hình:** section không nằm trong vùng nhìn được tạm dừng toàn bộ animation lặp vô hạn (`IntersectionObserver` + `animation-play-state`). Thời gian tính lại style khi trang đứng yên giảm khoảng 9 lần.
- **Sửa animation gây layout mỗi khung hình:** vệt sáng trên nút trước đây animate `left` (bắt tính lại layout liên tục), nay dùng `translate` chạy trên compositor.
- **Ảnh AVIF/WebP đúng kích thước** qua `<picture>` (logo 4–9 KB thay vì PNG 58 KB).
- **SEO và chia sẻ:** Open Graph/Twitter với ảnh xem trước 1200×630, JSON-LD thông tin doanh nghiệp, `robots.txt`, `sitemap.xml`, favicon, icon iOS/Android, web manifest.

## Khả năng truy cập

- Semantic HTML, skip link, `aria-*` cho menu, form và nút đổi giao diện (`aria-pressed`); đóng menu bằng Esc và trả focus về nút mở.
- `prefers-reduced-motion`: tắt toàn bộ chuyển động, nội dung **không bao giờ bị ẩn chờ hiệu ứng**, không tải WebGL.
- Nội dung vẫn hiển thị và đọc được khi JS không chạy (số liệu, tiêu đề đều có sẵn trong HTML).
- Đoạn chữ "sáng dần theo cuộn" bị Lighthouse báo thiếu tương phản ở trạng thái chưa cuộn: đây là hiệu ứng có chủ đích, chữ đạt đủ tương phản khi người đọc cuộn tới.

## Kiểm thử

[`tests/e2e/landing.spec.js`](tests/e2e/landing.spec.js) chạy trên **Chromium desktop, Chromium mobile (Pixel 7) và Firefox** (Firefox để kiểm tra luôn đường dự phòng GSAP):

- Tải trang không lỗi JS; tiêu đề tách chữ vẫn có tên truy cập đầy đủ
- Không cuộn ngang ở mọi kích thước
- Bấm menu (desktop và menu di động) cuộn tới đúng section
- Form: báo lỗi và đưa focus về ô sai; gửi hợp lệ thì hiện thông báo
- Giao diện tối: đổi được, ghi nhớ sau khi tải lại, lần đầu theo cài đặt hệ điều hành
- Menu di động: mở, khóa cuộn, đóng bằng Esc, trả focus
- Giảm chuyển động: mọi nội dung hiện ngay
- SEO: Open Graph, canonical, JSON-LD hợp lệ, các file tĩnh tồn tại

## Cấu trúc

```text
bai-test-fe-hoang-ha/
├── index.html
├── vite.config.js
├── vite/                       # plugin build tự viết
│   ├── split-text.js           # tách chữ tiêu đề lúc build
│   ├── inline-css.js           # nhúng CSS vào HTML
│   └── preload-fonts.js        # preload font màn hình đầu
├── public/                     # favicon, icon, og-image, robots.txt, sitemap.xml, manifest
│   └── brand/                  # logo gốc, logo đã tách nền và bản AVIF/WebP
├── scripts/
│   ├── prepare-logo.mjs        # tách nền trắng của logo (npm run logo)
│   └── build-assets.mjs        # ảnh tối ưu, icon, ảnh chia sẻ OG (npm run assets)
├── src/
│   ├── main.js                 # khởi động: Lenis, header, gradient chữ, gọi các module
│   ├── lib/env.js              # tiện ích DOM, phát hiện tính năng (reduced motion, scroll-driven)
│   ├── modules/
│   │   ├── theme.js            # sáng/tối + View Transitions
│   │   ├── hero.js             # bộ đếm, tải nền WebGL/2D theo nhu cầu
│   │   ├── scroll-fx.js        # hiệu ứng cuộn (CSS) + đo quãng cuộn ngang
│   │   ├── scroll-fallback.js  # dự phòng GSAP ScrollTrigger (tải động)
│   │   └── scramble.js         # chữ "giải mã" ở nhãn kỹ thuật
│   ├── hero-gl.js              # WebGL: shader nền + mạng lưới 3D
│   ├── network.js              # canvas 2D dự phòng
│   ├── interactions.js         # menu, scrollspy, magnetic, tilt, spotlight, ripple, form
│   ├── fonts.css               # font tự host + font dự phòng cùng số đo
│   ├── styles.css              # token + layout responsive
│   └── effects.css             # intro, scroll-driven, vi mô tương tác, giao diện tối
├── tests/e2e/                  # Playwright
├── playwright.config.js
├── lighthouserc.json           # ngân sách Lighthouse CI
└── eslint.config.js
```

## Nguồn nội dung

- Thông tin doanh nghiệp: https://masothue.com/0601330926-cong-ty-tnhh-giai-phap-so-hoang-ha
- Tên pháp lý: CÔNG TY TNHH GIẢI PHÁP SỐ HOÀNG HÀ · MST 0601330926
- Địa chỉ: Xóm An Khánh, Thôn Vân Chàng, Xã Nam Trực, Tỉnh Ninh Bình
- Phần social proof trình bày các nền tảng công nghệ, không dựng tên khách hàng giả. Các chỉ số trong hero là **cam kết dịch vụ** (uptime, tốc độ tải, hỗ trợ 24/7, bàn giao mã nguồn), không phải số liệu thành tích.
