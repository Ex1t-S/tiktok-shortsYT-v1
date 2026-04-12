import { elements, setActiveView, setStatus, state } from "./dom.js";
import {
  escapeHtml,
  formatDate,
  postJson,
  summarizeTrackingRun,
  translateStatus,
  translateWorkerHealth,
  translateWorkerType
} from "./utils.js";

let actions = {
  loadDashboard: async () => {},
  loadProfile: async () => {},
  loadPublicationJobs: async () => {},
  loadPublications: async () => {}
};

export function setOverviewActions(nextActions) {
  actions = { ...actions, ...nextActions };
}

export function renderDashboardSummary(summary) {
  const cards = [
    ["Perfiles rastreados", summary.tracked_profiles || 0],
    ["Items en catalogo", summary.media_items || 0],
    ["Videos en biblioteca", summary.library_videos || 0],
    ["Candidatos", summary.candidate_items || 0],
    ["Publicaciones en cola", summary.queued_publications || 0],
    ["Programadas", summary.scheduled_publications || 0],
    ["Canales YouTube", summary.youtube_accounts || 0]
  ];

  elements.summaryStrip.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="summary-chip">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");

  const healthCards = [
    ["Scrapes OK", summary.successful_scrapes || 0],
    ["Scrapes fallidos", summary.failed_scrapes || 0],
    ["Aprobados", summary.approved_candidates || 0],
    ["Corridas 24h", summary.recent_scrape_runs || 0]
  ];

  elements.heroHealthStrip.innerHTML = healthCards
    .map(
      ([label, value]) => `
        <article class="health-pill">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");

  const recentProfiles = Array.isArray(summary.recent_profiles) ? summary.recent_profiles : [];
  renderRecentProfiles(recentProfiles);
  renderRecentPublications(Array.isArray(summary.recent_publications) ? summary.recent_publications : []);
  renderRecentErrors(recentProfiles);

  const failedScrapes = Number(summary.failed_scrapes || 0);
  if (failedScrapes > 0) {
    elements.dashboardAlert.classList.remove("hidden");
    elements.dashboardAlert.innerHTML = `<strong>Atencion:</strong> ${failedScrapes} perfil${
      failedScrapes === 1 ? "" : "es"
    } termino con error de scraping. Revisa la lista reciente para ver el detalle.`;
  } else {
    elements.dashboardAlert.classList.add("hidden");
    elements.dashboardAlert.innerHTML = "";
  }
}

function renderRecentProfiles(recentProfiles) {
  if (recentProfiles.length === 0) {
    elements.recentProfilesList.innerHTML = '<p class="empty-state">Todavia no hay perfiles rastreados.</p>';
    return;
  }

  elements.recentProfilesList.innerHTML = recentProfiles
    .map(
      (profile) => `
        <article class="stack-card recent-profile-card">
          <div>
            <strong>${escapeHtml(profile.display_name || `@${profile.username}`)}</strong>
            <p>@${escapeHtml(profile.username)} | ${profile.total_media_count || 0} items</p>
          </div>
          <div class="inline-meta">
            <span class="badge ${
              profile.last_scrape_status === "failed"
                ? "danger"
                : profile.last_scrape_status === "success"
                  ? "success"
                  : ""
            }">${escapeHtml(translateStatus(profile.last_scrape_status || "idle"))}</span>
            <span>${formatDate(profile.last_scraped_at)}</span>
            <button type="button" class="ghost-button recent-profile-open" data-username="${escapeHtml(
              profile.username
            )}">Abrir</button>
          </div>
          ${profile.last_scrape_error ? `<p class="recent-error">${escapeHtml(profile.last_scrape_error)}</p>` : ""}
        </article>
      `
    )
    .join("");

  elements.recentProfilesList.querySelectorAll(".recent-profile-open").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = button.dataset.username;
      elements.username.value = username.startsWith("tag-") ? `#${username.replace(/^tag-/, "")}` : `@${username}`;
      state.currentTrackQuery = elements.username.value;
      state.currentUsername = username;
      setActiveView("tracking");
      setStatus(`Abriendo ${elements.username.value} desde el panel...`);

      try {
        await actions.loadProfile(username);
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
}

function renderRecentPublications(items) {
  if (items.length === 0) {
    elements.recentPublicationsList.innerHTML = '<p class="empty-state">Todavia no hay publicaciones.</p>';
    return;
  }

  elements.recentPublicationsList.innerHTML = items
    .map(
      (item) => `
        <article class="stack-card">
          <div>
            <strong>${escapeHtml(item.title || "Publicacion sin titulo")}</strong>
            <p>@${escapeHtml(item.username)} | ${formatDate(item.created_at)}</p>
          </div>
          <div class="inline-meta">
            <span class="badge ${
              item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""
            }">${escapeHtml(translateStatus(item.status))}</span>
            <span>#${item.id}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRecentErrors(recentProfiles) {
  const recentErrors = recentProfiles.filter((profile) => profile.last_scrape_status === "failed");

  if (recentErrors.length === 0) {
    elements.recentErrorsList.innerHTML = '<p class="empty-state">No hubo fallos recientes de scraping.</p>';
    return;
  }

  elements.recentErrorsList.innerHTML = recentErrors
    .map(
      (profile) => `
        <article class="stack-card error-card">
          <div class="inline-meta">
            <strong>@${escapeHtml(profile.username)}</strong>
            <span class="badge danger">fallo</span>
            <span>${formatDate(profile.last_scraped_at)}</span>
          </div>
          <p class="recent-error">${escapeHtml(profile.last_scrape_error || "Error de scraping desconocido.")}</p>
        </article>
      `
    )
    .join("");
}

export function renderPublicationJobs(payload) {
  const summaryItems = Array.isArray(payload?.summary) ? payload.summary : [];
  const jobItems = Array.isArray(payload?.items) ? payload.items : [];
  state.currentJobs = jobItems;

  if (summaryItems.length === 0) {
    elements.jobsSummaryStrip.innerHTML = '<p class="empty-state">Todavia no hay jobs de publicacion.</p>';
  } else {
    elements.jobsSummaryStrip.innerHTML = summaryItems
      .map(
        (item) => `
          <article class="summary-chip">
            <span>${translateStatus(item.status)}</span>
            <strong>${item.count}</strong>
          </article>
        `
      )
      .join("");
  }

  if (jobItems.length === 0) {
    elements.jobsList.innerHTML = '<p class="empty-state">No hay jobs para mostrar.</p>';
    return;
  }

  elements.jobsList.innerHTML = jobItems
    .map(
      (job) => `
        <article class="stack-card">
          <div>
            <strong>${escapeHtml(job.publication_title || "Publicacion sin titulo")}</strong>
            <p>Canal: ${escapeHtml(job.channel_title)} | Publicacion #${job.publication_id}</p>
          </div>
          <div class="inline-meta">
            <span class="badge ${job.status === "completed" ? "success" : job.status === "failed" ? "danger" : ""}">${translateStatus(job.status)}</span>
            <span>Intentos: ${job.attempts}/${job.max_attempts}</span>
            <span>${job.available_at ? `Disponible: ${formatDate(job.available_at)}` : ""}</span>
          </div>
          ${job.last_error ? `<p class="recent-error">${escapeHtml(job.last_error)}</p>` : ""}
          <div class="account-actions">
            ${
              job.status === "failed"
                ? `<button type="button" class="ghost-button publication-job-retry" data-id="${job.id}">Reintentar job</button>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");

  elements.jobsList.querySelectorAll(".publication-job-retry").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus(`Reencolando job ${button.dataset.id}...`);

      try {
        await postJson(`/api/jobs/publications/${button.dataset.id}/retry`, {});
        await Promise.all([actions.loadPublicationJobs(), actions.loadPublications(), actions.loadDashboard()]);
        setStatus(`El job ${button.dataset.id} volvio a la cola.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

export function renderWorkers(payload) {
  const summaryItems = Array.isArray(payload?.summary) ? payload.summary : [];
  const workerItems = Array.isArray(payload?.items) ? payload.items : [];
  state.currentWorkers = workerItems;

  if (summaryItems.length === 0) {
    elements.workersSummaryStrip.innerHTML = '<p class="empty-state">Todavia no hay workers registrados.</p>';
  } else {
    elements.workersSummaryStrip.innerHTML = summaryItems
      .map(
        (item) => `
          <article class="summary-chip">
            <span>${translateWorkerType(item.worker_type)}</span>
            <strong>${item.online}/${item.total}</strong>
          </article>
        `
      )
      .join("");
  }

  if (workerItems.length === 0) {
    elements.workersList.innerHTML = '<p class="empty-state">No hay heartbeats para mostrar.</p>';
    return;
  }

  elements.workersList.innerHTML = workerItems
    .map(
      (worker) => `
        <article class="stack-card">
          <div>
            <strong>${escapeHtml(translateWorkerType(worker.worker_type))}</strong>
            <p>${escapeHtml(worker.worker_id)} | PID ${escapeHtml(worker.pid || "-")}</p>
          </div>
          <div class="inline-meta">
            <span class="badge ${
              worker.health === "online" ? "success" : worker.health === "stale" ? "danger" : ""
            }">${escapeHtml(translateWorkerHealth(worker.health))}</span>
            <span>${escapeHtml(translateStatus(worker.status))}</span>
            <span>Heartbeat: ${formatDate(worker.last_heartbeat_at)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

export function renderSummary(profile, scrape = null) {
  elements.summaryCard.classList.remove("hidden");
  elements.avatar.src = profile.avatar_url || "";
  elements.avatar.style.visibility = profile.avatar_url ? "visible" : "hidden";
  elements.trackedKind.textContent = profile.username?.startsWith("tag-") ? "Hashtag rastreado" : "Perfil rastreado";
  elements.displayName.textContent = profile.display_name || `@${profile.username}`;
  elements.profileLink.textContent = profile.profile_url;
  elements.profileLink.href = profile.profile_url;
  elements.totalMedia.textContent = profile.total_media_count;
  elements.videoCount.textContent = profile.video_count;
  elements.imageCount.textContent = profile.image_count;
  elements.lastScrape.textContent = formatDate(profile.last_scraped_at);
  elements.zipButton.href = `/api/profiles/${encodeURIComponent(profile.username)}/download.zip`;

  const scrapeStatus = scrape?.status || profile.last_scrape_status || "idle";
  const scrapeMessage = scrape?.progress_message || profile.last_scrape_error || "";
  const scrapeMeta = summarizeTrackingRun(scrape);

  if (scrapeStatus === "success" && !profile.last_scrape_error) {
    elements.scrapeStatusBox.className = "scrape-status-box hidden";
    elements.scrapeStatusBox.innerHTML = "";
    return;
  }

  elements.scrapeStatusBox.className = `scrape-status-box${scrapeStatus === "failed" ? " is-error" : ""}`;
  elements.scrapeStatusBox.innerHTML = `
    <strong>Ultimo scrape: ${escapeHtml(translateStatus(scrapeStatus))}</strong>
    <p>${escapeHtml(scrapeMessage || "La ultima corrida termino sin mensaje de error.")}</p>
    ${scrapeMeta ? `<p>${escapeHtml(scrapeMeta)}</p>` : ""}
  `;
}

export function renderTrackingBox(profile, scrape = null) {
  if (!profile) {
    elements.scrapeStatusBox.className = "scrape-status-box hidden";
    elements.scrapeStatusBox.innerHTML = "";
    return;
  }

  const scrapeStatus = scrape?.status || profile.last_scrape_status || "idle";
  const scrapeMessage = scrape?.progress_message || profile.last_scrape_error || "";
  const scrapeMeta = summarizeTrackingRun(scrape);

  if (scrapeStatus === "success" && !scrapeMessage) {
    elements.scrapeStatusBox.className = "scrape-status-box hidden";
    elements.scrapeStatusBox.innerHTML = "";
    return;
  }

  elements.scrapeStatusBox.className = `scrape-status-box${scrapeStatus === "failed" ? " is-error" : ""}`;
  elements.scrapeStatusBox.innerHTML = `
    <strong>Tracking: ${escapeHtml(translateStatus(scrapeStatus))}</strong>
    <p>${escapeHtml(scrapeMessage || "Sin detalle adicional.")}</p>
    ${scrapeMeta ? `<p>${escapeHtml(scrapeMeta)}</p>` : ""}
  `;
}
