/* ════════════════════════════════════════════════════════════════
   نُخبة — Service Worker — النسخة النهائية
   ────────────────────────────────────────────────────────────────
   __SW_VERSION__ يُستبدل تلقائياً بـ timestamp عند كل Deploy
   عبر GitHub Actions (deploy.yml).
   ════════════════════════════════════════════════════════════════ */

const RAW_VERSION = '__SW_VERSION__';
const VERSION = (RAW_VERSION === '__SW_VERSION__') ? 'dev-local' : RAW_VERSION;
const CACHE_NAME = `elite-v${VERSION}`;

/* ── INSTALL ──────────────────────────────────────────────────────
   لا skipWaiting() هنا — يمنع التفعيل المفاجئ وحلقة الـ reload. */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).catch(() => {}));
  // لا skipWaiting — ننتظر رسالة SKIP_WAITING من الصفحة
});

/* ── ACTIVATE ─────────────────────────────────────────────────────
   حذف كل الكاشات القديمة، ثم claim الكلاينتس. */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── MESSAGE ──────────────────────────────────────────────────────
   الصفحة ترسل SKIP_WAITING عند اكتشاف إصدار جديد.
   بعدها يتم reload نظيف. */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── FETCH TIMEOUT ────────────────────────────────────────────────
   مهلة 7 ثوانٍ — تمنع التعليق اللانهائي على شبكة بطيئة. */
function fetchWithTimeout(request, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

/* ── OFFLINE FALLBACK ─────────────────────────────────────────────
   صفحة احتياطية عند انقطاع الإنترنت تماماً. */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#060D0A">
<title>نُخبة — لا يوجد اتصال</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:#060D0A;color:#e8f5ee;
  font-family:Cairo,system-ui,sans-serif;
  min-height:100vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  gap:20px;padding:24px;text-align:center
}
.icon{font-size:60px}
h1{font-size:20px;color:#22C55E;font-weight:900}
p{font-size:14px;color:#9fb8ac;max-width:300px;line-height:1.7}
button{
  padding:14px 40px;border:none;border-radius:14px;
  background:linear-gradient(135deg,#22C55E,#15803D);
  color:#fff;font-size:16px;font-weight:900;
  cursor:pointer;font-family:inherit
}
</style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>لا يوجد اتصال</h1>
  <p>تحقق من اتصالك بالإنترنت ثم حاول مجدداً</p>
  <button onclick="location.reload()">إعادة المحاولة</button>
  <script>window.addEventListener('online',()=>location.reload())</script>
</body>
</html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/* ── FETCH ────────────────────────────────────────────────────────*/
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  let url;
  try { url = new URL(event.request.url); } catch { return; }

  /* 1) Supabase / Auth / API — تجاهل تام، المتصفح يتعامل معها مباشرة */
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.in') ||
    url.hostname.includes('workers.dev') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/rpc/') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/realtime/') ||
    url.search.includes('apikey') ||
    event.request.headers.get('authorization')
  ) {
    return; // لا respondWith — المتصفح يرسلها مباشرة
  }

  /* 2) التنقل / HTML / sw / manifest — Network First دائماً
     لا نخزن index.html لضمان وصول آخر نسخة دائماً */
  const isNav =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/manifest.json';

  if (isNav) {
    event.respondWith(
      fetchWithTimeout(event.request, 8000)
        .then(res => {
          // نحتفظ بنسخة واحدة احتياطية للـ offline فقط
          if (res.ok && event.request.mode === 'navigate') {
            caches.open(CACHE_NAME)
              .then(c => c.put('/index.html', res.clone()))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request)
            .then(c => c || caches.match('/index.html'))
            .then(c => c || offlineResponse())
        )
    );
    return;
  }

  /* 3) الأصول الثابتة (صور / أيقونات / خطوط) — Cache First */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res?.ok && (res.type === 'basic' || res.type === 'cors')) {
          caches.open(CACHE_NAME)
            .then(c => c.put(event.request, res.clone()))
            .catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
