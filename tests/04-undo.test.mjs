/* 撤销：核心是「快照必须在数据改动之前记录」。
   历史教训：act() 曾在 splice 之后调用，导致快照记的是已改动状态，
   撤销等于没撤。本测试专门锁住这个顺序。 */
import { serve, launch, createSuite, sleep } from "./lib.mjs";

export default async function run() {
  const s = createSuite("撤销");
  const srv = await serve();
  const b = await launch();
  try {
    await b.enable();
    await b.goto(srv.base);

    s.section("初始状态");
    s.ok("无历史时撤销按钮隐藏", (await b.js("getComputedStyle(document.getElementById('undoBtn')).display")) === "none");

    s.section("删除后撤销");
    const n0 = await b.js("window.__page.data.categories[0].links.length");
    await b.js("document.getElementById('editToggle').click()"); await sleep(800);
    await b.js("document.querySelector('.edit-bar .mini.del').click()"); await sleep(600);
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()"); await sleep(1000);
    s.eq("删除生效", await b.js("window.__page.data.categories[0].links.length"), n0 - 1);
    s.ok("撤销按钮出现", (await b.js("getComputedStyle(document.getElementById('undoBtn')).display")) !== "none");
    await b.js("document.getElementById('undoBtn').click()"); await sleep(1000);
    s.eq("撤销后恢复原数量", await b.js("window.__page.data.categories[0].links.length"), n0);
    s.ok("撤销回线上状态后清除本机标记", (await b.js("localStorage.getItem('links-data-v1')")) === null);

    s.section("多步撤销 + Ctrl+Z");
    await b.js("document.getElementById('editToggle').click()"); await sleep(600);
    for (const name of ["撤销A", "撤销B", "撤销C"]) {
      await b.js("[...document.querySelectorAll('#c-常读 .sec-actions .btn')].find(x=>x.textContent.trim()==='添加').click()");
      await sleep(600);
      await b.js(`(()=>{const ins=document.querySelectorAll('#modalBody input');
        ins[0].value=${JSON.stringify(name)};ins[1].value='https://undo.example';
        [...document.querySelectorAll('#modalBody .modal-foot .btn')].find(x=>x.textContent.trim()==='保存').click()})()`);
      await sleep(900);
    }
    s.eq("连续新增 3 个", await b.js("window.__page.data.categories[0].links.length"), n0 + 3);
    for (let i = 0; i < 3; i++) {
      await b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))");
      await sleep(700);
    }
    s.eq("Ctrl+Z 三次后回到原数量", await b.js("window.__page.data.categories[0].links.length"), n0);

    s.section("排序变更也可撤销");
    await b.js("document.querySelector('.edit-bar .mini.del')"); // 确保编辑态
    const names0 = await b.js("window.__page.data.categories[0].links.slice(0,3).map(l=>l.name).join(',')");
    await b.js("(()=>{const btns=[...document.querySelectorAll('.nudge')][0];btns.querySelectorAll('button')[1].click()})()");
    await sleep(1000);
    const names1 = await b.js("window.__page.data.categories[0].links.slice(0,3).map(l=>l.name).join(',')");
    s.ok("下移改变了顺序", names0 !== names1, `${names0} → ${names1}`);
    await b.js("document.getElementById('undoBtn').click()"); await sleep(1000);
    s.eq("撤销排序恢复原顺序", await b.js("window.__page.data.categories[0].links.slice(0,3).map(l=>l.name).join(',')"), names0);

    s.ok("无 JS 运行时异常", b.errors.length === 0, b.errors.length ? b.errors[0] : "");
  } finally {
    await b.close(); srv.close();
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(s => process.exit(s.summary() ? 0 : 1));
}
