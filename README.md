# 常用网址

一个零构建的静态导航页，参考 Apple 官网的视觉语言：大留白、克制的灰阶、毛玻璃导航、有物理感的动效。

- **搜索**：匹配名称、描述、网址、域名、**别名 tags**，命中关键词会高亮
- **分类筛选**：顶部 chip 统一承担切换与定位（不再与导航重复列一遍）；状态写入 URL hash 可直接分享；切换时用 FLIP 让卡片平滑移动而非瞬跳
- **深浅色主题**：首访跟随系统，手动切换后记住；切换时图标旋转淡入
- **动效**：Hero 极光视差、滚动揭示、卡片交错上映、指针跟随柔光、回到顶部环形进度、统计数字滚动
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
| `links[].tags` | 否 | 别名数组，用于搜索。例如 YouTube 配 `["油管"]`，搜「油管」也能命中 |
| `links[].icon` | 否 | 官方图标路径（如 `/favicon.ico`），会拼在 `url` 之后。用于聚合服务取不到图标的站点 |

- 分类顺序 = 页面展示顺序
- 某分类 `links` 为空数组则整组不渲染
- 别名只参与搜索，不显示在页面上 —— 想让站点用你的习惯叫法搜到就加 `tags`

当前编目（73 个站点 / 7 个分类）：

| 分类 | 数量 | 说明 |
| --- | --- | --- |
| 社交 | 11 | X、Facebook、Instagram、Threads、Reddit、TikTok、小红书、微博、Telegram、Discord、LinkedIn |
| 开发工具 | 15 | GitHub、MDN、Stack Overflow、npm、PyPI、Docker Hub、Vercel 等 |
| AI 工具 | 16 | DeepSeek、ChatGPT、Claude、Gemini、Grok、Hugging Face、Ollama 等 |
| AI 状态 | 3 | TIBO（Codex 重置动态）、OpenAI Status、Claude Status |
| 常读 | 15 | LINUX DO、V2EX、Hacker News、掘金、博客园、酷壳、阮一峰、Google/百度/维基 |
| 影音 | 5 | YouTube、哔哩哔哩、Netflix、Spotify、Twitch |
| 效率 | 8 | Excalidraw、Carbon、TinyPNG、Squoosh、PDF24、草料、ITDOG、Speedtest |
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

## 设计说明

### 版面结构

一页内只用一个对齐轴 —— 标题、描述、统计、分组标题、卡片全部左对齐。

早期版本是「Hero 居中 + 内容左对齐」，两条对齐轴打架，版面会显得散。Apple 的页面几乎从不在同一列里混用居中与左对齐，所以改为统一的左对齐编辑式布局，并为每组数据加了语义化的竖线分隔。

分类切换只保留一处入口：顶部 chip 一排在滚动时吸顶，同时承担筛选与定位，不再由导航栏重复列一遍。

### URL 约定

| 形式 | 含义 |
| --- | --- |
| `#cat=影音` | 筛选到某分类，可分享 |
| `#sec=影音` | 滚动定位到某分组 |
| 无 hash | 显示全部 |

两种语义用显式前缀区分（早期版本共用一个裸分类名，导致 `#c-AI 状态` 解析后匹配不到任何分类而显示空白页）。旧的 `#c-分类名` 写法仍兼容，无法识别的 hash 一律安全回退到「全部」，不会出现空白页。

### 为什么暗色不用纯黑

纯黑背景（`#000`）上放近黑卡片（`#1c1c1e`），两者亮度差仅 **1.23:1**，卡片会失去依附感、看起来像一个个"黑框"。改用分层灰阶后：

| 层级 | 亮色 | 暗色 |
| --- | --- | --- |
| 页面底色 | `#f5f5f7` | `#0b0b0d` |
| 卡片 | `#ffffff` | `#17171b` |
| 悬停 | `#ffffff` | `#1e1e23` |

再配合可见描边（亮色 `rgba(0,0,0,.07)` / 暗色 `rgba(255,255,255,.085)`）建立层次。

### 文字对比度（WCAG AA 需 ≥ 4.5:1）

| 用途 | 亮色 | 暗色 |
| --- | --- | --- |
| 站点名 | 16.8:1 | 16.2:1 |
| 描述文字 | 6.3:1 | 7.5:1 |

### 图标为什么用浅底 + 投影

绝大多数品牌 logo 是深色或彩色，放在暗底上会糊成一团 —— 这是最初"黑框"观感的主因，所以头像恒定用浅底（`#f2f2f4`），两种主题一致。

但极少数 logo 是**纯白**的（如 Reddit），贴浅底会隐形（对比仅 1.12:1）。因此给图标加了一圈极淡投影勾出边界，白色 logo 靠阴影显形，深色与彩色 logo 不受影响 —— 比换成土气的中灰底更优雅。

### 图标级联回退

```
links.json 的 icon 字段（官方图标，品牌保真）
   ↓ 失败
favicon 聚合服务（可绕过部分站的防盗链与网络限制）
   ↓ 失败
名称首字母色块（离线可用，永不空框）
```

实测两者各有不可替代之处：**LINUX DO 直连返回 403 但聚合服务可取；小红书恰好相反**，所以级联而非二选一。另会主动检测"返回空白图但不报错"的情况。

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
