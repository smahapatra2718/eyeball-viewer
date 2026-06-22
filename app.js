"use strict";

const HIDDEN_TASKS = new Set(["perfect pot place"]);

const appEl = document.getElementById("app");
const crumbEl = document.getElementById("breadcrumb");

function enc(s) { return encodeURIComponent(s); }

// Filesystem/URL-safe slug. MUST match slugify() in build_static.py exactly so
// the static filenames the build emits line up with what the frontend requests.
function slugify(s) {
  return String(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// This site is fully static (GitHub Pages): the FastAPI endpoints were
// pre-rendered to JSON files at build time. Translate each original
// `/api/...?params` URL into its static file path. Paths are RELATIVE (no
// leading slash) so the site works under a project subpath like
// `/eyeball-viewer/`. Keeping this mapping in one place lets every fetchJSON
// call site stay byte-for-byte the same as the server version.
function staticUrlFor(apiUrl) {
  const u = new URL(apiUrl, window.location.href);
  const path = u.pathname.replace(/.*\/api\//, "/api/");
  const q = u.searchParams;
  switch (path) {
    case "/api/summary":     return "data/summary.json";
    case "/api/throughput":  return "data/throughput.json";
    case "/api/correlation": return "data/correlation.json";
    case "/api/episodes":
      return `data/episodes/${slugify(q.get("policy"))}__${slugify(q.get("task"))}.json`;
    case "/api/episode_videos":
      return `data/episode_videos/${slugify(q.get("policy"))}__${slugify(q.get("task"))}__${slugify(q.get("episode"))}.json`;
    case "/api/episode_compare":
      return `data/episode_compare/${slugify(q.get("task"))}__${slugify(q.get("episode"))}.json`;
    default:
      return apiUrl;
  }
}

async function fetchJSON(url) {
  const res = await fetch(staticUrlFor(url));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function metaValue(value, fallback = "?") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function renderEvalMeta(data, fallbackTask, extraClass = "") {
  const cls = ["run-meta", extraClass].filter(Boolean).join(" ");
  const items = [
    ["Model", data.model],
    ["Task", data.task || fallbackTask],
    ["Action type", data.action_type],
    ["Checkpoint", data.checkpoint || data.checkpoint_path],
  ];
  return `<dl class="${cls}">
    ${items.map(([label, value]) => `<div class="meta-item">
      <dt>${escapeHtml(label)}</dt>
      <dd><code>${escapeHtml(metaValue(value))}</code></dd>
    </div>`).join("")}
  </dl>`;
}

function formatDuration(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}s` : "in CSV";
}

function renderModelCompare(compareData, currentPolicy, task, episode) {
  const options = (compareData && compareData.options ? compareData.options : [])
    .filter(option => option.csv_exists || option.error !== "no_data");
  if (options.length <= 1) return "";

  return `<div class="model-compare">
    <div class="model-compare-head">
      <span>Compare models</span>
      <code>${escapeHtml(episode)}</code>
    </div>
    <div class="model-compare-list">
      ${options.map(option => {
        const active = option.policy === currentPolicy;
        const available = !!option.episode_in_csv;
        const resultClass = available ? (option.task_success ? "ok" : "fail") : "missing";
        const duration = typeof option.duration_s === "number" ? option.duration_s : Number(option.duration_s);
        const resultText = available
          ? `${option.task_success ? "✓" : "✗"} ${formatDuration(duration)}`
          : (option.error === "csv_missing" ? "CSV missing" : "episode missing");
        const runTotal = option.n_succ !== null && option.n_succ !== undefined && option.n_trials
          ? ` · ${option.n_succ}/${option.n_trials}`
          : "";
        const modelName = option.model || option.policy;
        const classes = ["model-option", resultClass, active ? "current" : "", available ? "" : "unavailable"]
          .filter(Boolean)
          .join(" ");
        const title = [option.policy, modelName, option.action_type, option.checkpoint || option.checkpoint_path]
          .filter(Boolean)
          .join(" · ");
        const body = `<span class="model-policy">${escapeHtml(option.policy)}</span>
          <span class="model-name">${escapeHtml(modelName)}</span>
          <span class="model-status">${escapeHtml(resultText)}${escapeHtml(runTotal)}</span>`;
        if (!available) {
          return `<span class="${classes}" title="${escapeHtml(title)}">${body}</span>`;
        }
        return `<a class="${classes}" href="#/video/${enc(option.policy)}/${enc(task)}/${enc(episode)}" title="${escapeHtml(title)}"${active ? ' aria-current="page"' : ""}>${body}</a>`;
      }).join("")}
    </div>
  </div>`;
}

function setBreadcrumb(parts) {
  const html = parts.map(p => {
    if (p.href) return `<a href="${p.href}">${escapeHtml(p.label)}</a>`;
    return `<span>${escapeHtml(p.label)}</span>`;
  }).join('<span class="sep">/</span>');
  crumbEl.innerHTML = html;
}

function showError(msg, detail) {
  appEl.innerHTML = `<div class="error-box">
    <h2>${escapeHtml(msg)}</h2>
    ${detail ? `<p>${detail}</p>` : ""}
  </div>`;
}

function route() {
  disposeThroughputCharts();
  const hash = window.location.hash.slice(1) || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) {
    renderHome();
  } else if (parts[0] === "throughput" && parts.length === 1) {
    renderThroughput();
  } else if (parts[0] === "correlation" && parts.length === 1) {
    renderCorrelation();
  } else if (parts[0] === "pair" && parts.length === 3) {
    renderPairDetail(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
  } else if (parts[0] === "episodes" && parts.length === 3) {
    renderEpisodes(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
  } else if (parts[0] === "video" && parts.length === 4) {
    renderVideo(
      decodeURIComponent(parts[1]),
      decodeURIComponent(parts[2]),
      decodeURIComponent(parts[3])
    );
  } else {
    setBreadcrumb([]);
    showError(`Unknown route: ${hash}`);
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

// ---------- Home ----------
async function renderHome() {
  setBreadcrumb([]);
  appEl.innerHTML = '<p class="loading">Loading…</p>';
  let summary;
  try {
    summary = await fetchJSON("/api/summary");
  } catch (e) {
    showError("Failed to load summary", escapeHtml(e.message));
    return;
  }

  const { policies, tasks, data, best_per_task } = summary;
  const visibleTasks = tasks.filter(t => !HIDDEN_TASKS.has(t));
  const nPolicies = policies.length;

  const parts = [];
  parts.push(`<div class="home-intro">
    <h1 class="home-title">Results</h1>
    <div class="home-intro-right">
      <!-- analysis views (extra) hidden:
      <div class="page-links">
        <a class="page-link" href="#/correlation">Correlation →</a>
        <a class="page-link" href="#/throughput">Throughput →</a>
      </div>
      -->
      <div class="home-sub">${visibleTasks.length} tasks &middot; ${nPolicies} policies</div>
    </div>
  </div>`);

  parts.push('<p class="nav-hint">↳ click a policy to see its episodes</p>');
  parts.push('<div class="charts-grid">');
  for (const task of visibleTasks) {
    let totalTrials = null;
    for (const policy of policies) {
      const entry = data[policy] && data[policy][task];
      if (entry && entry.n_trials) {
        totalTrials = entry.n_trials;
        break;
      }
    }
    parts.push(`<div class="chart-card">
      <h3><span class="task-name">${escapeHtml(task)}</span><span class="trials">${totalTrials ? totalTrials + " trials" : ""}</span></h3>
      <div class="bars">`);

    const best = best_per_task[task];
    for (const policy of policies) {
      const policyMarkerClass = policy === "eyeball" ? " eyeball-policy" : "";
      const entry = data[policy] && data[policy][task];
      if (!entry || entry.n_succ === null || entry.n_succ === undefined) {
        parts.push(`<div class="bar-row dim${policyMarkerClass}">
          <div class="bar-label">${escapeHtml(policy)}</div>
          <div class="bar-track"><div class="bar-fill missing"></div></div>
          <div class="bar-value">—</div>
        </div>`);
        continue;
      }
      if (!entry.csv_exists) {
        parts.push(`<a href="#/episodes/${enc(policy)}/${enc(task)}" class="bar-row${policyMarkerClass} error-row">
          <div class="bar-label">${escapeHtml(policy)}</div>
          <div class="bar-track"><div class="bar-fill error"></div></div>
          <div class="bar-value">CSV not found · ${entry.n_succ}/${entry.n_trials}</div>
        </a>`);
        continue;
      }
      const pct = entry.n_trials ? (entry.n_succ / entry.n_trials * 100) : 0;
      const isBest = policy === best;
      parts.push(`<a href="#/episodes/${enc(policy)}/${enc(task)}" class="bar-row${policyMarkerClass}${isBest ? ' best' : ''}">
        <div class="bar-label">${escapeHtml(policy)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="bar-value"><span class="pct">${pct.toFixed(0)}</span><span class="pct-sym">%</span><span class="ratio">${entry.n_succ}/${entry.n_trials}</span></div>
      </a>`);
    }
    parts.push('</div></div>');
  }
  parts.push('</div>');
  appEl.innerHTML = parts.join("");
}

// ---------- Conditional success funnel (Sankey) ----------
function pctStr(x) {
  return x == null ? "" : `${(x * 100).toFixed(0)}%`;
}

// Render a perfect-prefix success funnel as inline SVG (a Sankey): the success
// "spine" runs along a flat top; at each stage the episodes that drop out FORK
// downward into their own block, separated from the continuing flow by a clear
// gap. Every flow's width is proportional to its episode count (one shared
// scale), so failures read at true size. funnel = { total, success_count,
// nodes:[{id,label,count,parent,cond,is_start,is_success,is_primary}] }.
function renderFunnel(funnel) {
  if (!funnel || !funnel.total || !Array.isArray(funnel.nodes) || funnel.nodes.length <= 1) {
    return "";
  }
  const { nodes, total } = funnel;
  const byId = new Map(nodes.map(n => [n.id, n]));

  const childrenOf = new Map();
  for (const n of nodes) {
    if (n.parent == null) continue;
    if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
    childrenOf.get(n.parent).push(n);
  }
  // Larger flow first; stable tie-break by label.
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  const start = nodes.find(n => n.is_start) || nodes[0];

  const depth = new Map([[start.id, 0]]);
  let maxDepth = 0;
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift(), d = depth.get(id);
    for (const c of (childrenOf.get(id) || [])) {
      depth.set(c.id, d + 1);
      maxDepth = Math.max(maxDepth, d + 1);
      queue.push(c.id);
    }
  }

  // Spine = the primary success node's ancestor chain (the success path).
  const primaryNode = nodes.find(n => n.is_primary) || nodes.find(n => n.is_success);
  const spineSet = new Set();
  for (let cur = primaryNode ? primaryNode.id : null; cur != null; cur = (byId.get(cur) || {}).parent) {
    spineSet.add(cur);
  }
  const primaryChild = id => {
    const kids = childrenOf.get(id) || [];
    if (!kids.length) return null;
    return kids.find(k => spineSet.has(k.id)) || kids[0];
  };

  // Geometry.
  const VB_W = 1000, PAD_L = 14, PAD_R = 150, PAD_T = 44, NODE_W = 9, GAP = 13;
  const FUNNEL_H = 188;
  const scale = FUNNEL_H / total;
  const colGap = (VB_W - PAD_L - PAD_R - NODE_W) / Math.max(maxDepth, 1);
  const xOf = d => PAD_L + d * colGap;
  const fx = v => v.toFixed(1);

  // Placement: spine top-aligned (flat top); branch outcomes + the failure
  // block stack BELOW the spine in the child column, each separated by GAP.
  const place = new Map();
  let bottomMax = PAD_T;
  const put = (id, x, y, count, kind, label, cond, onSpine, missed) => {
    place.set(id, { x, y, h: count * scale, count, kind, label, cond, onSpine, missed: missed || "" });
    bottomMax = Math.max(bottomMax, y + count * scale);
  };
  const walk = (node, y) => {
    const d = depth.get(node.id);
    const kind = node.is_start ? "start"
      : (node.is_success ? (node.is_primary ? "success" : "win") : "spine");
    put(node.id, xOf(d), y, node.count, kind,
        node.is_start ? "all" : node.label, node.cond, spineSet.has(node.id) || node.is_start);
    const kids = childrenOf.get(node.id) || [];
    if (!kids.length) return;
    const primary = primaryChild(node.id);
    if (primary) walk(primary, y);                  // spine continues at the same top
    let cursor = y + (primary ? primary.count * scale : 0) + GAP;
    for (const c of kids) {
      if (primary && c.id === primary.id) continue;
      walk(c, cursor);                              // branch outcome (e.g. suboptimal place)
      cursor += c.count * scale + GAP;
    }
    const drop = node.count - kids.reduce((s, k) => s + k.count, 0);
    if (drop > 0) {
      const missed = (kids.length === 1 && primary) ? `no ${primary.label}` : "dropped";
      put(`${node.id}__fail`, xOf(d + 1), cursor, drop, "fail", `✗ ${drop}`, null, false, missed);
      cursor += drop * scale + GAP;
    }
  };
  walk(start, PAD_T);

  // Curved ribbon from a contiguous source slice to a (gapped) destination.
  const ribbon = (x1, t1, b1, x2, t2, b2) => {
    const mx = (x1 + x2) / 2;
    return `M${fx(x1)},${fx(t1)} C${fx(mx)},${fx(t1)} ${fx(mx)},${fx(t2)} ${fx(x2)},${fx(t2)} `
         + `L${fx(x2)},${fx(b2)} C${fx(mx)},${fx(b2)} ${fx(mx)},${fx(b1)} ${fx(x1)},${fx(b1)} Z`;
  };
  const flows = [];
  for (const P of nodes) {
    const pp = place.get(P.id);
    if (!pp) continue;
    const kids = childrenOf.get(P.id) || [];
    if (!kids.length) continue;
    const primary = primaryChild(P.id);
    const dests = [];
    if (primary) dests.push(primary.id);
    for (const c of kids) if (!(primary && c.id === primary.id)) dests.push(c.id);
    if (place.has(`${P.id}__fail`)) dests.push(`${P.id}__fail`);
    let sy = pp.y;                                  // source slices contiguous from P's top
    for (const did of dests) {
      const dd = place.get(did);
      const srcTop = sy, srcBot = sy + dd.count * scale;
      sy = srcBot;
      flows.push(`<path class="funnel-flow ${dd.kind}" d="${ribbon(pp.x + NODE_W, srcTop, srcBot, dd.x, dd.y, dd.y + dd.h)}"/>`);
    }
  }

  const bars = [];
  for (const [, p] of place) {
    bars.push(`<rect class="funnel-bar ${p.kind}" x="${fx(p.x)}" y="${fx(p.y)}" width="${NODE_W}" height="${fx(Math.max(p.h, 1.5))}" rx="2"/>`);
  }

  // Track the rightmost drawn extent (bars + estimated label widths) so the
  // viewBox hugs the content; otherwise the label margin reserved on the right
  // shows up as dead space.
  const estW = (s, px) => [...String(s)].length * px * 0.6;
  let contentRight = xOf(maxDepth) + NODE_W;
  const labels = [];
  for (const [id, p] of place) {
    if (p.onSpine) {                                // above its column, centered
      const cx = p.x + NODE_W / 2;
      const nm = `${escapeHtml(p.label)}${p.kind === "success" ? " ✓" : ""}`;
      const sub = id === start.id ? `${total}` : `${p.count}${p.cond == null ? "" : " · " + pctStr(p.cond)}`;
      const wHalf = Math.max(estW(p.label, 12.5) + (p.kind === "success" ? 11 : 0), estW(sub, 11)) / 2;
      contentRight = Math.max(contentRight, cx + wHalf);
      labels.push(
        `<text class="funnel-name ${p.kind}" x="${fx(cx)}" y="${fx(PAD_T - 24)}" text-anchor="middle">${nm}</text>` +
        `<text class="funnel-sub ${p.kind}" x="${fx(cx)}" y="${fx(PAD_T - 10)}" text-anchor="middle">${escapeHtml(sub)}</text>`
      );
    } else {                                        // beside the block (right of bar)
      const lx = p.x + NODE_W + 6, cy = p.y + p.h / 2;
      const sub = p.kind === "fail" ? p.missed
        : `${p.count}${p.cond == null ? "" : " · " + pctStr(p.cond)}`;
      contentRight = Math.max(contentRight, lx + Math.max(estW(p.label, 12.5), estW(sub, 11)));
      labels.push(
        `<text class="funnel-name ${p.kind}" x="${fx(lx)}" y="${fx(cy - 1)}">${escapeHtml(p.label)}</text>` +
        `<text class="funnel-sub ${p.kind}" x="${fx(lx)}" y="${fx(cy + 11)}">${escapeHtml(sub)}</text>`
      );
    }
  }
  const viewW = Math.ceil(contentRight + 4);

  const VB_H = bottomMax + 20;
  const winNodes = nodes.filter(n => n.is_success).slice().sort((a, b) => b.count - a.count);
  const sc = funnel.success_count != null ? funnel.success_count : 0;
  const breakdown = winNodes.length > 1
    ? ` <span class="dim">(${winNodes.map(w => `${escapeHtml(w.label)} ${w.count}`).join(" · ")})</span>`
    : "";
  const winLabel = winNodes.length > 1 ? "succeeded" : (winNodes[0] ? escapeHtml(winNodes[0].label) : "success");
  const successLine = `<div class="funnel-result"><span class="ok-pill">✓ ${winLabel}</span> ${sc}/${total} <span class="dim">(${pctStr(sc / total)})</span>${breakdown}</div>`;

  return `<section class="funnel-card">
    <div class="funnel-head">
      <h3>Success funnel</h3>
      <span class="funnel-note">flow width &prop; episodes &middot; % = conditional on a perfect run so far &middot; red = runs that fail out</span>
    </div>
    <svg class="funnel-svg" viewBox="0 0 ${viewW} ${fx(VB_H)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Success funnel">
      ${flows.join("")}${bars.join("")}${labels.join("")}
    </svg>
    ${successLine}
  </section>`;
}

// ---------- Episodes ----------
async function renderEpisodes(policy, task) {
  setBreadcrumb([
    { label: "Home", href: "#/" },
    { label: `${policy} × ${task}` },
  ]);
  appEl.innerHTML = '<p class="loading">Loading…</p>';
  let data;
  try {
    data = await fetchJSON(`/api/episodes?policy=${enc(policy)}&task=${enc(task)}`);
  } catch (e) {
    showError("Failed to load episodes", escapeHtml(e.message));
    return;
  }

  if (data.error === "csv_missing") {
    appEl.innerHTML = `<div class="error-box">
      <h2>Source CSV not found</h2>
      <p>checkpoints.txt references: <code>${escapeHtml(data.path)}</code></p>
      <p>This file does not exist on disk. Fix the path in <code>checkpoints.txt</code> or generate the eval.</p>
    </div>`;
    return;
  }
  if (data.error === "no_data") {
    appEl.innerHTML = `<div class="error-box">
      <h2>No eval data</h2>
      <p>No source_csv listed for <code>${escapeHtml(policy)}</code> × <code>${escapeHtml(task)}</code> in checkpoints.txt.</p>
    </div>`;
    return;
  }

  const out = [];
  const succRate = (data.funnel && data.funnel.total && data.funnel.success_count != null)
    ? data.funnel.success_count / data.funnel.total : null;
  const hdrRate = succRate == null ? "" : ` <span class="hdr-rate">${(succRate * 100).toFixed(0)}%</span>`;
  out.push(`<div class="episodes-header">
    <h2>${escapeHtml(policy)}<span class="x">×</span><span class="accent">${escapeHtml(task)}</span>${hdrRate}</h2>
    ${renderEvalMeta(data, task, "episodes-meta")}
  </div>`);

  out.push(renderFunnel(data.funnel));

  out.push('<p class="nav-hint">↳ click an episode to watch its rollout</p>');
  out.push('<table class="episode-table"><thead><tr>');
  out.push('<th>Episode</th><th>Duration (s)</th>');
  for (const stage of data.stages) {
    out.push(`<th>${escapeHtml(stage)}<div class="stage-total">${data.stage_totals[stage]}/${data.n_total}</div></th>`);
  }
  out.push('</tr></thead><tbody>');

  for (const ep of data.episodes) {
    const succeeded = !!ep.success;
    out.push(`<tr class="${succeeded ? 'success-row' : 'failure-row'}">`);
    out.push(`<td><a href="#/video/${enc(policy)}/${enc(task)}/${enc(ep.episode_dir)}">${escapeHtml(ep.episode_dir)}</a></td>`);
    out.push(`<td>${ep.duration_s.toFixed(2)}</td>`);
    for (const stage of data.stages) {
      const val = ep.stages[stage];
      out.push(`<td class="cell ${val ? 'ok' : 'fail'}">${val ? '✓' : '✗'}</td>`);
    }
    out.push('</tr>');
  }
  out.push('</tbody>');
  const visibleSummary = (data.summary_rows || []).filter(r => r.label !== "conditional_rate");
  if (visibleSummary.length > 0) {
    out.push('<tfoot>');
    for (const row of visibleSummary) {
      out.push('<tr class="summary-row">');
      out.push(`<td>${escapeHtml(row.label)}</td>`);
      out.push(`<td>${escapeHtml(row.duration_s || "")}</td>`);
      for (const stage of data.stages) {
        out.push(`<td>${escapeHtml(row.values[stage] || "")}</td>`);
      }
      out.push('</tr>');
    }
    out.push('</tfoot>');
  }
  out.push('</table>');
  appEl.innerHTML = out.join("");
}

// ---------- Video ----------
async function renderVideo(policy, task, episode) {
  setBreadcrumb([
    { label: "Home", href: "#/" },
    { label: `${policy} × ${task}`, href: `#/episodes/${enc(policy)}/${enc(task)}` },
    { label: episode },
  ]);
  appEl.innerHTML = '<p class="loading">Loading…</p>';

  let epData, videoData, compareData;
  try {
    [epData, videoData, compareData] = await Promise.all([
      fetchJSON(`/api/episodes?policy=${enc(policy)}&task=${enc(task)}`),
      fetchJSON(`/api/episode_videos?policy=${enc(policy)}&task=${enc(task)}&episode=${enc(episode)}`),
      fetchJSON(`/api/episode_compare?task=${enc(task)}&episode=${enc(episode)}`).catch(() => ({ options: [] })),
    ]);
  } catch (e) {
    showError("Failed to load video page", escapeHtml(e.message));
    return;
  }

  if (epData.error) {
    showError("Cannot load episodes for this policy/task", escapeHtml(epData.path || ""));
    return;
  }

  const epList = epData.episodes.map(e => e.episode_dir);
  const idx = epList.indexOf(episode);
  const prev = idx > 0 ? epList[idx - 1] : null;
  const next = idx >= 0 && idx < epList.length - 1 ? epList[idx + 1] : null;

  const out = [];
  out.push('<div class="video-nav">');
  out.push(`<div class="left-nav">${prev ? `<a href="#/video/${enc(policy)}/${enc(task)}/${enc(prev)}">← ${escapeHtml(prev.replace(/^episode_/, "Ep. "))}</a>` : '<span class="dim">← first</span>'}</div>`);
  out.push(`<h2>${escapeHtml(episode.replace(/^episode_/, "Ep. "))}</h2>`);
  out.push(`<div class="right-nav">${next ? `<a href="#/video/${enc(policy)}/${enc(task)}/${enc(next)}">${escapeHtml(next.replace(/^episode_/, "Ep. "))} →</a>` : '<span class="dim">last →</span>'}</div>`);
  out.push('</div>');

  out.push(renderEvalMeta(epData, task, "video-run-meta"));
  out.push(renderModelCompare(compareData, policy, task, episode));

  const epRow = epData.episodes.find(e => e.episode_dir === episode);
  if (epRow) {
    out.push('<div class="ep-stages">');
    out.push(`<span class="meta-line">Duration ${epRow.duration_s.toFixed(2)}s</span>`);
    for (const stage of epData.stages) {
      const v = epRow.stages[stage];
      out.push(`<span class="badge ${v ? 'ok' : 'fail'}">${escapeHtml(stage)}: ${v ? '✓' : '✗'}</span>`);
    }
    out.push('</div>');
  } else {
    out.push(`<div class="ep-stages"><span class="meta-line">Episode <code>${escapeHtml(episode)}</code> is not in the eval CSV.</span></div>`);
  }

  out.push('<div class="video-grid">');
  if (videoData.slots.length === 0) {
    out.push(`<div class="video-slot missing">
      <div class="video-slot-label">no slots</div>
      <div class="video-missing-box">No videos configured for policy <code>${escapeHtml(policy)}</code>.</div>
    </div>`);
  }
  for (const slot of videoData.slots) {
    if (slot.exists) {
      // Static build bakes the relative file path into each existing slot.
      const url = slot.url;
      out.push(`<div class="video-slot">
        <div class="video-slot-label">${escapeHtml(slot.label)}</div>
        <video src="${url}" controls preload="metadata"></video>
      </div>`);
    } else {
      out.push(`<div class="video-slot missing">
        <div class="video-slot-label">${escapeHtml(slot.label)}</div>
        <div class="video-missing-box">
          <div>Eval Video Not Found</div>
          <code>${escapeHtml(slot.relative_path)}</code>
        </div>
      </div>`);
    }
  }
  out.push('</div>');

  out.push('<div class="sync-note">Videos are synced — play/pause/seek/speed propagates across all videos in this episode.</div>');

  out.push('<div class="episode-jump"><span class="episode-jump-label">Jump to:</span> ');
  for (const e of epList) {
    const cls = e === episode ? 'current' : '';
    const epStageInfo = epData.episodes.find(x => x.episode_dir === e);
    const successCls = epStageInfo
      ? (epStageInfo.success ? 'ok' : 'fail')
      : '';
    const num = e.replace(/^episode_/, '');
    out.push(`<a class="${cls} ${successCls}" href="#/video/${enc(policy)}/${enc(task)}/${enc(e)}">${escapeHtml(num)}</a> `);
  }
  out.push('</div>');

  appEl.innerHTML = out.join("");
  syncVideos();
}

function syncVideos() {
  const videos = Array.from(document.querySelectorAll('.video-slot video'));
  if (videos.length === 0) return;

  for (const v of videos) {
    const slot = v.closest('.video-slot');
    if (!slot) continue;
    slot.classList.toggle('playing', !v.paused);
    v.addEventListener('play',  () => slot.classList.add('playing'));
    v.addEventListener('pause', () => slot.classList.remove('playing'));
    v.addEventListener('ended', () => slot.classList.remove('playing'));
  }

  if (videos.length < 2) return;

  let syncing = false;
  const syncOthers = (source, fn) => {
    if (syncing) return;
    syncing = true;
    for (const v of videos) {
      if (v !== source) {
        try { fn(v); } catch (_) {}
      }
    }
    syncing = false;
  };

  for (const v of videos) {
    v.addEventListener('play', () => syncOthers(v, o => {
      const p = o.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }));
    v.addEventListener('pause', () => syncOthers(v, o => o.pause()));
    v.addEventListener('seeked', () => syncOthers(v, o => {
      if (Math.abs(o.currentTime - v.currentTime) > 0.05) o.currentTime = v.currentTime;
    }));
    v.addEventListener('ratechange', () => syncOthers(v, o => { o.playbackRate = v.playbackRate; }));
  }
}

// ---------- Throughput ----------
// One chart per task: y = success-episode duration (s). A dropdown switches
// the summary overlay between three modes:
//   box     — per-policy box & whisker over jittered episode dots
//   medians — a bar chart of each policy's median duration (0-based axis)
//   meanci  — per-policy mean with a 95% CI error bar over the dots
let tpCharts = [];
let tpThemeObserver = null;
const TP_BOX_MIN_N = 5;
let tpMode = (() => {
  try { return localStorage.getItem("eyeball-tp-mode") || "box"; } catch (_) { return "box"; }
})();

function disposeThroughputCharts() {
  for (const c of tpCharts) {
    try { c.dispose(); } catch (_) {}
  }
  tpCharts = [];
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tpThemeColors() {
  return {
    text: cssVar("--text"),
    text2: cssVar("--text-2"),
    text3: cssVar("--text-3"),
    border: cssVar("--border"),
    borderStrong: cssVar("--border-strong"),
    accent: cssVar("--accent"),
    surface: cssVar("--surface"),
    surface2: cssVar("--surface-2"),
    font: cssVar("--font-sans"),
  };
}

// Deterministic horizontal jitter in [-0.18, 0.18] so dots stay put across
// re-renders (e.g. theme toggle) instead of jumping around.
function stableJitter(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const u = (((h % 1000) + 1000) % 1000) / 1000;
  return (u - 0.5) * 0.36;
}

function tpPolicyData(policies, cellByPolicy) {
  return policies.map((policy) => {
    const pc = cellByPolicy[policy] || {};
    const succ = pc.successes || [];
    return { policy, succ, n: succ.length, stats: pc.stats || null };
  });
}

// Shared grid / fonts / y-axis (identical across modes).
function tpScaffold(colors) {
  return {
    grid: { left: 6, right: 14, top: 24, bottom: 6, containLabel: true },
    textStyle: { fontFamily: colors.font },
    yAxis: {
      type: "value",
      scale: true,
      name: "s",
      nameLocation: "end",
      nameGap: 8,
      nameTextStyle: { color: colors.text3, fontSize: 10, align: "right" },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text3, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    },
  };
}

function tpPolicyXAxis(colors, policies, nByPolicy) {
  return {
    type: "category",
    data: policies,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: colors.border } },
    axisLabel: {
      color: colors.text2,
      fontSize: 10.5,
      lineHeight: 13,
      formatter: (val, idx) => `${val}\nn=${nByPolicy[idx]}`,
    },
  };
}

function tpTooltip(colors, formatter) {
  return {
    trigger: "item",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: [8, 11],
    textStyle: { color: colors.text, fontFamily: colors.font, fontSize: 12 },
    extraCssText: "border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,0.12);",
    formatter,
  };
}

function tpEpisodeDots(pdata) {
  const dots = [];
  pdata.forEach((d, pi) => {
    for (const e of d.succ) {
      dots.push({
        value: [pi + stableJitter(d.policy + "/" + e.episode), e.duration_s],
        policy: d.policy,
        episode: e.episode,
      });
    }
  });
  return dots;
}

// Mode: per-policy box & whisker over the episode dots.
function tpBuildBox(policies, cellByPolicy, colors) {
  const pdata = tpPolicyData(policies, cellByPolicy);
  const nByPolicy = pdata.map((d) => d.n);
  const boxData = [];
  const medianTicks = [];
  pdata.forEach((d, pi) => {
    if (d.n >= TP_BOX_MIN_N && d.stats) {
      const s = d.stats;
      boxData.push([s.min, s.q1, s.median, s.q3, s.max]);
    } else {
      boxData.push("-");
      if (d.n >= 1 && d.stats) medianTicks.push({ value: [pi, d.stats.median] });
    }
  });
  const fmt = (p) => {
    if (p.seriesName === "dots") {
      return `<b>${escapeHtml(p.data.policy)}</b> · ${escapeHtml(p.data.episode)}<br>${p.data.value[1].toFixed(2)}s`;
    }
    if (p.seriesName === "box") {
      const b = boxData[p.dataIndex];
      if (!b || b === "-") return "";
      const f = (x) => Number(x).toFixed(1);
      return `<b>${escapeHtml(policies[p.dataIndex])}</b> · n=${nByPolicy[p.dataIndex]}<br>`
        + `max ${f(b[4])}s<br>Q3 ${f(b[3])}s<br>median ${f(b[2])}s<br>Q1 ${f(b[1])}s<br>min ${f(b[0])}s`;
    }
    return "";
  };
  return {
    ...tpScaffold(colors),
    tooltip: tpTooltip(colors, fmt),
    xAxis: tpPolicyXAxis(colors, policies, nByPolicy),
    series: [
      { name: "box", type: "boxplot", data: boxData, boxWidth: [8, 38], itemStyle: { color: colors.surface2, borderColor: colors.borderStrong, borderWidth: 1.2 }, z: 2 },
      { name: "median", type: "scatter", data: medianTicks, symbol: "rect", symbolSize: [24, 2], itemStyle: { color: colors.borderStrong }, silent: true, z: 3 },
      { name: "dots", type: "scatter", data: tpEpisodeDots(pdata), symbolSize: 7, itemStyle: { color: colors.accent, opacity: 0.6, borderColor: colors.surface, borderWidth: 0.5 }, emphasis: { scale: 1.6, itemStyle: { opacity: 1 } }, z: 4 },
    ],
  };
}

// Mode: bar chart of each policy's median duration.
function tpBuildMedians(policies, cellByPolicy, colors) {
  const pdata = tpPolicyData(policies, cellByPolicy);
  const nByPolicy = pdata.map((d) => d.n);
  const bars = pdata.map((d) => ({
    value: d.stats ? d.stats.median : null,
    policy: d.policy,
    n: d.n,
  }));
  const fmt = (p) => {
    if (p.seriesName !== "median-bar") return "";
    const v = p.data.value;
    if (v == null) return `<b>${escapeHtml(p.data.policy)}</b><br>no successes`;
    return `<b>${escapeHtml(p.data.policy)}</b> · n=${p.data.n}<br>median ${Number(v).toFixed(2)}s`;
  };

  const base = tpScaffold(colors);
  return {
    ...base,
    // 0-based so bar heights are honest; ECharts auto-pads the top to a round
    // number (clean labels + room for the value labels above each bar).
    yAxis: { ...base.yAxis, scale: false, min: 0 },
    tooltip: tpTooltip(colors, fmt),
    xAxis: tpPolicyXAxis(colors, policies, nByPolicy),
    series: [
      {
        name: "median-bar",
        type: "bar",
        data: bars,
        barWidth: "52%",
        itemStyle: { color: colors.accent, borderRadius: [3, 3, 0, 0] },
        label: {
          show: true,
          position: "top",
          formatter: (pp) => (pp.data.value == null ? "" : Number(pp.data.value).toFixed(1)),
          fontSize: 10,
          color: colors.text2,
          fontFamily: colors.font,
        },
        z: 2,
      },
    ],
  };
}

// Mode: per-policy mean with a 95% CI error bar over the episode dots.
function tpBuildMeanCI(policies, cellByPolicy, colors) {
  const pdata = tpPolicyData(policies, cellByPolicy);
  const nByPolicy = pdata.map((d) => d.n);
  const means = [];
  const cibars = [];
  pdata.forEach((d, pi) => {
    if (d.stats && d.stats.mean != null) {
      means.push({ value: [pi, d.stats.mean], policy: d.policy, n: d.n, lo: d.stats.ci_lo, hi: d.stats.ci_hi });
      cibars.push({ value: [pi, d.stats.mean, d.stats.ci_lo, d.stats.ci_hi] });
    }
  });
  const renderCI = (params, api) => {
    const xi = api.value(0);
    const pLo = api.coord([xi, api.value(2)]);
    const pHi = api.coord([xi, api.value(3)]);
    const cap = 6;
    const style = { stroke: colors.text2, lineWidth: 1.5 };
    return {
      type: "group",
      children: [
        { type: "line", shape: { x1: pLo[0], y1: pLo[1], x2: pHi[0], y2: pHi[1] }, style },
        { type: "line", shape: { x1: pLo[0] - cap, y1: pLo[1], x2: pLo[0] + cap, y2: pLo[1] }, style },
        { type: "line", shape: { x1: pHi[0] - cap, y1: pHi[1], x2: pHi[0] + cap, y2: pHi[1] }, style },
      ],
    };
  };
  const fmt = (p) => {
    if (p.seriesName === "dots") {
      return `<b>${escapeHtml(p.data.policy)}</b> · ${escapeHtml(p.data.episode)}<br>${p.data.value[1].toFixed(2)}s`;
    }
    if (p.seriesName === "mean") {
      const d = p.data;
      return `<b>${escapeHtml(d.policy)}</b> · n=${d.n}<br>mean ${d.value[1].toFixed(2)}s<br>95% CI [${Number(d.lo).toFixed(2)}, ${Number(d.hi).toFixed(2)}]s`;
    }
    return "";
  };
  return {
    ...tpScaffold(colors),
    tooltip: tpTooltip(colors, fmt),
    xAxis: tpPolicyXAxis(colors, policies, nByPolicy),
    series: [
      { name: "dots", type: "scatter", data: tpEpisodeDots(pdata), symbolSize: 6, itemStyle: { color: colors.accent, opacity: 0.28 }, z: 2 },
      { name: "ci", type: "custom", renderItem: renderCI, data: cibars, encode: { x: 0, y: [1, 2, 3] }, silent: true, z: 3 },
      { name: "mean", type: "scatter", data: means, symbol: "circle", symbolSize: 10, itemStyle: { color: colors.accent, borderColor: colors.surface, borderWidth: 1.5 }, emphasis: { scale: 1.4 }, z: 4 },
    ],
  };
}

function buildTaskOption(task, policies, cellByPolicy, colors, mode) {
  if (mode === "medians") return tpBuildMedians(policies, cellByPolicy, colors);
  if (mode === "meanci") return tpBuildMeanCI(policies, cellByPolicy, colors);
  return tpBuildBox(policies, cellByPolicy, colors);
}

function tpRebuildAll() {
  if (tpCharts.length === 0) return;
  const colors = tpThemeColors();
  for (const c of tpCharts) {
    const ctx = c.__ctx;
    if (!ctx) continue;
    try {
      c.setOption(buildTaskOption(ctx.task, ctx.policies, ctx.cell, colors, tpMode), true);
    } catch (_) { /* keep other charts alive on a bad rebuild */ }
  }
}

function ensureTpThemeObserver() {
  if (tpThemeObserver) return;
  tpThemeObserver = new MutationObserver(() => tpRebuildAll());
  tpThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

// Pairwise overall speedup on SHARED successes only: an episode counts for a
// pair only if BOTH policies succeeded on it (same episode index = same
// scenario), so durations are compared like-for-like. Per shared episode take
// ln(col_dur / row_dur); average within a task, then average those across the
// tasks that have ≥1 shared success. exp() > 1 (positive %) => row is faster.
function tpPairwiseMatrix(policies, tasks, data) {
  const succMap = (t, p) => {
    const m = {};
    const c = data[t] && data[t][p];
    if (c && c.successes) for (const s of c.successes) m[s.episode] = s.duration_s;
    return m;
  };
  return policies.map((rp) => policies.map((cp) => {
    if (rp === cp) return { self: true };
    const taskLogs = [];
    let nEp = 0, solid = 0; // solid = tasks backed by >=3 shared episodes
    for (const t of tasks) {
      const a = succMap(t, rp), b = succMap(t, cp);
      let sum = 0, k = 0;
      for (const ep in a) {
        if (ep in b && a[ep] > 0 && b[ep] > 0) { sum += Math.log(b[ep] / a[ep]); k += 1; }
      }
      if (k > 0) { taskLogs.push(sum / k); nEp += k; if (k >= 3) solid += 1; }
    }
    if (!taskLogs.length) return { nTasks: 0, nEp: 0, solid: 0, pct: null, factor: null };
    const factor = Math.exp(taskLogs.reduce((x, y) => x + y, 0) / taskLogs.length);
    return { nTasks: taskLogs.length, nEp, solid, factor, pct: (factor - 1) * 100 };
  }));
}

// Diverging tint: green when the row is faster (pct>0), red when slower.
// color-mix keeps it theme-reactive (re-evaluates var() on theme toggle).
function tpDeltaBg(pct) {
  if (pct == null) return "transparent";
  const mix = Math.min(72, (Math.abs(pct) / 15) * 72); // ~full tint by 15%
  const v = pct >= 0 ? "--accent" : "--fail-current";
  return `color-mix(in srgb, var(${v}) ${mix.toFixed(0)}%, transparent)`;
}

function renderPairwiseSection(policies, tasks, data) {
  const M = tpPairwiseMatrix(policies, tasks, data);
  const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "");
  const head = policies.map((p) => `<th class="pw-col">${escapeHtml(p)}</th>`).join("");
  const rows = policies.map((rp, r) => {
    const cells = policies.map((cp, c) => {
      const m = M[r][c];
      if (m.self) return `<td class="pw-diag">—</td>`;
      if (m.pct == null) return `<td class="pw-na" title="no shared successes">·</td>`;
      // Fade cells backed by few well-sampled tasks (<4 tasks with >=3 shared eps).
      const conf = Math.min(1, m.solid / 4);
      const op = (0.6 + 0.4 * conf).toFixed(2);
      const title = `${rp} vs ${cp}: ${m.factor.toFixed(2)}× (${sign(m.pct)}${Math.abs(m.pct).toFixed(0)}%) · ${m.nEp} shared episodes across ${m.nTasks} tasks (${m.solid} with ≥3)`;
      return `<td class="pw-cell" style="background:${tpDeltaBg(m.pct)};opacity:${op}" title="${escapeHtml(title)}">`
        + `<span class="pw-pct">${sign(m.pct)}${Math.abs(m.pct).toFixed(0)}%</span>`
        + `<span class="pw-n">n=${m.nEp}</span></td>`;
    }).join("");
    return `<tr><th class="pw-row">${escapeHtml(rp)}</th>${cells}</tr>`;
  }).join("");

  return `<div class="pairwise-card">
    <div class="pairwise-head">
      <h3>Overall pairwise speedup</h3>
      <span class="pairwise-sub">paired on episodes <b>both</b> policies succeeded on · <b>green</b> = row faster than column · n = shared-success episodes · faint = few well-sampled tasks</span>
    </div>
    <div class="pairwise-scroll">
      <table class="pairwise-table">
        <thead><tr><th class="pw-corner"></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="pairwise-method">
      <div class="pw-method-title">How each cell is computed</div>
      <ol>
        <li>Keep only episodes where <b>both</b> the row and column policy succeeded (same episode index = same scenario; success = <code>task_success</code>, or for pot = lid placed anywhere).</li>
        <li>Per shared episode, take <code>ln(col_duration / row_duration)</code>.</li>
        <li>Average those within each task, then average the per-task values across every task with ≥1 shared episode (tasks weighted <b>equally</b>).</li>
        <li>Cell = <code>exp(that average) − 1</code>, shown as a %. <b>Positive / green = the row policy finishes faster.</b> <code>n</code> = total shared episodes.</li>
      </ol>
      <div class="pw-method-caveat"><b>Caveats:</b> this is speed on <b>shared</b> (typically easier) successes — it ignores success <i>rate</i> and the episodes only one policy solved. Assumes <code>episode_i</code> is the same scenario for every policy and that <code>duration_s</code> is measured the same way across policies. Faint cells rest on few well-sampled tasks (≥3 shared episodes); read those as tentative.</div>
    </div>
  </div>`;
}

async function renderThroughput() {
  setBreadcrumb([{ label: "Home", href: "#/" }, { label: "Throughput" }]);
  appEl.innerHTML = '<p class="loading">Loading…</p>';
  let summary;
  try {
    summary = await fetchJSON("/api/throughput");
  } catch (e) {
    showError("Failed to load throughput", escapeHtml(e.message));
    return;
  }

  const { policies, tasks, data } = summary;
  const visibleTasks = tasks.filter(t => !HIDDEN_TASKS.has(t));

  const parts = [];
  parts.push(`<div class="home-intro">
    <h1 class="home-title">Throughput</h1>
    <div class="home-intro-right">
      <div class="tp-controls">
        <label class="tp-mode-label" for="tp-mode">View</label>
        <select id="tp-mode" class="tp-select">
          <option value="box">Box &amp; whisker</option>
          <option value="medians">Median bar chart</option>
          <option value="meanci">Mean ± 95% CI</option>
        </select>
        <a class="page-link" href="#/correlation">Correlation →</a>
        <a class="page-link" href="#/">← Results</a>
      </div>
      <div class="home-sub">${visibleTasks.length} tasks &middot; ${policies.length} policies &middot; success episodes only · lower = faster</div>
    </div>
  </div>`);
  parts.push(renderPairwiseSection(policies, visibleTasks, data));
  parts.push('<div class="charts-grid">');
  visibleTasks.forEach((task, i) => {
    parts.push(`<div class="chart-card">
      <h3><span class="task-name">${escapeHtml(task)}</span></h3>
      <div class="tp-chart" id="tp-chart-${i}"></div>
    </div>`);
  });
  parts.push('</div>');
  appEl.innerHTML = parts.join("");

  const sel = document.getElementById("tp-mode");
  if (sel) {
    sel.value = tpMode;
    sel.addEventListener("change", () => {
      tpMode = sel.value;
      try { localStorage.setItem("eyeball-tp-mode", tpMode); } catch (_) {}
      tpRebuildAll();
    });
  }

  if (!window.echarts) {
    showError("Charting library failed to load", "ECharts did not load from the CDN — check your connection.");
    return;
  }

  ensureTpThemeObserver();
  const colors = tpThemeColors();
  visibleTasks.forEach((task, i) => {
    const el = document.getElementById(`tp-chart-${i}`);
    if (!el) return;
    try {
      const chart = window.echarts.init(el);
      const cell = data[task] || {};
      chart.__ctx = { task, policies, cell };
      chart.setOption(buildTaskOption(task, policies, cell, colors, tpMode));
      chart.on("click", (params) => {
        const d = params.data;
        if (!d) return;
        if (d.episode) {
          window.location.hash = `#/video/${enc(d.policy)}/${enc(task)}/${enc(d.episode)}`;
        } else if (d.policy) {
          window.location.hash = `#/episodes/${enc(d.policy)}/${enc(task)}`;
        }
      });
      tpCharts.push(chart);
    } catch (err) {
      // One bad chart shouldn't blank the whole page.
      el.innerHTML = `<div class="tp-chart-error">chart failed: ${escapeHtml(err.message)}</div>`;
    }
  });
}

// ---------- Correlation (paired success across policies) ----------
// Evals are paired: episode_k is the same starting configuration for every
// policy, so per-episode success is directly comparable. From the aligned 0/1
// vectors we compute (1) a pooled policy×policy agreement matrix (phi +
// McNemar), (2) eyeball's edge vs ablations/baselines, and (3) a per-task
// episode-difficulty success matrix. Policies are grouped by role.
const ROLE_ORDER = ["main", "ablation", "baseline"];
const ROLE_LABEL = { main: "Main", ablation: "Ablations", baseline: "Baselines" };

// Stable sort by role group; preserves checkpoints.txt order within a group.
function corrOrderedPolicies(corr) {
  const roles = corr.roles || {};
  const rank = (p) => {
    const r = ROLE_ORDER.indexOf(roles[p]);
    return r < 0 ? ROLE_ORDER.length : r;
  };
  return corr.policies.slice().sort((a, b) => rank(a) - rank(b));
}

// Concatenate each policy's per-task success arrays (visible tasks only) into
// one pooled vector. Vectors stay index-aligned across policies because every
// task contributes its episodes in the same order; a policy missing a task is
// padded with nulls so the indices don't drift.
function corrPooledVectors(corr, visibleTasks) {
  const vecs = {};
  for (const p of corr.policies) vecs[p] = [];
  for (const t of visibleTasks) {
    const td = corr.data[t];
    if (!td) continue;
    const len = td.episodes.length;
    for (const p of corr.policies) {
      const arr = td.success[p];
      for (let i = 0; i < len; i++) vecs[p].push(arr && arr.length === len ? arr[i] : null);
    }
  }
  return vecs;
}

function binomCoef(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

// Two-sided exact-binomial McNemar p-value from the discordant counts (b, c).
function mcnemarP(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let cum = 0;
  for (let i = 0; i <= k; i++) cum += binomCoef(n, i);
  return Math.min(1, (2 * cum) / Math.pow(2, n));
}

// Paired 2×2 + phi + McNemar over episodes where both vectors are non-null.
function corrPairStats(v1, v2) {
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < v1.length; i++) {
    const x = v1[i], y = v2[i];
    if (x == null || y == null) continue;
    if (x && y) a++;
    else if (x && !y) b++;
    else if (!x && y) c++;
    else d++;
  }
  const denom = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const phi = denom > 0 ? (a * d - b * c) / denom : null;
  return { a, b, c, d, n: a + b + c + d, phi, p: mcnemarP(b, c) };
}

// Diverging tint: green for positive agreement, red for anti-correlation.
function corrPhiBg(phi) {
  if (phi == null) return "transparent";
  const mix = Math.min(72, Math.abs(phi) * 72);
  const v = phi >= 0 ? "--accent" : "--fail-current";
  return `color-mix(in srgb, var(${v}) ${mix.toFixed(0)}%, transparent)`;
}

function renderRoleLegend(corr, policies) {
  const roles = corr.roles || {};
  const groups = ROLE_ORDER
    .map((r) => ({ r, members: policies.filter((p) => roles[p] === r) }))
    .filter((g) => g.members.length);
  if (!groups.length) return "";
  const items = groups.map((g) =>
    `<span class="corr-legend-group"><span class="corr-legend-role ${g.r}">${ROLE_LABEL[g.r]}</span>${g.members.map(escapeHtml).join(", ")}</span>`
  ).join("");
  return `<div class="corr-legend">${items}</div>`;
}

// Episode-level consensus: for each (task, episode) count how many policies
// succeeded. The spectrum (0..N) shows whether policies pass/fail the SAME
// episodes (piled at the ends) or independently (middle-heavy); the two lists
// pull out the unanimous episodes; Fleiss' kappa is the single agreement number.
function renderEpisodeAgreement(corr, policies, visibleTasks) {
  const main = policies.find((p) => (corr.roles || {})[p] === "main") || policies[0];
  const N = policies.length;
  const spectrum = new Array(N + 1).fill(0);
  const allSucc = [], allFail = [];
  let sumP = 0, sumS = 0, fullItems = 0; // Fleiss accumulators (full-rating items)
  for (const t of visibleTasks) {
    const td = corr.data[t];
    if (!td) continue;
    for (let i = 0; i < td.episodes.length; i++) {
      let present = 0, succ = 0;
      for (const p of policies) {
        const v = td.success[p] ? td.success[p][i] : null;
        if (v == null) continue;
        present++; if (v) succ++;
      }
      if (present === 0) continue;
      if (succ === present) allSucc.push({ task: t, ep: td.episodes[i] });
      else if (succ === 0) allFail.push({ task: t, ep: td.episodes[i] });
      if (present === N) {
        spectrum[succ]++;
        sumP += (succ * succ + (N - succ) * (N - succ) - N) / (N * (N - 1));
        sumS += succ; fullItems++;
      }
    }
  }
  const total = spectrum.reduce((a, b) => a + b, 0);
  if (!total) return "";
  const unanimous = spectrum[0] + spectrum[N];

  let kappa = null;
  if (fullItems > 0 && N > 1) {
    const Pbar = sumP / fullItems;
    const pS = sumS / (fullItems * N);
    const Pe = pS * pS + (1 - pS) * (1 - pS);
    if (Pe < 1) kappa = (Pbar - Pe) / (1 - Pe);
  }
  const kappaWord = (k) => k < 0.2 ? "weak" : k < 0.4 ? "fair" : k < 0.6 ? "moderate" : k < 0.8 ? "substantial" : "near-perfect";

  const maxBar = Math.max(...spectrum, 1);
  const bars = [];
  for (let k = 0; k <= N; k++) {
    const cls = k === 0 ? "fail" : k === N ? "ok" : "mid";
    const lbl = k === 0 ? "0 · all fail" : k === N ? `${N} · all pass` : `${k}`;
    bars.push(`<div class="agree-bar-row">
      <div class="agree-bar-k ${cls}">${lbl}</div>
      <div class="agree-bar-track"><div class="agree-bar-fill ${cls}" style="width:${(100 * spectrum[k] / maxBar).toFixed(1)}%"></div></div>
      <div class="agree-bar-n">${spectrum[k]}</div>
    </div>`);
  }

  const chip = (e, cls) => {
    const num = e.ep.replace(/^episode_/, "");
    const tip = `${e.task} · ${e.ep.replace(/^episode_/, "Ep. ")}\nopen ${main}'s run`;
    return `<a class="agree-chip ${cls}" href="#/video/${enc(main)}/${enc(e.task)}/${enc(e.ep)}" data-tip="${escapeHtml(tip)}">${escapeHtml(e.task)} <b>${escapeHtml(num)}</b></a>`;
  };
  const succChips = allSucc.map((e) => chip(e, "ok")).join("") || '<span class="agree-empty">none</span>';
  const failChips = allFail.map((e) => chip(e, "fail")).join("") || '<span class="agree-empty">none</span>';
  const kappaStr = kappa == null ? ""
    : ` &middot; Fleiss <span class="agree-kappa">κ = ${kappa.toFixed(2)}</span> <span class="dim">(${kappaWord(kappa)} agreement)</span>`;

  return `<section class="agree-card">
    <div class="agree-head">
      <h3>Episode agreement</h3>
      <span class="agree-sub">do policies pass/fail the <b>same</b> episodes? &middot; unanimous: <b>${unanimous}</b>/${total} <span class="dim">(${(100 * unanimous / total).toFixed(0)}%)</span>${kappaStr}</span>
    </div>
    <div class="agree-body">
      <div class="agree-spectrum">
        <div class="agree-spectrum-title">episodes by # of ${N} policies that succeeded <span class="dim">— piled at the ends = policies agree; middle-heavy = independent</span></div>
        ${bars.join("")}
      </div>
      <div class="agree-lists">
        <div class="agree-list">
          <div class="agree-list-head ok">✓ all ${N} succeeded <span class="agree-count">${allSucc.length}</span></div>
          <div class="agree-chips">${succChips}</div>
        </div>
        <div class="agree-list">
          <div class="agree-list-head fail">✗ all ${N} failed <span class="agree-count">${allFail.length}</span></div>
          <div class="agree-chips">${failChips}</div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderAgreementMatrix(policies, pooled) {
  const M = policies.map((rp) => policies.map((cp) =>
    rp === cp ? { self: true } : corrPairStats(pooled[rp], pooled[cp])));
  const head = policies.map((p) => `<th class="pw-col">${escapeHtml(p)}</th>`).join("");
  const rows = policies.map((rp, r) => {
    const cells = policies.map((cp, c) => {
      const m = M[r][c];
      if (m.self) return `<td class="pw-diag">—</td>`;
      if (m.phi == null) return `<td class="pw-na" title="undefined — a policy has no variation in the pool">·</td>`;
      const sig = m.p < 0.05;
      const better = m.b > m.c ? rp : (m.c > m.b ? cp : "");
      const pStr = m.p < 0.001 ? "<0.001" : m.p.toFixed(3);
      return `<td class="pw-cell" style="background:${corrPhiBg(m.phi)}"`
        + ` data-tip2x2="1" data-rp="${escapeHtml(rp)}" data-cp="${escapeHtml(cp)}"`
        + ` data-a="${m.a}" data-b="${m.b}" data-c="${m.c}" data-d="${m.d}"`
        + ` data-phi="${m.phi.toFixed(2)}" data-p="${pStr}" data-sig="${sig ? 1 : 0}" data-better="${escapeHtml(better)}">`
        + `<span class="pw-pct">${m.phi.toFixed(2)}${sig ? '<sup class="pw-sig">*</sup>' : ''}</span>`
        + `<span class="pw-n">n=${m.n}</span></td>`;
    }).join("");
    return `<tr><th class="pw-row">${escapeHtml(rp)}</th>${cells}</tr>`;
  }).join("");

  return `<div class="pairwise-card">
    <div class="pairwise-head">
      <h3>Policy agreement (φ)</h3>
      <span class="pairwise-sub">phi correlation of per-episode success, pooled across tasks · <b>green</b> = succeed/fail on the same episodes · <b>*</b> = McNemar p&lt;0.05 (one is reliably better) · hover for the 2×2 · <b>click a cell</b> to break it down by task</span>
    </div>
    <div class="pairwise-scroll">
      <table class="pairwise-table">
        <thead><tr><th class="pw-corner"></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="pairwise-method">
      <div class="pw-method-title">How each cell is computed</div>
      <ol>
        <li>For a pair, build the 2×2 over all paired episodes (same episode index = same scenario): both ✓ <b>(a)</b>, row-only ✓ <b>(b)</b>, col-only ✓ <b>(c)</b>, both ✗ <b>(d)</b>.</li>
        <li><b>φ</b> = (ad − bc) / √((a+b)(c+d)(a+c)(b+d)) — Pearson correlation of the two success vectors. <b>+1</b> = identical wins/losses, <b>0</b> = independent, <b>negative</b> = anti-correlated.</li>
        <li><b>McNemar</b> (exact, two-sided) on the discordant counts <code>b</code> vs <code>c</code> tests whether one policy is reliably better; <b>*</b> marks p&lt;0.05.</li>
      </ol>
      <div class="pw-method-caveat"><b>Caveats:</b> φ is bounded by differing success rates — two policies with very different rates can't reach +1 even when perfectly nested, so read it alongside the raw 2×2 on hover. Pooled across the visible tasks, so high-volume tasks (tape = 64 episodes vs 25) weigh more.</div>
    </div>
  </div>`;
}

function corrEdgeVs(eye, other) {
  let win = 0, reg = 0, n = 0;
  for (let i = 0; i < eye.length; i++) {
    const e = eye[i], o = other[i];
    if (e == null || o == null) continue;
    n++;
    if (e && !o) win++;
    else if (!e && o) reg++;
  }
  return { win, reg, n };
}

// Episodes where every policy in the group failed; how many of those the main
// policy still solved.
function corrGroupAllFailed(eye, groupVecs) {
  let allFailed = 0, eyeWon = 0;
  for (let i = 0; i < eye.length; i++) {
    if (eye[i] == null) continue;
    let groupAllFail = true;
    for (const g of groupVecs) {
      if (g[i] == null || g[i]) { groupAllFail = false; break; }
    }
    if (!groupAllFail) continue;
    allFailed++;
    if (eye[i]) eyeWon++;
  }
  return { allFailed, eyeWon };
}

function renderEdgeSection(corr, policies, pooled) {
  const roles = corr.roles || {};
  const main = policies.find((p) => roles[p] === "main");
  if (!main) return "";
  const eye = pooled[main];
  const groups = [
    { title: "Ablations", noun: "ablations", members: policies.filter((p) => roles[p] === "ablation"),
      note: "removing a component should only lose episodes — a regression flags a part that sometimes hurts" },
    { title: "Baselines", noun: "baselines", members: policies.filter((p) => roles[p] === "baseline"),
      note: "external methods — the headline win count" },
  ];
  const cards = groups.map((g) => {
    if (!g.members.length) return "";
    const rows = g.members.map((p) => {
      const e = corrEdgeVs(eye, pooled[p]);
      return `<div class="edge-row">
        <span class="edge-policy">${escapeHtml(p)}</span>
        <span class="edge-stat win">+${e.win} <small>${escapeHtml(main)}-only wins</small></span>
        <span class="edge-stat ${e.reg ? "loss" : "zero"}">−${e.reg} <small>regressions</small></span>
        <span class="edge-n">of ${e.n}</span>
      </div>`;
    }).join("");
    const gf = corrGroupAllFailed(eye, g.members.map((p) => pooled[p]));
    const headline = gf.allFailed > 0
      ? `Of <b>${gf.allFailed}</b> episodes where all ${escapeHtml(g.noun)} failed, ${escapeHtml(main)} solved <b>${gf.eyeWon}</b> <span class="dim">(${(100 * gf.eyeWon / gf.allFailed).toFixed(0)}%)</span>`
      : `No episodes where all ${escapeHtml(g.noun)} jointly failed.`;
    return `<div class="edge-card">
      <div class="edge-head"><h3>${escapeHtml(main)} vs ${escapeHtml(g.title)}</h3><span class="edge-note">${escapeHtml(g.note)}</span></div>
      <div class="edge-headline">${headline}</div>
      <div class="edge-rows">${rows}</div>
    </div>`;
  }).join("");
  return cards ? `<div class="corr-edge">${cards}</div>` : "";
}

function renderTaskMatrixCard(corr, task, policies) {
  const roles = corr.roles || {};
  const td = corr.data[task];
  if (!td) return "";
  const eps = td.episodes;
  const n = eps.length;
  // Column order = episode difficulty: fewest successes (hardest) first.
  const order = eps.map((ep, i) => {
    let s = 0;
    for (const p of policies) { const arr = td.success[p]; if (arr && arr[i]) s++; }
    return { i, ep, s };
  }).sort((x, y) => x.s - y.s || x.i - y.i);

  const items = [];
  let lastRole = null;
  for (const p of policies) {
    const role = roles[p] || "other";
    if (lastRole !== null && role !== lastRole) items.push('<div class="corr-divider"></div>');
    lastRole = role;
    const arr = td.success[p] || [];
    let succ = 0, present = 0;
    const cells = order.map((o) => {
      const epLabel = o.ep.replace(/^episode_/, "Ep. ");
      const v = arr[o.i];
      if (v == null) {
        return `<span class="corr-cell na" data-tip="${escapeHtml(`${p}\n${epLabel} · not run`)}"></span>`;
      }
      present++; if (v) succ++;
      const tip = `${p}\n${epLabel} · ${v ? "✓ success" : "✗ fail"}\nsolved by ${o.s}/${policies.length} policies · click to watch`;
      return `<a class="corr-cell ${v ? "ok" : "fail"}" href="#/video/${enc(p)}/${enc(task)}/${enc(o.ep)}" data-tip="${escapeHtml(tip)}"></a>`;
    }).join("");
    const badge = role === "main" ? '<span class="corr-main-badge"></span>' : "";
    items.push(`<span class="corr-rowlabel ${role}">${escapeHtml(p)}${badge}</span>`);
    items.push(`<div class="corr-cells" style="grid-template-columns:repeat(${n},1fr)">${cells}</div>`);
    items.push(`<span class="corr-rate">${succ}/${present}</span>`);
  }

  const wide = n > 40 ? " wide" : "";
  return `<div class="chart-card corr-card${wide}">
    <h3><span class="task-name">${escapeHtml(task)}</span><span class="trials">${n} eps</span></h3>
    <div class="corr-axis"><span>← harder</span><span>easier →</span></div>
    <div class="corr-grid">${items.join("")}</div>
  </div>`;
}

// ---------- Pair detail (one policy pair, broken down per task) ----------
function pairVerdict(s) {
  const sig = s.p != null && s.p < 0.05;
  const better = s.b > s.c ? "rp" : (s.c > s.b ? "cp" : null);
  return { sig, better };
}

function renderPair2x2(A, B, s) {
  const cell = (v, k) => `<td class="pair2-${k}">${v}</td>`;
  return `<table class="pair-2x2">
    <tr><th></th><th>${escapeHtml(B)} ✓</th><th>${escapeHtml(B)} ✗</th></tr>
    <tr><th>${escapeHtml(A)} ✓</th>${cell(s.a, "win")}${cell(s.b, "split")}</tr>
    <tr><th>${escapeHtml(A)} ✗</th>${cell(s.c, "split")}${cell(s.d, "lose")}</tr>
  </table>`;
}

const pairP = (p) => p == null ? "–" : (p < 0.001 ? "<0.001" : p.toFixed(p < 0.1 ? 3 : 2));

async function renderPairDetail(A, B) {
  setBreadcrumb([
    { label: "Home", href: "#/" },
    { label: "Correlation", href: "#/correlation" },
    { label: `${A} × ${B}` },
  ]);
  appEl.innerHTML = '<p class="loading">Loading…</p>';
  let corr;
  try {
    corr = await fetchJSON("/api/correlation");
  } catch (e) {
    showError("Failed to load correlation", escapeHtml(e.message));
    return;
  }
  if (!corr.policies.includes(A) || !corr.policies.includes(B)) {
    showError("Unknown policy pair", escapeHtml(`${A} × ${B}`));
    return;
  }
  const visibleTasks = corr.tasks.filter((t) => !HIDDEN_TASKS.has(t) && corr.data[t]);
  const pooled = corrPooledVectors(corr, visibleTasks);
  const P = corrPairStats(pooled[A], pooled[B]);
  const pv = pairVerdict(P);
  const betterPolicy = pv.better === "rp" ? A : pv.better === "cp" ? B : null;

  const perTask = visibleTasks.map((t) => {
    const td = corr.data[t];
    const va = td.success[A] || [], vb = td.success[B] || [];
    const s = corrPairStats(va, vb);
    const bothWin = [], aOnly = [], bOnly = [], bothFail = [];
    let aSucc = 0, bSucc = 0;
    td.episodes.forEach((ep, i) => {
      const x = va[i], y = vb[i];
      if (x) aSucc++;
      if (y) bSucc++;
      if (x == null || y == null) return;
      if (x && y) bothWin.push(ep);
      else if (x && !y) aOnly.push(ep);
      else if (!x && y) bOnly.push(ep);
      else bothFail.push(ep);
    });
    return { task: t, s, bothWin, aOnly, bOnly, bothFail, aSucc, bSucc, n: td.episodes.length };
  });

  const out = [];
  out.push(`<div class="pair-header">
    <h2>${escapeHtml(A)}<span class="x">×</span><span class="accent">${escapeHtml(B)}</span></h2>
    <div class="pair-head-stats">pooled φ <b>${P.phi == null ? "–" : P.phi.toFixed(2)}</b> &middot; McNemar p=${pairP(P.p)}${pv.sig ? " *" : ""} &middot; ${pv.sig && betterPolicy ? `<b>${escapeHtml(betterPolicy)}</b> reliably better` : "no reliable difference"} &middot; n=${P.n}</div>
  </div>`);
  out.push(`<div class="pair-pooled">${renderPair2x2(A, B, P)}<div class="pair-pooled-note">green = agree (both pass / both fail) &middot; off-diagonal = where they diverge</div></div>`);

  out.push('<table class="pair-table"><thead><tr>');
  out.push(`<th>task</th><th>${escapeHtml(A)}</th><th>${escapeHtml(B)}</th><th>both ✓</th><th>${escapeHtml(A)} only</th><th>${escapeHtml(B)} only</th><th>both ✗</th><th>φ</th><th>McNemar</th></tr></thead><tbody>`);
  for (const r of perTask) {
    const rs = r.s, rsig = rs.p != null && rs.p < 0.05;
    out.push(`<tr>
      <td class="pair-task"><a href="#/episodes/${enc(A)}/${enc(r.task)}">${escapeHtml(r.task)}</a></td>
      <td>${r.aSucc}/${r.n}</td>
      <td>${r.bSucc}/${r.n}</td>
      <td class="pair-agree">${rs.a}</td>
      <td>${rs.b}</td>
      <td>${rs.c}</td>
      <td class="pair-agree">${rs.d}</td>
      <td class="pair-phi" style="background:${corrPhiBg(rs.phi)}">${rs.phi == null ? "–" : rs.phi.toFixed(2)}</td>
      <td class="${rsig ? "pair-sig" : "pair-dim"}">${pairP(rs.p)}${rsig ? " *" : ""}</td>
    </tr>`);
  }
  out.push('</tbody></table>');

  const qchip = (policy, task, ep) => {
    const num = ep.replace(/^episode_/, "");
    const tip = `${task} · ${ep.replace(/^episode_/, "Ep. ")}\nopen ${policy}'s run`;
    return `<a class="ptm-chip" href="#/video/${enc(policy)}/${enc(task)}/${enc(ep)}" data-tip="${escapeHtml(tip)}">${escapeHtml(num)}</a>`;
  };
  const qcell = (eps, kind, label, policy, task) =>
    `<div class="ptm-cell ${kind}">
      <div class="ptm-cell-head">${label} <span class="ptm-cnt">${eps.length}</span></div>
      <div class="ptm-chips">${eps.length ? eps.map((ep) => qchip(policy, task, ep)).join("") : '<span class="ptm-empty">—</span>'}</div>
    </div>`;
  out.push(`<h3 class="pair-subhead">Per-task episode breakdown <span class="dim">— every episode placed in the 2×2; click one to watch (the compare strip flips between the two)</span></h3>`);
  out.push('<div class="ptm-wrap">');
  for (const r of perTask) {
    const rs = r.s, rsig = rs.p != null && rs.p < 0.05;
    const stat = `φ=${rs.phi == null ? "–" : rs.phi.toFixed(2)} &middot; McNemar p=${pairP(rs.p)}${rsig ? " *" : ""} &middot; ${escapeHtml(A)} ${r.aSucc}/${r.n}, ${escapeHtml(B)} ${r.bSucc}/${r.n}`;
    out.push(`<div class="ptm-task">
      <div class="ptm-head"><span class="ptm-name">${escapeHtml(r.task)}</span><span class="ptm-stat">${stat}</span></div>
      <div class="ptm-grid">
        <div class="ptm-corner"></div>
        <div class="ptm-colh">${escapeHtml(B)} ✓</div>
        <div class="ptm-colh">${escapeHtml(B)} ✗</div>
        <div class="ptm-rowh">${escapeHtml(A)} ✓</div>
        ${qcell(r.bothWin, "win", "both ✓", A, r.task)}
        ${qcell(r.aOnly, "gold", `${escapeHtml(A)} only`, A, r.task)}
        <div class="ptm-rowh">${escapeHtml(A)} ✗</div>
        ${qcell(r.bOnly, "blue", `${escapeHtml(B)} only`, B, r.task)}
        ${qcell(r.bothFail, "lose", "both ✗", A, r.task)}
      </div>
    </div>`);
  }
  out.push('</div>');

  appEl.innerHTML = out.join("");
}

async function renderCorrelation() {
  setBreadcrumb([{ label: "Home", href: "#/" }, { label: "Correlation" }]);
  appEl.innerHTML = '<p class="loading">Loading…</p>';
  let corr;
  try {
    corr = await fetchJSON("/api/correlation");
  } catch (e) {
    showError("Failed to load correlation", escapeHtml(e.message));
    return;
  }

  const visibleTasks = corr.tasks.filter((t) => !HIDDEN_TASKS.has(t) && corr.data[t]);
  const policies = corrOrderedPolicies(corr);
  const pooled = corrPooledVectors(corr, visibleTasks);
  const pooledN = policies.length ? (pooled[policies[0]] || []).length : 0;

  const parts = [];
  parts.push(`<div class="home-intro">
    <h1 class="home-title">Correlation</h1>
    <div class="home-intro-right">
      <div class="page-links">
        <a class="page-link" href="#/">← Results</a>
        <a class="page-link" href="#/throughput">Throughput →</a>
      </div>
      <div class="home-sub">${policies.length} policies &middot; ${visibleTasks.length} tasks &middot; ${pooledN} paired episodes &middot; same start configs across policies</div>
    </div>
  </div>`);

  if (!visibleTasks.length) {
    parts.push('<div class="error-box"><h2>No correlation data</h2><p>No tasks with eval CSVs were found in checkpoints.txt.</p></div>');
    appEl.innerHTML = parts.join("");
    return;
  }

  parts.push(renderRoleLegend(corr, policies));
  parts.push(renderEpisodeAgreement(corr, policies, visibleTasks));
  parts.push(renderAgreementMatrix(policies, pooled));
  parts.push(renderEdgeSection(corr, policies, pooled));
  parts.push('<h2 class="corr-subhead">Per-task success matrix</h2>');
  parts.push('<p class="corr-subnote">Each column is one episode (same start config across policies), sorted hardest → easiest. Green = success, red = fail. Click any cell to watch that run.</p>');
  parts.push('<div class="charts-grid">');
  for (const task of visibleTasks) parts.push(renderTaskMatrixCard(corr, task, policies));
  parts.push('</div>');

  appEl.innerHTML = parts.join("");
}

// Instant tooltip for the correlation grids (native title= is laggy / easy to
// miss). Delegated off any element carrying data-tip; attached once.
const corrTip = document.createElement("div");
corrTip.className = "corr-tip";
document.body.appendChild(corrTip);
const CORR_TIP_SEL = "[data-tip],[data-tip2x2]";
function corrTipPlace(e) {
  const pad = 14;
  const r = corrTip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > window.innerWidth) x = e.clientX - pad - r.width;
  if (y + r.height > window.innerHeight) y = e.clientY - pad - r.height;
  corrTip.style.left = `${Math.max(4, x)}px`;
  corrTip.style.top = `${Math.max(4, y)}px`;
}
// Agreement cells render the paired 2×2 as an actual matrix; everything else
// (success cells, episode chips) is plain text with line breaks.
function corrTipHtml(el) {
  const d = el.dataset;
  if (d.tip2x2) {
    const cell = (v, k) => `<td class="t2-${k}">${v}</td>`;
    const verdict = d.sig === "1" && d.better
      ? `<div class="t2-verdict"><b>${escapeHtml(d.better)}</b> reliably better · McNemar p=${d.p}</div>`
      : `<div class="t2-verdict dim">no reliable difference · McNemar p=${d.p}</div>`;
    return `<div class="t2-title">${escapeHtml(d.rp)} <span class="dim">vs</span> ${escapeHtml(d.cp)} · φ=${d.phi}</div>`
      + `<table class="t2-grid">`
      + `<tr><th></th><th>${escapeHtml(d.cp)} ✓</th><th>${escapeHtml(d.cp)} ✗</th></tr>`
      + `<tr><th>${escapeHtml(d.rp)} ✓</th>${cell(d.a, "win")}${cell(d.b, "split")}</tr>`
      + `<tr><th>${escapeHtml(d.rp)} ✗</th>${cell(d.c, "split")}${cell(d.d, "lose")}</tr>`
      + `</table>${verdict}`;
  }
  return `<div class="t2-text">${escapeHtml(d.tip || "")}</div>`;
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest && e.target.closest(CORR_TIP_SEL);
  if (!el) return;
  corrTip.innerHTML = corrTipHtml(el);
  corrTip.style.display = "block";
  corrTipPlace(e);
});
document.addEventListener("mousemove", (e) => {
  if (corrTip.style.display !== "block") return;
  if (e.target.closest && e.target.closest(CORR_TIP_SEL)) corrTipPlace(e);
  else corrTip.style.display = "none";
});
// Click an agreement-matrix cell -> per-pair, per-task detail page.
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip2x2]");
  if (!el || !el.dataset.rp || !el.dataset.cp) return;
  corrTip.style.display = "none";
  location.hash = `#/pair/${enc(el.dataset.rp)}/${enc(el.dataset.cp)}`;
});

window.addEventListener("resize", () => {
  for (const c of tpCharts) { try { c.resize(); } catch (_) {} }
});
