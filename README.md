# 常用网址

一个零构建的静态导航页，参考 Apple 官网的视觉语言：大留白、克制的灰阶、毛玻璃导航、有物理感的动效。

- **搜索**：匹配名称、描述、网址、域名，命中关键词会高亮
- **分类筛选**：顶部 chip 切换，状态写入 URL hash，可直接分享
- **深浅色主题**：首访跟随系统，手动切换后记住
- **动效**：Hero 极光渐变、滚动揭示、卡片交错上映、鼠标跟随柔光、回到顶部
- **零依赖**：无框架、无构建、无后端、无统计

## 文件结构

```
boris-my-links/
├── index.html    # 页面本体（HTML + CSS + JS 全内联）
├── links.json    # 你的网址数据，唯一需要维护的文件
├── favicon.svg   # 站点图标
├── .nojekyll     # 让 GitHub Pages 跳过 Jekyll 处理
└── README.md
```

## 本地预览

`links.json` 是通过 `fetch` 读取的，**直接双击 `index.html` 会被浏览器的 CORS 策略拦住**，必须起一个本地服务器：

```bash
cd boris-my-links
python3 -m http.server 8000
# 打开 http://localhost:8000
```

改了 `links.json` 后刷新浏览器即可（已设 `cache: no-cache`，不会读到旧数据）。

## 维护网址

只需要编辑 `links.json`：

```json
{
  "title": "常用网址",
  "subtitle": "把每天要打开的站点放在一处",
  "categories": [
    {
      "name": "开发工具",
      "links": [
        { "name": "GitHub", "url": "https://github.com", "desc": "代码托管与协作" }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 否 | 页面大标题与浏览器标题；省略则保留默认 |
| `subtitle` | 否 | 标题下方一句话；省略则不显示 |
| `categories[].name` | 是 | 分组名，同时用作导航锚点和筛选按钮 |
| `categories[].icon` | 否 | 预留字段，当前未使用 |
| `links[].name` | 是 | 站点名 |
| `links[].url` | 是 | 网址，必须带 `https://` |
| `links[].desc` | 否 | 一句话描述；省略则显示域名 |

- 分类顺序 = 页面展示顺序
- 某分类 `links` 为空数组则整组不渲染
- **别删掉 JSON 的引号和逗号**，格式错误会导致页面显示「数据加载失败」

## 部署到 GitHub Pages

```bash
git add links.json
git commit -m "chore: 更新网址"
git push
```

Pages 会在约 1 分钟内自动重新发布。

### 首次部署设置

仓库 **Settings → Pages**：

- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main`，目录选 `/ (root)`
- 保存，等 1–2 分钟

访问 `https://<用户名>.github.io/<仓库名>/`。

## 技术说明

| 项目 | 说明 |
| --- | --- |
| 图标来源 | 通过 Google favicon 服务按域名获取；**取不到时自动降级为名称首字母色块**，不依赖网络也能看清 |
| 已知现象 | 极少数站点（如 `crates.io`）Google 服务抓不到图标会返回 404，控制台可能有一条外部资源报错。不影响显示，会走色块降级 |
| 权限边界 | 站点自身资源零 404；无任何第三方脚本，唯一的跨域请求是 favicon 图片 |
| 无障碍 | 键盘可达、搜索框 `aria-label`、筛选按钮 `aria-pressed`、`prefers-reduced-motion` 下关闭全部动效 |
| 兜底保护 | 滚动揭示若未按预期触发，1.2s 后强制显示所有分组 —— 宁可牺牲动画，也绝不让内容不可见 |
| 响应式 | 移动端单列、导航锚点自动折叠、搜索框占满宽度 |
| 兼容性 | 使用 `backdrop-filter`、`color-mix`、`IntersectionObserver`、CSS 自定义属性，支持 2020 年后的现代浏览器 |
