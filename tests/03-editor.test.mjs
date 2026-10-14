/* 编辑系统：新增 / 修改 / 删除 / 批量导入 / 导出 / 恢复 */
import { serve, launch, createSuite, sleep, waitFor } from "./lib.mjs";

export default async function run() {
  const s = createSuite("编辑系统");
  const srv = await serve();
  const b = await launch();
  try {
    await b.enable();
    await b.goto(srv.base);
    await b.ready();

    s.section("进入编辑模式");
    await b.js("document.getElementById('editToggle').click()"); await sleep(800);
    s.eq("editing 状态", await b.js("window.__page.editing"), true);
    s.eq("各分类操作按钮组数", await b.js("document.querySelectorAll('.sec-actions').length"), 7);
    s.ok("悬浮「添加站点」按钮显示", (await b.js("getComputedStyle(document.getElementById('fab')).display")) !== "none");
    s.ok("卡片可拖拽", await b.js("[...document.querySelectorAll('a.card')].every(c=>c.draggable)"));
    s.ok("编辑态收起筛选条", (await b.js("getComputedStyle(document.getElementById('filtersWrap')).display")) === "none");

    s.section("新增站点（走分类标题的「添加」）");
    const n0 = await b.js("window.__page.data.categories[0].links.length");
    await b.js("[...document.querySelectorAll('#c-常读 .sec-actions .btn')].find(x=>x.textContent.trim()==='添加').click()");
    await b.modalReady();
    s.eq("弹窗标题", await b.js("document.getElementById('mTitle').textContent"), "添加站点");
    // 校验：空名称 / 非法网址
    await b.js("document.querySelectorAll('#modalBody input')[0].value='';document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    s.ok("空名称被拦下", await waitFor(() => b.js("!!document.querySelector('#modalBody .field.bad')")));
    await b.js("document.querySelectorAll('#modalBody input')[0].value='测试站';document.querySelectorAll('#modalBody input')[1].value='not-a-url';document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    await b.js("document.querySelectorAll('#modalBody input')[0].value='测试站';document.querySelectorAll('#modalBody input')[1].value='not-a-url'");
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    s.ok("非法网址被拦下", await waitFor(() => b.js("!!document.querySelector('#modalBody .field.bad')")));
    s.ok("校验失败时弹窗保持打开", await b.js("document.getElementById('mask').classList.contains('show')"));
    // 正常保存
    await b.js("document.querySelectorAll('#modalBody input')[1].value='https://test.example';document.querySelectorAll('#modalBody input')[2].value='测试描述'");
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    await waitFor(() => b.js(`window.__page.data.categories[0].links.length === ${n0 + 1}`));
    s.eq("新增生效", await b.js("window.__page.data.categories[0].links.length"), n0 + 1);
    s.ok("已写入 localStorage", await b.js("!!localStorage.getItem('links-data-v1')"));
    await waitFor(() => b.js("document.body.classList.contains('has-local')"));
    s.ok("显示本机改动提示条", await b.js("document.body.classList.contains('has-local')"));

    s.section("批量导入");
    const before = await b.js("window.__page.data.categories[0].links.length");
    await b.js("[...document.querySelectorAll('#c-常读 .sec-actions .btn')].find(x=>x.textContent.trim()==='批量').click()");
    await b.modalReady();
    await b.js(`(()=>{const ta=document.querySelector('#modalBody textarea');
      ta.value='批量A | https://a.example | 描述A\\nhttps://b.example\\n# 注释行\\n坏行没有网址';
      ta.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(400);
    s.ok("预览显示将添加 2 条", String(await b.js("document.querySelector('#modalBody .hint').textContent")).includes("2"));
    await b.js("[...document.querySelectorAll('#modalBody .modal-foot .btn')].find(x=>x.textContent.includes('添加')).click()");
    await waitFor(() => b.js(`window.__page.data.categories[0].links.length === ${before + 2}`));
    s.eq("批量导入生效（跳过注释与坏行）", await b.js("window.__page.data.categories[0].links.length"), before + 2);

    s.section("修改与删除");
    await b.js("document.querySelector('.edit-bar .mini:not(.grip):not(.del)').click()");
    await b.modalReady();
    s.ok("表单回填名称", !!(await b.js("document.querySelectorAll('#modalBody input')[0].value")));
    await b.js("document.querySelectorAll('#modalBody input')[0].value='改名成功'");
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    await waitFor(() => b.js("window.__page.data.categories[0].links[0].name === '改名成功'"));
    s.eq("改名生效", await b.js("window.__page.data.categories[0].links[0].name"), "改名成功");
    const beforeDel = await b.js("window.__page.data.categories[0].links.length");
    await b.js("document.querySelector('.edit-bar .mini.del').click()");
    await b.modalReady();
    s.ok("删除出现确认弹窗", await b.js("document.getElementById('mask').classList.contains('show')"));
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    await waitFor(() => b.js(`window.__page.data.categories[0].links.length === ${beforeDel - 1}`));
    s.eq("删除生效", await b.js("window.__page.data.categories[0].links.length"), beforeDel - 1);

    s.section("导出");
    const ex = JSON.parse(await b.js("window.__page.exportText()"));
    s.ok("导出为合法 JSON 且有分类", Array.isArray(ex.categories) && ex.categories.length === 7);
    s.ok("导出包含本机新增内容", JSON.stringify(ex).includes("测试站") || JSON.stringify(ex).includes("批量A"));

    s.section("恢复线上版本");
    await b.js("document.getElementById('editToggle').click()"); await sleep(600);
    await b.js("document.getElementById('btnReset2').click()");
    await b.modalReady();
    await b.js("document.querySelector('#modalBody .modal-foot .btn.primary').click()");
    await waitFor(() => b.js("localStorage.getItem('links-data-v1') === null"));
    s.ok("localStorage 数据已清空", (await b.js("localStorage.getItem('links-data-v1')")) === null);
    await waitFor(() => b.js("window.__page.data.categories[0].links.length === 15"));
    s.eq("恢复为线上数据", await b.js("window.__page.data.categories[0].links.length"), 15);
    await waitFor(() => b.js("!document.body.classList.contains('has-local')"));
    s.ok("提示条隐藏", !(await b.js("document.body.classList.contains('has-local')")));

    s.ok("无 JS 运行时异常", b.errors.length === 0, b.errors.length ? b.errors[0] : "");
  } finally {
    await b.close(); srv.close();
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(s => process.exit(s.summary() ? 0 : 1));
}
