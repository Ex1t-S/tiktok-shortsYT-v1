import {
  elements,
  setActiveView,
  setStatus,
  state,
  syncLibrarySelectionBar,
  syncTrackResultsControls,
  syncSelectionBar
} from "./dom.js";
import {
  escapeHtml,
  formatDate,
  formatDuration,
  formatMetric,
  pathFromArchive,
  postJson,
  translateSeedType,
  translateSourceKind,
  translateStatus,
  translateStatusDetail,
  translateStorageProvider
} from "./utils.js";

let actions = {
  loadAccounts: async () => {},
  loadCandidates: async () => {},
  loadDashboard: async () => {},
  loadLibrary: async () => {},
  loadPublications: async () => {},
  loadSeeds: async () => {}
};

export function setContentActions(nextActions) {
  actions = { ...actions, ...nextActions };
}

export function renderMedia(items) {
  state.currentItems = items;
  elements.mediaGrid.innerHTML = "";

  if (items.length === 0) {
    elements.mediaGrid.innerHTML = '<p class="empty-state">Todavia no hay videos rastreados.</p>';
    syncSelectionBar();
    syncTrackResultsControls();
    return;
  }

  for (const item of items) {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const thumb = node.querySelector(".media-thumb");
    const mediaType = node.querySelector(".media-type");
    const postLink = node.querySelector(".post-link");
    const caption = node.querySelector(".media-caption");
    const extra = node.querySelector(".media-extra");
    const downloadLink = node.querySelector(".download-link");
    const checkbox = node.querySelector(".media-select");

    thumb.src = item.thumbnail_url || "";
    thumb.alt = item.caption || item.external_id;
    mediaType.textContent = item.media_type;
    postLink.href = item.post_url;
    caption.textContent = item.caption || "Video sin titulo";
    extra.textContent = [
      formatDuration(item.duration_seconds),
      formatDate(item.published_at),
      `${formatMetric(item.view_count)} vistas`,
      `score ${Math.round(Number(item.score || 0))}`
    ]
      .filter(Boolean)
      .join(" | ");
    downloadLink.href = `/api/media/${item.id}/download`;
    checkbox.checked = state.selectedIds.has(String(item.id));

    checkbox.addEventListener("change", () => {
      const mediaId = String(item.id);
      if (checkbox.checked) {
        state.selectedIds.add(mediaId);
      } else {
        state.selectedIds.delete(mediaId);
      }

      syncSelectionBar();
    });

    elements.mediaGrid.appendChild(node);
  }

  syncSelectionBar();
  syncTrackResultsControls();
}

export function renderSeeds(seeds) {
  if (seeds.length === 0) {
    elements.seedList.innerHTML = '<p class="empty-state">Todavia no hay semillas de descubrimiento.</p>';
    return;
  }

  elements.seedList.innerHTML = seeds
    .map(
      (seed) => `
        <article class="stack-card">
          <div>
            <strong>${seed.label || seed.query}</strong>
            <p>${translateSeedType(seed.seed_type)} | ${seed.query}</p>
          </div>
          <div class="inline-meta">
            <span class="badge">${translateStatus(seed.last_status)}</span>
            <span>${seed.last_result_count} items</span>
            <button type="button" class="ghost-button seed-run-button" data-seed-id="${seed.id}">Ejecutar</button>
          </div>
        </article>
      `
    )
    .join("");

  elements.seedList.querySelectorAll(".seed-run-button").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus(`Ejecutando semilla ${button.dataset.seedId}...`);

      try {
        await postJson(`/api/discovery/seeds/${button.dataset.seedId}/run`, {});
        await Promise.all([actions.loadSeeds(), actions.loadCandidates(), actions.loadDashboard(), actions.loadPublications()]);
        setStatus("La semilla termino correctamente.");
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}


function restoreSelectValue(select, accounts, previousValue) {
  if (accounts.some((account) => String(account.id) === previousValue)) {
    select.value = previousValue;
  }
}

function resolveSelectedAccount(accounts = state.currentAccounts) {
  if (state.selectedAccountId && accounts.some((account) => String(account.id) === String(state.selectedAccountId))) {
    return accounts.find((account) => String(account.id) === String(state.selectedAccountId)) || null;
  }

  const fallback = accounts.find((account) => account.oauth_status === "connected") || accounts[0] || null;
  state.selectedAccountId = fallback ? String(fallback.id) : null;
  return fallback;
}

function getAccountSnapshot(accountId) {
  return state.currentChannelVideosByAccount[String(accountId)] || [];
}

function getAccountPublicationBuckets(accountId) {
  const items = state.currentPublications.filter((item) => String(item.youtube_account_id) === String(accountId));
  return {
    all: items,
    queue: items.filter((item) => ["queued", "ready", "scheduled", "publishing", "awaiting_oauth", "failed"].includes(item.status)),
    published: items.filter((item) => item.status === "published")
  };
}

function renderProfileOverview(account, oauth) {
  if (!elements.profileOverviewStrip) {
    return;
  }

  if (!account) {
    elements.profileOverviewStrip.innerHTML = '<p class="empty-state">Agrega un perfil para empezar a publicar.</p>';
    return;
  }

  const snapshot = getAccountSnapshot(account.id);
  const publicationBuckets = getAccountPublicationBuckets(account.id);
  const recentViews = snapshot.reduce((sum, item) => sum + Number(item.viewCount || 0), 0);
  const recentLikes = snapshot.reduce((sum, item) => sum + Number(item.likeCount || 0), 0);
  const oauthBadgeClass =
    account.oauth_status === "connected"
      ? "success"
      : account.oauth_status === "oauth_pending"
        ? "warm"
        : "";
  const connectAction = oauth?.ready
    ? `<a class="button-link" href="/api/youtube/accounts/${account.id}/connect">${
        account.oauth_status === "connected" ? "Reconectar OAuth" : "Conectar OAuth"
      }</a>`
    : "";

  elements.profileOverviewStrip.innerHTML = `
    <div class="profile-overview-head">
      <div>
        <strong>${escapeHtml(account.channel_title || "Perfil sin nombre")}</strong>
        <p>${escapeHtml(account.channel_handle || account.channel_id || "Todavía sin handle")} · ${
          account.contact_email ? escapeHtml(account.contact_email) : "Sin email"
        }</p>
      </div>
      <div class="account-actions">
        <span class="badge ${oauthBadgeClass}">${escapeHtml(translateStatus(account.oauth_status || "manual"))}</span>
        ${connectAction}
      </div>
    </div>
    <div class="summary-strip profile-summary-strip">
      <article class="summary-chip">
        <span>Videos recientes</span>
        <strong>${formatMetric(snapshot.length)}</strong>
      </article>
      <article class="summary-chip">
        <span>Vistas recientes</span>
        <strong>${formatMetric(recentViews)}</strong>
      </article>
      <article class="summary-chip">
        <span>Likes recientes</span>
        <strong>${formatMetric(recentLikes)}</strong>
      </article>
      <article class="summary-chip">
        <span>En cola</span>
        <strong>${formatMetric(publicationBuckets.queue.length)}</strong>
      </article>
      <article class="summary-chip">
        <span>Publicados</span>
        <strong>${formatMetric(publicationBuckets.published.length)}</strong>
      </article>
    </div>
  `;
}

export function renderYoutubeAccounts(accounts, oauth) {
  state.currentAccounts = accounts;
  state.currentYoutubeOauth = oauth || null;
  const previousQueueValue = elements.queueAccountSelect.value;
  const previousLibraryValue = elements.libraryAccountSelect.value;
  const previousLibraryVideoValue = elements.libraryVideoAccountSelect.value;
  const previousLibraryQueueValue = elements.libraryQueueAccountSelect.value;
  const selectedAccount = resolveSelectedAccount(accounts);

  const options = [
    '<option value="">Elegir cuenta de YouTube</option>',
    ...accounts.map(
      (account) =>
        `<option value="${account.id}">${account.channel_title} (${translateStatus(account.oauth_status)})</option>`
    )
  ].join("");

  elements.queueAccountSelect.innerHTML = options;
  elements.libraryAccountSelect.innerHTML = options;
  elements.libraryVideoAccountSelect.innerHTML = options;
  elements.libraryQueueAccountSelect.innerHTML = options;
  elements.distributionAccountList.innerHTML = accounts.length
    ? accounts
        .map(
          (account) => `
            <label class="checkbox-row worker-checkbox">
              <input
                type="checkbox"
                class="distribution-account-checkbox"
                value="${account.id}"
                ${account.oauth_status === "connected" ? "checked" : ""}
              />
              <span>${escapeHtml(account.channel_title)} | ${escapeHtml(translateStatus(account.oauth_status))}</span>
            </label>
          `
        )
        .join("")
    : '<p class="empty-state">Primero agrega cuentas de YouTube.</p>';

  restoreSelectValue(elements.queueAccountSelect, accounts, previousQueueValue);
  restoreSelectValue(elements.libraryAccountSelect, accounts, previousLibraryValue);
  restoreSelectValue(elements.libraryVideoAccountSelect, accounts, previousLibraryVideoValue);
  restoreSelectValue(elements.libraryQueueAccountSelect, accounts, previousLibraryQueueValue);

  if (!elements.libraryQueueAccountSelect.value && selectedAccount) {
    elements.libraryQueueAccountSelect.value = String(selectedAccount.id);
  }

  elements.youtubeOauthBox.classList.remove("hidden");
  if (oauth?.ready) {
    elements.youtubeOauthBox.innerHTML = `
      <strong>OAuth disponible</strong>
      <p>Cuando un perfil esté conectado podrás publicar directo y leer métricas. Redirect actual: <code>${
        oauth.redirectUri || "faltante"
      }</code></p>
    `;
  } else {
    const missingVars = Array.isArray(oauth?.missingVariables) ? oauth.missingVariables.join(", ") : "Desconocido";
    elements.youtubeOauthBox.innerHTML = `
      <strong>OAuth incompleto</strong>
      <p>Faltan variables: <code>${missingVars}</code></p>
      <p>El callback esperado es <code>${oauth?.expectedLocalRedirectUri || "http://localhost:3000/api/youtube/oauth/callback"}</code></p>
    `;
  }

  if (accounts.length === 0) {
    elements.youtubeList.innerHTML = '<p class="empty-state">Todavía no hay perfiles de YouTube.</p>';
    renderProfileOverview(null, oauth);
    syncSelectionBar();
    return;
  }

  elements.youtubeList.innerHTML = accounts
    .map((account) => {
      const snapshot = getAccountSnapshot(account.id);
      const recentViews = snapshot.reduce((sum, item) => sum + Number(item.viewCount || 0), 0);
      const queueCount = state.currentPublications.filter(
        (item) =>
          String(item.youtube_account_id) === String(account.id) &&
          ["queued", "ready", "scheduled", "publishing", "awaiting_oauth", "failed"].includes(item.status)
      ).length;
      const isActive = String(account.id) === String(state.selectedAccountId);
      return `
        <article class="profile-card ${isActive ? "active" : ""}">
          <button type="button" class="profile-card-button" data-account-id="${account.id}">
            <div class="profile-card-main">
              <strong>${escapeHtml(account.channel_title)}</strong>
              <p>${escapeHtml(account.channel_handle || account.channel_id || "Sin handle")}</p>
            </div>
            <div class="profile-card-stats">
              <span>${snapshot.length ? `${formatMetric(recentViews)} vistas` : "Sin métricas aún"}</span>
              <span>${queueCount} en cola</span>
            </div>
          </button>
          <div class="profile-card-footer">
            <span class="badge ${
              account.oauth_status === "connected"
                ? "success"
                : account.oauth_status === "oauth_pending"
                  ? "warm"
                  : ""
            }">${escapeHtml(translateStatus(account.oauth_status))}</span>
            ${
              oauth?.ready
                ? `<a class="ghost-button profile-connect-link" href="/api/youtube/accounts/${account.id}/connect">${
                    account.oauth_status === "connected" ? "OAuth ok" : "Conectar"
                  }</a>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  elements.youtubeList.querySelectorAll(".profile-card-button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedAccountId = String(button.dataset.accountId);
      elements.libraryQueueAccountSelect.value = String(button.dataset.accountId);
      renderYoutubeAccounts(state.currentAccounts, state.currentYoutubeOauth);
      renderAccountSchedule();
      renderLibraryVideos(state.currentLibraryItems);
      try {
        await actions.loadChannelVideos(button.dataset.accountId);
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });

  renderProfileOverview(selectedAccount, oauth);
  syncSelectionBar();
  syncLibrarySelectionBar();
  renderAccountSchedule();
}

export function getPrimaryConnectedAccount() {
  return resolveSelectedAccount(state.currentAccounts);
}

export function renderAccountSchedule() {
  const account = resolveSelectedAccount();
  if (!account) {
    elements.accountScheduleList.innerHTML = '<p class="empty-state">Primero crea o conecta un perfil de YouTube.</p>';
    return;
  }

  const relevant = getAccountPublicationBuckets(account.id).queue;

  if (relevant.length === 0) {
    elements.accountScheduleList.innerHTML = '<p class="empty-state">No hay publicaciones pendientes para este perfil.</p>';
    return;
  }

  const ordered = relevant.sort((a, b) => {
    const left = a.scheduled_for ? new Date(a.scheduled_for).getTime() : 0;
    const right = b.scheduled_for ? new Date(b.scheduled_for).getTime() : 0;
    return right - left;
  });

  elements.accountScheduleList.innerHTML = ordered
    .map(
      (item) => `
        <article class="stack-card queue-row-card">
          <div class="queue-row-main">
            <strong>${escapeHtml(item.title || item.original_filename || "Short sin título")}</strong>
            <p>${escapeHtml(translateStatusDetail(item.status_detail || item.status))}</p>
          </div>
          <div class="queue-row-meta">
            <span class="badge ${
              item.status === "ready"
                ? "success"
                : item.status === "failed"
                  ? "danger"
                  : item.status === "awaiting_oauth"
                    ? "warm"
                    : ""
            }">${escapeHtml(translateStatus(item.status))}</span>
            <span>${item.scheduled_for ? formatDate(item.scheduled_for) : "Listo para subir"}</span>
          </div>
          <div class="account-actions">
            ${
              ["ready", "scheduled", "failed"].includes(item.status)
                ? `<button type="button" class="schedule-publish-now" data-id="${item.id}">Publicar ahora</button>`
                : ""
            }
            <button type="button" class="ghost-button publication-sync" data-id="${item.id}">Sincronizar</button>
          </div>
        </article>
      `
    )
    .join("");

  elements.accountScheduleList.querySelectorAll(".schedule-publish-now").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus(`Publicando trabajo ${button.dataset.id} en YouTube...`);
      try {
        await postJson(`/api/publications/${button.dataset.id}/publish`, {});
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary(), actions.loadAccounts()]);
        setStatus(`La publicación ${button.dataset.id} fue subida a YouTube.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });

  elements.accountScheduleList.querySelectorAll(".publication-sync").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await postJson(`/api/publications/${button.dataset.id}/sync`, {});
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary(), actions.loadAccounts()]);
        setStatus(`La publicación ${button.dataset.id} fue sincronizada.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

export function renderLibraryVideos(items) {
  state.currentLibraryItems = items;
  const searchTerm = elements.librarySearchInput?.value.trim().toLowerCase() || "";
  const statusFilter = elements.libraryStatusFilter?.value || "";
  const assignmentFilter = elements.libraryAssignmentFilter?.value || "";
  const sourceFilter = elements.librarySourceFilter?.value || "";
  const selectedAccount = resolveSelectedAccount();

  const filteredItems = items.filter((item) => {
    const haystack = [
      item.title,
      item.original_filename,
      item.source_label,
      item.source_archive_path,
      item.channel_title
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const publicationStatus = String(item.publication_status || item.status || "ready").toLowerCase();
    const hasChannel = Boolean(item.channel_title || item.youtube_account_id);
    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    const matchesStatus = !statusFilter || publicationStatus === statusFilter;
    const matchesAssignment =
      !assignmentFilter || (assignmentFilter === "assigned" ? hasChannel : !hasChannel);
    const matchesSource = !sourceFilter || String(item.source_kind || "").toLowerCase() === sourceFilter;

    return matchesSearch && matchesStatus && matchesAssignment && matchesSource;
  });

  state.currentLibraryFilteredCount = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / state.currentLibraryPageSize));
  state.currentLibraryPage = Math.min(state.currentLibraryPage, totalPages);
  const pageStart = (state.currentLibraryPage - 1) * state.currentLibraryPageSize;
  const pagedItems = filteredItems.slice(pageStart, pageStart + state.currentLibraryPageSize);

  elements.libraryResultsMeta.classList.toggle("hidden", filteredItems.length === 0);
  elements.libraryResultsMeta.textContent = filteredItems.length
    ? `Mostrando ${pageStart + 1}-${Math.min(pageStart + pagedItems.length, filteredItems.length)} de ${filteredItems.length}`
    : "";
  elements.libraryPrevPageButton.disabled = state.currentLibraryPage <= 1;
  elements.libraryNextPageButton.disabled = state.currentLibraryPage >= totalPages;

  if (items.length === 0) {
    elements.libraryVideoList.innerHTML = '<p class="empty-state">Todavía no hay videos en biblioteca.</p>';
    elements.libraryResultsMeta.classList.add("hidden");
    elements.libraryPrevPageButton.disabled = true;
    elements.libraryNextPageButton.disabled = true;
    syncLibrarySelectionBar();
    return;
  }

  if (filteredItems.length === 0) {
    elements.libraryVideoList.innerHTML =
      '<p class="empty-state">No hay videos que coincidan con la búsqueda o los filtros actuales.</p>';
    syncLibrarySelectionBar();
    return;
  }

  elements.libraryVideoList.innerHTML = pagedItems
    .map(
      (item) => `
        <article class="library-video-row">
          <label class="checkbox-row compact-checkbox-row">
            <input
              type="checkbox"
              class="library-select-checkbox"
              data-id="${item.id}"
              ${state.selectedLibraryIds.has(String(item.id)) ? "checked" : ""}
            />
          </label>
          <div class="library-video-main">
            <strong>${escapeHtml(item.title || item.original_filename || "Video importado")}</strong>
            <p>${escapeHtml(item.source_label || pathFromArchive(item.source_archive_path))}</p>
          </div>
          <div class="library-video-meta">
            <span class="badge ${
              item.publication_status === "published"
                ? "success"
                : item.publication_status === "failed"
                  ? "danger"
                  : item.publication_status === "scheduled"
                    ? "warm"
                    : ""
            }">${escapeHtml(translateStatus(item.publication_status || item.status || "ready"))}</span>
            <span>${escapeHtml(translateStorageProvider(item.storage_provider || "local"))}</span>
            <span>${escapeHtml(item.source_kind || "library")}</span>
            <span>${item.channel_title ? `Canal: ${escapeHtml(item.channel_title)}` : "Disponible"}</span>
          </div>
          <div class="account-actions library-row-actions">
            <button type="button" class="ghost-button library-queue-button" data-id="${item.id}">Mandar a cola</button>
          </div>
        </article>
      `
    )
    .join("");

  elements.libraryVideoList.querySelectorAll(".library-select-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = String(checkbox.dataset.id);
      if (checkbox.checked) {
        state.selectedLibraryIds.add(id);
      } else {
        state.selectedLibraryIds.delete(id);
      }

      syncLibrarySelectionBar();
    });
  });

  elements.libraryVideoList.querySelectorAll(".library-queue-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const youtubeAccountId = Number(elements.libraryQueueAccountSelect.value || selectedAccount?.id);
      if (!Number.isFinite(youtubeAccountId)) {
        setStatus("Elige primero un perfil de YouTube.", true);
        return;
      }

      button.disabled = true;
      try {
        await postJson("/api/publications", {
          libraryVideoIds: [button.dataset.id],
          youtubeAccountId
        });
        await Promise.all([actions.loadLibrary(), actions.loadPublications(), actions.loadDashboard(), actions.loadAccounts()]);
        setStatus(`El video ${button.dataset.id} fue mandado a la cola del perfil elegido.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });

  syncLibrarySelectionBar();
}

export function renderCandidates(items) {
  if (items.length === 0) {
    elements.candidateGrid.innerHTML = '<p class="empty-state">No hay candidatos para los filtros actuales.</p>';
    return;
  }

  elements.candidateGrid.innerHTML = items
    .map(
      (item) => `
        <article class="candidate-card">
          <img class="candidate-thumb" src="${item.thumbnail_url || ""}" alt="${item.caption || ""}" />
          <div class="candidate-body">
            <div class="candidate-header">
              <span class="badge warm">${Math.round(Number(item.score || 0))}</span>
              <a href="${item.post_url}" target="_blank" rel="noreferrer">@${item.username}</a>
            </div>
            <p class="candidate-caption">${item.caption || "Video sin titulo"}</p>
            <p class="candidate-meta">
              ${formatMetric(item.view_count)} vistas | ${formatMetric(item.like_count)} me gusta | ${formatDate(item.published_at)}
            </p>
            <p class="candidate-reason">${item.score_reason || "Todavia no hay explicacion del score."}</p>
            <div class="field-grid slim">
              <select class="candidate-review" data-id="${item.id}">
                <option value="pending" ${item.review_status === "pending" ? "selected" : ""}>Pendiente</option>
                <option value="approved" ${item.review_status === "approved" ? "selected" : ""}>Aprobado</option>
                <option value="rejected" ${item.review_status === "rejected" ? "selected" : ""}>Rechazado</option>
              </select>
              <select class="candidate-category" data-id="${item.id}">
                <option value="">Sin categoria</option>
                <option value="ai" ${item.editorial_category === "ai" ? "selected" : ""}>AI</option>
                <option value="brainrot" ${item.editorial_category === "brainrot" ? "selected" : ""}>Brainrot</option>
                <option value="gaming" ${item.editorial_category === "gaming" ? "selected" : ""}>Gaming</option>
                <option value="other" ${item.editorial_category === "other" ? "selected" : ""}>Otro</option>
              </select>
            </div>
            <div class="candidate-actions">
              <button type="button" class="ghost-button candidate-save" data-id="${item.id}">Guardar revision</button>
              <button type="button" class="candidate-queue" data-id="${item.id}">Enviar a cola</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  elements.candidateGrid.querySelectorAll(".candidate-save").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const reviewStatus = elements.candidateGrid.querySelector(`.candidate-review[data-id="${id}"]`).value;
      const editorialCategory = elements.candidateGrid.querySelector(`.candidate-category[data-id="${id}"]`).value;
      button.disabled = true;

      try {
        await postJson(`/api/candidates/${id}/review`, { reviewStatus, editorialCategory }, "PATCH");
        await Promise.all([actions.loadCandidates(), actions.loadDashboard()]);
        setStatus(`El candidato ${id} fue actualizado.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });

  elements.candidateGrid.querySelectorAll(".candidate-queue").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!elements.queueAccountSelect.value) {
        setStatus("Primero elige una cuenta de YouTube.", true);
        return;
      }

      button.disabled = true;
      try {
        await postJson("/api/publications", {
          mediaIds: [button.dataset.id],
          youtubeAccountId: Number(elements.queueAccountSelect.value)
        });
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary()]);
        setStatus(`El candidato ${button.dataset.id} fue enviado a la cola de Shorts.`);
        setActiveView("queue");
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}



export function renderPublications(items) {
  if (items.length === 0) {
    elements.publicationList.innerHTML = '<p class="empty-state">Todavía no hay trabajos de publicación.</p>';
    return;
  }

  const grouped = {
    urgent: items.filter((item) => ["failed", "awaiting_oauth"].includes(item.status)),
    pending: items.filter((item) => ["queued", "ready", "scheduled", "publishing"].includes(item.status)),
    published: items.filter((item) => item.status === "published")
  };

  const renderPublicationRows = (rows, emptyText) => {
    if (!rows.length) {
      return `<p class="empty-state">${emptyText}</p>`;
    }

    return rows
      .map(
        (item) => `
          <article class="stack-card queue-row-card">
            <div class="queue-row-main">
              <strong>${escapeHtml(item.title || "Publicación sin título")}</strong>
              <p>${escapeHtml(item.channel_title || "Canal sin nombre")} · ${
                item.source_kind === "library_video" ? "biblioteca" : "@tracked"
              }</p>
            </div>
            <div class="queue-row-meta">
              <span class="badge ${
                item.status === "published"
                  ? "success"
                  : item.status === "failed"
                    ? "danger"
                    : item.status === "awaiting_oauth"
                      ? "warm"
                      : ""
              }">${escapeHtml(translateStatus(item.status))}</span>
              <span>${item.scheduled_for ? formatDate(item.scheduled_for) : formatDate(item.created_at)}</span>
              ${item.youtube_url ? `<a class="ghost-button" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir</a>` : ""}
            </div>
            <div class="account-actions">
              ${
                ["ready", "failed", "scheduled"].includes(item.status)
                  ? `<button type="button" class="publication-publish" data-id="${item.id}">Publicar ahora</button>`
                  : ""
              }
              <button type="button" class="ghost-button publication-sync" data-id="${item.id}">Sincronizar</button>
            </div>
          </article>
        `
      )
      .join("");
  };

  elements.publicationList.innerHTML = `
    <section class="panel queue-group-panel">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">Atención</p>
          <h3>Bloqueados o con error</h3>
        </div>
      </div>
      <div class="stack-list compact-stack">${renderPublicationRows(grouped.urgent, "No hay bloqueos ahora mismo.")}</div>
    </section>
    <section class="panel queue-group-panel">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">Pendientes</p>
          <h3>Listos, programados o publicándose</h3>
        </div>
      </div>
      <div class="stack-list compact-stack">${renderPublicationRows(grouped.pending, "No hay pendientes en este momento.")}</div>
    </section>
    <section class="panel queue-group-panel">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">Historial</p>
          <h3>Publicados</h3>
        </div>
      </div>
      <div class="stack-list compact-stack">${renderPublicationRows(grouped.published, "Todavía no hay publicados.")}</div>
    </section>
  `;

  elements.publicationList.querySelectorAll(".publication-sync").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await postJson(`/api/publications/${button.dataset.id}/sync`, {});
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary(), actions.loadAccounts()]);
        setStatus(`La publicación ${button.dataset.id} fue sincronizada.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });

  elements.publicationList.querySelectorAll(".publication-publish").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus(`Publicando trabajo ${button.dataset.id} en YouTube...`);
      try {
        await postJson(`/api/publications/${button.dataset.id}/publish`, {});
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary(), actions.loadAccounts()]);
        setStatus(`La publicación ${button.dataset.id} fue subida a YouTube.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

