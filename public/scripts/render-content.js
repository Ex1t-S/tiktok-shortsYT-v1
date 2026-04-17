import { elements, state } from "./dom.js";
import {
  escapeHtml,
  extractVideoTitle,
  formatDate,
  formatDuration,
  formatIsoDuration,
  formatMetric,
  pathFromArchive,
  translateSourceKind,
  translateStatus,
  translateStatusDetail,
  translateStorageProvider
} from "./utils.js";

function paginate(items, page, pageSize) {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * safePageSize;
  return {
    totalPages,
    currentPage,
    pageItems: items.slice(start, start + safePageSize),
    start: start + 1,
    end: Math.min(start + safePageSize, items.length)
  };
}

function renderEmpty(target, message) {
  target.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderThumb(src, alt, imgClass, placeholder = "Sin preview") {
  return `
    <div class="media-thumb-shell ${imgClass}-shell">
      <img class="${imgClass}" src="${src || ""}" alt="${escapeHtml(alt || "")}" loading="lazy" data-fallback-thumb="true" />
      <span class="media-thumb-fallback">${escapeHtml(placeholder)}</span>
    </div>
  `;
}

function accountLabel(account) {
  return account?.channel_title || account?.channel_handle || account?.channel_id || "Canal";
}

function getSelectedAccount() {
  return state.accounts.find((item) => String(item.id) === String(state.selectedAccountId)) || null;
}

function getSelectedAccountVideos() {
  return Array.isArray(state.accountVideosById[state.selectedAccountId]) ? state.accountVideosById[state.selectedAccountId] : [];
}

function getSelectedAccountChannel() {
  return state.accountChannelById[state.selectedAccountId] || null;
}

function getSelectedAccountClones() {
  return Array.isArray(state.accountClonesById[state.selectedAccountId]) ? state.accountClonesById[state.selectedAccountId] : [];
}

function getSelectedAccountPublications() {
  return state.publications.filter((item) => String(item.youtube_account_id) === String(state.selectedAccountId));
}

function getLibraryTitle(item) {
  return (
    extractVideoTitle(item.title, item.description, item.original_filename, pathFromArchive(item.source_archive_path)) ||
    "Video sin titulo"
  );
}

function getLibraryOrigin(item) {
  return item.source_label || pathFromArchive(item.source_archive_path) || translateStorageProvider(item.storage_provider || "local");
}

function getLibraryStatus(item) {
  return String(item.publication_status || item.status || "ready").toLowerCase();
}

function getLibrarySource(item) {
  return String(item.source_kind || item.storage_provider || "").toLowerCase();
}

function isQueueLikeStatus(status) {
  return ["queued", "ready", "awaiting_oauth", "publishing", "scheduled"].includes(String(status || "").toLowerCase());
}

function getScrapedVideoTitle(item) {
  return extractVideoTitle(item.caption, item.description, item.original_filename) || "Video sin titulo";
}

function getPublicationTitle(item) {
  return (
    extractVideoTitle(item.title, item.library_title, item.caption, item.original_filename, item.clone_display_name && `@${item.clone_display_name}`) ||
    "Publicacion sin titulo"
  );
}

function getPublicationPreview(item) {
  return item.thumbnail_url || item.library_thumbnail_url || "";
}

function getProfileQueueItems(publications) {
  const queueStatuses = new Set(["awaiting_oauth", "ready", "scheduled", "publishing", "failed"]);
  return publications
    .filter((item) => queueStatuses.has(String(item.status || "").toLowerCase()))
    .sort((left, right) => {
      const leftDate = new Date(left.scheduled_for || left.created_at || 0).getTime();
      const rightDate = new Date(right.scheduled_for || right.created_at || 0).getTime();
      return rightDate - leftDate;
    });
}

function buildClonePreview(profileId, dailyLimit) {
  const profile = state.scrapedProfiles.find((item) => String(item.id) === String(profileId));
  const totalVideos = Number(profile?.stored_video_count || profile?.video_count || 0);
  const safeDailyLimit = Math.max(1, Number(dailyLimit || 1));
  const previewDates = Array.from({ length: Math.min(totalVideos, 6) }, (_, index) => {
    const dayOffset = Math.floor(index / safeDailyLimit);
    const date = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
    return date.toISOString();
  });

  return {
    profile,
    totalVideos,
    totalDays: totalVideos ? Math.ceil(totalVideos / safeDailyLimit) : 0,
    previewDates
  };
}

function renderContextItem({ active, title, meta, detail, action, attrs = {} }) {
  const attributes = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(" ");

  return `
    <button type="button" class="context-item ${active ? "active" : ""}" data-action="${action}" ${attributes}>
      <span class="context-item-title">${escapeHtml(title)}</span>
      <span class="context-item-meta">${escapeHtml(meta)}</span>
      ${detail ? `<span class="context-item-detail">${escapeHtml(detail)}</span>` : ""}
    </button>
  `;
}

function renderMetricStrip(items) {
  return `
    <div class="metric-strip">
      ${items
        .map(
          (item) => `
            <article class="metric-card">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(String(item.value))}</strong>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderScrapedProfiles() {
  renderScrapedProfilesList();
  renderScrapedWorkspace();
}

function renderScrapedProfilesList() {
  if (!state.scrapedProfiles.length) {
    renderEmpty(elements.scrapedProfilesList, "Todavia no hay perfiles scrapeados.");
    elements.scrapedProfilesPagerLabel.textContent = "Pagina 1";
    elements.scrapedProfilesPrevPage.disabled = true;
    elements.scrapedProfilesNextPage.disabled = true;
    return;
  }

  const { pageItems, currentPage, totalPages, start, end } = paginate(
    state.scrapedProfiles,
    state.scrapedProfilesPage,
    state.scrapedProfilesPageSize
  );

  state.scrapedProfilesPage = currentPage;
  elements.scrapedProfilesPagerLabel.textContent = `${start}-${end} de ${state.scrapedProfiles.length}`;
  elements.scrapedProfilesPrevPage.disabled = currentPage <= 1;
  elements.scrapedProfilesNextPage.disabled = currentPage >= totalPages;

  elements.scrapedProfilesList.innerHTML = pageItems
    .map((profile) => {
      const active = String(profile.username) === String(state.selectedScrapedUsername);
      const status = profile.latest_run_status || profile.last_scrape_status || "idle";
      const label = profile.username?.startsWith("tag-")
        ? `#${String(profile.username).replace(/^tag-/, "")}`
        : `@${profile.username}`;

      return renderContextItem({
        active,
        title: profile.display_name || label,
        meta: `${translateStatus(status)} · ${Number(profile.stored_video_count || profile.video_count || 0)} videos`,
        detail: profile.last_scraped_at ? `Ultimo scrape ${formatDate(profile.last_scraped_at)}` : "Sin corridas",
        action: "select-scraped-profile",
        attrs: { "data-username": profile.username }
      });
    })
    .join("");
}

function renderScrapedWorkspace() {
  const profile = state.currentTrackingProfile;
  const scrape = state.currentTrackingRun;

  if (!profile) {
    renderEmpty(elements.scrapedProfileHeader, "Elegi un perfil o escanea uno nuevo.");
    renderEmpty(elements.scrapedVideosGrid, "No hay videos para mostrar.");
    elements.scrapedResultsMeta.textContent = "Sin perfil activo.";
    elements.saveLibraryButton.disabled = true;
    elements.scrapedVideosPrevPage.disabled = true;
    elements.scrapedVideosNextPage.disabled = true;
    elements.scrapedVideosPagerLabel.textContent = "Pagina 1";
    return;
  }

  const label = profile.username?.startsWith("tag-")
    ? `#${String(profile.username).replace(/^tag-/, "")}`
    : `@${profile.username}`;
  const status = scrape?.status || profile.last_scrape_status || "idle";
  const badgeClass = status === "success" ? "success" : status === "failed" ? "danger" : "";

  elements.scrapedProfileHeader.innerHTML = `
    <div class="workspace-header-card">
      <div class="workspace-header-main">
        <div class="workspace-title-block">
          <span class="panel-label">Perfil activo</span>
          <h2>${escapeHtml(profile.display_name || label)}</h2>
          <p>${escapeHtml(label)} · ${Number(profile.total_media_count || 0)} items</p>
        </div>
        <div class="workspace-actions">
          <span class="badge ${badgeClass}">${escapeHtml(translateStatus(status))}</span>
          <button type="button" class="ghost-button" data-action="rescan-scraped-profile">Reescanear</button>
        </div>
      </div>
      ${renderMetricStrip([
        { label: "Videos", value: Number(profile.video_count || 0) },
        { label: "Imagenes", value: Number(profile.image_count || 0) },
        { label: "Nuevos", value: Number(scrape?.new_items_count || 0) },
        { label: "Guardados", value: Number(scrape?.saved_count || state.currentItems.length || 0) },
        { label: "Ultimo scrape", value: formatDate(profile.last_scraped_at) }
      ])}
      ${
        scrape?.progress_message
          ? `<div class="inline-status"><strong>Tracking</strong><span>${escapeHtml(scrape.progress_message)}</span></div>`
          : ""
      }
    </div>
  `;

  const total = state.currentItems.length;
  elements.saveLibraryButton.disabled = state.selectedTrackIds.size === 0;
  elements.scrapedResultsMeta.textContent = total
    ? `${state.selectedTrackIds.size} seleccionados · ${total} cargados`
    : "Sin videos cargados.";

  const canLoadMore = Number(state.currentTrackTotalAvailable || 0) > total || total >= state.currentTrackLimit;
  elements.loadMoreMediaButton.classList.toggle("hidden", !canLoadMore);

  if (!total) {
    renderEmpty(elements.scrapedVideosGrid, "No hay videos scrapeados para este perfil.");
    elements.scrapedVideosPrevPage.disabled = true;
    elements.scrapedVideosNextPage.disabled = true;
    elements.scrapedVideosPagerLabel.textContent = "Pagina 1";
    return;
  }

  const { pageItems, currentPage, totalPages, start, end } = paginate(
    state.currentItems,
    state.scrapedVideosPage,
    state.scrapedVideosPageSize
  );

  state.scrapedVideosPage = currentPage;
  elements.scrapedVideosPagerLabel.textContent = `${start}-${end} de ${total}`;
  elements.scrapedVideosPrevPage.disabled = currentPage <= 1;
  elements.scrapedVideosNextPage.disabled = currentPage >= totalPages;

  elements.scrapedVideosGrid.innerHTML = pageItems
    .map((item) => {
      const id = String(item.id);
      const selected = state.selectedTrackIds.has(id);

      return `
        <article class="media-card ${selected ? "is-selected" : ""}">
          <div class="media-card-thumb">
            ${renderThumb(item.thumbnail_url, item.caption || "Video", "video-thumb", "TikTok")}
          </div>
          <div class="media-card-body">
            <label class="select-chip">
              <input type="checkbox" data-action="toggle-track" data-id="${id}" ${selected ? "checked" : ""} />
              <span>Seleccionar</span>
            </label>
            <strong class="truncate-2" title="${escapeHtml(getScrapedVideoTitle(item))}">${escapeHtml(getScrapedVideoTitle(item))}</strong>
            <p>${escapeHtml(
              [formatDuration(item.duration_seconds), `${formatMetric(item.view_count)} vistas`, formatDate(item.published_at)]
                .filter(Boolean)
                .join(" · ")
            )}</p>
            <div class="media-card-actions">
              <a class="ghost-button" href="${item.post_url || "#"}" target="_blank" rel="noreferrer">Abrir</a>
              <a class="ghost-button" href="/api/media/${item.id}/download">Descargar</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderYoutubeAccounts() {
  syncYoutubeAddAccountAction();
  renderYoutubeChannelStrip();
  renderYoutubeWorkspace();
}

function renderYoutubeAccountsListLegacy() {
  if (!state.accounts.length) {
    renderEmpty(elements.youtubeProfilesList, "Todavia no hay cuentas conectadas.");
    elements.youtubeProfilesPagerLabel.textContent = "Pagina 1";
    elements.youtubeProfilesPrevPage.disabled = true;
    elements.youtubeProfilesNextPage.disabled = true;
    return;
  }

  const { pageItems, currentPage, totalPages, start, end } = paginate(
    state.accounts,
    state.youtubeListPage,
    state.youtubeListPageSize
  );

  state.youtubeListPage = currentPage;
  elements.youtubeProfilesPagerLabel.textContent = `${start}-${end} de ${state.accounts.length}`;
  elements.youtubeProfilesPrevPage.disabled = currentPage <= 1;
  elements.youtubeProfilesNextPage.disabled = currentPage >= totalPages;

  elements.youtubeProfilesList.innerHTML = pageItems
    .map((account) => {
      const active = String(account.id) === String(state.selectedAccountId);
      const queueCount = state.publications.filter(
        (item) => String(item.youtube_account_id) === String(account.id) && isQueueLikeStatus(item.status)
      ).length;

      return renderContextItem({
        active,
        title: accountLabel(account),
        meta: `${translateStatus(account.oauth_status)} · ${queueCount} en cola`,
        detail: account.last_sync_at ? `Sync ${formatDate(account.last_sync_at)}` : "Sin sync",
        action: "select-youtube-profile",
        attrs: { "data-id": account.id }
      });
    })
    .join("");
}

export function renderOauthBox() {
  syncYoutubeAddAccountAction();
}

function renderYoutubeChannelStrip() {
  if (!state.accounts.length) {
    renderEmpty(elements.youtubeProfilesList, "Todavia no hay cuentas conectadas.");
    elements.youtubeProfilesPagerLabel.textContent = "Pagina 1";
    elements.youtubeProfilesPrevPage.disabled = true;
    elements.youtubeProfilesNextPage.disabled = true;
    return;
  }

  const { pageItems, currentPage, totalPages, start, end } = paginate(
    state.accounts,
    state.youtubeListPage,
    state.youtubeListPageSize
  );

  state.youtubeListPage = currentPage;
  elements.youtubeProfilesPagerLabel.textContent = `${start}-${end} de ${state.accounts.length}`;
  elements.youtubeProfilesPrevPage.disabled = currentPage <= 1;
  elements.youtubeProfilesNextPage.disabled = currentPage >= totalPages;

  elements.youtubeProfilesList.innerHTML = pageItems
    .map((account) => {
      const active = String(account.id) === String(state.selectedAccountId);
      const queueCount = state.publications.filter(
        (item) => String(item.youtube_account_id) === String(account.id) && isQueueLikeStatus(item.status)
      ).length;
      const syncLabel = account.last_sync_at ? `Sync ${formatDate(account.last_sync_at)}` : "Sin sync";

      return `
        <button type="button" class="channel-strip-item ${active ? "active" : ""}" data-action="select-youtube-profile" data-id="${account.id}">
          <strong class="channel-strip-title truncate-1" title="${escapeHtml(accountLabel(account))}">${escapeHtml(accountLabel(account))}</strong>
          <span class="channel-strip-meta">
            <span class="badge ${account.oauth_status === "connected" ? "success" : "warning"}">${escapeHtml(translateStatus(account.oauth_status))}</span>
            <span class="meta-chip">${queueCount} en cola</span>
          </span>
          <span class="channel-strip-detail truncate-1" title="${escapeHtml(syncLabel)}">${escapeHtml(syncLabel)}</span>
        </button>
      `;
    })
    .join("");
}

function syncYoutubeAddAccountAction() {
  const oauth = state.oauth;
  if (!oauth) {
    elements.addYoutubeAccountButton.setAttribute("href", "#");
    elements.addYoutubeAccountButton.setAttribute("aria-disabled", "true");
    return;
  }

  elements.addYoutubeAccountButton.setAttribute("href", oauth.ready ? "/api/youtube/oauth/start" : "#");
  elements.addYoutubeAccountButton.setAttribute("aria-disabled", oauth.ready ? "false" : "true");
}

function renderYoutubeWorkspace() {
  const account = getSelectedAccount();

  if (!account) {
    renderEmpty(elements.youtubeProfileHeader, "Elegi una cuenta para abrir el workspace.");
    renderEmpty(elements.youtubeProfileTabContent, "No hay un canal activo.");
    return;
  }

  const videos = getSelectedAccountVideos();
  const channel = getSelectedAccountChannel();
  const publications = getSelectedAccountPublications();
  const clones = getSelectedAccountClones();
  const queued = publications.filter((item) => isQueueLikeStatus(item.status));
  const latestVideoTitle = videos[0]?.title || "Sin uploads sincronizados";

  elements.youtubeProfileHeader.innerHTML = `
    <div class="workspace-header-card">
      <div class="workspace-header-main">
        <div class="workspace-title-block">
          <span class="panel-label">Canal activo</span>
          <h2>${escapeHtml(accountLabel(account))}</h2>
          <p>${escapeHtml(account.channel_handle || account.channel_id || account.contact_email || "")}</p>
        </div>
        <div class="workspace-actions">
          <span class="badge ${account.oauth_status === "connected" ? "success" : "warning"}">${escapeHtml(
            translateStatus(account.oauth_status)
          )}</span>
          <a class="ghost-button" href="/api/youtube/accounts/${account.id}/connect">Reconectar OAuth</a>
        </div>
      </div>
      ${renderMetricStrip([
        { label: "Videos", value: Number(channel?.statistics?.videoCount || videos.length || 0) },
        { label: "Suscriptores", value: formatMetric(channel?.statistics?.subscriberCount || 0) },
        { label: "Vistas", value: formatMetric(channel?.statistics?.viewCount || 0) },
        { label: "En cola", value: queued.length },
        { label: "Clonaciones", value: clones.length }
      ])}
      <div class="workspace-note truncate-1" title="${escapeHtml(latestVideoTitle)}">${escapeHtml(latestVideoTitle)}</div>
    </div>
  `;

  elements.youtubeProfileTabBar.querySelectorAll(".profile-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.currentYoutubeTab);
  });

  renderYoutubeTabContent(account, channel, videos, publications, clones);
}

function renderYoutubeTabContent(account, channel, videos, publications, clones) {
  if (state.currentYoutubeTab === "videos") {
    const { pageItems, currentPage, totalPages, start, end } = paginate(
      videos,
      state.youtubeVideosPage,
      state.youtubeTabPageSize
    );

    state.youtubeVideosPage = currentPage;
    elements.youtubeProfileTabContent.innerHTML = `
      <section class="workspace-section">
        <div class="section-toolbar">
          <div>
            <strong>Videos del canal</strong>
            <span class="helper-inline">${videos.length ? `${start}-${end} de ${videos.length}` : "Sin videos"}</span>
          </div>
          <div class="pager-controls">
            <button type="button" class="ghost-button" data-action="youtube-videos-prev">Anterior</button>
            <button type="button" class="ghost-button" data-action="youtube-videos-next">Siguiente</button>
          </div>
        </div>
        <div class="dense-list">
          ${renderChannelVideoCards(pageItems)}
        </div>
      </section>
    `;

    elements.youtubeProfileTabContent.querySelector('[data-action="youtube-videos-prev"]').disabled = currentPage <= 1;
    elements.youtubeProfileTabContent.querySelector('[data-action="youtube-videos-next"]').disabled = currentPage >= totalPages;
    return;
  }

  if (state.currentYoutubeTab === "stats") {
    const totalViews = videos.reduce((sum, item) => sum + Number(item.viewCount || 0), 0);
    const totalLikes = videos.reduce((sum, item) => sum + Number(item.likeCount || 0), 0);
    const published = publications.filter((item) => String(item.status).toLowerCase() === "published").length;

    elements.youtubeProfileTabContent.innerHTML = `
      <section class="workspace-section">
        ${renderMetricStrip([
          { label: "Suscriptores", value: formatMetric(channel?.statistics?.subscriberCount || 0) },
          { label: "Vistas recientes", value: formatMetric(totalViews) },
          { label: "Likes recientes", value: formatMetric(totalLikes) },
          { label: "Publicaciones", value: publications.length },
          { label: "Publicados", value: published }
        ])}
        <div class="overview-columns">
          <section class="subpanel">
            <div class="subpanel-head">
              <strong>Estado del canal</strong>
            </div>
            <div class="info-stack">
              <div class="info-row"><span>Canal</span><strong>${escapeHtml(accountLabel(account))}</strong></div>
              <div class="info-row"><span>OAuth</span><strong>${escapeHtml(translateStatus(account.oauth_status))}</strong></div>
              <div class="info-row"><span>Ultima sync</span><strong>${escapeHtml(formatDate(account.last_sync_at))}</strong></div>
            </div>
          </section>
          <section class="subpanel">
            <div class="subpanel-head">
              <strong>Actividad</strong>
            </div>
            <div class="dense-list">
              ${renderQueueCards(publications.slice(0, 4))}
            </div>
          </section>
        </div>
      </section>
    `;
    return;
  }

  if (state.currentYoutubeTab === "queue") {
    const queueItems = getProfileQueueItems(publications);
    const scheduledCount = queueItems.filter((item) => String(item.status || "").toLowerCase() === "scheduled").length;
    const readyCount = queueItems.filter((item) => String(item.status || "").toLowerCase() === "ready").length;

    elements.youtubeProfileTabContent.innerHTML = `
      <section class="workspace-section profile-queue-workspace">
        <div class="section-toolbar section-toolbar-tight">
          <div>
            <strong>Cola del canal</strong>
            <span class="helper-inline">${queueItems.length ? `${queueItems.length} pendientes en este canal` : "Sin publicaciones pendientes"}</span>
          </div>
          <div class="list-row-meta">
            <span class="meta-chip">${scheduledCount} programados</span>
            <span class="meta-chip">${readyCount} listos</span>
          </div>
        </div>
        <div class="dense-list">
          ${renderProfileQueueRows(queueItems)}
        </div>
      </section>
    `;
    return;
  }

  if (state.currentYoutubeTab === "publish") {
    const publishable = filterPublishableLibrary(account.id);
    const { pageItems, currentPage, totalPages, start, end } = paginate(
      publishable,
      state.profilePublishPage,
      state.youtubeTabPageSize
    );

    state.profilePublishPage = currentPage;
    const pageIds = pageItems.map((item) => String(item.id));
    const selectedCount = publishable.filter((item) => state.selectedLibraryIds.has(String(item.id))).length;
    const pageSelectionCount = pageIds.filter((id) => state.selectedLibraryIds.has(id)).length;
    const allPageSelected = pageIds.length > 0 && pageSelectionCount === pageIds.length;

    elements.youtubeProfileTabContent.innerHTML = `
      <section class="workspace-section publish-workspace-section">
        <div class="section-toolbar section-toolbar-tight">
          <div>
            <strong>Publicar desde biblioteca</strong>
            <span class="helper-inline">${publishable.length ? `${start}-${end} de ${publishable.length}` : "Sin disponibles"}</span>
          </div>
          <div class="filter-row">
            <input id="profile-publish-search" type="search" placeholder="Buscar" value="${escapeHtml(
              state.profilePublishFilters.search
            )}" />
            <select id="profile-publish-source">
              <option value="">Todos los origenes</option>
              <option value="tracked_capture" ${state.profilePublishFilters.source === "tracked_capture" ? "selected" : ""}>Capturados</option>
              <option value="zip_import" ${state.profilePublishFilters.source === "zip_import" ? "selected" : ""}>ZIP</option>
              <option value="direct_upload" ${state.profilePublishFilters.source === "direct_upload" ? "selected" : ""}>Local</option>
              <option value="cloud_reference" ${state.profilePublishFilters.source === "cloud_reference" ? "selected" : ""}>Cloud</option>
            </select>
            <select id="profile-publish-availability">
              <option value="available" ${state.profilePublishFilters.availability === "available" ? "selected" : ""}>Solo disponibles</option>
              <option value="all" ${state.profilePublishFilters.availability === "all" ? "selected" : ""}>Todos</option>
            </select>
          </div>
        </div>
        <div class="selection-bar publish-selection-bar ${selectedCount ? "has-selection" : ""}">
          <div class="selection-copy">
            <strong>${selectedCount ? `${selectedCount} seleccionados` : "Selecciona videos"}</strong>
            <span>${allPageSelected ? "Toda la página actual está marcada." : `${pageSelectionCount} de ${pageItems.length} en esta página`}</span>
          </div>
          <div class="selection-actions">
            <button type="button" class="ghost-button" data-action="profile-publish-select-page" data-ids="${pageIds.join(",")}">${allPageSelected ? "Página marcada" : "Seleccionar página"}</button>
            <button type="button" class="ghost-button" data-action="profile-publish-clear-selection" ${selectedCount ? "" : "disabled"}>Limpiar</button>
            <button type="button" class="ghost-button" data-action="profile-publish-bulk-queue" data-account-id="${account.id}" ${selectedCount ? "" : "disabled"}>Agregar a cola</button>
            <button type="button" data-action="profile-publish-bulk-publish" data-account-id="${account.id}" ${selectedCount ? "" : "disabled"}>Publicar ahora</button>
          </div>
        </div>
        <div class="dense-list">
          ${renderPublishRows(pageItems, account.id)}
        </div>
        <div class="panel-pager">
          <span class="pager-label">Pagina ${currentPage} de ${totalPages}</span>
          <div class="pager-controls">
            <button type="button" class="ghost-button" data-action="profile-publish-prev">Anterior</button>
            <button type="button" class="ghost-button" data-action="profile-publish-next">Siguiente</button>
          </div>
        </div>
      </section>
    `;

    elements.youtubeProfileTabContent.querySelector('[data-action="profile-publish-prev"]').disabled = currentPage <= 1;
    elements.youtubeProfileTabContent.querySelector('[data-action="profile-publish-next"]').disabled = currentPage >= totalPages;
    return;
  }

  const preview = buildClonePreview(state.cloneForm.trackedProfileId, state.cloneForm.dailyLimit);
  elements.youtubeProfileTabContent.innerHTML = `
    <section class="workspace-section">
      <div class="section-toolbar">
        <div>
          <strong>Clonar perfil TikTok</strong>
          <span class="helper-inline">Programa una cuenta scrapeada con limite diario.</span>
        </div>
      </div>
      <div class="clone-split-layout">
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Nueva clonacion</strong>
          </div>
          <form id="clone-form" class="stack-form compact-form">
            <select id="clone-tracked-profile-select">
              <option value="">Elegir perfil scrapeado</option>
              ${state.scrapedProfiles
                .map((profile) => {
                  const label = profile.username?.startsWith("tag-")
                    ? `#${String(profile.username).replace(/^tag-/, "")}`
                    : `@${profile.username}`;
                  return `<option value="${profile.id}" ${String(profile.id) === String(state.cloneForm.trackedProfileId) ? "selected" : ""}>${escapeHtml(
                    profile.display_name || label
                  )} · ${Number(profile.stored_video_count || profile.video_count || 0)} videos</option>`;
                })
                .join("")}
            </select>
            <div class="field-row two-up">
              <label>
                <span>Limite diario</span>
                <input id="clone-daily-limit-input" type="number" min="1" step="1" value="${Number(state.cloneForm.dailyLimit || 3)}" />
              </label>
              <article class="compact-info-card">
                <strong>Vista previa</strong>
                <p>${preview.profile ? `${Number(preview.totalVideos)} videos · ${preview.totalDays} dias` : "Selecciona un perfil para estimar."}</p>
              </article>
            </div>
            ${
              preview.previewDates.length
                ? `<article class="compact-info-card"><strong>Calendario inicial</strong><p>${escapeHtml(
                    preview.previewDates.map((item) => formatDate(item)).join(" · ")
                  )}</p></article>`
                : ""
            }
            <button type="submit">Crear clonacion</button>
          </form>
        </section>
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Clonaciones activas</strong>
          </div>
          <div class="dense-list">
            ${renderCloneCards(clones)}
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderChannelVideoCards(items) {
  if (!items.length) {
    return '<div class="empty-state">No hay videos para mostrar.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="list-row list-row-compact list-row-video">
          <div class="list-row-thumb">
            ${renderThumb(item.thumbnails?.medium?.url || item.thumbnails?.default?.url || "", item.title || "", "channel-video-thumb", "YouTube")}
          </div>
          <div class="list-row-main">
            <strong class="truncate-2" title="${escapeHtml(item.title || "Video sin titulo")}">${escapeHtml(item.title || "Video sin titulo")}</strong>
            <p>${formatMetric(item.viewCount)} vistas · ${formatIsoDuration(item.duration) || "-"} · ${formatDate(item.publishedAt)}</p>
          </div>
          <div class="list-row-side">
            ${item.url ? `<a class="ghost-button" href="${item.url}" target="_blank" rel="noreferrer">Abrir</a>` : ""}
          </div>
        </article>
      `
    )
    .join("");
}

function filterPublishableLibrary(accountId) {
  const search = String(state.profilePublishFilters.search || "").trim().toLowerCase();
  const source = String(state.profilePublishFilters.source || "").trim().toLowerCase();
  const availability = String(state.profilePublishFilters.availability || "available").toLowerCase();

  return state.libraryItems.filter((item) => {
    const haystack = [getLibraryTitle(item), getLibraryOrigin(item), item.channel_title].filter(Boolean).join(" ").toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesSource = !source || getLibrarySource(item) === source;
    const isAssignedToAnother = item.youtube_account_id && String(item.youtube_account_id) !== String(accountId);
    const isPublished = getLibraryStatus(item) === "published";
    const isAvailable = !isAssignedToAnother && !isPublished;
    const matchesAvailability = availability === "all" || isAvailable;
    return matchesSearch && matchesSource && matchesAvailability;
  });
}

function renderPublishRows(items, accountId) {
  if (!items.length) {
    return '<div class="empty-state">No hay videos de biblioteca disponibles para este canal.</div>';
  }

  return items
    .map((item) => {
      const id = String(item.id);
      const selected = state.selectedLibraryIds.has(id);

      return `
        <article class="list-row list-row-compact publish-row ${selected ? "is-selected" : ""}">
          <label class="row-checkbox">
            <input type="checkbox" data-action="toggle-library-select" data-id="${id}" ${selected ? "checked" : ""} />
          </label>
          <div class="list-row-thumb">
            ${renderThumb(item.thumbnail_url || item.poster_url || "", getLibraryTitle(item), "video-row-thumb", "Biblioteca")}
          </div>
          <div class="list-row-main">
            <strong class="truncate-2" title="${escapeHtml(getLibraryTitle(item))}">${escapeHtml(getLibraryTitle(item))}</strong>
            <p class="truncate-1" title="${escapeHtml(getLibraryOrigin(item))}">${escapeHtml(getLibraryOrigin(item))}</p>
          </div>
          <div class="list-row-meta">
            <span class="meta-chip">${escapeHtml(translateStatus(getLibraryStatus(item)))}</span>
            <span class="meta-chip">${escapeHtml(translateStorageProvider(item.storage_provider || "local"))}</span>
          </div>
          <div class="list-row-side list-row-actions">
            <button type="button" class="ghost-button" data-action="publish-add-to-queue" data-id="${item.id}" data-account-id="${accountId}">Agregar</button>
            <button type="button" data-action="publish-now-from-library" data-id="${item.id}" data-account-id="${accountId}">Publicar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderProfileQueueRows(items) {
  if (!items.length) {
    return '<div class="empty-state">No hay videos en cola para este canal.</div>';
  }

  return items
    .map((item) => {
      const id = String(item.id);
      const expanded = String(state.expandedProfilePublicationId || "") === id;
      const title = getPublicationTitle(item);
      const scheduleLabel = item.scheduled_for ? formatDate(item.scheduled_for) : formatDate(item.created_at);
      const sourceLabel =
        item.source_kind === "clone"
          ? `${item.clone_display_name || `@${item.clone_username || "origen"}`} -> ${accountLabel(getSelectedAccount())}`
          : item.source_kind === "library_video"
            ? getLibraryOrigin(item)
            : `@${item.username || "origen"}`;

      return `
        <article class="profile-publication-card ${expanded ? "is-expanded" : ""}">
          <button type="button" class="profile-publication-bar" data-action="profile-publication-toggle" data-id="${id}" aria-expanded="${expanded ? "true" : "false"}">
            <div class="profile-publication-summary">
              <div class="list-row-thumb">
                ${renderThumb(getPublicationPreview(item), title, "video-row-thumb", "Preview")}
              </div>
              <div class="list-row-main">
                <strong class="truncate-2" title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
                <p class="truncate-1" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</p>
              </div>
            </div>
            <div class="profile-publication-meta">
              <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
                translateStatus(item.status)
              )}</span>
              <span class="meta-chip">${escapeHtml(scheduleLabel)}</span>
              <span class="meta-chip profile-publication-expand">${expanded ? "Ocultar" : "Editar"}</span>
            </div>
          </button>
          ${
            expanded
              ? `
                <div class="profile-publication-editor">
                  <div class="profile-publication-preview">
                    ${renderThumb(getPublicationPreview(item), title, "video-thumb", "Preview")}
                  </div>
                  <div class="profile-publication-fields">
                    <label>
                      <span>Titulo</span>
                      <input type="text" data-publication-field="title" value="${escapeHtml(title)}" maxlength="100" />
                    </label>
                    <label>
                      <span>Descripcion</span>
                      <textarea data-publication-field="description" rows="6">${escapeHtml(item.description || "")}</textarea>
                    </label>
                    <div class="profile-publication-actions">
                      <button type="button" class="ghost-button" data-action="profile-publication-save" data-id="${id}">Guardar cambios</button>
                      ${
                        ["ready", "scheduled", "failed"].includes(String(item.status || "").toLowerCase())
                          ? `<button type="button" data-action="profile-publication-publish" data-id="${id}">Publicar</button>`
                          : ""
                      }
                      <button type="button" class="ghost-button" data-action="profile-publication-sync" data-id="${id}">Sincronizar</button>
                      ${
                        item.youtube_url
                          ? `<a class="ghost-button" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir</a>`
                          : ""
                      }
                    </div>
                  </div>
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderCloneCards(items) {
  if (!items.length) {
    return '<div class="empty-state">Todavia no hay clonaciones creadas.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="list-row">
          <div class="list-row-main">
            <strong class="truncate-2" title="${escapeHtml(item.display_name || `@${item.username}`)}">${escapeHtml(
              item.display_name || `@${item.username}`
            )}</strong>
            <p>${Number(item.total_items_count || 0)} programados · ${Number(item.daily_limit || 1)} por dia</p>
          </div>
          <div class="list-row-meta">
            <span class="badge ${String(item.status).toLowerCase() === "active" ? "success" : ""}">${escapeHtml(translateStatus(item.status))}</span>
            <span class="meta-chip">${escapeHtml(formatDate(item.last_scheduled_for || item.updated_at))}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderQueueCards(items) {
  if (!items.length) {
    return '<div class="empty-state">No hay actividad para mostrar.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="list-row">
          <div class="list-row-main">
            <strong class="truncate-2" title="${escapeHtml(item.title || "Publicacion sin titulo")}">${escapeHtml(
              item.title || "Publicacion sin titulo"
            )}</strong>
            <p class="truncate-1" title="${escapeHtml(translateStatusDetail(item.status_detail || item.status || ""))}">${escapeHtml(
              translateStatusDetail(item.status_detail || item.status || "")
            )}</p>
          </div>
          <div class="list-row-meta">
            <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span class="meta-chip">${item.scheduled_for ? formatDate(item.scheduled_for) : "Listo"}</span>
          </div>
        </article>
      `
    )
    .join("");
}

export function renderQueue() {
  const groups = {
    all: state.publications,
    active: state.publications.filter((item) => ["queued", "ready", "awaiting_oauth"].includes(String(item.status || "").toLowerCase())),
    publishing: state.publications.filter((item) => String(item.status || "").toLowerCase() === "publishing"),
    scheduled: state.publications.filter((item) => String(item.status || "").toLowerCase() === "scheduled"),
    failed: state.publications.filter((item) => String(item.status || "").toLowerCase() === "failed"),
    published: state.publications.filter((item) => String(item.status || "").toLowerCase() === "published")
  };

  elements.queueSummaryStrip.innerHTML = Object.entries(groups)
    .map(
      ([key, items]) => `
        <article class="summary-chip ${state.queueTab === key ? "active" : ""}">
          <span>${escapeHtml(labelQueueTab(key))}</span>
          <strong>${items.length}</strong>
        </article>
      `
    )
    .join("");

  elements.queueTabBar.querySelectorAll(".queue-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.queueTab === state.queueTab);
  });

  const filtered = groups[state.queueTab] || groups.all;
  const { pageItems, currentPage, totalPages, start, end } = paginate(filtered, state.queuePage, state.queuePageSize);

  state.queuePage = currentPage;
  elements.queuePagerLabel.textContent = filtered.length ? `${start}-${end} de ${filtered.length}` : "0 resultados";
  elements.queuePrevPage.disabled = currentPage <= 1;
  elements.queueNextPage.disabled = currentPage >= totalPages;

  if (!filtered.length) {
    renderEmpty(elements.publicationList, "No hay publicaciones para esta vista.");
    return;
  }

  elements.publicationList.innerHTML = pageItems
    .map((item) => {
      const sourceLabel =
        item.source_kind === "clone"
          ? `${item.clone_display_name || `@${item.clone_username || "origen"}`} -> ${item.channel_title || "sin canal"}`
          : item.source_kind === "library_video"
            ? `${item.original_filename || "biblioteca"} -> ${item.channel_title || "sin canal"}`
            : `@${item.username || "origen"} -> ${item.channel_title || "sin canal"}`;

      return `
        <article class="queue-item queue-item-compact">
          <div class="queue-item-main">
            <strong class="truncate-2" title="${escapeHtml(getPublicationTitle(item))}">${escapeHtml(getPublicationTitle(item))}</strong>
            <p class="truncate-1" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</p>
          </div>
          <div class="queue-item-meta">
            <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span class="meta-chip">${escapeHtml(translateSourceKind(item.source_kind))}</span>
            <span class="meta-chip">${item.scheduled_for ? formatDate(item.scheduled_for) : formatDate(item.created_at)}</span>
          </div>
          <div class="queue-item-actions">
            ${
              ["ready", "scheduled", "failed"].includes(String(item.status || "").toLowerCase())
                ? `<button type="button" class="ghost-button" data-action="publication-publish" data-id="${item.id}">Publicar</button>`
                : ""
            }
            <button type="button" class="ghost-button" data-action="publication-sync" data-id="${item.id}">Sincronizar</button>
            ${item.youtube_url ? `<a class="ghost-button" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

function labelQueueTab(value) {
  const labels = {
    all: "Todo",
    active: "Pendientes",
    publishing: "Publicando",
    scheduled: "Programados",
    failed: "Fallidos",
    published: "Publicados"
  };

  return labels[value] || value;
}

export function renderOverview() {
  const summary = state.dashboardSummary;
  if (!summary) {
    renderEmpty(elements.summaryStrip, "Sin datos del sistema.");
    renderEmpty(elements.overviewScrapedList, "Sin perfiles.");
    renderEmpty(elements.overviewPublicationsList, "Sin actividad.");
    return;
  }

  elements.summaryStrip.innerHTML = [
    ["Perfiles", summary.tracked_profiles || 0],
    ["Videos scrapeados", summary.media_items || 0],
    ["Biblioteca", summary.library_videos || 0],
    ["Canales", summary.youtube_accounts || 0],
    ["En cola", summary.queued_publications || 0],
    ["Programados", summary.scheduled_publications || 0]
  ]
    .map(
      ([label, value]) => `
        <article class="summary-chip">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </article>
      `
    )
    .join("");

  const recentProfiles = Array.isArray(summary.recent_profiles) ? summary.recent_profiles : [];
  const recentPublications = Array.isArray(summary.recent_publications) ? summary.recent_publications : [];

  if (!recentProfiles.length) {
    renderEmpty(elements.overviewScrapedList, "Sin perfiles recientes.");
  } else {
    elements.overviewScrapedList.innerHTML = recentProfiles
      .map((profile) => {
        const label = profile.username?.startsWith("tag-")
          ? `#${String(profile.username).replace(/^tag-/, "")}`
          : `@${profile.username}`;
        return `
          <article class="list-row">
            <div class="list-row-main">
              <strong class="truncate-2" title="${escapeHtml(profile.display_name || label)}">${escapeHtml(profile.display_name || label)}</strong>
              <p>${Number(profile.video_count || 0)} videos · ${escapeHtml(translateStatus(profile.last_scrape_status || "idle"))}</p>
            </div>
            <div class="list-row-meta">
              <span class="meta-chip">${escapeHtml(formatDate(profile.last_scraped_at))}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  if (!recentPublications.length) {
    renderEmpty(elements.overviewPublicationsList, "Sin publicaciones recientes.");
  } else {
    elements.overviewPublicationsList.innerHTML = recentPublications
      .map(
        (item) => `
          <article class="list-row">
            <div class="list-row-main">
              <strong class="truncate-2" title="${escapeHtml(getPublicationTitle(item))}">${escapeHtml(getPublicationTitle(item))}</strong>
              <p class="truncate-1" title="${escapeHtml(`@${item.username || "origen"}`)}">${escapeHtml(`@${item.username || "origen"}`)}</p>
            </div>
            <div class="list-row-meta">
              <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
                translateStatus(item.status)
              )}</span>
              <span class="meta-chip">${escapeHtml(formatDate(item.created_at))}</span>
            </div>
          </article>
        `
      )
      .join("");
  }
}
