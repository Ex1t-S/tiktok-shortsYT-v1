import { elements, state } from './dom.js';
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
} from './utils.js';

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

function accountLabel(account) {
  return escapeHtml(account?.channel_title || account?.channel_handle || account?.channel_id || 'Canal');
}

function getSelectedAccount() {
  return state.accounts.find((item) => String(item.id) === String(state.selectedAccountId)) || null;
}

function getProfileVideos(accountId) {
  return Array.isArray(state.accountVideosById[accountId]) ? state.accountVideosById[accountId] : [];
}

function getProfilePublications(accountId) {
  return state.publications.filter((item) => String(item.youtube_account_id) === String(accountId));
}

function isQueueLikeStatus(status) {
  return ['queued', 'ready', 'awaiting_oauth', 'publishing', 'scheduled'].includes(String(status || '').toLowerCase());
}

function getLibraryTitle(item) {
  return item.title || item.original_filename || pathFromArchive(item.source_archive_path) || 'Video sin título';
}

function getLibraryOrigin(item) {
  return (
    item.source_label ||
    item.username ||
    pathFromArchive(item.source_archive_path) ||
    translateStorageProvider(item.storage_provider || item.source_provider || 'local')
  );
}

function getLibraryStatus(item) {
  return String(item.publication_status || item.status || 'ready').toLowerCase();
}

function getLibrarySource(item) {
  return String(item.source_kind || item.storage_provider || '').toLowerCase();
}

export function fillAccountSelect(select, placeholder = 'Elegir perfil destino') {
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...state.accounts.map(
      (account) =>
        `<option value="${account.id}">${accountLabel(account)} · ${escapeHtml(translateStatus(account.oauth_status))}</option>`
    )
  ].join('');
  if (state.accounts.some((account) => String(account.id) === currentValue)) {
    select.value = currentValue;
  } else if (state.selectedAccountId) {
    select.value = String(state.selectedAccountId);
  }
}

export function renderTracking() {
  const profile = state.currentTrackingProfile;
  const scrape = state.currentTrackingRun;
  if (!profile) {
    renderEmpty(elements.trackingSummary, 'Todavía no elegiste un perfil o hashtag para rastrear.');
  } else {
    const summaryBits = [
      `${Number(profile.total_media_count || state.currentTrackTotalAvailable || state.currentItems.length || 0)} detectados`,
      `${Number(profile.video_count || 0)} videos`,
      `${Number(profile.image_count || 0)} imágenes`,
      profile.last_scraped_at ? `último scrape ${formatDate(profile.last_scraped_at)}` : ''
    ]
      .filter(Boolean)
      .join(' · ');

    elements.trackingSummary.innerHTML = `
      <article class="summary-card tracking-profile-card">
        <div class="summary-card-main">
          <div>
            <p class="eyebrow">Perfil rastreado</p>
            <h3>${escapeHtml(profile.display_name || `@${profile.username || state.currentUsername}`)}</h3>
            <p class="helper-copy">@${escapeHtml(profile.username || state.currentUsername || '-')}</p>
          </div>
          <span class="badge ${scrape?.status === 'failed' ? 'danger' : scrape?.status === 'success' ? 'success' : ''}">${escapeHtml(
            translateStatus(scrape?.status || profile.last_scrape_status || 'idle')
          )}</span>
        </div>
        <p class="helper-copy">${escapeHtml(summaryBits)}</p>
        ${
          scrape?.progress_message
            ? `<p class="helper-inline"><strong>Tracking:</strong> ${escapeHtml(scrape.progress_message)}</p>`
            : ''
        }
      </article>
    `;
  }

  const total = state.currentItems.length;
  elements.saveLibraryButton.disabled = state.selectedTrackIds.size === 0;
  elements.queueSelectedButton.disabled = state.selectedTrackIds.size === 0 || !elements.queueAccountSelect.value;
  elements.trackResultsMeta.textContent = total
    ? `${state.selectedTrackIds.size} seleccionados · ${total} videos cargados`
    : 'Sin resultados todavía.';

  const canLoadMore = Number(state.currentTrackTotalAvailable || 0) > total || total >= state.currentTrackLimit;
  elements.loadMoreMediaButton.classList.toggle('hidden', !canLoadMore);

  if (!total) {
    renderEmpty(elements.mediaGrid, 'Todavía no hay videos rastreados.');
    elements.trackPrevPage.disabled = true;
    elements.trackNextPage.disabled = true;
    elements.trackingPagerLabel.textContent = 'Página 1';
    return;
  }

  const { pageItems, currentPage, totalPages, start, end } = paginate(
    state.currentItems,
    state.currentTrackPage,
    state.currentTrackPageSize
  );
  state.currentTrackPage = currentPage;
  elements.trackingPagerLabel.textContent = `${start}-${end} de ${total}`;
  elements.trackPrevPage.disabled = currentPage <= 1;
  elements.trackNextPage.disabled = currentPage >= totalPages;

  elements.mediaGrid.innerHTML = pageItems
    .map((item) => {
      const id = String(item.id);
      const selected = state.selectedTrackIds.has(id);
      return `
        <article class="video-card ${selected ? 'is-selected' : ''}">
          <label class="select-chip">
            <input type="checkbox" data-action="toggle-track" data-id="${id}" ${selected ? 'checked' : ''} />
            <span>Seleccionar</span>
          </label>
          <img class="video-thumb" src="${item.thumbnail_url || ''}" alt="${escapeHtml(item.caption || getLibraryTitle(item))}" />
          <div class="video-card-body">
            <strong>${escapeHtml(item.caption || 'Video sin título')}</strong>
            <p class="video-meta">${escapeHtml(
              [formatDuration(item.duration_seconds), formatMetric(item.view_count) + ' vistas', formatDate(item.published_at)]
                .filter(Boolean)
                .join(' · ')
            )}</p>
          </div>
          <div class="video-card-actions compact-actions">
            <a class="ghost-button" href="${item.post_url || '#'}" target="_blank" rel="noreferrer">Abrir</a>
            <a class="ghost-button" href="/api/media/${item.id}/download">Descargar</a>
          </div>
        </article>
      `;
    })
    .join('');
}

function filterLibraryItems(filters) {
  const search = String(filters.search || '').trim().toLowerCase();
  const status = String(filters.status || '').toLowerCase();
  const source = String(filters.source || '').toLowerCase();
  return state.libraryItems.filter((item) => {
    const haystack = [getLibraryTitle(item), getLibraryOrigin(item), item.channel_title, item.source_archive_path]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const itemStatus = getLibraryStatus(item);
    const itemSource = getLibrarySource(item);
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = !status || itemStatus === status;
    const matchesSource = !source || itemSource === source;
    return matchesSearch && matchesStatus && matchesSource;
  });
}

export function renderLibrary() {
  const filtered = filterLibraryItems(state.libraryFilters);
  const { pageItems, currentPage, totalPages, start, end } = paginate(filtered, state.libraryPage, state.libraryPageSize);
  state.libraryPage = currentPage;

  elements.libraryResultsMeta.textContent = filtered.length ? `${start}-${end} de ${filtered.length} videos` : '0 videos';
  elements.libraryPrevPageButton.disabled = currentPage <= 1;
  elements.libraryNextPageButton.disabled = currentPage >= totalPages;

  if (!filtered.length) {
    renderEmpty(elements.libraryVideoList, 'No hay videos que coincidan con los filtros actuales.');
    return;
  }

  elements.libraryVideoList.innerHTML = pageItems
    .map((item) => {
      const alreadyAssigned = item.channel_title || item.youtube_account_id;
      return `
        <article class="video-row">
          <img class="video-row-thumb" src="${item.thumbnail_url || item.poster_url || ''}" alt="${escapeHtml(getLibraryTitle(item))}" />
          <div class="video-row-main">
            <strong>${escapeHtml(getLibraryTitle(item))}</strong>
            <p>${escapeHtml(getLibraryOrigin(item))}</p>
          </div>
          <div class="video-row-meta">
            <span>${escapeHtml(translateStatus(getLibraryStatus(item)))}</span>
            <span>${escapeHtml(translateStorageProvider(item.storage_provider || 'local'))}</span>
            ${alreadyAssigned ? `<span>${escapeHtml(item.channel_title || 'asignado')}</span>` : '<span>sin perfil</span>'}
          </div>
          <div class="video-row-actions">
            <button type="button" class="ghost-button" data-action="library-queue" data-id="${item.id}">Agregar a cola</button>
          </div>
        </article>
      `;
    })
    .join('');
}

export function renderProfiles() {
  renderProfilesList();
  renderProfileWorkspace();
}

export function renderProfilesList() {
  if (!state.accounts.length) {
    renderEmpty(elements.profilesList, 'Todavía no agregaste canales de YouTube.');
    elements.profilesPagerLabel.textContent = 'Página 1';
    elements.profilesPrevPage.disabled = true;
    elements.profilesNextPage.disabled = true;
    return;
  }

  const { pageItems, currentPage, totalPages, start, end } = paginate(
    state.accounts,
    state.profileListPage,
    state.profileListPageSize
  );
  state.profileListPage = currentPage;
  elements.profilesPagerLabel.textContent = `${start}-${end} de ${state.accounts.length}`;
  elements.profilesPrevPage.disabled = currentPage <= 1;
  elements.profilesNextPage.disabled = currentPage >= totalPages;

  elements.profilesList.innerHTML = pageItems
    .map((account) => {
      const queueCount = getProfilePublications(account.id).filter((item) => isQueueLikeStatus(item.status)).length;
      return `
        <button type="button" class="profile-list-item ${String(account.id) === String(state.selectedAccountId) ? 'active' : ''}" data-action="select-profile" data-id="${account.id}">
          <span class="profile-list-name">${accountLabel(account)}</span>
          <span class="profile-list-sub">${escapeHtml(translateStatus(account.oauth_status))} · ${queueCount} en cola</span>
        </button>
      `;
    })
    .join('');
}

export function renderOauthBox() {
  const oauth = state.oauth;
  if (!oauth) {
    elements.youtubeOauthBox.innerHTML = '<div class="compact-info-card">Cargando OAuth...</div>';
    return;
  }
  if (oauth.ready) {
    elements.youtubeOauthBox.innerHTML = `
      <article class="compact-info-card soft-card">
        <strong>OAuth disponible</strong>
        <p>${oauth.redirectUri ? `Redirect activo: ${escapeHtml(oauth.redirectUri)}` : 'Revisá las variables de Google.'}</p>
      </article>
    `;
  } else {
    elements.youtubeOauthBox.innerHTML = `
      <article class="compact-info-card danger-soft-card">
        <strong>OAuth incompleto</strong>
        <p>${escapeHtml((oauth.missingVariables || []).join(', ') || 'Faltan variables')}</p>
      </article>
    `;
  }
}

export function renderProfileWorkspace() {
  const account = getSelectedAccount();
  if (!account) {
    renderEmpty(elements.profileHeader, 'Elegí un perfil para ver el workspace del canal.');
    renderEmpty(elements.profileTabContent, 'Todavía no hay un perfil activo.');
    renderEmpty(elements.profileSideActions, 'Las acciones del perfil aparecerán acá.');
    return;
  }

  const videos = getProfileVideos(account.id);
  const publications = getProfilePublications(account.id);
  const queued = publications.filter((item) => isQueueLikeStatus(item.status));
  const published = publications.filter((item) => String(item.status).toLowerCase() === 'published');
  const totalViews = videos.reduce((sum, item) => sum + Number(item.viewCount || 0), 0);
  const totalLikes = videos.reduce((sum, item) => sum + Number(item.likeCount || 0), 0);

  elements.profileHeader.innerHTML = `
    <div class="profile-summary-head">
      <div>
        <p class="eyebrow">Perfil activo</p>
        <h3>${accountLabel(account)}</h3>
        <p class="helper-copy">${escapeHtml(account.channel_handle || account.contact_email || account.channel_id || '')}</p>
      </div>
      <div class="profile-header-actions">
        <span class="badge ${account.oauth_status === 'connected' ? 'success' : 'warning'}">${escapeHtml(
          translateStatus(account.oauth_status)
        )}</span>
        <a class="button-link" href="/api/youtube/accounts/${account.id}/connect">Conectar OAuth</a>
      </div>
    </div>
    <div class="mini-stats-grid">
      <article class="mini-stat"><span>Subidos</span><strong>${videos.length}</strong></article>
      <article class="mini-stat"><span>Vistas recientes</span><strong>${formatMetric(totalViews)}</strong></article>
      <article class="mini-stat"><span>Likes recientes</span><strong>${formatMetric(totalLikes)}</strong></article>
      <article class="mini-stat"><span>En cola</span><strong>${queued.length}</strong></article>
      <article class="mini-stat"><span>Publicados</span><strong>${published.length}</strong></article>
    </div>
  `;

  elements.profileTabBar.querySelectorAll('.profile-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.currentProfileTab);
  });

  renderProfileTabContent(account, videos, publications);

  elements.profileSideActions.innerHTML = `
    <article class="compact-info-card">
      <strong>Estado del perfil</strong>
      <p>${escapeHtml(account.oauth_status === 'connected' ? 'Listo para publicar.' : 'Conectá OAuth antes de publicar.')}</p>
    </article>
    <article class="compact-info-card">
      <strong>Subidos recientes</strong>
      <p>${videos.length ? `Último video: ${escapeHtml(videos[0]?.title || 'sin título')}` : 'Todavía no hay videos sincronizados.'}</p>
    </article>
    <div class="inline-action-list">
      <button type="button" class="ghost-button" data-action="refresh-profile-videos" data-id="${account.id}">Sincronizar videos</button>
      <button type="button" class="ghost-button" data-action="open-queue-view">Ver cola general</button>
    </div>
  `;
}

function renderProfileTabContent(account, videos, publications) {
  if (state.currentProfileTab === 'summary') {
    const queueItems = publications.filter((item) => isQueueLikeStatus(item.status)).slice(0, 4);
    elements.profileTabContent.innerHTML = `
      <div class="two-column-panel">
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Últimos subidos</strong>
            <span class="helper-inline">Mostrando pocos para no saturar.</span>
          </div>
          ${renderChannelVideoCards(videos.slice(0, 4), true)}
        </section>
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Lo pendiente en este perfil</strong>
            <span class="helper-inline">De acá sale lo que se publica.</span>
          </div>
          ${renderQueueCards(queueItems, true)}
        </section>
      </div>
    `;
    return;
  }

  if (state.currentProfileTab === 'uploads') {
    const { pageItems, currentPage, totalPages, start, end } = paginate(videos, state.profileUploadsPage, state.profileTabPageSize);
    state.profileUploadsPage = currentPage;
    elements.profileTabContent.innerHTML = `
      <section class="subpanel">
        <div class="subpanel-head between">
          <div>
            <strong>Videos subidos</strong>
            <span class="helper-inline">${videos.length ? `${start}-${end} de ${videos.length}` : 'Sin videos'}</span>
          </div>
          <div class="pager-controls">
            <button type="button" class="ghost-button" data-action="profile-uploads-prev">Anterior</button>
            <button type="button" class="ghost-button" data-action="profile-uploads-next">Siguiente</button>
          </div>
        </div>
        ${renderChannelVideoCards(pageItems, false)}
      </section>
    `;
    elements.profileTabContent.querySelector('[data-action="profile-uploads-prev"]').disabled = currentPage <= 1;
    elements.profileTabContent.querySelector('[data-action="profile-uploads-next"]').disabled = currentPage >= totalPages;
    return;
  }

  if (state.currentProfileTab === 'queue') {
    const queueItems = publications.filter((item) => isQueueLikeStatus(item.status));
    const { pageItems, currentPage, totalPages, start, end } = paginate(queueItems, state.profileQueuePage, state.profileTabPageSize);
    state.profileQueuePage = currentPage;
    elements.profileTabContent.innerHTML = `
      <section class="subpanel">
        <div class="subpanel-head between">
          <div>
            <strong>Cola del perfil</strong>
            <span class="helper-inline">${queueItems.length ? `${start}-${end} de ${queueItems.length}` : 'Sin trabajos'}</span>
          </div>
          <div class="pager-controls">
            <button type="button" class="ghost-button" data-action="profile-queue-prev">Anterior</button>
            <button type="button" class="ghost-button" data-action="profile-queue-next">Siguiente</button>
          </div>
        </div>
        ${renderQueueCards(pageItems, false)}
      </section>
    `;
    elements.profileTabContent.querySelector('[data-action="profile-queue-prev"]').disabled = currentPage <= 1;
    elements.profileTabContent.querySelector('[data-action="profile-queue-next"]').disabled = currentPage >= totalPages;
    return;
  }

  const publishable = filterPublishableLibrary(account.id);
  const { pageItems, currentPage, totalPages, start, end } = paginate(
    publishable,
    state.profilePublishPage,
    state.profileTabPageSize
  );
  state.profilePublishPage = currentPage;
  elements.profileTabContent.innerHTML = `
    <section class="subpanel">
      <div class="subpanel-head between">
        <div>
          <strong>Publicar desde biblioteca</strong>
          <span class="helper-inline">${publishable.length ? `${start}-${end} de ${publishable.length}` : 'Sin disponibles'}</span>
        </div>
        <div class="toolbar-row compact wrap tiny-gap publish-filter-row">
          <input id="profile-publish-search" type="search" placeholder="Buscar en biblioteca" value="${escapeHtml(
            state.profilePublishFilters.search
          )}" />
          <select id="profile-publish-source">
            <option value="">Todos los orígenes</option>
            <option value="tracked_media" ${state.profilePublishFilters.source === 'tracked_media' ? 'selected' : ''}>Trackeados</option>
            <option value="zip_import" ${state.profilePublishFilters.source === 'zip_import' ? 'selected' : ''}>ZIP</option>
            <option value="remote_url" ${state.profilePublishFilters.source === 'remote_url' ? 'selected' : ''}>URL</option>
            <option value="s3-compatible" ${state.profilePublishFilters.source === 's3-compatible' ? 'selected' : ''}>Cloud</option>
          </select>
          <select id="profile-publish-availability">
            <option value="available" ${state.profilePublishFilters.availability === 'available' ? 'selected' : ''}>Solo disponibles</option>
            <option value="all" ${state.profilePublishFilters.availability === 'all' ? 'selected' : ''}>Todos</option>
          </select>
        </div>
      </div>
      ${renderPublishRows(pageItems, account.id)}
      <div class="pager-row tight top-gap">
        <span class="pager-label">Página ${currentPage} de ${totalPages}</span>
        <div class="pager-controls">
          <button type="button" class="ghost-button" data-action="profile-publish-prev">Anterior</button>
          <button type="button" class="ghost-button" data-action="profile-publish-next">Siguiente</button>
        </div>
      </div>
    </section>
  `;
  elements.profileTabContent.querySelector('[data-action="profile-publish-prev"]').disabled = currentPage <= 1;
  elements.profileTabContent.querySelector('[data-action="profile-publish-next"]').disabled = currentPage >= totalPages;
}

function filterPublishableLibrary(accountId) {
  const search = String(state.profilePublishFilters.search || '').trim().toLowerCase();
  const source = String(state.profilePublishFilters.source || '').toLowerCase();
  const availability = String(state.profilePublishFilters.availability || 'available').toLowerCase();
  return state.libraryItems.filter((item) => {
    const haystack = [getLibraryTitle(item), getLibraryOrigin(item), item.channel_title].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesSource = !source || getLibrarySource(item) === source;
    const isAssignedToAnother = item.youtube_account_id && String(item.youtube_account_id) !== String(accountId);
    const isPublished = getLibraryStatus(item) === 'published';
    const isAvailable = !isAssignedToAnother && !isPublished;
    const matchesAvailability = availability === 'all' || isAvailable;
    return matchesSearch && matchesSource && matchesAvailability;
  });
}

function renderChannelVideoCards(items, compactMode) {
  if (!items.length) {
    return '<div class="empty-state">Todavía no hay videos para mostrar.</div>';
  }
  return items
    .map(
      (item) => `
        <article class="channel-video-row ${compactMode ? 'compact-mode' : ''}">
          <img class="channel-video-thumb" src="${item.thumbnails?.medium?.url || item.thumbnails?.default?.url || ''}" alt="${escapeHtml(
            item.title || ''
          )}" />
          <div class="channel-video-main">
            <strong>${escapeHtml(item.title || 'Video sin título')}</strong>
            <p>${formatMetric(item.viewCount)} vistas · ${formatDate(item.publishedAt)}</p>
          </div>
          <div class="channel-video-side">
            ${item.url ? `<a class="ghost-button" href="${item.url}" target="_blank" rel="noreferrer">Abrir</a>` : ''}
          </div>
        </article>
      `
    )
    .join('');
}

function renderQueueCards(items, compactMode) {
  if (!items.length) {
    return '<div class="empty-state">No hay elementos en esta cola.</div>';
  }
  return items
    .map(
      (item) => `
        <article class="queue-card ${compactMode ? 'compact-mode' : ''}">
          <div class="queue-card-main">
            <strong>${escapeHtml(item.title || 'Publicación sin título')}</strong>
            <p>${escapeHtml(translateStatusDetail(item.status_detail || item.status || ''))}</p>
          </div>
          <div class="queue-card-side">
            <span class="badge ${item.status === 'published' ? 'success' : item.status === 'failed' ? 'danger' : ''}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span>${item.scheduled_for ? formatDate(item.scheduled_for) : 'listo ahora'}</span>
            <div class="inline-action-list">
              ${['ready', 'scheduled', 'failed'].includes(String(item.status || '').toLowerCase()) ? `<button type="button" class="ghost-button" data-action="publication-publish" data-id="${item.id}">Publicar</button>` : ''}
              <button type="button" class="ghost-button" data-action="publication-sync" data-id="${item.id}">Sincronizar</button>
            </div>
          </div>
        </article>
      `
    )
    .join('');
}

function renderPublishRows(items, accountId) {
  if (!items.length) {
    return '<div class="empty-state">No hay videos de biblioteca disponibles para este perfil.</div>';
  }
  return items
    .map(
      (item) => `
        <article class="video-row publish-row">
          <img class="video-row-thumb" src="${item.thumbnail_url || item.poster_url || ''}" alt="${escapeHtml(getLibraryTitle(item))}" />
          <div class="video-row-main">
            <strong>${escapeHtml(getLibraryTitle(item))}</strong>
            <p>${escapeHtml(getLibraryOrigin(item))}</p>
          </div>
          <div class="video-row-meta">
            <span>${escapeHtml(translateStatus(getLibraryStatus(item)))}</span>
            <span>${escapeHtml(translateStorageProvider(item.storage_provider || 'local'))}</span>
          </div>
          <div class="video-row-actions">
            <button type="button" class="ghost-button" data-action="publish-add-to-queue" data-id="${item.id}" data-account-id="${accountId}">Agregar a cola</button>
            <button type="button" data-action="publish-now-from-library" data-id="${item.id}" data-account-id="${accountId}">Publicar ahora</button>
          </div>
        </article>
      `
    )
    .join('');
}

export function renderQueue() {
  const groups = {
    all: state.publications,
    active: state.publications.filter((item) => ['queued', 'ready', 'awaiting_oauth'].includes(String(item.status || '').toLowerCase())),
    publishing: state.publications.filter((item) => String(item.status || '').toLowerCase() === 'publishing'),
    scheduled: state.publications.filter((item) => String(item.status || '').toLowerCase() === 'scheduled'),
    failed: state.publications.filter((item) => String(item.status || '').toLowerCase() === 'failed'),
    published: state.publications.filter((item) => String(item.status || '').toLowerCase() === 'published')
  };

  elements.queueSummaryStrip.innerHTML = Object.entries(groups)
    .map(
      ([key, items]) => `<article class="summary-chip ${state.queueTab === key ? 'active' : ''}"><span>${labelQueueTab(key)}</span><strong>${items.length}</strong></article>`
    )
    .join('');

  elements.queueTabBar.querySelectorAll('.queue-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.queueTab === state.queueTab);
  });

  const filtered = groups[state.queueTab] || groups.all;
  const { pageItems, currentPage, totalPages, start, end } = paginate(filtered, state.queuePage, state.queuePageSize);
  state.queuePage = currentPage;
  elements.queuePagerLabel.textContent = filtered.length ? `${start}-${end} de ${filtered.length}` : '0 resultados';
  elements.queuePrevPage.disabled = currentPage <= 1;
  elements.queueNextPage.disabled = currentPage >= totalPages;

  if (!filtered.length) {
    renderEmpty(elements.publicationList, 'No hay publicaciones para esta pestaña.');
    return;
  }

  elements.publicationList.innerHTML = pageItems
    .map(
      (item) => `
        <article class="queue-row">
          <div class="queue-row-main">
            <strong>${escapeHtml(item.title || 'Publicación sin título')}</strong>
            <p>${escapeHtml(
              item.source_kind === 'library_video'
                ? `${item.original_filename || 'video de biblioteca'} → ${item.channel_title || 'sin perfil'}`
                : `@${item.username || 'origen'} → ${item.channel_title || 'sin perfil'}`
            )}</p>
          </div>
          <div class="queue-row-meta">
            <span class="badge ${item.status === 'published' ? 'success' : item.status === 'failed' ? 'danger' : ''}">${escapeHtml(
              translateStatus(item.status)
            )}</span>
            <span>${escapeHtml(translateSourceKind(item.source_kind))}</span>
            <span>${item.scheduled_for ? formatDate(item.scheduled_for) : formatDate(item.created_at)}</span>
          </div>
          <div class="queue-row-actions">
            ${['ready', 'scheduled', 'failed'].includes(String(item.status || '').toLowerCase()) ? `<button type="button" class="ghost-button" data-action="publication-publish" data-id="${item.id}">Publicar</button>` : ''}
            <button type="button" class="ghost-button" data-action="publication-sync" data-id="${item.id}">Sincronizar</button>
            ${item.youtube_url ? `<a class="ghost-button" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir</a>` : ''}
          </div>
        </article>
      `
    )
    .join('');
}

function labelQueueTab(value) {
  const labels = {
    all: 'Todo',
    active: 'Pendientes',
    publishing: 'Publicando',
    scheduled: 'Programados',
    failed: 'Fallidos',
    published: 'Publicados'
  };
  return labels[value] || value;
}

export function renderOverview() {
  const summary = state.dashboardSummary;
  if (!summary) {
    renderEmpty(elements.summaryStrip, 'Todavía no hay resumen del sistema.');
    return;
  }

  const cards = [
    ['Perfiles rastreados', summary.tracked_profiles || 0],
    ['Videos biblioteca', summary.library_videos || 0],
    ['En cola', summary.queued_publications || 0],
    ['Programados', summary.scheduled_publications || 0],
    ['Canales', summary.youtube_accounts || 0],
    ['Scrapes fallidos', summary.failed_scrapes || 0]
  ];

  elements.summaryStrip.innerHTML = cards
    .map(
      ([label, value]) => `<article class="summary-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`
    )
    .join('');
}
