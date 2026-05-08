import { collect } from “./collector.js”;
import { analyze } from “./analyzer.js”;

// ── State ────────────────────────────────────────────────
let currentData = null;
let currentReport = null;
let progressSteps = 0;
const TOTAL_STEPS = 28;

// ── DOM refs ─────────────────────────────────────────────
const urlInput       = document.getElementById(“url-input”);
const apiKeyInput    = document.getElementById(“api-key-input”);
const regionsInput   = document.getElementById(“regions-input”);
const competInput    = document.getElementById(“competitors-input”);
const runBtn         = document.getElementById(“run-btn”);
const advToggle      = document.getElementById(“adv-toggle”);
const advPanel       = document.getElementById(“adv-panel”);
const advIcon        = document.getElementById(“adv-icon”);
const progressArea   = document.getElementById(“progress-area”);
const progressFill   = document.getElementById(“progress-fill”);
const progressLog    = document.getElementById(“progress-log”);
const errorCard      = document.getElementById(“error-card”);
const resultsArea    = document.getElementById(“results-area”);

// ── Advanced toggle ───────────────────────────────────────
advToggle.addEventListener(“click”, () => {
advPanel.classList.toggle(“open”);
advIcon.classList.toggle(“open”);
});

// ── Tab switching ─────────────────────────────────────────
document.addEventListener(“click”, e => {
const btn = e.target.closest(”.tab-btn”);
if (!btn) return;
const tabs = btn.closest(”.tabs”);
const panels = btn.closest(”.results-area”) || btn.closest(”.main”);
tabs.querySelectorAll(”.tab-btn”).forEach(b => b.classList.remove(“active”));
btn.classList.add(“active”);
const target = btn.dataset.tab;
document.querySelectorAll(”.tab-panel”).forEach(p => {
p.classList.toggle(“active”, p.id === target);
});
});

// ── Progress helpers ──────────────────────────────────────
function showProgress() {
progressSteps = 0;
progressArea.classList.add(“visible”);
progressLog.innerHTML = “”;
progressFill.style.width = “0%”;
}

function logProgress(msg) {
progressSteps = Math.min(progressSteps + 1, TOTAL_STEPS);
const pct = Math.round((progressSteps / TOTAL_STEPS) * 100);
progressFill.style.width = pct + “%”;
const line = document.createElement(“div”);
line.className = “log-line”;
line.textContent = `› ${msg}`;
progressLog.appendChild(line);
progressLog.scrollTop = progressLog.scrollHeight;
}

function showError(msg) {
errorCard.textContent = msg;
errorCard.classList.add(“visible”);
}

function hideError() {
errorCard.classList.remove(“visible”);
}

// ── Difficulty helpers ────────────────────────────────────
function diffClass(score) {
if (score < 30) return “blue-ocean”;
if (score < 60) return “competitive”;
if (score < 80) return “hard”;
return “saturated”;
}

function diffLabel(verdict) {
const map = {
BLUE_OCEAN: “🟢 Mavi Okyanus”, COMPETITIVE: “🟡 Rekabetçi”,
HARD: “🟠 Zor”, SATURATED: “🔴 Doymuş”
};
return map[verdict] || verdict;
}

function diffDesc(d) {
if (d.score < 30) return `${d.saturationCount} uygulama, düşük kalite barı — nişe girilmeye hazır.`;
if (d.score < 60) return `${d.saturationCount} uygulama, HHI ${d.concentrationHHI} — diferansiyasyon mümkün.`;
if (d.score < 80) return `${d.saturationCount} uygulama, kalite tavanı ${d.qualityCeiling}★ — güçlü oyuncular var.`;
return `${d.saturationCount} uygulama, Top-1 baskınlığı ${d.entryGapMultiplier}× — kazananın aldığı piyasa.`;
}

function ratingColor(r) {
if (!r) return “#5E5D57”;
if (r >= 4.5) return “#5AFF8F”;
if (r >= 4.0) return “#FFD060”;
return “#FF5A5A”;
}

// ── Render results ────────────────────────────────────────
function renderResults(data, report) {
const t = data.target;
const d = data.difficulty;

// App header
document.getElementById(“app-icon”).src = t.icon || “”;
document.getElementById(“app-icon”).alt = t.name;
document.getElementById(“app-name”).textContent = t.name;
document.getElementById(“app-dev”).textContent = t.developer;

const pillsEl = document.getElementById(“app-pills”);
const pills = [
{ text: `${t.rating?.toFixed(1) ?? "—"} ★`, accent: true },
{ text: `${(t.ratingCount || 0).toLocaleString()} yorum` },
{ text: t.category || “—” },
{ text: t.formattedPrice || “Ücretsiz”, accent: t.price === 0 },
t.iapPresent ? { text: “IAP mevcut” } : null,
{ text: t.releaseDate?.slice(0, 4) ? `${t.releaseDate.slice(0, 4)}'den beri` : “” },
].filter(Boolean).filter(p => p.text);
pillsEl.innerHTML = pills.map(p => `<span class="pill${p.accent ? " accent" : ""}">${p.text}</span>`).join(””);

// Difficulty
const diffCard = document.getElementById(“diff-card”);
diffCard.className = “diff-card “ + diffClass(d.score);
document.getElementById(“diff-score-num”).textContent = d.score;
document.getElementById(“diff-label”).textContent = diffLabel(d.verdict);
document.getElementById(“diff-sub”).textContent = diffDesc(d);

// SVG ring
const circ = 2 * Math.PI * 30;
const filled = circ * (d.score / 100);
const ringColor = d.score < 30 ? “#5AFF8F” : d.score < 60 ? “#FFD060” : d.score < 80 ? “#FF8B3C” : “#FF5A5A”;
document.getElementById(“diff-ring-path”).setAttribute(“stroke-dasharray”, `${filled} ${circ}`);
document.getElementById(“diff-ring-path”).setAttribute(“stroke”, ringColor);

// Competitor table
const tbody = document.getElementById(“comp-tbody”);
tbody.innerHTML = data.competitors.slice(0, 10).map((c, i) => `<tr> <td class="rank-num">${i + 1}</td> <td> ${c.icon ?`<img class="comp-icon" src="${c.icon}" alt="" loading="lazy" onerror="this.style.display='none'">`: ""} <a href="${c.url || "#"}" target="_blank" style="color:var(--text-1);text-decoration:none;font-weight:500">${c.name}</a> </td> <td style="color:var(--text-2)">${c.developer}</td> <td style="color:${ratingColor(c.rating)};font-family:var(--font-mono)"> ${c.rating?.toFixed(1) ?? "—"} <span class="rating-star">★</span> </td> <td style="color:var(--text-2);font-family:var(--font-mono)">${(c.ratingCount || 0).toLocaleString()}</td> <td style="color:var(--text-2)">${c.formattedPrice || "Ücretsiz"}</td> <td style="color:var(--text-2)">${c.releaseDate?.slice(0, 4) ?? "—"}</td> </tr>`).join(””);

// Report
document.getElementById(“report-content”).innerHTML = markdownToHtml(report || “Rapor oluşturulamadı.”);

// Show results
progressFill.style.width = “100%”;
setTimeout(() => {
progressArea.classList.remove(“visible”);
resultsArea.classList.add(“visible”);
resultsArea.scrollIntoView({ behavior: “smooth”, block: “start” });
}, 600);
}

// ── Minimal markdown parser ───────────────────────────────
function markdownToHtml(md) {
return md
.replace(/^### (.+)$/gm, “<h3>$1</h3>”)
.replace(/^## (.+)$/gm, “<h2>$1</h2>”)
.replace(/^# (.+)$/gm, “<h1>$1</h1>”)
.replace(/**(.+?)**/g, “<strong>$1</strong>”)
.replace(/*(.+?)*/g, “<em>$1</em>”)
.replace(/`(.+?)`/g, “<code>$1</code>”)
.replace(/^> (.+)$/gm, “<blockquote>$1</blockquote>”)
.replace(/^| (.+) |$/gm, (line) => {
if (/^[\s|:-]+$/.test(line)) return “”;
const cells = line.split(”|”).slice(1, -1).map(c => c.trim());
return “<tr>” + cells.map(c => `<td>${c}</td>`).join(””) + “</tr>”;
})
.replace(/(<tr>.*</tr>\n?)+/gs, m => `<div class="table-wrap"><table><tbody>${m}</tbody></table></div>`)
.replace(/^- (.+)$/gm, “<li>$1</li>”)
.replace(/((?:<li>.*</li>\n?)+)/g, “<ul>$1</ul>”)
.replace(/\n\n/g, “</p><p>”)
.replace(/^(?!<[h|u|b|t|d|b])/gm, “”)
.replace(/<p></p>/g, “”);
}

// ── Export handlers ───────────────────────────────────────
window.exportMarkdown = function () {
if (!currentReport) return;
const blob = new Blob([currentReport], { type: “text/markdown” });
const a = Object.assign(document.createElement(“a”), { href: URL.createObjectURL(blob), download: “market-research.md” });
a.click();
};

window.exportJson = function () {
if (!currentData) return;
const safe = { …currentData, target: { …currentData.target, reviews_by_region: {} }, competitors: currentData.competitors.map(c => ({ …c, reviews_by_region: {} })) };
const blob = new Blob([JSON.stringify(safe, null, 2)], { type: “application/json” });
const a = Object.assign(document.createElement(“a”), { href: URL.createObjectURL(blob), download: “market-data.json” });
a.click();
};

// ── Main run ──────────────────────────────────────────────
runBtn.addEventListener(“click”, async () => {
const url = urlInput.value.trim();
if (!url) { showError(“Lütfen bir App Store URL’si veya uygulama ID’si girin.”); return; }

const apiKey = apiKeyInput.value.trim();
if (!apiKey) { showError(“Claude API key gerekli. Gelişmiş seçeneklerden girin.”); return; }

hideError();
runBtn.disabled = true;
runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Çalışıyor...`;
resultsArea.classList.remove(“visible”);

const regions = (regionsInput.value || “us,gb,de,jp,tr”).split(”,”).map(r => r.trim()).filter(Boolean);
const competitorCount = parseInt(competInput.value || “10”);

showProgress();

try {
const data = await collect({
url,
regions,
competitorCount,
reviewPages: 3,
onProgress: logProgress,
});
currentData = data;

```
logProgress("Veri toplandı, AI analizi başlıyor...");

const { report } = await analyze(apiKey, data, logProgress);
currentReport = report;

renderResults(data, report);
```

} catch (err) {
progressArea.classList.remove(“visible”);
showError(“Hata: “ + err.message);
console.error(err);
} finally {
runBtn.disabled = false;
runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Analiz Et`;
}
});

// Enter key support
urlInput.addEventListener(“keydown”, e => { if (e.key === “Enter”) runBtn.click(); });