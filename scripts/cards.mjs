// Builds the profile's stats, languages and activity cards as SVGs.
// Runs in GitHub Actions with GITHUB_TOKEN; no dependencies (Node 20+).
import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.PROFILE_USER || "Jishnuraj07";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv[2] || "dist";

const C = {
  bg: "#0d0221", pink: "#ff2a6d", cyan: "#05d9e8",
  yellow: "#f9f002", text: "#d1f7ff", dim: "#8b8ba7", grid: "#2a1a4a",
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";
const MONO = "'Fira Code', Consolas, 'Courier New', monospace";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const data = await gql(`query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`, { login: USER });

const u = data.user;
const repos = u.repositories.nodes;
const cc = u.contributionsCollection;

const frame = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<style>
  .t{font:700 18px ${FONT};fill:${C.pink}}
  .l{font:600 14px ${FONT};fill:${C.text}}
  .v{font:700 15px ${MONO};fill:${C.cyan}}
  .s{font:400 12px ${FONT};fill:${C.dim}}
  .f{opacity:0;animation:in .5s ease-out forwards}
  @keyframes in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.f{animation:none;opacity:1}}
</style>
<defs><linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="${C.pink}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient></defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="${C.bg}" stroke="url(#edge)" stroke-width="1.5"/>
<text x="24" y="36" class="t">${esc(title)}</text>
${body}
</svg>`;

// ── Stats card ──────────────────────────────────────────────
const stars = repos.reduce((a, r) => a + r.stargazerCount, 0);
const rows = [
  ["★", "Total stars", stars],
  ["⟳", "Commits (last year)", cc.totalCommitContributions + cc.restrictedContributionsCount],
  ["⇄", "Pull requests", u.pullRequests.totalCount],
  ["!", "Issues", u.issues.totalCount],
  ["▣", "Contributions (last year)", cc.contributionCalendar.totalContributions],
  ["◉", "Followers", u.followers.totalCount],
];
const statsBody = rows.map(([icon, label, val], i) => {
  const y = 66 + i * 23;
  return `<g class="f" style="animation-delay:${150 + i * 120}ms">
  <text x="26" y="${y}" style="font:700 14px ${FONT};fill:${C.yellow}">${icon}</text>
  <text x="48" y="${y}" class="l">${esc(label)}</text>
  <text x="440" y="${y}" class="v" text-anchor="end">${fmt(val)}</text></g>`;
}).join("\n");

// ── Languages card ──────────────────────────────────────────
const langs = new Map();
for (const r of repos) for (const e of r.languages.edges) {
  const cur = langs.get(e.node.name) || { size: 0, color: e.node.color || C.dim };
  cur.size += e.size;
  langs.set(e.node.name, cur);
}
const top = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const total = top.reduce((a, [, v]) => a + v.size, 0) || 1;
let x = 24;
const barW = 302;
const bar = top.map(([, v]) => {
  const w = (v.size / total) * barW;
  const seg = `<rect x="${x.toFixed(2)}" y="52" width="${w.toFixed(2)}" height="10" fill="${v.color}"/>`;
  x += w;
  return seg;
}).join("");
const legend = top.map(([name, v], i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const lx = 24 + col * 152, ly = 92 + row * 25;
  return `<g class="f" style="animation-delay:${200 + i * 90}ms">
  <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${v.color}"/>
  <text x="${lx + 16}" y="${ly}" class="l" style="font-size:13px">${esc(name.replace(" Notebook", ""))}</text>
  <text x="${lx + 140}" y="${ly}" class="s" text-anchor="end">${((v.size / total) * 100).toFixed(1)}%</text></g>`;
}).join("\n");
const langBody = `<clipPath id="bar"><rect x="24" y="52" width="${barW}" height="10" rx="5"/></clipPath>
<g clip-path="url(#bar)">${bar}</g>
${legend}`;

// ── Activity card (last 60 days) ────────────────────────────
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).slice(-60);
const AW = 1000, AH = 300, padL = 50, padR = 24, padT = 60, padB = 44;
const max = Math.max(4, ...days.map((d) => d.contributionCount));
const px = (i) => padL + (i / (days.length - 1)) * (AW - padL - padR);
const py = (v) => padT + (1 - v / max) * (AH - padT - padB);
const pts = days.map((d, i) => [px(i), py(d.contributionCount)]);
const line = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
const area = `${line}L${px(days.length - 1).toFixed(1)},${AH - padB}L${padL},${AH - padB}Z`;
const ticks = [0, 0.5, 1].map((t) => {
  const v = Math.round(max * t), y = py(v);
  return `<line x1="${padL}" x2="${AW - padR}" y1="${y}" y2="${y}" stroke="${C.grid}" stroke-dasharray="3 4"/>
  <text x="${padL - 10}" y="${y + 4}" class="s" text-anchor="end">${v}</text>`;
}).join("\n");
const labels = days.map((d, i) => (i % 10 === 0 || i === days.length - 1)
  ? `<text x="${px(i)}" y="${AH - 18}" class="s" text-anchor="middle">${d.date.slice(5)}</text>` : "").join("");
const dots = pts.map(([a, b], i) => days[i].contributionCount
  ? `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3.5" fill="${C.cyan}"/>` : "").join("");
const actBody = `<defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
  <stop offset="0" stop-color="${C.pink}" stop-opacity=".55"/><stop offset="1" stop-color="${C.pink}" stop-opacity="0"/></linearGradient></defs>
<text x="${AW - padR}" y="36" class="s" text-anchor="end">${days.reduce((a, d) => a + d.contributionCount, 0)} contributions in the last 60 days</text>
${ticks}
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="${C.pink}" stroke-width="2.5" stroke-linejoin="round"
  stroke-dasharray="4000" stroke-dashoffset="4000" style="animation:draw 2s ease-out forwards"/>
<style>@keyframes draw{to{stroke-dashoffset:0}}@media (prefers-reduced-motion:reduce){path{animation:none!important;stroke-dashoffset:0!important}}</style>
${dots}
${labels}`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats.svg`, frame(467, 205, "Jishnu's GitHub Stats", statsBody));
writeFileSync(`${OUT}/langs.svg`, frame(350, 205, "Most Used Languages", langBody));
writeFileSync(`${OUT}/activity.svg`, frame(AW, AH, "Contribution Activity", actBody));
console.log(`cards written to ${OUT}/`);
