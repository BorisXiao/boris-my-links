/* 基础渲染与数据完整性 */
import { serve, launch, createSuite } from "./lib.mjs";

export default async function run() {
  const s = createSuite("基础渲染");
  const srv = await serve();
  const b = await launch();
  try {
    await b.enable();
    await b.goto(srv.base);

    s.section("数据与结构");
    s.eq("浏览器标题", await b.js("document.title"), "壹页");
    s.eq("站点卡片数", await b.js("document.querySelectorAll('a.card').length"), 73);
    s.eq("分类分组数（含收藏区）", await b.js("document.querySelectorAll('main section').length"), 8);
    s.eq("筛选 chip 数", await b.js("document.querySelectorAll('.chip').length"), 8);
    s.eq("统计项数", await b.js("document.querySelectorAll('#stats .item').length"), 2);
    s.ok("骨架屏已被真实内容替换", await b.js("!document.getElementById('skeleton')"));
    s.ok("页脚显示总数", String(await b.js("document.getElementById('footCount').textContent")).includes("73"));

    s.section("分类顺序（常读置顶）");
    s.eq("分类顺序", await b.js("window.__page.data.categories.map(c=>c.name).join(' > ')"),
      "常读 > 开发工具 > AI 工具 > 社交 > AI 状态 > 影音 > 效率");

    s.section("图标");
    s.eq("图标 img 数", await b.js("document.querySelectorAll('.avatar img').length"), 73);
    s.eq("降级为色块的数量", await b.js("document.querySelectorAll('.avatar.failed').length"), 0);

    s.section("关键机制存在性");
    s.ok("无重复的分类导航链接", (await b.js("document.querySelectorAll('.nav-link').length")) === 0);
    /* noscript 在启用 JS 时其内容不会被解析为 DOM 元素（规范行为），
       所以必须查原始 HTML —— 那才是禁用 JS 时浏览器看到的内容 */
    const rawHtml = await (await fetch(srv.base)).text();
    s.ok("原始 HTML 含 noscript 兜底块", rawHtml.includes("<noscript>"));
    s.ok("noscript 里给出了 links.json 直链", rawHtml.includes('href="links.json"'));
    s.ok("html 元素带 .js 标记（骨架屏显隐依据）", String(await b.js("document.documentElement.className")).includes("js"));
    /* 第一个 chip 是「全部」，href 为裸 #；分类 chip 才是 #cat= */
    s.ok("分类 chip 的 hash 语义为 #cat=",
      String(await b.js("document.querySelectorAll('.chip')[1].getAttribute('href')")).startsWith("#cat="),
      await b.js("document.querySelectorAll('.chip')[1].getAttribute('href')"));

    s.section("资源与错误");
    const ownBad = b.failedReqs.filter(r => String(r.url).includes("127.0.0.1"));
    s.ok("站点自身资源无 4xx/5xx", ownBad.length === 0, ownBad.length ? JSON.stringify(ownBad.slice(0, 3)) : "");
    s.ok("无 JS 运行时异常", b.errors.length === 0, b.errors.length ? b.errors[0] : "");
  } finally {
    await b.close(); srv.close();
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(s => process.exit(s.summary() ? 0 : 1));
}
