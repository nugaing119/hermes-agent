const state = {
  filter: "all",
  candidates: [],
  maintenance: [],
  overrides: [],
  selected: null,
  selectedType: null,
};

const els = {
  flash: document.getElementById("flash"),
  refreshBtn: document.getElementById("refresh-btn"),
  safeBatchBtn: document.getElementById("safe-batch-btn"),
  candidateList: document.getElementById("candidate-list"),
  candidateEmpty: document.getElementById("candidate-empty"),
  maintenanceList: document.getElementById("maintenance-list"),
  maintenanceEmpty: document.getElementById("maintenance-empty"),
  maintenanceSummary: document.getElementById("maintenance-summary"),
  overrideList: document.getElementById("override-list"),
  overrideEmpty: document.getElementById("override-empty"),
  detailPlaceholder: document.getElementById("detail-placeholder"),
  detailCard: document.getElementById("detail-card"),
  detailStatus: document.getElementById("detail-status"),
  detailKicker: document.getElementById("detail-kicker"),
  detailTitle: document.getElementById("detail-title"),
  detailBadges: document.getElementById("detail-badges"),
  detailMeta: document.getElementById("detail-meta"),
  detailBody: document.getElementById("detail-body"),
  detailOutput: document.getElementById("detail-output"),
  detailContext: document.getElementById("detail-context"),
  actionNote: document.getElementById("action-note"),
  detailPrimary: document.getElementById("detail-primary"),
  detailSecondary: document.getElementById("detail-secondary"),
  detailTertiary: document.getElementById("detail-tertiary"),
  countAll: document.getElementById("count-all"),
  countReady: document.getElementById("count-ready"),
  countNeedsReview: document.getElementById("count-needs-review"),
  countBlocked: document.getElementById("count-blocked"),
};

function setFlash(message, kind = "info") {
  els.flash.textContent = message;
  els.flash.dataset.kind = kind;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function chip(label, kind = "") {
  return `<span class="chip ${kind}">${escapeHtml(label)}</span>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.stderr || payload.error || "Request failed");
  }
  return payload;
}

function renderCandidate(item) {
  const approveMode = item.approve_mode || "";
  const approveLabel = approveMode ? approveMode.replace("approve_", "Approve ") : "Approve";
  return `
    <article class="card">
      <header>
        <div>
          <h3>${escapeHtml(item.proposed_title || item.candidate_id)}</h3>
          <p class="sub">${escapeHtml(item.candidate_id)}</p>
        </div>
        <div class="chip-row">
          ${chip(item.promotion_readiness || "unassessed", item.promotion_readiness || "")}
          ${chip(item.proposal_kind || "unknown")}
        </div>
      </header>
      <p class="body">${escapeHtml(item.summary || "")}</p>
      <div class="chip-row meta-row">
        ${chip(item.source_basis || "source:?")}
        ${item.proposed_cluster ? chip(item.proposed_cluster) : ""}
      </div>
      <div class="actions">
        <button class="secondary js-candidate-review" data-id="${escapeHtml(item.candidate_id)}">Inspect</button>
        <button class="primary js-candidate-approve" data-id="${escapeHtml(item.candidate_id)}" ${approveMode ? "" : "disabled"}>${escapeHtml(approveLabel)}</button>
      </div>
    </article>
  `;
}

function renderMaintenance(item) {
  return `
    <article class="card">
      <header>
        <div>
          <h3>${escapeHtml(item.summary || item.maintenance_id)}</h3>
          <p class="sub">${escapeHtml(item.maintenance_id)}</p>
        </div>
        <div class="chip-row">
          ${chip(item.status || "unknown", item.status === "open" ? "needs_review" : item.status === "rolled_back" ? "blocked" : "ready")}
          ${chip(item.kind || "unknown")}
        </div>
      </header>
      <div class="actions">
        <button class="secondary js-maint-review" data-id="${escapeHtml(item.maintenance_id)}">Inspect</button>
        <button class="primary js-maint-apply" data-id="${escapeHtml(item.maintenance_id)}">Apply</button>
        <button class="danger js-maint-rollback" data-id="${escapeHtml(item.maintenance_id)}">Rollback</button>
      </div>
    </article>
  `;
}

function renderOverride(item) {
  return `
    <article class="card compact">
      <div class="chip-row">
        ${chip(item.event_type || "trace", item.event_type === "rollback" ? "blocked" : item.event_type === "override" ? "needs_review" : "ready")}
        ${chip(item.created_at || "")}
      </div>
      <p class="sub mono">${escapeHtml(item.target || "")}</p>
      <p class="body">${escapeHtml(item.reason || "")}</p>
    </article>
  `;
}

function renderLists() {
  const candidates = state.candidates.filter((item) => state.filter === "all" || item.promotion_readiness === state.filter);
  els.candidateList.innerHTML = candidates.map(renderCandidate).join("");
  els.candidateEmpty.classList.toggle("hidden", candidates.length > 0);

  els.maintenanceList.innerHTML = state.maintenance.map(renderMaintenance).join("");
  els.maintenanceEmpty.classList.toggle("hidden", state.maintenance.length > 0);

  els.overrideList.innerHTML = state.overrides.map(renderOverride).join("");
  els.overrideEmpty.classList.toggle("hidden", state.overrides.length > 0);
}

function renderSummary(summary) {
  els.countAll.textContent = summary.all ?? 0;
  els.countReady.textContent = summary.ready ?? 0;
  els.countNeedsReview.textContent = summary.needs_review ?? 0;
  els.countBlocked.textContent = summary.blocked ?? 0;
}

function renderMaintenanceSummary(summary) {
  els.maintenanceSummary.innerHTML = [
    chip(`open ${summary.open ?? 0}`, "needs_review"),
    chip(`applied ${summary.applied ?? 0}`, "ready"),
    chip(`rolled back ${summary.rolled_back ?? 0}`, "blocked"),
  ].join("");
}

function showDetail() {
  els.detailPlaceholder.classList.add("hidden");
  els.detailCard.classList.remove("hidden");
}

function renderMeta(entries) {
  els.detailMeta.innerHTML = entries
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? "null")}</dd></div>`)
    .join("");
}

function setDetailActions(primaryLabel, primaryHandler, secondaryLabel, secondaryHandler, tertiaryLabel = "", tertiaryHandler = null) {
  els.detailPrimary.textContent = primaryLabel;
  els.detailSecondary.textContent = secondaryLabel;
  els.detailTertiary.textContent = tertiaryLabel;
  els.detailTertiary.classList.toggle("hidden", !tertiaryHandler);
  els.detailPrimary.onclick = primaryHandler;
  els.detailSecondary.onclick = secondaryHandler;
  els.detailTertiary.onclick = tertiaryHandler;
}

async function loadAll() {
  setFlash("Loading...");
  const [summary, candidates, maintenance, overrides] = await Promise.all([
    api("/api/review/summary"),
    api(`/api/review/candidates?filter=${encodeURIComponent(state.filter)}`),
    api("/api/review/maintenance?status=all"),
    api("/api/review/overrides?limit=5"),
  ]);
  renderSummary(summary.candidates);
  renderMaintenanceSummary(summary.maintenance);
  state.candidates = candidates.items || [];
  state.maintenance = maintenance.items || [];
  state.overrides = overrides.items || [];
  renderLists();
  setFlash("Loaded", "success");
}

async function inspectCandidate(candidateId) {
  const payload = await api(`/api/review/candidates/${encodeURIComponent(candidateId)}/context`);
  const item = payload.item;
  showDetail();
  state.selected = item;
  state.selectedType = "candidate";
  els.detailStatus.innerHTML = chip(item.promotion_readiness || "unassessed", item.promotion_readiness || "");
  els.detailKicker.textContent = item.candidate_id;
  els.detailTitle.textContent = item.proposed_title || item.candidate_id;
  els.detailBadges.innerHTML = `${chip(item.status || "pending")} ${chip(item.proposal_kind || "unknown")}`;
  renderMeta([
    ["candidate_id", item.candidate_id],
    ["proposal_kind", item.proposal_kind],
    ["source_basis", item.source_basis],
    ["cluster", item.proposed_cluster],
    ["readiness", item.promotion_readiness],
    ["approve_mode", item.approve_mode || "blocked"],
  ]);
  els.detailBody.textContent = item.body || "";
  els.detailOutput.textContent = payload.context.show_output || "";
  els.detailContext.textContent = payload.context.preflight_output || "";
  const approveAction = item.approve_mode;
  setDetailActions(
    approveAction ? approveAction.replace("approve_", "Approve ") : "Approve",
    async () => {
      if (!approveAction) return;
      const note = els.actionNote.value.trim();
      await api("/api/review/actions/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: approveAction, target_id: item.candidate_id, note }) });
      await loadAll();
      await inspectCandidate(item.candidate_id);
    },
    "Reject",
    async () => {
      const note = window.prompt("Reject note:", els.actionNote.value.trim());
      if (note === null) return;
      await api("/api/review/actions/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject", target_id: item.candidate_id, note }) });
      await loadAll();
    },
    "Revise",
    async () => {
      const note = window.prompt("Revise note:", els.actionNote.value.trim());
      if (note === null) return;
      await api("/api/review/actions/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revise", target_id: item.candidate_id, note }) });
      await loadAll();
    }
  );
}

async function inspectMaintenance(maintenanceId) {
  const payload = await api(`/api/review/maintenance/${encodeURIComponent(maintenanceId)}/context`);
  const item = payload.item;
  showDetail();
  state.selected = item;
  state.selectedType = "maintenance";
  els.detailStatus.innerHTML = chip(item.status || "unknown", item.status === "open" ? "needs_review" : item.status === "rolled_back" ? "blocked" : "ready");
  els.detailKicker.textContent = item.maintenance_id;
  els.detailTitle.textContent = item.summary || item.maintenance_id;
  els.detailBadges.innerHTML = `${chip(item.status || "unknown")} ${chip(item.kind || "unknown")}`;
  renderMeta([
    ["maintenance_id", item.maintenance_id],
    ["kind", item.kind],
    ["status", item.status],
    ["run_id", item.run_id],
    ["target_notes", Array.isArray(item.target_notes) ? item.target_notes.join(", ") : ""],
  ]);
  els.detailBody.textContent = item.body || "";
  els.detailOutput.textContent = payload.context.show_output || "";
  els.detailContext.textContent = payload.context.trace_output || "";
  setDetailActions(
    "Apply",
    async () => {
      const note = window.prompt("Apply note:", els.actionNote.value.trim());
      if (note === null) return;
      await api("/api/review/actions/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply_maintenance", target_id: item.maintenance_id, note }) });
      await loadAll();
      await inspectMaintenance(item.maintenance_id);
    },
    "Rollback",
    async () => {
      const note = window.prompt("Rollback note:", els.actionNote.value.trim());
      if (note === null) return;
      await api("/api/review/actions/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rollback", target_id: item.maintenance_id, note }) });
      await loadAll();
      await inspectMaintenance(item.maintenance_id);
    }
  );
}

function bindEvents() {
  document.querySelectorAll(".pill").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".pill").forEach((b) => b.classList.toggle("active", b === button));
      state.filter = button.dataset.filter || "all";
      await loadAll();
    });
  });

  els.refreshBtn.addEventListener("click", loadAll);
  els.safeBatchBtn.addEventListener("click", async () => {
    if (!window.confirm("Approve safe batch?")) return;
    await api("/api/review/actions/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_safe_batch" }) });
    await loadAll();
  });

  els.candidateList.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;
    if (button.classList.contains("js-candidate-review")) {
      await inspectCandidate(id);
    } else if (button.classList.contains("js-candidate-approve")) {
      await inspectCandidate(id);
      els.detailPrimary.click();
    }
  });

  els.maintenanceList.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;
    if (button.classList.contains("js-maint-review")) {
      await inspectMaintenance(id);
    } else if (button.classList.contains("js-maint-apply")) {
      await inspectMaintenance(id);
      els.detailPrimary.click();
    } else if (button.classList.contains("js-maint-rollback")) {
      await inspectMaintenance(id);
      els.detailSecondary.click();
    }
  });
}

bindEvents();
loadAll().catch((err) => setFlash(err.message || String(err), "error"));
