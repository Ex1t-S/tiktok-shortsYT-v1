import { elements, state } from "./dom.js";
import {
  escapeHtml,
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
  return escapeHtml(account?.channel_title || account?.channel_handle || account?.channel_id || "Canal");
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
  return item.title || item.original_filename || pathFromArchive(item.source_archive_path) || "Video sin titulo";
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

function describeYoutubeTab(tab) {
  const labels = {
    videos: "Uploads recientes del canal.",
    stats: "Metricas y actividad resumida.",
    publish: "Videos de biblioteca listos para cola.",
    clone: "Clonacion programada desde TikTok scrapeado."
  };
  return labels[tab] || "Workspace del canal.";
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
      return `
        <button type="button" class="profile-list-item ${active ? "active" : ""}" data-action="select-scraped-profile" data-username="${escapeHtml(
          profile.username
        )}">
          <span class="profile-list-name">${escapeHtml(profile.display_name || label)}</span>
          <span class="profile-list-sub">${escapeHtml(translateStatus(status))} · ${Number(
            profile.stored_video_count || profile.video_count || 0
          )} videos</span>
        </button>
      `;
    })
    .join("");
}

function renderScrapedWorkspace() {
  const profile = state.currentTrackingProfile;
  const scrape = state.currentTrackingRun;
  if (!profile) {
    renderEmpty(elements.scrapedProfileHeader, "Elegi un perfil scrapeado o ejecuta un escaneo nuevo.");
    renderEmpty(elements.scrapedVideosGrid, "Todavia no hay videos para mostrar.");
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
  const badgeClass = scrape?.status === "failed" ? "danger" : scrape?.status === "success" ? "success" : "";
  elements.scrapedProfileHeader.innerHTML = `
    <div class="profile-summary-head">
      <div>
        <p class="eyebrow">Perfil scrapeado</p>
        <h3>${escapeHtml(profile.display_name || label)}</h3>
        <p class="helper-copy">${escapeHtml(label)} · ${Number(profile.total_media_count || 0)} items</p>
      </div>
      <div class="profile-header-actions">
        <span class="badge ${badgeClass}">${escapeHtml(translateStatus(scrape?.status || profile.last_scrape_status || "idle"))}</span>
        <button type="button" class="ghost-button" data-action="rescan-scraped-profile">Reescanear</button>
      </div>
    </div>
    <div class="mini-stats-grid">
      <article class="mini-stat"><span>Videos</span><strong>${Number(profile.video_count || 0)}</strong></article>
      <article class="mini-stat"><span>Imagenes</span><strong>${Number(profile.image_count || 0)}</strong></article>
      <article class="mini-stat"><span>Nuevos</span><strong>${Number(scrape?.new_items_count || 0)}</strong></article>
      <article class="mini-stat"><span>Guardados</span><strong>${Number(scrape?.saved_count || state.currentItems.length || 0)}</strong></article>
      <article class="mini-stat"><span>Ultimo scrape</span><strong>${escapeHtml(formatDate(profile.last_scraped_at))}</strong></article>
    </div>
    ${
      scrape?.progress_message
        ? `<article class="compact-info-card soft-card"><strong>Tracking</strong><p>${escapeHtml(scrape.progress_message)}</p></article>`
        : ""
    }
  `;

  const total = state.currentItems.length;
  elements.saveLibraryButton.disabled = state.selectedTrackIds.size === 0;
  elements.scrapedResultsMeta.textContent = total
    ? `${state.selectedTrackIds.size} seleccionados · ${total} videos cargados`
    : "Sin videos todavia.";

  const canLoadMore = Number(state.currentTrackTotalAvailable || 0) > total || total >= state.currentTrackLimit;
  elements.loadMoreMediaButton.classList.toggle("hidden", !canLoadMore);

  if (!total) {
    renderEmpty(elements.scrapedVideosGrid, "Todavia no hay videos scrapeados para este perfil.");
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
        <article class="video-card ${selected ? "is-selected" : ""}">
          <label class="select-chip">
            <input type="checkbox" data-action="toggle-track" data-id="${id}" ${selected ? "checked" : ""} />
            <span>Seleccionar</span>
          </label>
          ${renderThumb(item.thumbnail_url, item.caption || "Video", "video-thumb", "TikTok")}
          <div class="video-card-body">
            <strong>${escapeHtml(item.caption || "Video sin titulo")}</strong>
            <p>${escapeHtml(
              [formatDuration(item.duration_seconds), `${formatMetric(item.view_count)} vistas`, formatDate(item.published_at)]
                .filter(Boolean)
                .join(" · ")
            )}</p>
          </div>
          <div class="video-card-actions compact-actions">
            <a class="ghost-button" href="${item.post_url || "#"}" target="_blank" rel="noreferrer">Abrir</a>
            <a class="ghost-button" href="/api/media/${item.id}/download">Descargar</a>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderYoutubeAccounts() {
  renderOauthBox();
  renderYoutubeAccountsList();
  renderYoutubeWorkspace();
}

function renderYoutubeAccountsList() {
  if (!state.accounts.length) {
    renderEmpty(elements.youtubeProfilesList, "Todavia no conectaste cuentas de YouTube.");
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
      return `
        <button type="button" class="profile-list-item ${active ? "active" : ""}" data-action="select-youtube-profile" data-id="${account.id}">
          <span class="profile-list-name">${accountLabel(account)}</span>
          <span class="profile-list-sub">${escapeHtml(translateStatus(account.oauth_status))} · ${queueCount} en cola</span>
        </button>
      `;
    })
    .join("");
}

export function renderOauthBox() {
  const oauth = state.oauth;
  if (!oauth) {
    elements.youtubeOauthBox.innerHTML = '<div class="compact-info-card">Cargando OAuth...</div>';
    return;
  }

  elements.addYoutubeAccountButton.setAttribute("href", oauth.ready ? "/api/youtube/oauth/start" : "#");
  elements.addYoutubeAccountButton.setAttribute("aria-disabled", oauth.ready ? "false" : "true");

  if (oauth.ready) {
    elements.youtubeOauthBox.innerHTML = `
      <article class="compact-info-card soft-card">
        <strong>OAuth listo</strong>
        <p>${escapeHtml(oauth.redirectUri || "Google OAuth configurado.")}</p>
      </article>
    `;
  } else {
    elements.youtubeOauthBox.innerHTML = `
      <article class="compact-info-card danger-soft-card">
        <strong>OAuth incompleto</strong>
        <p>${escapeHtml((oauth.missingVariables || []).join(", ") || "Faltan variables de Google")}</p>
      </article>
    `;
  }
}

function renderYoutubeWorkspace() {
  const account = getSelectedAccount();
  if (!account) {
    renderEmpty(elements.youtubeProfileHeader, "Conecta o elegi una cuenta de YouTube.");
    renderEmpty(elements.youtubeProfileTabContent, "Todavia no hay una cuenta activa.");
    renderEmpty(elements.youtubeSideActions, "Abri el panel de canales para elegir una cuenta.");
    return;
  }

  const videos = getSelectedAccountVideos();
  const channel = getSelectedAccountChannel();
  const publications = getSelectedAccountPublications();
  const clones = getSelectedAccountClones();
  const queued = publications.filter((item) => isQueueLikeStatus(item.status));
  const latestVideoTitle = videos[0]?.title || "Todavia no hay videos sincronizados.";

  const toolbarCopy = document.querySelector(".youtube-main-toolbar-copy strong");
  if (toolbarCopy) {
    toolbarCopy.textContent = `Canal activo: ${account.channel_handle || account.channel_title || account.channel_id || "YouTube"}`;
  }

  elements.youtubeProfileHeader.innerHTML = `
    <div class="profile-summary-head youtube-workspace-hero">
      <div class="youtube-hero-copy">
        <p class="eyebrow">Perfil YouTube</p>
        <h3>${accountLabel(account)}</h3>
        <p class="helper-copy">${escapeHtml(account.channel_handle || account.channel_id || account.contact_email || "")}</p>
      </div>
      <div class="profile-header-actions">
        <span class="badge ${account.oauth_status === "connected" ? "success" : "warning"}">${escapeHtml(
          translateStatus(account.oauth_status)
        )}</span>
        <a class="button-link" href="/api/youtube/accounts/${account.id}/connect">Reconectar OAuth</a>
      </div>
    </div>
    <div class="mini-stats-grid mini-stats-grid-compact">
      <article class="mini-stat"><span>Videos</span><strong>${Number(channel?.statistics?.videoCount || videos.length || 0)}</strong></article>
      <article class="mini-stat"><span>Suscriptores</span><strong>${formatMetric(channel?.statistics?.subscriberCount || 0)}</strong></article>
      <article class="mini-stat"><span>Vistas canal</span><strong>${formatMetric(channel?.statistics?.viewCount || 0)}</strong></article>
      <article class="mini-stat"><span>En cola</span><strong>${queued.length}</strong></article>
      <article class="mini-stat"><span>Clonaciones</span><strong>${clones.length}</strong></article>
    </div>
  `;

  elements.youtubeProfileTabBar.querySelectorAll(".profile-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.currentYoutubeTab);
  });

  renderYoutubeTabContent(account, channel, videos, publications, clones);

  elements.youtubeSideActions.innerHTML = `
    <article class="compact-info-card compact-info-card-inline">
      <strong>Estado</strong>
      <p>${escapeHtml(
        account.oauth_status === "connected" ? "Listo para publicar, clonar y mover cola." : "Falta reconectar OAuth para publicar."
      )}</p>
    </article>
    <article class="compact-info-card compact-info-card-inline">
      <strong>Ultimo video</strong>
      <p class="truncate-2">${escapeHtml(latestVideoTitle)}</p>
    </article>
    <article class="compact-info-card compact-info-card-inline">
      <strong>Seccion activa</strong>
      <p>${escapeHtml(describeYoutubeTab(state.currentYoutubeTab))}</p>
    </article>
  `;
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
      <section class="subpanel youtube-section-shell">
        <div class="subpanel-head between">
          <div class="youtube-section-copy">
            <strong>Videos del canal</strong>
            <span class="helper-inline">${videos.length ? `${start}-${end} de ${videos.length}` : "Sin videos"}</span>
          </div>
          <div class="pager-controls">
            <button type="button" class="ghost-button" data-action="youtube-videos-prev">Anterior</button>
            <button type="button" class="ghost-button" data-action="youtube-videos-next">Siguiente</button>
          </div>
        </div>
        ${renderChannelVideoCards(pageItems)}
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
      <section class="subpanel youtube-section-shell">
        <div class="mini-stats-grid mini-stats-grid-compact">
          <article class="mini-stat"><span>Suscriptores</span><strong>${formatMetric(channel?.statistics?.subscriberCount || 0)}</strong></article>
          <article class="mini-stat"><span>Vistas recientes</span><strong>${formatMetric(totalViews)}</strong></article>
          <article class="mini-stat"><span>Likes recientes</span><strong>${formatMetric(totalLikes)}</strong></article>
          <article class="mini-stat"><span>Publicaciones locales</span><strong>${publications.length}</strong></article>
          <article class="mini-stat"><span>Publicados</span><strong>${published}</strong></article>
        </div>
        <div class="two-column-panel top-gap">
          <section class="subpanel">
            <div class="subpanel-head"><strong>Estado del canal</strong></div>
            <article class="compact-info-card">
              <p>Canal: ${accountLabel(account)}</p>
              <p>OAuth: ${escapeHtml(translateStatus(account.oauth_status))}</p>
              <p>Ultima sincronizacion: ${escapeHtml(formatDate(account.last_sync_at))}</p>
            </article>
          </section>
          <section class="subpanel">
            <div class="subpanel-head"><strong>Actividad</strong></div>
            ${renderQueueCards(publications.slice(0, 4))}
          </section>
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
    elements.youtubeProfileTabContent.innerHTML = `
      <section class="subpanel youtube-section-shell">
        <div class="subpanel-head between">
          <div class="youtube-section-copy">
            <strong>Publicar desde biblioteca</strong>
            <span class="helper-inline">${publishable.length ? `${start}-${end} de ${publishable.length}` : "Sin disponibles"}</span>
          </div>
          <div class="toolbar-row compact wrap tiny-gap publish-filter-row">
            <input id="profile-publish-search" type="search" placeholder="Buscar en biblioteca" value="${escapeHtml(
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
        ${renderPublishRows(pageItems, account.id)}
        <div class="pager-row tight top-gap">
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
    <section class="subpanel youtube-section-shell">
      <div class="subpanel-head between">
        <div class="youtube-section-copy">
          <strong>Clonar perfil TikTok</strong>
          <span class="helper-inline">Programa todos los videos del perfil elegido con un limite diario.</span>
        </div>
      </div>
      <div class="youtube-clone-layout">
        <section class="subpanel youtube-clone-form-panel">
          <div class="subpanel-head"><strong>Nueva clonacion</strong></div>
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
              <article class="compact-info-card soft-card">
                <strong>Vista previa</strong>
                <p>${preview.profile ? `${Number(preview.totalVideos)} videos · ${preview.totalDays} dias estimados` : "Elegi un perfil scrapeado para ver la prevision."}</p>
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
        <section class="subpanel youtube-clone-list-panel">
          <div class="subpanel-head"><strong>Clonaciones activas</strong></div>
          ${renderCloneCards(clones)}
        </section>
      </div>
    </section>
  `;
}

function renderChannelVideoCards(items) {
  if (!items.length) {
    return '<div class="empty-state">Todavia no hay videos para mostrar.</div>';
  }
  return items
    .map(
      (item) => `
        <article class="channel-video-row">
          ${renderThumb(item.thumbnails?.medium?.url || item.thumbnails?.default?.url || "", item.title || "", "channel-video-thumb", "YouTube")}
          <div class="channel-video-main">
            <strong>${escapeHtml(item.title || "Video sin titulo")}</strong>
            <p>${formatMetric(item.viewCount)} vistas · ${formatIsoDuration(item.duration) || "-"} · ${formatDate(item.publishedAt)}</p>
          </div>
          <div class="channel-video-side">
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
    .map(
      (item) => `
        <article class="video-row publish-row">
          ${renderThumb(item.thumbnail_url || item.poster_url || "", getLibraryTitle(item), "video-row-thumb", "Biblioteca")}
          <div class="video-row-main">
            <strong>${escapeHtml(getLibraryTitle(item))}</strong>
            <p>${escapeHtml(getLibraryOrigin(item))}</p>
          </div>
          <div class="video-row-meta">
            <span>${escapeHtml(translateStatus(getLibraryStatus(item)))}</span>
            <span>${escapeHtml(translateStorageProvider(item.storage_provider || "local"))}</span>
          </div>
          <div class="video-row-actions">
            <button type="button" class="ghost-button" data-action="publish-add-to-queue" data-id="${item.id}" data-account-id="${accountId}">Agregar a cola</button>
            <button type="button" data-action="publish-now-from-library" data-id="${item.id}" data-account-id="${accountId}">Publicar ahora</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCloneCards(items) {
  if (!items.length) {
    return '<div class="empty-state">Todavia no hay clonaciones creadas.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="queue-card">
          <div class="queue-card-main">
            <strong>${escapeHtml(item.display_name || `@${item.username}`)}</strong>
            <p>${Number(item.total_items_count || 0)} programados · ${Number(item.daily_limit || 1)} por dia</p>
          </div>
          <div class="queue-card-side">
            <span class="badge ${String(item.status).toLowerCase() === "active" ? "success" : ""}">${escapeHtml(translateStatus(item.status))}</span>
            <span>${escapeHtml(formatDate(item.last_scheduled_for || item.updated_at))}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderQueueCards(items) {
  if (!items.length) {
    return '<div class="empty-state">No hay elementos para mostrar.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="queue-card">
          <div class="queue-card-main">
            <strong>${escapeHtml(item.title || "Publicacion sin titulo")}</strong>
            <p>${escapeHtml(translateStatusDetail(item.status_detail || item.status || ""))}</p>
          </div>
          <div class="queue-card-side">
            <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span>${item.scheduled_for ? formatDate(item.scheduled_for) : "listo ahora"}</span>
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
      ([key, items]) =>
        `<article class="summary-chip ${state.queueTab === key ? "active" : ""}"><span>${labelQueueTab(key)}</span><strong>${items.length}</strong></article>`
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
    renderEmpty(elements.publicationList, "No hay publicaciones para esta pestana.");
    return;
  }

  elements.publicationList.innerHTML = pageItems
    .map((item) => {
      const sourceLabel =
        item.source_kind === "clone"
          ? `${item.clone_display_name || `@${item.clone_username || "origen"}`} → ${item.channel_title || "sin canal"}`
          : item.source_kind === "library_video"
            ? `${item.original_filename || "video de biblioteca"} → ${item.channel_title || "sin canal"}`
            : `@${item.username || "origen"} → ${item.channel_title || "sin canal"}`;
      return `
        <article class="queue-row">
          <div class="queue-row-main">
            <strong>${escapeHtml(item.title || "Publicacion sin titulo")}</strong>
            <p>${escapeHtml(sourceLabel)}</p>
          </div>
          <div class="queue-row-meta">
            <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span>${escapeHtml(translateSourceKind(item.source_kind))}</span>
            <span>${item.scheduled_for ? formatDate(item.scheduled_for) : formatDate(item.created_at)}</span>
          </div>
          <div class="queue-row-actions">
            ${["ready", "scheduled", "failed"].includes(String(item.status || "").toLowerCase()) ? `<button type="button" class="ghost-button" data-action="publication-publish" data-id="${item.id}">Publicar</button>` : ""}
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
    renderEmpty(elements.summaryStrip, "Todavia no hay resumen del sistema.");
    renderEmpty(elements.overviewScrapedList, "Sin datos.");
    renderEmpty(elements.overviewPublicationsList, "Sin datos.");
    return;
  }

  const cards = [
    ["Perfiles scrapeados", summary.tracked_profiles || 0],
    ["Videos scrapeados", summary.media_items || 0],
    ["Biblioteca", summary.library_videos || 0],
    ["Canales YouTube", summary.youtube_accounts || 0],
    ["En cola", summary.queued_publications || 0],
    ["Programados", summary.scheduled_publications || 0]
  ];

  elements.summaryStrip.innerHTML = cards
    .map(
      ([label, value]) => `<article class="summary-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`
    )
    .join("");

  const recentProfiles = Array.isArray(summary.recent_profiles) ? summary.recent_profiles : [];
  if (!recentProfiles.length) {
    renderEmpty(elements.overviewScrapedList, "Todavia no hay perfiles recientes.");
  } else {
    elements.overviewScrapedList.innerHTML = recentProfiles
      .map((profile) => {
        const label = profile.username?.startsWith("tag-")
          ? `#${String(profile.username).replace(/^tag-/, "")}`
          : `@${profile.username}`;
        return `
          <article class="queue-card">
            <div class="queue-card-main">
              <strong>${escapeHtml(profile.display_name || label)}</strong>
              <p>${Number(profile.video_count || 0)} videos · ${escapeHtml(translateStatus(profile.last_scrape_status || "idle"))}</p>
            </div>
            <div class="queue-card-side">
              <span>${escapeHtml(formatDate(profile.last_scraped_at))}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  const recentPublications = Array.isArray(summary.recent_publications) ? summary.recent_publications : [];
  if (!recentPublications.length) {
    renderEmpty(elements.overviewPublicationsList, "Todavia no hay publicaciones recientes.");
  } else {
    elements.overviewPublicationsList.innerHTML = recentPublications
      .map(
        (item) => `
          <article class="queue-card">
            <div class="queue-card-main">
              <strong>${escapeHtml(item.title || "Publicacion sin titulo")}</strong>
              <p>${escapeHtml(`@${item.username || "origen"}`)}</p>
            </div>
            <div class="queue-card-side">
              <span class="badge ${item.status === "published" ? "success" : item.status === "failed" ? "danger" : ""}">${escapeHtml(
                translateStatus(item.status)
              )}</span>
              <span>${escapeHtml(formatDate(item.created_at))}</span>
            </div>
          </article>
        `
      )
      .join("");
  }
}
