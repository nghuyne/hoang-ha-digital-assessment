// Tách chữ lúc BUILD thay vì lúc chạy: tiêu đề [data-split] và đoạn [data-scrub] được chia sẵn thành
// từng từ trong HTML. CSS chạy hiệu ứng ngay ở khung hình đầu tiên (không đợi JS tải, không reflow do
// JS thay DOM), và trình đọc màn hình vẫn đọc nguyên câu qua aria-label.
//
// Nội dung các khối này do mình viết nên chỉ gồm: chữ, <br>, <span class="..."> một cấp, thực thể HTML.
// &nbsp; được giữ trong từ để các cụm như "bứt&nbsp;phá" không bị tách.

const TOKEN = /<br\s*\/?>|<span class="([^"]*)">([\s\S]*?)<\/span>|([^<]+)/g;

function plainText(html) {
  return html
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trả về danh sách từ: { text, cls } hoặc { br: true } */
function words(html) {
  const out = [];
  const pushText = (text, cls = '') => {
    text.split(/[ \t\r\n]+/).filter(Boolean).forEach((w) => out.push({ text: w, cls }));
  };
  for (const [token, spanClass, spanText, text] of html.matchAll(TOKEN)) {
    if (token.startsWith('<br')) out.push({ br: true });
    else if (spanClass !== undefined) pushText(spanText, spanClass);
    else pushText(text);
  }
  return out;
}

function splitHeading(inner) {
  let i = 0;
  return words(inner)
    .map((w) => (w.br
      ? '<br>'
      : `<span class="split-word" aria-hidden="true"><span class="split-inner${w.cls ? ` ${w.cls}` : ''}" style="--i:${i++}">${w.text}</span></span>`))
    .join(' ')
    .replace(/ <br> /g, '<br>');
}

function splitScrub(inner) {
  const list = words(inner).filter((w) => !w.br);
  return {
    count: list.length,
    html: list.map((w, i) => `<span class="w" style="--i:${i}">${w.text}</span>`).join(' '),
  };
}

export function splitText() {
  return {
    name: 'split-text',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(/<(h[1-6])([^>]*?)\sdata-split([^>]*)>([\s\S]*?)<\/\1>/g, (_, tag, before, after, inner) =>
            `<${tag}${before} data-split${after} aria-label="${plainText(inner)}">${splitHeading(inner)}</${tag}>`)
          .replace(/<p([^>]*?)\sdata-scrub([^>]*)>([\s\S]*?)<\/p>/g, (_, before, after, inner) => {
            const { count, html: body } = splitScrub(inner);
            return `<p${before} data-scrub${after} style="--n:${count}">${body}</p>`;
          });
      },
    },
  };
}
