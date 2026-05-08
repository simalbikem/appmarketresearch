/**

- collector.js — Browser port of collect.mjs
- Uses iTunes Lookup + Search + RSS Reviews (all CORS-friendly)
- SensorTower is skipped (blocks CORS from browser)
  */

const CORS_PROXY = “https://corsproxy.io/?”;

function proxyUrl(url) {
return CORS_PROXY + encodeURIComponent(url);
}

function parseAppId(input) {
input = input.trim();
if (/^\d+$/.test(input)) return input;
const m = input.match(/id(\d+)/);
if (m) return m[1];
throw new Error(“Geçerli bir App Store URL veya uygulama ID’si giriniz.”);
}

async function fetchJson(url, useProxy = false) {
const finalUrl = useProxy ? proxyUrl(url) : url;
for (let i = 0; i < 3; i++) {
try {
const r = await fetch(finalUrl, {
headers: { “Accept”: “application/json” }
});
if (!r.ok) throw new Error(`HTTP ${r.status}`);
return await r.json();
} catch (e) {
if (i === 2) throw e;
await new Promise(r => setTimeout(r, 400 * (i + 1)));
}
}
}

async function lookup(appId, country = “us”) {
const url = `https://itunes.apple.com/lookup?id=${appId}&country=${country}`;
const data = await fetchJson(url);
return data.results?.[0] || null;
}

async function search(term, country = “us”, limit = 50) {
const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=${limit}`;
const data = await fetchJson(url);
return data.results || [];
}

async function fetchReviews(appId, region, maxPages = 3) {
const reviews = [];
for (let page = 1; page <= maxPages; page++) {
const url = `https://itunes.apple.com/${region}/rss/customerreviews/id=${appId}/sortBy=mostRecent/page=${page}/json`;
try {
const data = await fetchJson(proxyUrl(url));
const entries = data.feed?.entry;
if (!entries) break;
const list = Array.isArray(entries) ? entries : [entries];
let added = 0;
for (const e of list) {
if (!e[“im:rating”]) continue;
reviews.push({
rating: parseInt(e[“im:rating”].label, 10),
title: e.title?.label || “”,
content: e.content?.label || “”,
version: e[“im:version”]?.label || “”,
region,
});
added++;
}
if (added === 0) break;
} catch { break; }
}
return reviews;
}

function popularityScore(meta) {
const ratings = meta.userRatingCount || 0;
const avg = meta.averageUserRating || 0;
const recent = meta.userRatingCountForCurrentVersion || 0;
const recencyFactor = recent > 100 ? 1 : recent > 10 ? 0.85 : 0.7;
return Math.log10(ratings + 1) * avg * recencyFactor;
}

function compactMeta(m, regionFound) {
if (!m) return null;
return {
id: String(m.trackId),
bundleId: m.bundleId,
name: m.trackName,
developer: m.sellerName || m.artistName,
category: m.primaryGenreName,
categoryId: m.primaryGenreId,
price: m.price,
formattedPrice: m.formattedPrice,
rating: m.averageUserRating,
ratingCount: m.userRatingCount,
ratingCurrentVersion: m.averageUserRatingForCurrentVersion,
ratingCountCurrentVersion: m.userRatingCountForCurrentVersion,
version: m.version,
releaseDate: m.releaseDate,
currentVersionReleaseDate: m.currentVersionReleaseDate,
languages: m.languageCodesISO2A,
iapPresent: !!(m.advisories || []).find(a => /In-App/i.test(a)),
url: m.trackViewUrl,
icon: m.artworkUrl512 || m.artworkUrl100,
popularity_score: popularityScore(m),
popularity_source: “rating_proxy”,
region_found: regionFound,
description: m.description || “”,
};
}

async function findCompetitors(target, competitorCount, onProgress) {
const seen = new Map();
const words = target.trackName
.toLowerCase()
.replace(/[^a-z0-9 ]/g, “ “)
.split(/\s+/)
.filter(w => w.length > 3);
const queries = [
target.primaryGenreName,
words.slice(0, 2).join(” “),
words[0],
].filter(Boolean);

for (const q of queries) {
onProgress?.(`"${q}" aranıyor...`);
try {
const results = await search(q, “us”, 50);
for (const r of results) {
if (String(r.trackId) === String(target.trackId)) continue;
if (r.primaryGenreId !== target.primaryGenreId) continue;
if (!seen.has(r.trackId)) seen.set(r.trackId, r);
}
} catch (e) {
console.warn(“Arama başarısız:”, q, e);
}
}

const all = […seen.values()]
.map(m => compactMeta(m, “us”))
.sort((a, b) => b.popularity_score - a.popularity_score);

return { all, top: all.slice(0, competitorCount) };
}

function calcDifficulty(competitors, poolSize) {
if (!competitors.length) return { score: 0, verdict: “UNKNOWN” };
const top10 = competitors.slice(0, 10);
const saturationNorm = Math.min(1, (poolSize ?? competitors.length) / 100);
const totalScore = top10.reduce((s, c) => s + (c.popularity_score || 0), 0) || 1;
const hhi = top10.reduce((s, c) => s + Math.pow((c.popularity_score || 0) / totalScore, 2), 0);
const concentrationNorm = Math.max(0, Math.min(1, (hhi - 0.1) / 0.9));
const qualityCeiling = top10.reduce((s, c) => s + (c.rating || 0), 0) / top10.length;
const qualityNorm = Math.max(0, Math.min(1, (qualityCeiling - 3) / 2));
const sortedRatings = top10.map(c => c.ratingCount || 0).sort((a, b) => a - b);
const medianReviews = sortedRatings[Math.floor(sortedRatings.length / 2)] || 0;
const reviewBarNorm = Math.min(1, Math.log10(medianReviews + 1) / 6);
const top1 = top10[0]?.popularity_score || 1;
const med = top10[Math.floor(top10.length / 2)]?.popularity_score || 0.001;
const entryGap = top1 / Math.max(med, 0.001);
const entryGapNorm = Math.min(1, entryGap / 20);
const score = Math.round(
(saturationNorm * 0.20 + concentrationNorm * 0.25 + qualityNorm * 0.20 +
reviewBarNorm * 0.20 + entryGapNorm * 0.15) * 100
);
let verdict;
if (score < 30) verdict = “BLUE_OCEAN”;
else if (score < 60) verdict = “COMPETITIVE”;
else if (score < 80) verdict = “HARD”;
else verdict = “SATURATED”;
return {
score, verdict,
saturationCount: poolSize ?? competitors.length,
concentrationHHI: +hhi.toFixed(3),
qualityCeiling: +qualityCeiling.toFixed(2),
medianReviewBar: medianReviews,
entryGapMultiplier: +entryGap.toFixed(1),
};
}

export async function collect({ url, regions = [“us”, “gb”, “de”, “jp”, “tr”], competitorCount = 10, reviewPages = 3, onProgress }) {
const appId = parseAppId(url);
onProgress?.(“Hedef uygulama bilgileri alınıyor…”);

let target = null, regionFound = null;
for (const r of [“us”, …regions]) {
target = await lookup(appId, r);
if (target) { regionFound = r; break; }
}
if (!target) throw new Error(“Uygulama bulunamadı. URL veya ID’yi kontrol edin.”);
onProgress?.(`Hedef: ${target.trackName} (${target.primaryGenreName})`);

onProgress?.(“Rakipler aranıyor…”);
const { all: allCompetitors, top: competitors } = await findCompetitors(target, competitorCount, onProgress);
onProgress?.(`${allCompetitors.length} rakip adayı bulundu, en iyi ${competitors.length} tanesi seçildi.`);

onProgress?.(“Yorumlar alınıyor…”);
const reviewsByRegion = {};
for (const r of regions) {
onProgress?.(`${r.toUpperCase()} yorumları alınıyor...`);
reviewsByRegion[r] = await fetchReviews(appId, r, reviewPages);
}

onProgress?.(“Rakip yorumları alınıyor…”);
for (let i = 0; i < Math.min(5, competitors.length); i++) {
const c = competitors[i];
c.reviews_by_region = {};
for (const r of regions) {
c.reviews_by_region[r] = await fetchReviews(c.id, r, 2);
}
onProgress?.(`${i + 1}. rakip yorumları tamamlandı: ${c.name}`);
}

const difficulty = calcDifficulty(competitors, allCompetitors.length);

return {
collected_at: new Date().toISOString(),
regions,
target: { …compactMeta(target, regionFound), reviews_by_region: reviewsByRegion },
competitors,
competitor_pool_size: allCompetitors.length,
difficulty,
};
}