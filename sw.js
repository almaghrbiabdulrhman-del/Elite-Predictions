/* ════════════════════════════════════════════════════════════════
   نُخبة — Service Worker (v5 — Fixed)
   ----------------------------------------------------------------
   الإصلاحات:
   • منع حلقة إعادة التحميل اللانهائية (لا skipWaiting تلقائي).
   • عدم تخزين index.html / التنقل في الكاش إطلاقاً → دائماً أحدث نسخة
     من الشبكة، والكاش يُستخدم فقط عند انقطاع الإنترنت (offline fallback).
   • تجاهل كامل لطلبات Supabase / Auth / Workers / REST.
   • التحديث يتم عبر رسالة SKIP_WAITING من الصفحة فقط (تحكّم نظيف).
   • SW_VERSION يُستبدل تلقائياً عند كل نشر بواسطة CI (deploy.yml).
   ════════════════════════════════════════════════════════════════ */

// __SW_VERSION__ يُستبدل تلقائياً برقم البناء عبر GitHub Actions (deploy.yml).
// لو لم يُستبدل (تطوير محلي) نستخدم رقماً ثابتاً احتياطياً.
const RAW_VERSION = '__SW_VERSION__';
const VERSION = RAW_VERSION.indexOf('__SW_VERSION') === 0 ? 'dev-1781708737' : RAW_VERSION;
const CACHE_NAME = `elite-predictions-${VERSION}`;

// لا نُخزّن أي شيء مسبقاً — التطبيق صفحة واحدة (SPA) تُجلب من الشبكة.
const STATIC_ASSETS = [];

/* ── INSTALL ──────────────────────────────────────────────────────
   لا نستدعي skipWaiting() هنا. ننتظر رسالة SKIP_WAITING من الصفحة
   حتى لا يحدث تبديل مفاجئ للـ controller يؤدي إلى reload loop. */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

/* ── ACTIVATE ─────────────────────────────────────────────────────
   نحذف الكاشات القديمة فقط. لا نُرسل SW_UPDATED من هنا (كان يسبب
   حلقة reload). الإبلاغ بالتحديث يتم في الصفحة عبر updatefound. */
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
   الصفحة ترسل {type:'SKIP_WAITING'} عندما يوافق المستخدم/منطق التحديث
   على تفعيل النسخة الجديدة. عندها فقط نُفعّلها فوراً. */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── OFFLINE FALLBACK PAGE ──────────────────────────────────────────
   تُستخدم فقط عند فشل الشبكة والكاش معاً (مثل أول زيارة بدون اتصال).
   تمنع ظهور شاشة خطأ النظام الافتراضية (No internet connection). */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>نُخبة — لا يوجد اتصال</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{
    background:#0a1410;color:#e8f5ee;
    font-family:'Segoe UI',Tahoma,Arial,sans-serif;
    min-height:100vh;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;
  }
  .icon{font-size:56px;opacity:.85;}
  h1{font-size:20px;color:#3ddc84;font-weight:700;}
  p{font-size:15px;color:#9fb8ac;max-width:320px;line-height:1.6;}
  button{
    margin-top:8px;padding:14px 38px;border:none;border-radius:14px;
    background:linear-gradient(135deg,#2ecc71,#27ae60);color:#fff;
    font-size:16px;font-weight:700;cursor:pointer;
  }
  button:active{opacity:.85;}
</style></head>
<body>
  <div class="icon">📡</div>
  <h1>لا يوجد اتصال بالإنترنت</h1>
  <p>تحقق من اتصالك بالشبكة ثم حاول مجدداً. سيتم إعادة تحميل التطبيق تلقائياً عند استعادة الاتصال.</p>
  <button onclick="location.reload()">إعادة المحاولة</button>
  <script>
    window.addEventListener('online', () => location.reload());
  </script>
</body></html>`;

function offlineResponse(){
  return new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* مهلة صريحة على fetch — لو الشبكة "متصلة" لكن بطيئة جداً (انتظار بلا نهاية)،
   ننتقل للكاش/الـ fallback بسرعة بدل تعليق الشاشة. */
function fetchWithTimeout(request, ms){
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => { ctrl.abort(); reject(new Error('sw_fetch_timeout')); }, ms);
    fetch(request, { cache: 'no-store', signal: ctrl.signal })
      .then(res => { clearTimeout(t); resolve(res); })
      .catch(err => { clearTimeout(t); reject(err); });
  });
}

/* ── FETCH ────────────────────────────────────────────────────────*/
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }

  // 1) Supabase / Auth / Workers / REST / RPC — تجاهل تام، لا cache إطلاقاً.
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
    return; // اترك المتصفح يتعامل معها مباشرة (لا respondWith).
  }

  // 2) طلبات التنقل / HTML / sw / manifest — Network First بلا تخزين دائم.
  //    لا نُخزّن index.html أبداً حتى لا تظهر نسخة قديمة بعد النشر على Vercel.
  const isNavigation =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/sw.js') ||
    url.pathname.endsWith('/manifest.json');

  if (isNavigation) {
    event.respondWith(
      fetchWithTimeout(event.request, 8000)
        .then(response => {
          // نحتفظ بنسخة احتياطية واحدة للوضع دون اتصال فقط.
          if (response && response.ok && (url.pathname === '/' || event.request.mode === 'navigate')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('/index.html', clone)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request)
            .then(c => c || caches.match('/index.html'))
            .then(c => c || offlineResponse())
        )
    );
    return;
  }

  // 3) الأصول الثابتة (صور/خطوط/أيقونات) — Cache First.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 &&
            (response.type === 'basic' || response.type === 'cors')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
    })
  );
});
