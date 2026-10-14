# 测试

零依赖的端到端测试：启动本地静态服务器 + 无头 Chrome，通过 CDP 驱动真实页面。

## 运行

```bash
npm test                # 跑全部
npm test ux             # 只跑文件名含 ux 的
node tests/run.mjs      # 等价于 npm test
```

需要本机装有 Chrome / Chromium / Edge。若装在别处：

```bash
CHROME_PATH="/path/to/chrome" npm test
```

## 测试文件

| 文件 | 覆盖 |
| --- | --- |
| `01-basic` | 渲染、数据完整性、分类顺序、图标、资源无 4xx |
| `02-visibility` | **可见性** —— 专门防「元素存在但 opacity:0」这类静默故障 |
| `03-editor` | 新增 / 校验 / 批量导入 / 修改 / 删除 / 导出 / 恢复线上 |
| `04-undo` | 撤销（含「快照必须在改动前记录」这一关键顺序） |
| `05-ux` | 收藏置顶、键盘导航、搜索排序、三档视图、读屏播报、引导、导入、hash、多视口溢出 |

## 为什么单独有 `02-visibility`

历史教训：曾因重写时丢失 `revealHero()`，导致 hero 的标题/副标题/统计带着
`opacity: 0` 永远拿不到 `.in`，**线上首屏顶部一片空白**。

这类故障不报错、不抛异常、DOM 里元素也在，普通断言完全测不到 ——
只有断言「实际 computed opacity」才能发现。所以它值得单独一个文件。

## 编写注意

**不要用固定 `sleep` 猜时序。** 求值返回时渲染可能尚未完成，
这是本项目测试里出现最多的假失败来源。用 `waitFor()`：

```js
await b.js("...click()");
await waitFor(() => b.js("window.__page.data.categories[0].links.length === 16"));
```

另外：**弹窗内的输入框 id 是动态生成的**（`fld1`、`fld2`…，用于 label 无障碍关联），
不要用固定的 `#iName` 之类选择器 —— 用 `#modalBody input` 的索引。
