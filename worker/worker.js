/**
 * 「壹页」GitHub OAuth Token 交换 Worker（yiyi-oauth）
 * ---------------------------------------------------------------------------
 * 这个 Worker 只做一件事：把前端拿到的 OAuth `code` 换成 `access_token`，
 * 校验「授权的人」是否是站点主人，是则把 token 回传，否则丢弃。
 *
 * 它为什么必须存在：
 *   - GitHub 的 Contents API 支持浏览器跨域（预检 204、allow-methods 含 PUT、
 *     allow-origin: *），所以「提交 links.json」这一步完全在浏览器里完成，
 *     不需要服务端代理。
 *   - 但 GitHub 的 token 交换端点 https://github.com/login/oauth/access_token
 *     不支持 CORS，而且 client_secret 绝不能进前端。
 *   于是只剩下这一个端点需要服务端：收 code → 换 token → 验身份 → 回 token。
 *
 * 它绝对不做的事（刻意设计）：
 *   - 不接触仓库：不调用任何 Contents API，不读写 links.json
 *   - 不存任何数据：不用 KV / D1 / R2 / Durable Objects / 缓存
 *   - 不写日志：代码里没有任何 console.*，token 与 code 不会落到任何日志里
 *   - 不引入任何依赖：纯 Web 标准 API（fetch / Headers / Request / Response）
 *
 * 需要的 4 个环境变量（在 Cloudflare 上用 `wrangler secret put` 设置）：
 *   ALLOWED_ORIGIN        必填。唯一允许调用本 Worker 的网页来源，必须精确匹配，
 *                         比如 https://borisxiao.github.io
 *                         （注意：来源不含路径，不要写成 .../links/，更不能用 *）
 *   GITHUB_CLIENT_ID      必填。GitHub OAuth App 的 Client ID（公开值）
 *   GITHUB_CLIENT_SECRET  必填。GitHub OAuth App 的 Client Secret（绝密，只存在服务端）
 *   ALLOWED_GITHUB_ID     必填。唯一允许提交的 GitHub 数值用户 ID，比如 76441108
 *                         （安全核心：即使别人用自己的 GitHub 账号走完授权，
 *                          他的 id 不匹配，token 也会被丢弃）
 *
 * 接口约定：
 *   POST /token   body: {"code": "<oauth code>"}
 *   200 {"token": "..."}                     —— 成功
 *   400 {"error":"bad_code"}                 —— body 不是合法 JSON 或缺 code
 *   400 {"error":"github_error"}             —— GitHub 拒绝换取 token（code 过期/已用过，或 Client ID/Secret 填错）
 *   403 {"error":"not_authorized"}           —— code 合法，但用户 ID 不在白名单
 *   403 {"error":"origin_not_allowed"}       —— 请求来自非白名单来源
 *   405 {"error":"method_not_allowed"}       —— 非 POST
 *   500 {"error":"server_misconfigured"}     —— 环境变量缺失/格式不对
 *   502 {"error":"upstream_error"}           —— 连不上 GitHub（网络/5xx）
 */

// GitHub 的两个固定端点
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
// 撤销 token 的端点（校验失败时尽力撤销，模板里填 client_id）
const GITHUB_REVOKE_URL = 'https://api.github.com/applications/{client_id}/token';

// 需要存在的环境变量清单
const REQUIRED_ENV_KEYS = [
  'ALLOWED_ORIGIN',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'ALLOWED_GITHUB_ID',
];

// 常见失败的排查提示（只给「怎么修」，不透出任何上游原文）
// 注意：client_id 不存在时 GitHub 会返回 HTTP 404 + {"error":"Not Found"}（已实测），
// 所以这里必须覆盖 'Not Found' 这一项，否则使用者只会看到一句没头绪的 404。
const GITHUB_ERROR_HINTS = {
  bad_verification_code: 'code 无效、已过期或已被使用过，请重新发起授权（用假 code 自测时出现这个是正常的）',
  incorrect_client_credentials: 'Client ID 或 Client Secret 不对，请核对后重设 secret',
  redirect_uri_mismatch: '授权链接里的 redirect_uri 与 GitHub OAuth App 登记的 Callback URL 不一致',
  'Not Found': 'GitHub 找不到这个 OAuth App，通常是 GITHUB_CLIENT_ID 填错了',
  unsupported_grant_type: 'grant_type 不受支持，请检查换 token 的请求参数',
};

/**
 * 统一构造响应头。
 * CORS 规则：只有当请求的 Origin 与 ALLOWED_ORIGIN 完全相等时，才回 Access-Control-Allow-Origin；
 * 其余情况干脆不回这个头，浏览器会自己拦下（绝不使用通配符 *）。
 */
function buildHeaders(allowedOrigin, origin) {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store'); // 响应里可能含 token，任何环节都不许缓存
  headers.set('Vary', 'Origin'); // 让 CDN/浏览器按 Origin 区分缓存键
  if (allowedOrigin && origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }
  return headers;
}

/** 返回一个 JSON 响应（body 里只有 error 与可诊断的 message，不含任何敏感原文） */
function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** 把可能出现在上游返回文本里的 secret 抹掉，避免错误信息意外泄露凭据 */
function redact(text, secret) {
  if (typeof text !== 'string') return '';
  let safe = text;
  if (secret) safe = safe.split(secret).join('[已隐藏]');
  return safe.length > 200 ? safe.slice(0, 200) + '…' : safe;
}

/** 尽力撤销一个不该下发的 token；失败无所谓，只求不让它继续可用 */
async function tryRevoke(token, env) {
  try {
    await fetch(GITHUB_REVOKE_URL.replace('{client_id}', encodeURIComponent(env.GITHUB_CLIENT_ID)), {
      method: 'DELETE',
      headers: {
        Authorization: 'Basic ' + btoa(env.GITHUB_CLIENT_ID + ':' + env.GITHUB_CLIENT_SECRET),
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'yiyi-oauth-worker', // GitHub API 要求带 User-Agent，否则 403
      },
      body: JSON.stringify({ access_token: token }),
    });
  } catch (e) {
    // 撤销失败不影响主流程：token 已经被丢弃、不会回传给任何调用方
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const headers = buildHeaders(allowedOrigin, origin);

    // ---- 0. CORS 预检：浏览器在真正 POST 之前会先发一个 OPTIONS ----
    // 注意：预检本身不带业务语义，回 204 空响应即可；ACAO 头由 buildHeaders 决定加不加。
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'content-type');
      headers.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers });
    }

    // ---- 1. 只接受 POST ----
    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed', message: '本端点只接受 POST' }, headers);
    }

    // ---- 2. 环境变量自检：缺了就明确报出来，不要带着空 secret 去请求 GitHub ----
    const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
    if (missing.length > 0) {
      return json(
        500,
        {
          error: 'server_misconfigured',
          message:
            'Worker 缺少环境变量：' +
            missing.join('、') +
            '。请在 worker/ 目录执行 wrangler secret put <名称> 重新设置后重试。',
        },
        headers
      );
    }

    // ---- 3. 来源白名单：精确匹配，不用 * ----
    // 带 Origin 的请求（浏览器）必须在白名单里；不带 Origin 的请求（curl 自测、服务端调用）放行，
    // 因为这类调用本来就不受同源策略保护，伪造 Origin 也不会有额外收益。
    if (origin && origin !== allowedOrigin) {
      return json(403, { error: 'origin_not_allowed', message: '请求来源不在白名单内' }, headers);
    }

    // ---- 4. 白名单用户 ID 必须是合法正整数 ----
    const allowedId = Number(env.ALLOWED_GITHUB_ID);
    if (!Number.isInteger(allowedId) || allowedId <= 0) {
      return json(
        500,
        { error: 'server_misconfigured', message: 'ALLOWED_GITHUB_ID 必须是 GitHub 的数值用户 ID' },
        headers
      );
    }

    // ---- 5. 读 body 里的 code ----
    let code = '';
    try {
      const body = await request.json();
      if (body && typeof body.code === 'string') code = body.code.trim();
    } catch (e) {
      // 不是合法 JSON，落到下面统一的 bad_code
    }
    if (!code) {
      return json(400, { error: 'bad_code', message: '请求体需要是 {"code":"..."} 形式的合法 JSON' }, headers);
    }

    // ---- 6. 用 code 换 token（这一步必须服务端做，因为要用 client_secret）----
    // 用 form-urlencoded 提交参数，Accept: application/json 让 GitHub 回 JSON。
    const tokenParams = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: code,
    });
    let tokenRes;
    try {
      tokenRes = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'yiyi-oauth-worker',
        },
        body: tokenParams.toString(),
      });
    } catch (e) {
      return json(502, { error: 'upstream_error', message: '无法连接 GitHub token 端点，请稍后重试' }, headers);
    }

    // 解析 GitHub 的返回；失败时只透出 error 代码与一条排查提示，绝不透出原始响应体。
    // 注意：GitHub 有时「HTTP 状态码不是 200 但 body 里带 error」（例如 client_id 不存在 → 404 Not Found），
    // 所以先看 body 里的 error，再看 HTTP 状态码。
    let tokenData = null;
    const rawText = await tokenRes.text();
    try {
      tokenData = JSON.parse(rawText);
    } catch (e) {
      tokenData = null;
    }
    if (tokenData && tokenData.error) {
      const code = String(tokenData.error);
      const hint = GITHUB_ERROR_HINTS[code] || redact(tokenData.error_description, env.GITHUB_CLIENT_SECRET);
      return json(
        400,
        {
          error: 'github_error',
          message: 'GitHub 拒绝换取 token：' + code + (hint ? '（' + hint + '）' : ''),
        },
        headers
      );
    }
    if (!tokenRes.ok || !tokenData || typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
      return json(
        502,
        { error: 'upstream_error', message: 'GitHub token 端点返回了非预期结果（HTTP ' + tokenRes.status + '）' },
        headers
      );
    }
    const token = tokenData.access_token;

    // ---- 7. 立刻用 token 查身份：这一步是安全核心，不可跳过 ----
    let userRes;
    try {
      userRes = await fetch(GITHUB_USER_URL, {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'yiyi-oauth-worker', // 不带 User-Agent 会被 GitHub 拒绝
        },
      });
    } catch (e) {
      await tryRevoke(token, env); // 拿不到身份就绝不下发
      return json(502, { error: 'upstream_error', message: '无法连接 GitHub API 校验用户身份' }, headers);
    }
    if (!userRes.ok) {
      await tryRevoke(token, env);
      return json(
        502,
        { error: 'upstream_error', message: 'GitHub API 校验用户身份失败（HTTP ' + userRes.status + '）' },
        headers
      );
    }

    let user = null;
    try {
      user = await userRes.json();
    } catch (e) {
      user = null;
    }
    const userId = user && Number(user.id);

    // ---- 8. 本人校验：id 不匹配就丢弃 token，绝不下发 ----
    if (!Number.isInteger(userId) || userId !== allowedId) {
      await tryRevoke(token, env); // 尽力撤销，让这个 token 立刻失效
      return json(403, { error: 'not_authorized', message: '该 GitHub 账号不在本站白名单内' }, headers);
    }

    // ---- 9. 通过：只把 token 回传给白名单来源 ----
    return json(200, { token: token }, headers);
  },
};
