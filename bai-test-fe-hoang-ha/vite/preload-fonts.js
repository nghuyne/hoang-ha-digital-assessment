// Font dùng ngay ở màn hình đầu: tiêu đề hero (800) và chữ thường (400), bộ latin + vietnamese.
// Preload để trình duyệt tải song song với HTML thay vì đợi đọc xong CSS mới phát hiện ra font.
// Tên file có mã băm nên chỉ chèn được lúc build.
const CRITICAL_FONTS = /be-vietnam-pro-(latin|vietnamese)-(400|800)-normal-[\w-]+\.woff2$/;

export function preloadCriticalFonts() {
  return {
    name: 'preload-critical-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => CRITICAL_FONTS.test(file))
          .sort()
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'preload', href: `./${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head-prepend',
          }));
      },
    },
  };
}
