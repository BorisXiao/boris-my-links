/* 可见性回归 —— 专门防「内容存在但不可见」这类静默故障。
   历史教训：曾因丢失 revealHero() 导致 hero 整块 opacity:0，页面顶部空白，
   而这类故障不报错、不抛异常，普通断言完全测不到。 */
import { serve, launch, createSuite } from "./lib.mjs";

export default async function run() {
  const s = createSuite("可见性");
  const srv = await serve();
  const b = await launch();
  try {
    await b.enable();
    await b.goto(srv.base);

    s.section("首屏元素必须可见");
    const r = JSON.parse(await b.js(`(()=>{
      const vh = window.innerHeight;
      const near = [...document.querySelectorAll('.reveal')]
        .filter(e => { const b = e.getBoundingClientRect(); return b.top < vh * 1.2 && b.bottom > 0; });
      return JSON.stringify({
        total: document.querySelectorAll('.reveal').length,
        near: near.length,
        broken: near.filter(e => getComputedStyle(e).opacity === '0')
                    .map(e => e.id || e.className),
        offscreen: document.querySelectorAll('.reveal:not(.in)').length,
        heroOpacity: getComputedStyle(document.getElementById('heroTitle')).opacity
      });
    })()`));
    s.ok("首屏附近没有不可见的 .reveal 元素", r.broken.length === 0, r.broken.length ? JSON.stringify(r.broken) : "");
    s.eq("hero 标题可见（opacity）", r.heroOpacity, "1");
    console.log(`     （另有 ${r.offscreen} 个分组在首屏之下等待滚动进场，属正常设计）`);

    s.section("hero 三件套都要可见");
    for (const id of ["heroTitle", "heroSub", "stats"]) {
      s.eq(`${id} opacity`, await b.js(`getComputedStyle(document.getElementById('${id}')).opacity`), "1");
    }

    s.section("滚动到底后所有分组可见");
    const H = await b.js("document.documentElement.scrollHeight");
    await b.js(`window.scrollTo(0, ${H})`);
    await new Promise(r => setTimeout(r, 2600));
    s.eq("不可见的分组数", await b.js(
      "[...document.querySelectorAll('main section:not(.hide)')].filter(s=>getComputedStyle(s).opacity==='0').length"), 0);

    s.section("兜底机制能自愈");
    await b.js("document.querySelectorAll('.reveal').forEach(e=>e.classList.remove('in'))");
    await new Promise(r => setTimeout(r, 3500));
    s.eq("兜底后首屏附近仍不可见的数量", await b.js(`(()=>{
      const vh = window.innerHeight;
      return [...document.querySelectorAll('.reveal')].filter(e=>{
        const b = e.getBoundingClientRect();
        return b.top < vh*1.2 && b.bottom > 0 && getComputedStyle(e).opacity === '0';
      }).length;
    })()`), 0);

    s.ok("无 JS 运行时异常", b.errors.length === 0, b.errors.length ? b.errors[0] : "");
  } finally {
    await b.close(); srv.close();
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(s => process.exit(s.summary() ? 0 : 1));
}
