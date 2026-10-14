/* 交互与体验：收藏、键盘导航、搜索排序、三档视图、读屏播报、引导、导入、hash */
import { serve, launch, createSuite, sleep } from "./lib.mjs";

export default async function run() {
  const s = createSuite("交互与体验");
  const srv = await serve();
  const b = await launch();
  try {
    await b.enable();
    await b.goto(srv.base);

    s.section("收藏置顶");
    s.eq("每张卡片都有星标", await b.js("document.querySelectorAll('.card .star').length"), 73);
    await b.js("document.querySelector('a.card .star').click()"); await sleep(900);
    s.eq("收藏已记录", await b.js("window.__page.ui.starred.length"), 1);
    s.ok("已持久化", (await b.js("JSON.parse(localStorage.getItem('links-ui-v1')).starred.length")) === 1);
    s.ok("常用区显示", (await b.js("document.getElementById('c-__pinned__').style.display")) !== "none");
    s.eq("常用区含该卡片", await b.js("document.querySelectorAll('#c-__pinned__ a.card').length"), 1);
    s.eq("统计项增加到 3", await b.js("document.querySelectorAll('#stats .item').length"), 3);
    const url1 = await b.js("window.__page.ui.starred[0]");
    s.eq("同一站点的所有实例星标同步",
      await b.js(`(()=>{const u=${JSON.stringify(url1)};
        return [...document.querySelectorAll('a.card')].filter(c=>c.getAttribute('href')===u&&c.querySelector('.star').classList.contains('on')).length})()`),
      await b.js(`(()=>{const u=${JSON.stringify(url1)};
        return [...document.querySelectorAll('a.card')].filter(c=>c.getAttribute('href')===u).length})()`));
    await b.js("document.querySelector('#c-__pinned__ a.card .star').click()"); await sleep(900);
    s.eq("可取消收藏", await b.js("window.__page.ui.starred.length"), 0);
    s.eq("常用区隐藏", await b.js("document.getElementById('c-__pinned__').style.display"), "none");

    s.section("键盘导航");
    await b.js("document.getElementById('q').focus()");
    await b.js("document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))"); await sleep(400);
    s.eq("↓ 从搜索框进入结果", await b.js("window.__pageTest.kbIndex"), 0);
    for (let i = 0; i < 3; i++) {
      await b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))"); await sleep(250);
    }
    s.eq("→ 推进 3 次", await b.js("window.__pageTest.kbIndex"), 3);
    s.eq("同时只有一个高亮", await b.js("document.querySelectorAll('.card.kb-focus').length"), 1);
    await b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))"); await sleep(250);
    s.eq("← 回退", await b.js("window.__pageTest.kbIndex"), 2);
    await b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))"); await sleep(250);
    s.eq("↑ 到顶回到搜索框", await b.js("document.activeElement.id"), "q");

    s.section("筛选后必须清空键盘焦点（曾出现幽灵高亮）");
    await b.js("window.__pageTest.focusCard(10)"); await sleep(400);
    await b.js("[...document.querySelectorAll('.chip')].find(c=>c.dataset.value==='影音').click()"); await sleep(900);
    s.eq("切分类后 kbIndex 归位", await b.js("window.__pageTest.kbIndex"), -1);
    s.eq("切分类后无残留高亮", await b.js("document.querySelectorAll('.card.kb-focus').length"), 0);
    await b.js("[...document.querySelectorAll('.chip')].find(c=>c.dataset.value==='all').click()"); await sleep(800);
    await b.js("window.__pageTest.focusCard(5)"); await sleep(400);
    await b.js("(()=>{const q=document.getElementById('q');q.value='zzzznope';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await sleep(900);
    s.eq("搜索无结果后无残留高亮", await b.js("document.querySelectorAll('.card.kb-focus').length"), 0);
    await b.js("(()=>{const q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(800);

    s.section("搜索相关性排序");
    await b.js("(()=>{const q=document.getElementById('q');q.value='git';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await sleep(900);
    const order = await b.js("[...document.querySelectorAll('a.card')].filter(e=>!e.classList.contains('hide')).map(e=>e.querySelector('.t').textContent).join(',')");
    s.ok("前缀匹配排在最前（GitHub 在首位）", String(order).split(",")[0] === "GitHub", order);
    s.section("别名搜索");
    await b.js("(()=>{const q=document.getElementById('q');q.value='油管';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await sleep(900);
    s.ok("搜「油管」命中 YouTube",
      String(await b.js("[...document.querySelectorAll('a.card')].filter(e=>!e.classList.contains('hide')).map(e=>e.querySelector('.t').textContent).join(',')")).includes("YouTube"));
    await b.js("(()=>{const q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(700);

    s.section("三档视图密度");
    for (const [id, cls] of [["viewList", "view-list"], ["viewCozy", "view-cozy"], ["viewGrid", "view-grid"]]) {
      await b.js(`document.getElementById('${id}').click()`); await sleep(500);
      const body = await b.js("document.body.className");
      if (cls === "view-grid") s.ok("标准网格：无额外 view 类", !String(body).includes("view-list") && !String(body).includes("view-cozy"));
      else s.ok(`${id} 生效`, String(body).includes(cls));
    }
    s.ok("视图偏好已持久化", typeof (await b.js("JSON.parse(localStorage.getItem('links-ui-v1')).view")) === "string");

    s.section("读屏播报");
    s.eq("toast 容器 aria-live", await b.js("document.getElementById('toasts').getAttribute('aria-live')"), "polite");
    s.eq("播报区 aria-live", await b.js("document.getElementById('live').getAttribute('aria-live')"), "polite");
    await b.js("(()=>{const q=document.getElementById('q');q.value='github';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await sleep(900);
    s.ok("搜索结果数被播报", String(await b.js("document.getElementById('live').textContent")).includes("找到"));
    await b.js("(()=>{const q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(700);

    s.section("首次访问引导");
    s.ok("首次显示引导", await b.js("document.getElementById('onboard').classList.contains('show')"));
    await b.js("document.getElementById('onboardClose').click()"); await sleep(500);
    s.ok("点击后消失", !(await b.js("document.getElementById('onboard').classList.contains('show')")));
    s.eq("已记录不再显示", await b.js("localStorage.getItem('links-seen-v1')"), "1");

    s.section("导入 links.json");
    await b.js("document.getElementById('btnImport').click()"); await sleep(700);
    s.ok("导入弹窗打开", await b.js("document.getElementById('mask').classList.contains('show')"));
    const payload = JSON.stringify({ title: "导入标题", subtitle: "来自导入",
      categories: [{ name: "导入分类", links: [{ name: "导入A", url: "https://a.example" }] }],
      starred: ["https://a.example"] });
    await b.js(`(()=>{const ta=document.querySelector('#modalBody textarea');ta.value=${JSON.stringify(payload)}})()`);
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()"); await sleep(1200);
    s.eq("导入后标题", await b.js("window.__page.data.title"), "导入标题");
    s.eq("导入后分类数", await b.js("window.__page.data.categories.length"), 1);
    s.eq("收藏一并恢复", await b.js("window.__page.ui.starred.length"), 1);
    // 非法 JSON
    await b.js("document.getElementById('btnImport').click()"); await sleep(700);
    await b.js("(()=>{const ta=document.querySelector('#modalBody textarea');ta.value='{ bad json'})()");
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()"); await sleep(700);
    s.ok("非法 JSON 被拦下", String(await b.js("(()=>{const h=[...document.querySelectorAll('#modalBody .hint')];return h.length?h[h.length-1].textContent:''})()")).includes("导入失败"));
    await b.js("document.querySelector('#ModalOpen') || document.querySelector('.modal-close').click()"); await sleep(500);
    await b.js("document.getElementById('undoBtn').click()"); await sleep(1200);
    s.eq("导入可被撤销", await b.js("window.__page.data.categories.length"), 7);

    s.section("hash 语义（含旧格式兼容）");
    for (const [hash, expect] of [["#cat=常读", 15], ["#c-AI%20状态", 3], ["#cat=不存在", 73]]) {
      await b.goto(srv.base + "?" + Math.random() + hash, 5200);
      s.eq(`hash ${hash}`, await b.js("[...document.querySelectorAll('a.card')].filter(e=>!e.classList.contains('hide')).length"), expect);
    }

    s.section("横向溢出（多视口）");
    for (const w of [360, 390, 768, 1024, 1440, 1920]) {
      await b.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
      await b.goto(srv.base + "?w=" + w, 4800);
      s.eq(`视口 ${w}px 无横向溢出`, await b.js("document.documentElement.scrollWidth <= window.innerWidth + 1"), true);
    }

    s.ok("无 JS 运行时异常", b.errors.length === 0, b.errors.length ? b.errors[0] : "");
  } finally {
    await b.close(); srv.close();
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(s => process.exit(s.summary() ? 0 : 1));
}
