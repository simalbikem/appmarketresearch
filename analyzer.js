/**

- analyzer.js — Claude API ile review kategorileme ve rapor üretimi
  */

const MODEL = “claude-sonnet-4-20250514”;

async function callClaude(apiKey, systemPrompt, userPrompt, maxTokens = 1000) {
const res = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“x-api-key”: apiKey,
“anthropic-version”: “2023-06-01”,
“anthropic-dangerous-direct-browser-access”: “true”,
},
body: JSON.stringify({
model: MODEL,
max_tokens: maxTokens,
system: systemPrompt,
messages: [{ role: “user”, content: userPrompt }],
}),
});
if (!res.ok) {
const err = await res.json().catch(() => ({}));
throw new Error(err.error?.message || `Claude API hatası: ${res.status}`);
}
const data = await res.json();
return data.content[0].text;
}

function sampleReviews(data) {
const allReviews = [];
const target = data.target;
for (const regionReviews of Object.values(target.reviews_by_region || {})) {
allReviews.push(…regionReviews);
}
const complaints = allReviews.filter(r => r.rating <= 3).slice(0, 30);
const featureSignalRx = /wish|would (be|love)|could (you )?add|should (add|have)|needs|missing|please add|would like|hoping for|if only|suggestion|recommend/i;
const featureReqs = allReviews.filter(r => r.rating >= 4 && featureSignalRx.test(r.content)).slice(0, 20);
return { complaints, featureReqs, total: allReviews.length };
}

function sampleCompetitorReviews(competitor) {
const all = [];
for (const regionReviews of Object.values(competitor.reviews_by_region || {})) {
all.push(…regionReviews);
}
const featureSignalRx = /wish|would (be|love)|could (you )?add|should (add|have)|needs|missing|please add|would like|hoping for|if only|suggestion|recommend/i;
return {
complaints: all.filter(r => r.rating <= 3).slice(0, 20),
featureReqs: all.filter(r => r.rating >= 4 && featureSignalRx.test(r.content)).slice(0, 10),
};
}

async function categorizeApp(apiKey, appName, complaints, featureReqs, onProgress) {
onProgress?.(`${appName} için yorumlar analiz ediliyor...`);

const reviewText = [
…complaints.map(r => `[${r.rating}★][${r.region}] ${r.title}: ${r.content}`),
…featureReqs.map(r => `[${r.rating}★][${r.region}][feature-signal] ${r.title}: ${r.content}`),
].join(”\n\n”);

if (!reviewText.trim()) {
return {
app: appName,
total_classified: 0,
per_category: {},
notable_quotes: [],
raw: “Yorum bulunamadı.”
};
}

const system = `Sen bir mobil uygulama pazar araştırmacısısın. Sana verilen App Store yorumlarını kategorize et ve JSON döndür.

KATEGORİLER:

- bug: Çökmeler, donmalar, bozuk davranışlar
- missing_feature: Kullanıcının olmadığını söylediği özellikler
- feature_request: “eklensin/ekleyin” tarzı açık istekler
- recommendation: “şu olsa 5 yıldız verirdim” tarzı öneriler
- ux: Kafa karıştırıcı arayüz, tasarım sorunları
- performance: Yavaşlık, pil, boyut
- content: Veri/çıktı kalitesi sorunları
- support: Müşteri desteği sorunları
- account: Giriş, senkronizasyon, veri kaybı
- ads: Reklam yoğunluğu sorunları

ÇIKAR (kategorize etme):

- Sadece övgü içeren yorumlar
- Ücretlendirme/iade şikayetleri (bunları fiyatlandırma bölümünde ele al)

YANIT FORMATI (sadece JSON, başka hiçbir şey):
{
“total_classified”: <sayı>,
“per_category”: { “bug”: <sayı>, “missing_feature”: <sayı>, “feature_request”: <sayı>, “recommendation”: <sayı>, “ux”: <sayı>, “performance”: <sayı>, “content”: <sayı>, “support”: <sayı>, “account”: <sayı>, “ads”: <sayı> },
“notable_quotes”: [
{ “category”: “…”, “region”: “…”, “rating”: <sayı>, “quote”: “birebir alıntı” }
],
“wishlist_themes”: [“tema1”, “tema2”, “…”],
“pricing_notes”: “fiyatlandırma gözlemleri (varsa)”
}

notable_quotes: 4-6 adet, şikayet VE istekleri dengeli seç. Birebir alıntı kullan.
wishlist_themes: missing_feature + feature_request + recommendation’dan tema adları çıkar (örn: “Apple Watch”, “widget”, “geçmiş/log”)`;

const userPrompt = `Uygulama: ${appName}\n\nYorumlar:\n${reviewText}`;

let raw = “”;
try {
raw = await callClaude(apiKey, system, userPrompt, 1000);
const clean = raw.replace(/`json|`/g, “”).trim();
const parsed = JSON.parse(clean);
return { app: appName, …parsed };
} catch (e) {
console.error(“Kategorileme parse hatası:”, e, raw);
return { app: appName, total_classified: 0, per_category: {}, notable_quotes: [], wishlist_themes: [], raw };
}
}

async function generateReport(apiKey, data, categorized, onProgress) {
onProgress?.(“Rapor oluşturuluyor…”);

const difficulty = data.difficulty;
const diffEmoji = difficulty.score < 30 ? “🟢” : difficulty.score < 60 ? “🟡” : difficulty.score < 80 ? “🟠” : “🔴”;
const diffLabel = difficulty.verdict === “BLUE_OCEAN” ? “MAVİ OKYANUS” :
difficulty.verdict === “COMPETITIVE” ? “REKABETÇİ” :
difficulty.verdict === “HARD” ? “ZOR” : “DOYMUŞ”;

const competitorRows = data.competitors.slice(0, 10).map((c, i) =>
`| ${i + 1} | **${c.name}** | ${c.developer} | ${c.rating?.toFixed(1) ?? "—"} ★ (${(c.ratingCount || 0).toLocaleString()}) | ${c.formattedPrice || "Ücretsiz"} | ${c.iapPresent ? "Evet" : "Hayır"} | ${c.releaseDate?.slice(0, 4) ?? "—"} |`
).join(”\n”);

const categorizedSummary = categorized.map(c => ({
app: c.app,
total: c.total_classified,
categories: c.per_category,
quotes: c.notable_quotes?.slice(0, 3),
themes: c.wishlist_themes,
}));

const system = `Sen bir iOS pazar araştırma uzmanısın. Sana verilen verileri kullanarak Türkçe, kapsamlı bir pazar araştırma raporu yaz.

RAPOR FORMATI (Markdown):

1. Hedef Uygulama Özeti
1. Zorluk Analizi (metrikleri yorumla)
1. Fiyatlandırma Ortamı
   4a. Şikayet Matrisi (tablo) — pricing hariç
   4b. İstek Listesi Matrisi (tablo) — ✓/✓✓/✓✓✓ + eksik/var/buggy/var ama kötü gösterimi
1. Bölgeler Arası Farklar
1. Fırsat Boşlukları (actionable)
1. Stratejik Öneri

Matris tablolarında rakiplerin kısaltılmış adlarını kullan. Somut, aksiyon alınabilir öneriler ver.`;

const userPrompt = `HEDEF UYGULAMA:
İsim: ${data.target.name}
Geliştirici: ${data.target.developer}
Kategori: ${data.target.category}
Rating: ${data.target.rating?.toFixed(1)} ★ (${(data.target.ratingCount || 0).toLocaleString()} yorum)
Fiyat: ${data.target.formattedPrice || “Ücretsiz”} ${data.target.iapPresent ? “· IAP mevcut” : “”}
Yayınlanma: ${data.target.releaseDate?.slice(0, 10)}

PAZAR ZORLUĞU: ${diffEmoji} ${difficulty.score}/100 — ${diffLabel}

- Doygunluk: ${difficulty.saturationCount} uygulama
- HHI: ${difficulty.concentrationHHI}
- Kalite tavanı: ${difficulty.qualityCeiling} ★
- Medyan yorum barı: ${difficulty.medianReviewBar?.toLocaleString()}
- Top-1 baskınlığı: ${difficulty.entryGapMultiplier}× medyan

TOP ${data.competitors.length} RAKİP:
${competitorRows}

KATEGORİZASYON SONUÇLARI (her uygulama için):
${JSON.stringify(categorizedSummary, null, 2)}

Bölgeler: ${data.regions.join(”, “)}
Toplam yorum analiz edildi: ${categorized.reduce((s, c) => s + (c.total_classified || 0), 0)}`;

const reportText = await callClaude(apiKey, system, userPrompt, 1000);
return reportText;
}

export async function analyze(apiKey, data, onProgress) {
const apps = [
{ name: data.target.name, reviews: sampleReviews(data) },
…data.competitors.slice(0, 5).map(c => ({
name: c.name,
reviews: sampleCompetitorReviews(c),
})),
];

const categorized = [];
for (const app of apps) {
const result = await categorizeApp(
apiKey,
app.name,
app.reviews.complaints || [],
app.reviews.featureReqs || [],
onProgress
);
categorized.push(result);
}

const report = await generateReport(apiKey, data, categorized, onProgress);
return { categorized, report };
}