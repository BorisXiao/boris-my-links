/* 壹页 · Service Worker
   目的：断网或网络不稳时仍能打开页面并跳转站点。
   策略：network-first —— 有网时永远拿最新内容（改完推送立刻生效），
        只有网络失败时才回退到缓存。这样不会出现"站点改了但看到旧版"。 */
var CACHE = "yiyi-v1";
var ASSETS = ["./", "./index.html", "./links.json", "./favicon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* 个别资源取不到不影响安装 */ })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  /* 只接管同源请求；图标等外部请求交给浏览器正常处理 */
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        /* 成功后顺手更新缓存 */
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
  );
});
