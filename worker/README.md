# 壹页 · GitHub OAuth Token 交换 Worker（yiyi-oauth）

这是「壹页」实现**在站内直接提交到 GitHub** 所需的唯一后端，约 200 行、零依赖、无状态。
部署一次大概 10 分钟，不需要买域名，Cloudflare 免费套餐足够。

> 这份文档假设你没怎么用过 Cloudflare。凡是容易错的地方都单独标了 ⚠️，**最常错的一步是第一步里 Callback URL 该填站点地址而不是 Worker 地址**。

---

## 1. 这个 Worker 是干什么的（以及不干什么）

背景事实（已实测，不要凭直觉推翻）：

- GitHub 的 **Contents API 支持浏览器跨域**：预检返回 `204`，`allow-methods` 含 `PUT`，`allow-origin: *`。
  → 所以**提交 `links.json` 这件事完全在浏览器里完成，不需要服务端代理**。
- 但 GitHub 的 **token 交换端点 `POST https://github.com/login/oauth/access_token` 不支持 CORS**，
  而且 `client_secret` 绝对不能放进前端。
  → 所以只剩下一个端点需要服务端。

于是这个 Worker 的唯一职责是：

```
浏览器拿到 code  →  POST 给 Worker  →  Worker 用 secret 换 token  →  校验是不是站主  →  回传 token
```

它**刻意不做**的事：

| 不做 | 说明 |
| --- | --- |
| 不接触仓库 | 不调用任何 Contents API，不读写 `links.json`；提交由浏览器直连 GitHub 完成 |
| 不存数据 | 不用 KV / D1 / R2 / 缓存，token 和 code 不落任何存储 |
| 不写日志 | 代码里没有任何 `console.*`，Cloudflare 日志里不会出现 code 或 token |
| 不引依赖 | 只用 Web 标准 API（`fetch` / `Headers` / `Request` / `Response`） |

接口只有一个：

```
POST /token          （路径其实任意，推荐 /token）
body: {"code":"<GitHub 回调带来的 code>"}

200  {"token":"gho_xxx"}                 成功，且请求来源 + 用户 ID 都通过校验
400  {"error":"bad_code", ...}           body 不是合法 JSON 或缺 code
400  {"error":"github_error", ...}       GitHub 拒绝换取 token（code 过期/已用过，或 Client ID/Secret 填错）
403  {"error":"not_authorized", ...}     code 合法，但用户不是你 —— token 已被丢弃
403  {"error":"origin_not_allowed", ...} 请求来源不在白名单
405  {"error":"method_not_allowed", ...} 非 POST
500  {"error":"server_misconfigured", ...} 环境变量缺失或格式不对
502  {"error":"upstream_error", ...}     连不上 GitHub / GitHub 返回异常
```

---

## 2. 你要准备的两样东西

1. **你的 GitHub 数值 ID**（本文档第二节教怎么拿）
2. **一个 Cloudflare 账号**（免费注册，见第三节）

---

## 3. 第一步：在 GitHub 创建 OAuth App

1. 打开 <https://github.com/settings/developers>（或 GitHub 头像 → Settings → 左侧最下方 Developer settings → **OAuth Apps**）。
2. 点 **New OAuth App**（不是 New GitHub App，别选错）。
3. 按下面填：

| 字段 | 填什么 | 说明 |
| --- | --- | --- |
| Application name | `壹页`（随便起） | 只会显示在授权页面上 |
| Homepage URL | `https://borisxiao.github.io/links/` | 站点首页 |
| Application description | 可留空 | |
| **Authorization callback URL** | `https://borisxiao.github.io/links/` | ⚠️ **填站点地址，不是 Worker 地址**，见下方解释 |
| Enable Device Flow | 不勾 | 我们用标准浏览器跳转流程 |

4. 点 **Register application**。
5. 页面上会显示 **Client ID**（一串 `Ov23li...` 之类的字符）——复制保存。
6. 点 **Generate a new client secret**，复制 **Client Secret**。

> ⚠️ **Client Secret 只会显示这一次**，关掉页面就再也看不到，只能重新生成。请立刻存到密码管理器里。

### ⚠️ 为什么 Callback URL 是站点地址，而不是 Worker 地址（最容易搞错的一步）

授权流程的**浏览器跳转**是这样的：

```
站点页面  --跳转-->  https://github.com/login/oauth/authorize?client_id=...&redirect_uri=https://borisxiao.github.io/links/&scope=public_repo
                            ↓ 用户在 GitHub 上点「Authorize」
GitHub  --带 ?code=... 跳回-->  https://borisxiao.github.io/links/?code=xxxx
                            ↓ 页面里的 JS 读出 code
站点页面  --POST {code}-->  Worker  --换 token-->  GitHub
```

- GitHub 会**严格校验** `redirect_uri` 和 App 里登记的 callback 完全一致，然后把用户**连人带 code 跳回站点页面**——需要这个 code 的是页面里的 JS，所以回跳地址必须是**站点地址**。
- **Worker 从头到尾不参与跳转**，它只接受 `POST` 的 JSON。如果你把 callback 填成 Worker 地址，会出现两种坏结果：GitHub 可能报 `redirect_uri_mismatch`；即使跳过去，Worker 对 `GET` 只回 `405`，页面也不会被打开，用户看到一片 JSON 错误。
- 所以：**Callback URL = `https://borisxiao.github.io/links/`；Worker 地址不填进 GitHub 的任何字段。**

> 顺带一提：授权 URL 里需要带 `scope=public_repo`（写公开仓库所需的最小权限）。这一步在前端拼授权链接时做，和 Worker 无关。

---

## 4. 第二步：拿到你自己的 GitHub 数值 ID

Worker 的核心安全检查就是比对 `user.id`，所以你必须知道自己的**数字** ID。

**方法 A（推荐，命令行）：**

```bash
curl -s https://api.github.com/users/BorisXiao | grep '"id"'
```

输出（示例，你的实际值以此为准）：

```json
  "id": 76441108,
```

→ 要填进环境变量 `ALLOWED_GITHUB_ID` 的就是 **`76441108`**（纯数字，不带引号、不带逗号）。

**方法 B（浏览器）：** 打开 <https://api.github.com/users/BorisXiao>，看 JSON 开头的
`"login": "BorisXiao"` 下面那行 `"id": 76441108`。

> ⚠️ 不要填错成 `node_id`（形如 `MDQ6VXNlcjc2NDQxMTA4`，是字符串），也不要填 `login`（用户名可以改，数字 ID 不变，更安全）。
> 换用户名后数字 ID 不变，所以白名单用数字 ID 最稳。

---

## 5. 第三步：注册 Cloudflare 并部署这个 Worker

### 5.1 注册

1. 打开 <https://dash.cloudflare.com/sign-up>，用邮箱注册并验证。
2. 免费套餐（Workers Free）足够，**不需要买域名，也不需要绑定信用卡**。
3. 部署完成后 Cloudflare 会送你一个 `*.workers.dev` 子域名，我们就用它。

### 5.2 安装 wrangler（Cloudflare 官方 CLI）

需要 Node.js 18 或更高版本。

```bash
npm install -g wrangler
wrangler --version     # 能输出版本号即可
```

> 不想全局安装也可以用 `npx wrangler@latest` 替换下面所有 `wrangler` 命令。

### 5.3 登录 Cloudflare

```bash
wrangler login
```

浏览器会自动打开并要求授权，点 **Allow**。终端出现 `Successfully logged in` 即可。
（若服务器无浏览器，改用 `wrangler login --browser=false` 按提示贴 token。）

### 5.4 首次部署

```bash
cd worker          # 就是本文件所在的目录，里面要有 wrangler.toml 和 worker.js
wrangler deploy
```

成功后会打印 Worker 地址，形如：

```
https://yiyi-oauth.<你的子域>.workers.dev
```

于是 token 端点就是 **`https://yiyi-oauth.<你的子域>.workers.dev/token`**。

> 此时还没设环境变量，访问会返回 `500 server_misconfigured`，这是**正常的**，下一步补上。
> 这一步先部署一次，是因为 `wrangler secret put` 要求 Worker 已经存在。

### 5.5 逐条设置 4 个环境变量（全部走加密 secret）

在 `worker/` 目录下依次执行下面 4 条命令，**每条都会提示 `Enter a secret value:`，粘贴后回车**（输入内容不会显示，也不会进入 shell 历史）：

```bash
# 1) 唯一允许调用 Worker 的网页来源：只写到域名，不带路径、不带末尾斜杠、绝不用 *
wrangler secret put ALLOWED_ORIGIN
# 粘贴：https://borisxiao.github.io

# 2) 第一步拿到的 Client ID（公开值，但统一走 secret 省心）
wrangler secret put GITHUB_CLIENT_ID
# 粘贴：Ov23li...（你的 Client ID）

# 3) 第一步拿到的 Client Secret（绝密）
wrangler secret put GITHUB_CLIENT_SECRET
# 粘贴：你的 Client Secret

# 4) 你的 GitHub 数值 ID
wrangler secret put ALLOWED_GITHUB_ID
# 粘贴：76441108
```

每条成功都会输出 `✨ Success! Uploaded secret <名字>`。

四个变量的作用一览（也和 `worker.js` 顶部注释对应）：

| 变量 | 作用 | 示例值 |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | CORS 白名单来源，精确匹配；用它替代 `*` | `https://borisxiao.github.io` |
| `GITHUB_CLIENT_ID` | 换 token 时表明是哪个 OAuth App | `Ov23liXXXXXXXX` |
| `GITHUB_CLIENT_SECRET` | 换 token 的密钥，只存在服务端 | `a1b2c3...` |
| `ALLOWED_GITHUB_ID` | 唯一允许的 GitHub 数值用户 ID | `76441108` |

> ⚠️ `ALLOWED_ORIGIN` 的规则：**Origin 是「协议 + 域名 + 端口」，不含路径**。
> 正确：`https://borisxiao.github.io`
> 错误：`https://borisxiao.github.io/links/`、`https://borisxiao.github.io/`（末尾斜杠）、`*`
>
> secret 设置后**立即生效，不需要重新部署**。想改值就再执行一次同样的命令。
> 也可以不用命令行：Cloudflare 面板 → Workers & Pages → `yiyi-oauth` → Settings → Variables and Secrets → 添加，类型选 **Secret**。

### 5.6 本地调试（可选）

想在本地跑（`wrangler dev`）时，环境变量放在 `worker/.dev.vars` 文件里，内容形如：

```
ALLOWED_ORIGIN=http://localhost:8000
GITHUB_CLIENT_ID=Ov23liXXXXXXXX
GITHUB_CLIENT_SECRET=a1b2c3...
ALLOWED_GITHUB_ID=76441108
```

> ⚠️ `.dev.vars` 里有明文 secret，**绝不要提交进 Git**（本仓库的 `worker/` 里没有、也不需要这个文件）。
> 本地调试时 `ALLOWED_ORIGIN` 要改成你本地服务器的来源，如 `http://localhost:8000`。

---

## 6. 第四步：部署后自测

### 6.1 探活：用假 code 打一发

```bash
curl -i -X POST "https://yiyi-oauth.<你的子域>.workers.dev/token" \
  -H "Origin: https://borisxiao.github.io" \
  -H "content-type: application/json" \
  -d '{"code":"fake-code"}'
```

**预期输出**（关键是 `400` + `github_error`，说明链路已通：Worker 收到了请求，并且拿你的凭据去问了 GitHub，GitHub 说这个 code 是假的）：

```
HTTP/2 400
content-type: application/json; charset=utf-8
access-control-allow-origin: https://borisxiao.github.io
cache-control: no-store

{"error":"github_error","message":"GitHub 拒绝换取 token：bad_verification_code（code 无效、已过期或已被使用过，请重新发起授权（用假 code 自测时出现这个是正常的））"}
```

**这条命令的不同结果分别说明什么**（Worker 不会把 GitHub 的原始响应透出来，只给错误代码 + 排查提示）：

| 你看到的 | 说明 | 下一步 |
| --- | --- | --- |
| `400 github_error` + `bad_verification_code` | ✅ **这就是成功的样子**：凭据被 GitHub 接受，只是 code 是假的 | 无需处理，去做 6.4 的真实授权验证 |
| `400 github_error` + `Not Found` + 「通常是 GITHUB_CLIENT_ID 填错了」 | GitHub 根本找不到这个 OAuth App（实测这种情况 GitHub 回 HTTP 404） | 重设 `GITHUB_CLIENT_ID` |
| `400 github_error` + `incorrect_client_credentials` | Client ID 对但 Client Secret 不对 | 重设 `GITHUB_CLIENT_SECRET` |
| `500 server_misconfigured` | 某个 secret 没设上，message 里写明缺哪个 | 执行对应的 `wrangler secret put` |
| `403 origin_not_allowed` | 你漏了 `-H "Origin: https://borisxiao.github.io"`，或 `ALLOWED_ORIGIN` 值不对 | 见 8.1 |

### 6.2 预检自测

```bash
curl -i -X OPTIONS "https://yiyi-oauth.<你的子域>.workers.dev/token" \
  -H "Origin: https://borisxiao.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**预期：`204`，且响应头里有** `access-control-allow-origin: https://borisxiao.github.io`、
`access-control-allow-methods: POST, OPTIONS`、`access-control-allow-headers: content-type`。

### 6.3 其余分支快查表

| 命令（省略 URL 前缀） | 预期 |
| --- | --- |
| `GET` 请求 | `405 {"error":"method_not_allowed"}` |
| `POST -d '{}'` | `400 {"error":"bad_code"}` |
| `POST -d 'not-json'` | `400 {"error":"bad_code"}` |
| 不带 `Origin` 头（curl 默认） | 正常处理，但响应里**没有** ACAO 头 |
| `-H "Origin: https://evil.example"` | `403 {"error":"origin_not_allowed"}`，且无 ACAO 头 |

### 6.4 真实验证

真正的 `200 {"token":"..."}` 只能通过一次站内授权拿到：在站点上点「授权 GitHub」→ 在 GitHub 点 Authorize → 跳回站点 → 页面把 code POST 给 Worker。
想确认端到端是否成功，打开浏览器开发者工具 → Network，看这个 `POST /token` 是否 `200`。
如果前端拿到 token 后提交 `links.json` 失败，那是 GitHub Contents API 的问题（多半是 token 缺 `public_repo` 权限，或仓库分支/路径不对），不是 Worker 的问题。

### 6.5 把地址接到前端

Worker 地址只有前端需要知道，把它配到站点的常量里（例如 `index.html` 里的 `WORKER_URL`）：

```js
const WORKER_URL = "https://yiyi-oauth.<你的子域>.workers.dev/token";
```

> 按本项目约定，本 Worker 只负责 `/token`；前端授权链接里的 `redirect_uri` 请用站点地址 `https://borisxiao.github.io/links/`，且必须与 GitHub OAuth App 里登记的一致。

---

## 7. 安全说明

1. **token 只回传给白名单来源。** `Access-Control-Allow-Origin` 不是 `*`，而是用 `ALLOWED_ORIGIN` 精确匹配后回显；来源不匹配时直接 `403` 且**不带** CORS 头，浏览器也会拦下响应。别的网站即使诱导用户走完授权，也读不到 token。
2. **服务端强制校验用户身份。** 拿到 token 后立刻 `GET https://api.github.com/user`，比对 `user.id === Number(ALLOWED_GITHUB_ID)`；不匹配就**丢弃 token 并返回 `403 not_authorized`**，同时尽力调 GitHub 撤销该 token。这一步是安全核心，不可删除、不可改成「只校验用户名」。
3. **无状态、不存数据。** 没有 KV / D1 / R2，token 与 code 只在单次请求的内存里存在，响应结束即消失。
4. **无日志。** 代码里没有 `console.*`，`code` 和 `token` 不会写进 Cloudflare 日志或任何地方。
5. **secret 不进前端、不进 Git。** Client Secret 只以 Cloudflare 加密 secret 形式存在；`worker/` 目录里没有任何明文密钥文件（`.dev.vars` 只在本地调试时临时创建，且不应提交）。
6. **不碰仓库。** Worker 不调用 Contents API、不需要仓库权限；提交动作由浏览器拿着 token 直连 GitHub 完成，Worker 即使被攻破也无法改你的仓库。
7. **最小权限。** 前端授权时只申请 `public_repo`（写公开仓库的最小 scope），不要申请 `repo`、`delete_repo` 等更宽的权限。

### 如何轮换 Client Secret

怀疑泄露、或按周期轮换时：

1. GitHub → <https://github.com/settings/developers> → 点进你的 OAuth App → **Generate a new client secret**
   （GitHub 允许新旧 secret 并存一段时间，方便平滑切换）。
2. 立刻更新 Worker 里的值：

   ```bash
   cd worker
   wrangler secret put GITHUB_CLIENT_SECRET
   # 粘贴新的 Client Secret
   ```

   secret **立即生效，无需重新部署**。
3. 回到 6.1 的自测命令验证仍是 `bad_verification_code`（而不是 `incorrect_client_credentials`）。
4. 确认无误后，在 GitHub 上**删掉旧的 secret**。
5. 如果怀疑已经泄露，顺手去 <https://github.com/settings/applications> 撤销所有已签发的授权（Authorized OAuth Apps 里找到「壹页」→ Revoke），让旧 token 全部失效。
6. 同理可轮换 `GITHUB_CLIENT_ID`（在 GitHub 上是同一个 App，一般不需要换；真要换就新建 App，并同步更新 `ALLOWED_ORIGIN` 之外的两个变量）。

---

## 8. 常见故障排查

### 8.1 浏览器控制台报 CORS 错误

典型报错：`No 'Access-Control-Allow-Origin' header is present on the requested resource`
或 `Response to preflight request doesn't pass access control check`。

| 可能原因 | 怎么查 | 怎么修 |
| --- | --- | --- |
| `ALLOWED_ORIGIN` 写成了带路径的地址 | 6.2 的预检命令里有 ACAO 头，但值不对 | 改成 `https://borisxiao.github.io`（无路径、无末尾斜杠） |
| 在本地 `http://localhost:8000` 测试 | 预检响应里没有 ACAO | 临时把 `ALLOWED_ORIGIN` 改成 `http://localhost:8000`（注意端口要一致），测完改回来 |
| 直接双击 `index.html`（`file://`）打开 | 请求的 `Origin` 是 `null` | 必须起本地服务器：`python3 -m http.server 8000` |
| 改的是别的 Worker / 页面请求了旧地址 | `wrangler secret put` 后 `wrangler secret list` 确认存在 | 确认 `wrangler.toml` 的 `name = "yiyi-oauth"`，且前端 `WORKER_URL` 指向这个地址 |
| 预检就返回了 4xx/5xx | 看预检响应体：`server_misconfigured` 说明 secret 缺失 | 补设对应 secret（secret 立即生效，不用重新部署） |

> 排查口诀：先用 `curl -i -X OPTIONS` 打预检，再看 `wrangler tail` 的实时日志（`wrangler tail yiyi-oauth`）。**curl 没有 CORS 限制，curl 都不通就不是 CORS 问题。**

### 8.2 返回 `403 {"error":"not_authorized"}`

含义：code 换 token 成功了，但那个 GitHub 账号的 `id` 不等于 `ALLOWED_GITHUB_ID`，token 已被丢弃。

| 可能原因 | 怎么查 | 怎么修 |
| --- | --- | --- |
| `ALLOWED_GITHUB_ID` 填成了用户名或 `node_id` | 值应该是纯数字 | 用第四节的方法重新取，`wrangler secret put ALLOWED_GITHUB_ID` 覆盖 |
| 浏览器当时登录的是另一个 GitHub 账号 | GitHub 授权页右下角/头像显示的是谁 | 退出那个账号或用无痕窗口登录自己的账号重新授权 |
| 数字填错一位 | `curl -s https://api.github.com/users/BorisXiao \| grep '"id"'` | 重新粘贴 |
| 自己给别的账号授权测试 | — | 这是**预期行为**，白名单机制正常工作 |

### 8.3 返回 `400 {"error":"bad_code"}`

含义：Worker 没从请求体里读到非空的 `code` 字符串。

| 可能原因 | 怎么查 | 怎么修 |
| --- | --- | --- |
| 前端没把 code 放进 body | 开发者工具 Network 看请求 payload | 必须是 `{"code":"..."}`，`content-type: application/json` |
| URL 里没有 `?code=` | 看地址栏 | GitHub 回调才会带 code；检查 OAuth App 的 Callback URL 是否为站点地址，以及 `redirect_uri` 是否与之一致 |
| code 已过期（约 10 分钟） | 报错时是否停留很久 | 重新点「授权」再走一遍 |
| code 被用了两次 | 页面是否重复发送（React 严格模式、重试逻辑） | 保证一次授权只用一次；如需重试必须重新拿新 code |
| JSON 写坏了（如单引号、尾逗号） | 请求体原文 | 用 `JSON.stringify({code})` 生成 |
| 误把 `code` 放进了 URL query | Network 里看 | 本 Worker 只读 JSON body，不读 query |

### 8.4 其他错误码速查

| 错误 | 含义与处理 |
| --- | --- |
| `500 server_misconfigured` | 有环境变量没设或格式不对，`message` 会写明缺哪个；执行对应的 `wrangler secret put` |
| `403 origin_not_allowed` | 请求的 `Origin` 与 `ALLOWED_ORIGIN` 不一致，见 8.1 |
| `405 method_not_allowed` | 用了 GET/PUT 等。本 Worker 只接受 POST，浏览器直接打开 URL 也会看到这个 |
| `502 upstream_error` | Worker 连不上 GitHub 或 GitHub 返回异常（网络抖动、GitHub 故障）；看 `message` 里的 HTTP 状态码后重试 |
| `400 github_error` + `incorrect_client_credentials` | Client Secret 不对（Client ID 是对的），重新核对后重设 secret |
| `400 github_error` + `Not Found` | **GitHub 找不到这个 OAuth App**（实测此时 GitHub 返回 HTTP 404 + `{"error":"Not Found"}`），几乎总是 `GITHUB_CLIENT_ID` 填错或 OAuth App 被删了 |
| `400 github_error` + `bad_verification_code` | code 无效/过期/重复使用，重新授权；**用假 code 自测时出现这个是正常的** |
| `400 github_error` + `redirect_uri_mismatch` | 授权链接里的 `redirect_uri` 与 OAuth App 登记的 Callback URL 不一致，改成 `https://borisxiao.github.io/links/` |

---

## 9. 文件清单

```
worker/
├── worker.js      # Worker 本体：CORS + 换 token + 身份校验，零依赖
├── wrangler.toml  # 最小配置：name = yiyi-oauth、main、compatibility_date
└── README.md      # 本文档
```

`worker/` 之外的文件（`index.html`、`links.json`、根 `README.md` 等）不属于本次改动范围。
