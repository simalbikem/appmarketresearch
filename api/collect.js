/**

- api/collect.js — Vercel Serverless Function
- collect.mjs’nin birebir portu. Tarayıcı yerine sunucuda çalışır,
- bu sayede SensorTower ve iTunes RSS CORS sorunu olmaz.
- 
- GET /api/collect?url=<AppStoreURL>&regions=us,gb&competitors=10&reviewPages=5
  */

export const maxDuration = 60; // Vercel Pro: 300, Free: 60 saniye

async function fetchJson(url, { retry = 2, headers = {} } = {}) {
for (let i = 0; i <= retry; i++) {
try {
const r = await fetch(url, {
headers: {
“User-Agent”: “Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36”,
…headers,
},
});
if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
return await r.json();
} catch (e) {
if (i === retry) throw e;
await new Promise((r) => setTimeout(r, 400 * (i + 1)));
}
}
}

const ST_BATCH = 50;
async function fetchSensorTower(appIds) {
const ids = (Array.isArray(appIds) ? appIds : [appIds]).map(String);
const map = {};
for (let i = 0; i < ids.length; i += ST_BATCH) {
const chunk = ids.slice(i, i + ST_BATCH);
const url = `https://app.sensortower.com/api/ios/apps?app_ids=${chunk.join(",")}`;
try {
const data = await fetchJson(url, {
retry: 1,
headers: {
Accept: “application/json”,
Referer: “https://app.sensortower.com/”,
},
});
for (const a of data.apps || []) map[String(a.app_id)] = a;
} catch (e) {
console.error(`SensorTower batch failed:`, e.message);
}
}
return map;
}

function parseAppId(input) {
if (/^\d+$/.test(String(input))) return String(input);
const m = String(input).match(/id(\d+)/);
if (m) return m[1];
throw new Error(`Geçerli App Store URL veya ID değil: ${input}`);
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

async function fetchReviews(appId, region, maxPages = 5) {
const reviews = [];
for (let page = 1; page <= maxPages; page++) {
const url = `https://itunes.apple.com/${region}/rss/customerreviews/id=${appId}/sortBy=mostRecent/page=${page}/json`;
try {
const data = await fetchJson(url, { retry: 1 });
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
updated: e.updated?.label || “”,
region,
});
added++;
}
if (added === 0) break;
} catch {
break;
}
}
return reviews;
}

function popularityScore(meta, st) {
if (st && st.humanized_worldwide_last_month_revenue?.revenue) {
const rev = st.humanized_worldwide_last_month_revenue.revenue;
return { score: Math.log10(rev + 1) * 5, source: “revenue_usd_monthly” };
}
const ratings = meta.userRatingCount || 0;
const avg = meta.averageUserRating || 0;
const recent = meta.userRatingCountForCurrentVersion || 0;
const recencyFactor = recent > 100 ? 1 : recent > 10 ? 0.85 : 0.7;
return { score: Math.log10(ratings + 1) * avg * recencyFactor, source: “rating_proxy” };
}

function compactMeta(m, regionFound, st) {
if (!m) return null;
const pop = popularityScore(m, st);
const out = {
id: String(m.trackId),
bundleId: m.bundleId,
name: m.trackName,
developer: m.sellerName || m.artistName,
category: m.primaryGenreName,
categoryId: m.primaryGenreId,
genres: m.genres,
price: m.price,
formattedPrice: m.formattedPrice,
currency: m.currency,
rating: m.averageUserRating,
ratingCount: m.userRatingCount,
ratingCurrentVersion: m.averageUserRatingForCurrentVersion,
ratingCountCurrentVersion: m.userRatingCountForCurrentVersion,
version: m.version,
releaseDate: m.releaseDate,
currentVersionReleaseDate: m.currentVersionReleaseDate,
contentRating: m.contentAdvisoryRating,
minOsVersion: m.minimumOsVersion,
fileSizeBytes: m.fileSizeBytes ? parseInt(m.fileSizeBytes, 10) : null,
description: m.description,
releaseNotes: m.releaseNotes,
languages: m.languageCodesISO2A,
iapPresent: !!(m.advisories || []).find((a) => /In-App/i.test(a)),
url: m.trackViewUrl,
icon: m.artworkUrl512 || m.artworkUrl100,
popularity_score: pop.score,
popularity_source: pop.source,
region_found: regionFound,
};
if (st) {
out.st_revenue_monthly_usd = st.humanized_worldwide_last_month_revenue?.revenue ?? null;
out.st_revenue_string = st.humanized_worldwide_last_month_revenue?.string ?? null;
out.st_downloads_monthly = st.humanized_worldwide_last_month_downloads?.downloads ?? null;
out.st_downloads_string = st.humanized_worldwide_last_month_downloads?.string ?? null;
out.st_global_rating_count = st.global_rating_count ?? null;
out.st_top_countries = st.top_countries ?? null;
out.st_valid_countries_count = (st.valid_countries || []).length;
out.apple_watch_enabled = st.apple_watch_enabled ?? null;
out.imessage_enabled = st.imessage_enabled ?? null;
out.subtitle = st.subtitle ?? null;
out.publisher_country = st.publisher_country ?? null;
}
return out;
}

function extractKeywords(meta) {
const stop = new Set(
“the a an and or for with to of in on at is by app apps from your you it that this i my our we be best free pro plus premium new now all how get make use”.split(” “)
);
const fromName = (meta.trackName || “”)
.toLowerCase().replace(/[^a-z0-9 ]/g, “ “).split(/\s+/)
.filter((w) => w.length > 2 && !stop.has(w));
const fromDesc = (meta.description || “”)
.slice(0, 400).toLowerCase().replace(/[^a-z0-9 ]/g, “ “).split(/\s+/)
.filter((w) => w.length > 3 && !stop.has(w));
const counts = new Map();
for (const w of […fromName, …fromName, …fromDesc]) {
counts.set(w, (counts.get(w) || 0) + 1);
}
return […counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
}

async function findCompetitors(target, competitorTarget, country = “us”) {
const keywords = extractKeywords(target);
const seen = new Map();
const queries = [
target.trackName,
…keywords.slice(0, 4),
keywords.slice(0, 2).join(” “),
keywords.slice(2, 4).join(” “),
target.primaryGenreName,
].filter(Boolean);

for (const q of queries) {
try {
const results = await search(q, country, 50);
for (const r of results) {
if (String(r.trackId) === String(target.trackId)) continue;
if (r.primaryGenreId !== target.primaryGenreId) continue;
if (!seen.has(r.trackId)) seen.set(r.trackId, r);
}
} catch (e) {
console.error(“search failed for”, q, e.message);
}
}

const candidates = […seen.values()];
const ids = candidates.map((c) => String(c.trackId));
const stMap = await fetchSensorTower(ids);

const all = candidates.map((m) => compactMeta(m, country, stMap[String(m.trackId)]));
all.sort((a, b) => b.popularity_score - a.popularity_score);
return all;
}

function calcDifficulty(competitors, poolSize) {
if (!competitors.length) return { score: 0, verdict: “UNKNOWN” };
const top10 = competitors.slice(0, 10);
const saturationCount = poolSize ?? competitors.length;
const saturationNorm = Math.min(1, saturationCount / 100);
const totalScore = top10.reduce((s, c) => s + (c.popularity_score || 0), 0) || 1;
const hhi = top10.reduce((s, c) => s + Math.pow((c.popularity_score || 0) / totalScore, 2), 0);
const concentrationNorm = Math.max(0, Math.min(1, (hhi - 0.1) / 0.9));
const qualityCeiling = top10.reduce((s, c) => s + (c.rating || 0), 0) / top10.length;
const qualityNorm = Math.max(0, Math.min(1, (qualityCeiling - 3) / 2));
const sortedRatings = top10.map((c) => c.ratingCount || 0).sort((a, b) => a - b);
const medianReviews = sortedRatings[Math.floor(sortedRatings.length / 2)] || 0;
const reviewBarNorm = Math.min(1, Math.log10(medianReviews + 1) / 6);
const top1 = top10[0]?.popularity_score || 1;
const med = top10[Math.floor(top10.length / 2)]?.popularity_score || 1;
const entryGap = top1 / Math.max(med, 0.001);
const entryGapNorm = Math.min(1, entryGap / 20);
const score = Math.round(
(saturationNorm * 0.2 + concentrationNorm * 0.25 + qualityNorm * 0.2 +
reviewBarNorm * 0.2 + entryGapNorm * 0.15) * 100
);
let verdict;
if (score < 30) verdict = “BLUE_OCEAN”;
else if (score < 60) verdict = “COMPETITIVE”;
else if (score < 80) verdict = “HARD”;
else verdict = “SATURATED”;
return {
score, verdict, saturationCount,
saturationNorm: +saturationNorm.toFixed(2),
concentrationHHI: +hhi.toFixed(3),
concentrationNorm: +concentrationNorm.toFixed(2),
qualityCeiling: +qualityCeiling.toFixed(2),
qualityNorm: +qualityNorm.toFixed(2),
medianReviewBar: medianReviews,
reviewBarNorm: +reviewBarNorm.toFixed(2),
entryGapMultiplier: +entryGap.toFixed(1),
entryGapNorm: +entryGapNorm.toFixed(2),
weights: { saturation: 0.2, concentration: 0.25, quality: 0.2, reviewBar: 0.2, entryGap: 0.15 },
};
}

function reviewVelocity(competitors) {
const counts = competitors.slice(0, 5).map((c) => c.ratingCountCurrentVersion || 0);
const total = counts.reduce((a, b) => a + b, 0);
return { top5_current_version_reviews: total, per_app_avg: Math.round(total / Math.max(counts.length, 1)) };
}

function incumbentAge(competitors) {
const dates = competitors.slice(0, 5).map((c) => c.releaseDate).filter(Boolean)
.map((d) => new Date(d).getTime()).sort();
if (!dates.length) return null;
const median = dates[Math.floor(dates.length / 2)];
const ageYears = (Date.now() - median) / (365.25 * 86400 * 1000);
return { median_release: new Date(median).toISOString().slice(0, 10), median_age_years: +ageYears.toFixed(1) };
}

export default async function handler(req, res) {
// CORS — aynı Vercel domainden ve GitHub Pages’ten erişime izin ver
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “GET, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);
if (req.method === “OPTIONS”) return res.status(200).end();

const { url, regions = “us,gb,de,jp,tr”, competitors = “10”, reviewPages = “5” } = req.query;

if (!url) return res.status(400).json({ error: “url parametresi gerekli” });

let APP_ID;
try { APP_ID = parseAppId(url); }
catch (e) { return res.status(400).json({ error: e.message }); }

const REGIONS = regions.split(”,”).map((s) => s.trim().toLowerCase());
const COMPETITOR_TARGET = parseInt(competitors, 10);
const REVIEW_PAGES = parseInt(reviewPages, 10);

try {
// Hedef uygulamayı bul
let target = null, regionFound = null;
for (const r of [“us”, …REGIONS]) {
target = await lookup(APP_ID, r);
if (target) { regionFound = r; break; }
}
if (!target) return res.status(404).json({ error: “Uygulama bulunamadı”, appId: APP_ID });

```
// SensorTower — hedef
const targetSt = (await fetchSensorTower([APP_ID]))[APP_ID];

// Rakipler
const competitorsAll = await findCompetitors(target, COMPETITOR_TARGET, "us");
const competitorsRanked = competitorsAll.slice(0, COMPETITOR_TARGET);

// Hedef yorumlar
const targetReviews = {};
for (const r of REGIONS) {
  targetReviews[r] = await fetchReviews(APP_ID, r, REVIEW_PAGES);
}

// Rakip yorumlar (ilk 5)
for (let i = 0; i < Math.min(5, competitorsRanked.length); i++) {
  const c = competitorsRanked[i];
  c.reviews_by_region = {};
  for (const r of REGIONS) {
    c.reviews_by_region[r] = await fetchReviews(c.id, r, Math.min(REVIEW_PAGES, 3));
  }
}

const difficulty = calcDifficulty(competitorsRanked, competitorsAll.length);
const velocity = reviewVelocity(competitorsRanked);
const age = incumbentAge(competitorsRanked);

const output = {
  schema_version: 1,
  collected_at: new Date().toISOString(),
  regions: REGIONS,
  target: { ...compactMeta(target, regionFound, targetSt), reviews_by_region: targetReviews },
  competitors: competitorsRanked,
  competitor_pool_size: competitorsAll.length,
  difficulty,
  review_velocity: velocity,
  incumbent_age: age,
  notes: [
    "popularity_score uses SensorTower revenue when available (popularity_source='revenue_usd_monthly'); else falls back to rating proxy.",
    "SensorTower revenue/downloads come from app.sensortower.com/api/ios/apps — public unofficial endpoint, may break.",
    "Review fetch capped at iTunes RSS (~500/region max).",
  ],
};

res.status(200).json(output);
```

} catch (e) {
console.error(e);
res.status(500).json({ error: e.message });
}
}
