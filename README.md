# Bài test FE — Hoàng Hà Digital

Landing page doanh nghiệp responsive (Desktop 1440px · Mobile 390px), xây dựng theo yêu cầu trong `Bài Test Ứng Viên FE.pdf`.

**🔗 Demo:** https://nghuyne.github.io/hoang-ha-digital-landing/

## Chạy dự án

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # bản production trong dist/
npm run preview
```

Mỗi lần push lên nhánh `main`, GitHub Actions (`.github/workflows/deploy.yml`) sẽ tự build và deploy lên GitHub Pages.

## Luồng UX

| # | Section | Mục đích |
|---|---------|----------|
| 1 | **Header** | Logo, menu kèm scrollspy, hotline, nút **Liên hệ** |
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
- **Typography:** Be Vietnam Pro (hỗ trợ tiếng Việt tốt) và JetBrains Mono cho số/nhãn kỹ thuật.
- **Ngôn ngữ thị giác:** glassmorphism nhẹ, bo góc lớn, lưới nền, hình mạng lưới điểm nút gợi lại biểu tượng logo.

## Animation và tương tác

- Preloader có logo và bộ đếm %, vén màn bằng gradient để vào trang
- Canvas **mạng lưới điểm nút** trong hero, phản hồi theo con trỏ (tự dừng khi ra khỏi màn hình)
- Tiêu đề hiện dần từng chữ (split text), gradient chạy liền mạch qua các từ
- Orbit quay quanh logo, các thẻ UI trôi nổi kèm **parallax theo chuột**, biểu đồ tự vẽ, bộ đếm số
- Smooth scroll bằng **Lenis**, animation theo cuộn bằng **GSAP ScrollTrigger**
- Đoạn giới thiệu sáng dần theo tiến độ cuộn (scroll-scrubbed text)
- Card có **spotlight** viền sáng theo con trỏ và **tilt 3D**, nút "nam châm" (magnetic)
- Quy trình **cuộn ngang ghim màn hình** trên desktop, chuyển thành timeline dọc trên mobile
- Header tự ẩn khi cuộn xuống, hiện lại khi cuộn lên; thanh tiến trình cuộn; viên nền trượt theo mục đang xem
- Form có floating label, báo lỗi kèm hiệu ứng rung, toast thông báo khi gửi
- **Lưu ý:** form liên hệ chỉ là **mô phỏng** (bài test FE, không có backend). Dữ liệu được kiểm tra hợp lệ phía client nhưng **không gửi đi đâu**; toast sẽ báo rõ đây là bản demo. Có thể nối với Web3Forms/Formspree/API riêng khi cần.

## Khả năng truy cập và hiệu năng

- Semantic HTML, skip link, `aria-*` cho menu và form, đóng menu bằng phím Esc
- Tôn trọng `prefers-reduced-motion`: tắt toàn bộ animation, nội dung hiển thị ngay
- Tắt hiệu ứng hover trên thiết bị cảm ứng; canvas giới hạn DPR và số điểm nút trên mobile
- Nội dung vẫn hiển thị khi JS không chạy (lớp `.js` chỉ được thêm khi có JS)

## Cấu trúc

```text
bai-test-fe-hoang-ha/
├── index.html
├── public/brand/          # logo gốc + logo đã tách nền (logo-mark, logo-full)
├── scripts/prepare-logo.mjs   # tách nền trắng của logo (npm run logo)
└── src/
    ├── main.js            # Lenis + GSAP: preloader, intro, scroll animation
    ├── interactions.js    # menu, scrollspy, magnetic, tilt, spotlight, form
    ├── network.js         # canvas mạng lưới điểm nút
    └── styles.css         # design tokens + layout responsive
```

## Nguồn nội dung

- Thông tin doanh nghiệp: https://masothue.com/0601330926-cong-ty-tnhh-giai-phap-so-hoang-ha
- Tên pháp lý: CÔNG TY TNHH GIẢI PHÁP SỐ HOÀNG HÀ · MST 0601330926
- Địa chỉ: Xóm An Khánh, Thôn Vân Chàng, Xã Nam Trực, Tỉnh Ninh Bình
- Phần social proof trình bày các nền tảng công nghệ, không dựng tên khách hàng giả. Các chỉ số trong hero là **cam kết dịch vụ** (uptime, tốc độ tải, hỗ trợ 24/7, bàn giao mã nguồn), không phải số liệu thành tích.
