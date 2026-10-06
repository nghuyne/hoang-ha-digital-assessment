// Nhúng thẳng CSS vào <style> trong HTML (trang đơn, CSS ~11 KB gzip): bỏ được một lượt request chặn
// render, trình duyệt vẽ ngay khi có HTML. Đường dẫn url(./x) trong CSS vốn tương đối với thư mục assets/,
// nên phải đổi sang assets/x khi CSS nằm trong HTML ở thư mục gốc.

export function inlineCss() {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName === 'index.html');
      const cssFiles = Object.values(bundle).filter((f) => f.type === 'asset' && f.fileName.endsWith('.css'));
      if (!html || !cssFiles.length) return;

      let source = String(html.source);
      for (const css of cssFiles) {
        const dir = css.fileName.slice(0, css.fileName.lastIndexOf('/') + 1);
        const code = String(css.source).replace(/url\(\.\/([^)]+)\)/g, `url(./${dir}$1)`);
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="\\./${css.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        if (!link.test(source)) continue;
        source = source.replace(link, () => `<style>${code}</style>`);
        delete bundle[css.fileName];
      }
      html.source = source;
    },
  };
}
