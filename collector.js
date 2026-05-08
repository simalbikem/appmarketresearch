/**

- collector.js — Vercel /api/collect endpoint’ini çağırır.
- Tüm gerçek iş sunucu tarafında (api/collect.js) yapılır;
- bu dosya sadece isteği iletir ve progress callback’i çalıştırır.
  */

function parseAppId(input) {
input = input.trim();
if (/^\d+$/.test(input)) return input;
const m = input.match(/id(\d+)/);
if (m) return m[1];
throw new Error(“Geçerli bir App Store URL veya uygulama ID’si giriniz.”);
}

export async function collect({ url, regions = [“us”, “gb”, “de”, “jp”, “tr”], competitorCount = 10, reviewPages = 5, onProgress }) {
parseAppId(url); // erken validasyon

onProgress?.(“Vercel API’ye bağlanılıyor…”);

const params = new URLSearchParams({
url: url.trim(),
regions: regions.join(”,”),
competitors: String(competitorCount),
reviewPages: String(reviewPages),
});

// Geliştirme ortamında localhost, production’da aynı domain
const base = window.location.origin;
const apiUrl = `${base}/api/collect?${params}`;

onProgress?.(“Veri toplanıyor (bu 30-60 saniye sürebilir)…”);

const res = await fetch(apiUrl);

if (!res.ok) {
let msg = `API hatası: ${res.status}`;
try {
const err = await res.json();
msg = err.error || msg;
} catch {}
throw new Error(msg);
}

onProgress?.(“Veriler alındı, analiz hazırlanıyor…”);

const data = await res.json();

const totalReviews = Object.values(data.target?.reviews_by_region || {})
.reduce((s, arr) => s + arr.length, 0);

onProgress?.(`Hedef: ${data.target?.name} · ${totalReviews} yorum · ${data.competitor_pool_size} rakip adayı`);

return data;
}