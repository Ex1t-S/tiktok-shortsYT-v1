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
  loadSeeds: async () => {},
  loadYoutubeChannelVideos: async () => {}
};

export function setContentActions(nextActions) {
  actions = { ...actions, ...nextActions };
}

function ensureActiveAccount(accounts = state.currentAccounts) {
  const availableIds = new Set(accounts.map((account) => String(account.id)));
  if (state.currentActiveAccountId && availableIds.has(String(state.currentActiveAccountId))) {
    return accounts.find((account) => String(account.id) === String(state.currentActiveAccountId)) || null;
  }

  const preferred = accounts.find((account) => account.oauth_status === "connected") || accounts[0] || null;
  state.currentActiveAccountId = preferred ? String(preferred.id) : null;
  return preferred;
}

function syncAccountSelectors(accounts) {
  const options = [
    '<option value="">Elegir cuenta de YouTube</option>',
    ...accounts.map(
      (account) =>
        `<option value="${account.id}">${escapeHtml(account.channel_title)} (${translateStatus(account.oauth_status)})</option>`
    )
  ].join("");

  [
    elements.queueAccountSelect,
    elements.libraryAccountSelect,
    elements.libraryVideoAccountSelect,
    elements.libraryQueueAccountSelect
  ].forEach((select) => {
    const previousValue = select.value;
    select.innerHTML = options;
    if (accounts.some((account) => String(account.id) === previousValue)) {
      select.value = previousValue;
    }
  });

  if (state.currentActiveAccountId && accounts.some((account) => String(account.id) === String(state.currentActiveAccountId))) {
    elements.queueAccountSelect.value = String(state.currentActiveAccountId);
    elements.libraryQueueAccountSelect.value = String(state.currentActiveAccountId);
  }
}

export function renderMedia(items) {
  state.currentItems = items;
  elements.mediaGrid.innerHTML = "";

  if (items.length === 0) {
    elements.mediaGrid.innerHTML = '<p class="empty-state">Todavía no hay videos rastreados.</p>';
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
    mediaType.textContent = translateStatus(item.media_type || "video");
    postLink.href = item.post_url;
    caption.textContent = item.caption || "Video sin título";
    extra.textContent = [
      formatDuration(item.duration_seconds),
      formatDate(item.published_at),
      `${formatMetric(item.view_count)} vistas`,
      `${formatMetric(item.like_count)} likes`
    ]
      .filter(Boolean)
      .join(" · ");
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
    elements.seedList.innerHTML = '<p class="empty-state">Todavía no hay semillas de descubrimiento.</p>';
    return;
  }

  elements.seedList.innerHTML = seeds
    .map(
      (seed) => `
        <article class="stack-card">
          <div>
            <strong>${escapeHtml(seed.label || seed.query)}</strong>
            <p>${translateSeedType(seed.seed_type)} · ${escapeHtml(seed.query)}</p>
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
        setStatus("La semilla terminó correctamente.");
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

export function renderActiveAccountSummary() {
  const account = ensureActiveAccount();

  if (!account) {
    elements.activeProfileTitle.textContent = "Elegí un canal";
    elements.activeProfileMeta.textContent = "Cuando selecciones un perfil verás su resumen, su cola y sus videos.";
    elements.activeProfileStatus.textContent = "sin cuenta";
    elements.activeProfileStatus.className = "badge";
    elements.activeProfileOauthLink.classList.add("hidden");
    elements.activeProfileKpis.innerHTML = '<p class="empty-state">Primero crea o conecta un canal de YouTube.</p>';
    return;
  }

  const relatedPublications = state.currentPublications.filter(
    (item) => String(item.youtube_account_id) === String(account.id)
  );
  const recentVideos = Array.isArray(state.currentChannelVideos) ? state.currentChannelVideos : [];
  const totalViews = recentVideos.reduce((sum, item) => sum + Number(item.viewCount || item.view_count || 0), 0);
  const totalLikes = recentVideos.reduce((sum, item) => sum + Number(item.likeCount || item.like_count || 0), 0);
  const queueCount = relatedPublications.filter((item) => ["ready", "scheduled", "publishing", "awaiting_oauth"].includes(item.status)).length;
  const publishedCount = relatedPublications.filter((item) => item.status === "published").length;

  elements.activeProfileTitle.textContent = account.channel_title || "Canal sin nombre";
  elements.activeProfileMeta.textContent = [account.channel_handle || account.channel_id || "Sin handle", account.contact_email || "Sin email"]
    .filter(Boolean)
    .join(" · ");
  elements.activeProfileStatus.textContent = translateStatus(account.oauth_status || "manual");
  elements.activeProfileStatus.className = `badge ${
    account.oauth_status === "connected" ? "success" : account.oauth_status === "oauth_pending" ? "warm" : ""
  }`;

  if (account.oauth_status !== "connected") {
    elements.activeProfileOauthLink.classList.remove("hidden");
    elements.activeProfileOauthLink.href = `/api/youtube/accounts/${account.id}/connect`;
    elements.activeProfileOauthLink.textContent = "Conectar OAuth";
  } else {
    elements.activeProfileOauthLink.classList.add("hidden");
  }

  const cards = [
    ["Videos recientes", recentVideos.length],
    ["Vistas recientes", formatMetric(totalViews)],
    ["Likes recientes", formatMetric(totalLikes)],
    ["En cola", queueCount],
    ["Publicados", publishedCount]
  ];

  elements.activeProfileKpis.innerHTML = cards
    .map(
      ([label, value]) => `
        <article>
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");
}

export function renderYoutubeAccounts(accounts, oauth) {
  state.currentAccounts = accounts;
  const activeAccount = ensureActiveAccount(accounts);
  syncAccountSelectors(accounts);

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
              <span>${escapeHtml(account.channel_title)} · ${escapeHtml(translateStatus(account.oauth_status))}</span>
            </label>
          `
        )
        .join("")
    : '<p class="empty-state">Primero agrega cuentas de YouTube.</p>';

  elements.youtubeOauthBox.classList.remove("hidden");
  if (oauth?.ready) {
    const redirectHint = oauth.matchesExpectedLocalRedirectUri
      ? `<p>La Redirect URI actual apunta a local: <code>${oauth.redirectUri}</code></p>`
      : `<p>Redirect URI actual: <code>${oauth.redirectUri || "faltante"}</code><br />Local esperado: <code>${
          oauth.expectedLocalRedirectUri || "no disponible"
        }</code></p>`;
    elements.youtubeOauthBox.innerHTML = `
      <strong>OAuth disponible</strong>
      <p>Las credenciales de Google están cargadas. Conecta cada perfil antes de publicar.</p>
      ${redirectHint}
    `;
  } else {
    const missingVars = Array.isArray(oauth?.missingVariables) ? oauth.missingVariables.join(", ") : "Desconocido";
    elements.youtubeOauthBox.innerHTML = `
      <strong>OAuth incompleto</strong>
      <p>Variables faltantes: <code>${missingVars}</code></p>
      <p>Para pruebas en local usa este callback: <code>${
        oauth?.expectedLocalRedirectUri || "http://localhost:3000/api/youtube/oauth/callback"
      }</code></p>
    `;
  }

  if (accounts.length === 0) {
    elements.youtubeList.innerHTML = '<p class="empty-state">Todavía no hay canales de YouTube.</p>';
    renderActiveAccountSummary();
    syncSelectionBar();
    syncLibrarySelectionBar();
    return;
  }

  elements.youtubeList.innerHTML = accounts
    .map(
      (account) => `
        <button type="button" class="profile-account-item ${
          String(account.id) === String(activeAccount?.id) ? "active" : ""
        }" data-account-id="${account.id}">
          <div class="profile-account-copy">
            <strong>${escapeHtml(account.channel_title)}</strong>
            <p>${escapeHtml(account.channel_handle || account.channel_id || "Sin handle")}</p>
          </div>
          <div class="profile-account-meta">
            <span class="badge ${account.oauth_status === "connected" ? "success" : ""}">${translateStatus(
              account.oauth_status
            )}</span>
            <span>${formatMetric(
              state.currentPublications.filter((item) => String(item.youtube_account_id) === String(account.id)).length
            )} items</span>
          </div>
        </button>
      `
    )
    .join("");

  elements.youtubeList.querySelectorAll(".profile-account-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextId = String(button.dataset.accountId);
      if (nextId === String(state.currentActiveAccountId || "")) {
        return;
      }

      state.currentActiveAccountId = nextId;
      state.currentChannelVideos = [];
      renderYoutubeAccounts(state.currentAccounts, oauth);
      renderAccountSchedule();
      renderLibraryVideos(state.currentLibraryItems);

      try {
        await actions.loadYoutubeChannelVideos(nextId);
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });

  renderActiveAccountSummary();
  syncSelectionBar();
  syncLibrarySelectionBar();
  renderAccountSchedule();
}

export function getPrimaryConnectedAccount() {
  return ensureActiveAccount();
}

export function renderAccountSchedule() {
  const account = ensureActiveAccount();
  if (!account) {
    elements.accountScheduleList.innerHTML = '<p class="empty-state">Primero crea o conecta un canal de YouTube.</p>';
    return;
  }

  const items = state.currentPublications.filter((item) => String(item.youtube_account_id) === String(account.id));
  const relevant = items.filter((item) => ["scheduled", "ready", "publishing", "awaiting_oauth", "failed"].includes(item.status));

  if (relevant.length === 0) {
    elements.accountScheduleList.innerHTML = '<p class="empty-state">No hay subidas próximas para este canal.</p>';
    return;
  }

  elements.accountScheduleList.innerHTML = relevant
    .map(
      (item) => `
        <article class="list-row publication-row">
          <div class="list-row-main">
            <strong>${escapeHtml(item.title || item.original_filename || "Short sin título")}</strong>
            <p>${escapeHtml(translateStatusDetail(item.status_detail || item.status))}</p>
          </div>
          <div class="list-row-meta">
            <span class="badge ${item.status === "ready" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span>${item.scheduled_for ? formatDate(item.scheduled_for) : "Listo ahora"}</span>
            <div class="inline-meta">
              ${
                ["ready", "scheduled", "failed"].includes(item.status)
                  ? `<button type="button" class="schedule-publish-now" data-id="${item.id}">Publicar ahora</button>`
                  : ""
              }
              <button type="button" class="ghost-button publication-sync" data-id="${item.id}">Sincronizar</button>
            </div>
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
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary()]);
        setStatus(`La publicación ${button.dataset.id} fue sincronizada.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function sourceFilterMatches(item, sourceFilter) {
  if (!sourceFilter) {
    return true;
  }

  const provider = String(item.storage_provider || "").toLowerCase();
  const sourceKind = String(item.source_kind || item.kind || "").toLowerCase();

  if (sourceFilter === "tracked") {
    return sourceKind.includes("tracked") || provider === "remote_url";
  }

  if (sourceFilter === "zip") {
    return provider === "zip_import" || Boolean(item.source_archive_path);
  }

  if (sourceFilter === "cloud") {
    return provider === "s3-compatible" || Boolean(item.storage_object_key);
  }

  if (sourceFilter === "direct") {
    return provider === "local" && !item.source_archive_path;
  }

  return true;
}

export function renderLibraryVideos(items) {
  state.currentLibraryItems = items;
  const searchTerm = elements.librarySearchInput?.value.trim().toLowerCase() || "";
  const statusFilter = elements.libraryStatusFilter?.value || "";
  const assignmentFilter = elements.libraryAssignmentFilter?.value || "";
  const sourceFilter = elements.librarySourceFilter?.value || "";
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

    return matchesSearch && matchesStatus && matchesAssignment && sourceFilterMatches(item, sourceFilter);
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
        <article class="list-row library-row">
          <label class="checkbox-row row-select-cell">
            <input
              type="checkbox"
              class="library-select-checkbox"
              data-id="${item.id}"
              ${state.selectedLibraryIds.has(String(item.id)) ? "checked" : ""}
            />
          </label>
          <div class="list-row-main">
            <strong>${escapeHtml(item.title || item.original_filename || "Video importado")}</strong>
            <p>${escapeHtml(item.source_label || pathFromArchive(item.source_archive_path) || "Sin etiqueta")}</p>
          </div>
          <div class="list-row-meta">
            <span>${escapeHtml(translateStorageProvider(item.storage_provider || "local"))}</span>
            <span class="badge ${
              item.publication_status === "published"
                ? "success"
                : item.publication_status === "failed"
                  ? "danger"
                  : ""
            }">${escapeHtml(translateStatus(item.publication_status || item.status || "ready"))}</span>
            <span>${item.channel_title ? `Canal: ${escapeHtml(item.channel_title)}` : "Sin canal"}</span>
            <div class="inline-meta">
              <button type="button" class="ghost-button library-queue-button" data-id="${item.id}">Agregar a cola</button>
            </div>
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
      const youtubeAccountId = Number(elements.libraryQueueAccountSelect.value || state.currentActiveAccountId);
      if (!Number.isFinite(youtubeAccountId)) {
        setStatus("Elige un perfil para reutilizar este video.", true);
        return;
      }

      button.disabled = true;
      try {
        await postJson("/api/publications", {
          libraryVideoIds: [button.dataset.id],
          youtubeAccountId
        });
        await Promise.all([actions.loadLibrary(), actions.loadPublications(), actions.loadDashboard()]);
        setStatus(`El video ${button.dataset.id} fue mandado a la cola del perfil.`);
        setActiveView("accounts");
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
            <p class="candidate-caption">${item.caption || "Video sin título"}</p>
            <p class="candidate-meta">
              ${formatMetric(item.view_count)} vistas · ${formatMetric(item.like_count)} likes · ${formatDate(item.published_at)}
            </p>
            <p class="candidate-reason">${item.score_reason || "Todavía no hay explicación del score."}</p>
            <div class="field-grid slim">
              <select class="candidate-review" data-id="${item.id}">
                <option value="pending" ${item.review_status === "pending" ? "selected" : ""}>Pendiente</option>
                <option value="approved" ${item.review_status === "approved" ? "selected" : ""}>Aprobado</option>
                <option value="rejected" ${item.review_status === "rejected" ? "selected" : ""}>Rechazado</option>
              </select>
              <select class="candidate-category" data-id="${item.id}">
                <option value="">Sin categoría</option>
                <option value="ai" ${item.editorial_category === "ai" ? "selected" : ""}>AI</option>
                <option value="brainrot" ${item.editorial_category === "brainrot" ? "selected" : ""}>Brainrot</option>
                <option value="gaming" ${item.editorial_category === "gaming" ? "selected" : ""}>Gaming</option>
                <option value="other" ${item.editorial_category === "other" ? "selected" : ""}>Otro</option>
              </select>
            </div>
            <div class="candidate-actions">
              <button type="button" class="ghost-button candidate-save" data-id="${item.id}">Guardar revisión</button>
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
      const activeAccount = ensureActiveAccount();
      const queueAccountId = Number(elements.queueAccountSelect.value || activeAccount?.id);
      if (!Number.isFinite(queueAccountId)) {
        setStatus("Primero elige una cuenta de YouTube.", true);
        return;
      }

      button.disabled = true;
      try {
        await postJson("/api/publications", {
          mediaIds: [button.dataset.id],
          youtubeAccountId: queueAccountId
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
  state.currentPublications = items;
  renderActiveAccountSummary();
  renderAccountSchedule();

  if (items.length === 0) {
    elements.publicationList.innerHTML = '<p class="empty-state">Todavía no hay trabajos de publicación.</p>';
    return;
  }

  const groups = [
    {
      title: "Pendientes y programados",
      filter: (item) => ["ready", "scheduled", "awaiting_oauth", "publishing"].includes(item.status)
    },
    {
      title: "Publicados",
      filter: (item) => item.status === "published"
    },
    {
      title: "Fallidos",
      filter: (item) => item.status === "failed"
    }
  ];

  elements.publicationList.innerHTML = groups
    .map(({ title, filter }) => {
      const groupItems = items.filter(filter);
      return `
        <section class="queue-group">
          <div class="queue-group-head">
            <h4>${title}</h4>
            <span>${groupItems.length}</span>
          </div>
          <div class="stack-list">
            ${
              groupItems.length
                ? groupItems
                    .map(
                      (item) => `
                        <article class="list-row publication-row full-width">
                          <div class="list-row-main">
                            <strong>${escapeHtml(item.title || item.caption || item.original_filename || "Publicación sin título")}</strong>
                            <p>${
                              item.source_kind === "library_video"
                                ? `${escapeHtml(item.original_filename || "Video de biblioteca")} → ${escapeHtml(item.channel_title)}`
                                : `@${escapeHtml(item.username || "perfil")} → ${escapeHtml(item.channel_title)}`
                            }</p>
                          </div>
                          <div class="list-row-meta">
                            <span class="badge ${
                              item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""
                            }">${translateStatus(item.status)}</span>
                            <span>${translateSourceKind(item.source_kind)}</span>
                            <span>${formatDate(item.created_at)}</span>
                            ${item.scheduled_for ? `<span>Programa: ${formatDate(item.scheduled_for)}</span>` : ""}
                            <div class="inline-meta">
                              ${
                                item.status === "ready" || item.status === "failed" || item.status === "scheduled"
                                  ? `<button type="button" class="publication-publish" data-id="${item.id}">Publicar ahora</button>`
                                  : ""
                              }
                              <button type="button" class="ghost-button publication-sync" data-id="${item.id}">Sincronizar</button>
                              ${
                                item.youtube_url
                                  ? `<a class="ghost-button" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir</a>`
                                  : ""
                              }
                            </div>
                          </div>
                        </article>
                      `
                    )
                    .join("")
                : '<p class="empty-state">No hay elementos en este grupo.</p>'
            }
          </div>
        </section>
      `;
    })
    .join("");

  elements.publicationList.querySelectorAll(".publication-sync").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await postJson(`/api/publications/${button.dataset.id}/sync`, {});
        await Promise.all([actions.loadPublications(), actions.loadDashboard(), actions.loadLibrary()]);
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
