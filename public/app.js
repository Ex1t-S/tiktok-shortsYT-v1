import {
  elements,
  runWithBusyButton,
  setActiveView,
  setButtonBusy,
  setStatus,
  setTrackingPollTimer,
  state,
  stopTrackingPolling
} from './scripts/dom.js';
import {
  fetchJson,
  formatIsoDuration,
  isHashtagQuery,
  parseBulkYoutubeAccounts,
  postJson,
  summarizeTrackingRun,
  translateStatus
} from './scripts/utils.js';
import {
  fillAccountSelect,
  renderLibrary,
  renderOauthBox,
  renderOverview,
  renderProfiles,
  renderQueue,
  renderTracking
} from './scripts/render-content.js';

function handleOauthFeedback() {
  const params = new URLSearchParams(window.location.search);
  const oauthStatus = params.get('youtube_oauth');
  if (!oauthStatus) return;

  if (oauthStatus === 'success') {
    setStatus(`La cuenta ${params.get('account_id') || ''} quedó conectada.`);
  } else {
    setStatus(params.get('message') || 'Falló Google OAuth.', true);
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('youtube_oauth');
  cleanUrl.searchParams.delete('account_id');
  cleanUrl.searchParams.delete('message');
  window.history.replaceState({}, '', cleanUrl);
}

async function loadDashboard() {
  try {
    const { summary } = await fetchJson('/api/dashboard/summary');
    state.dashboardSummary = summary;
  } catch {
    state.dashboardSummary = null;
  }
  renderOverview();
}

async function loadAccounts() {
  const { accounts, oauth } = await fetchJson('/api/youtube/accounts');
  state.accounts = Array.isArray(accounts) ? accounts : [];
  state.oauth = oauth || null;

  if (!state.selectedAccountId && state.accounts.length) {
    state.selectedAccountId = state.accounts.find((item) => item.oauth_status === 'connected')?.id || state.accounts[0].id;
  }
  if (state.selectedAccountId && !state.accounts.some((item) => String(item.id) === String(state.selectedAccountId))) {
    state.selectedAccountId = state.accounts[0]?.id || null;
  }

  fillAccountSelect(elements.queueAccountSelect, 'Elegir perfil destino');
  fillAccountSelect(elements.libraryTargetAccountSelect, 'Perfil destino para mandar a cola');
  renderOauthBox();
  await ensureSelectedAccountVideos();
  renderProfiles();
}

async function ensureSelectedAccountVideos(force = false) {
  if (!state.selectedAccountId) return;
  const accountId = String(state.selectedAccountId);
  if (!force && state.accountVideosById[accountId]) return;
  try {
    const payload = await fetchJson(`/api/youtube/accounts/${accountId}/videos?limit=10`);
    state.accountVideosById[accountId] = Array.isArray(payload.items) ? payload.items : [];
  } catch {
    state.accountVideosById[accountId] = [];
  }
}

async function loadLibrary() {
  const { items } = await fetchJson('/api/library/videos');
  state.libraryItems = Array.isArray(items) ? items : [];
  renderLibrary();
  renderProfiles();
}

async function loadPublications() {
  const { items } = await fetchJson('/api/publications');
  state.publications = Array.isArray(items) ? items : [];
  renderQueue();
  renderProfiles();
}

async function loadProfile(username) {
  const payload = await fetchJson(
    `/api/profiles/${encodeURIComponent(username)}/tracking-status?limit=${encodeURIComponent(state.currentTrackLimit)}`
  ).catch(async () => {
    const profileData = await fetchJson(`/api/profiles/${encodeURIComponent(username)}`);
    const mediaData = await fetchJson(`/api/profiles/${encodeURIComponent(username)}/media?limit=${state.currentTrackLimit}`);
    return { profile: profileData.profile, scrape: null, items: mediaData.items };
  });

  state.currentTrackingProfile = payload.profile || null;
  state.currentTrackingRun = payload.scrape || null;
  state.currentItems = Array.isArray(payload.items) ? payload.items : [];
  state.currentTrackTotalAvailable = Number(payload.profile?.total_media_count || state.currentItems.length || 0);
  state.selectedTrackIds.clear();
  state.currentTrackPage = 1;
  renderTracking();
}

async function loadTrackingStatus(username) {
  const payload = await fetchJson(
    `/api/profiles/${encodeURIComponent(username)}/tracking-status?limit=${encodeURIComponent(state.currentTrackLimit)}`
  );

  state.currentTrackingProfile = payload.profile || null;
  state.currentTrackingRun = payload.scrape || null;
  state.currentItems = Array.isArray(payload.items) ? payload.items : [];
  state.currentTrackTotalAvailable = Number(payload.profile?.total_media_count || state.currentItems.length || 0);
  renderTracking();
  return payload;
}

function scheduleTrackingPolling(username) {
  stopTrackingPolling();
  setTrackingPollTimer(
    window.setTimeout(async () => {
      try {
        const payload = await loadTrackingStatus(username);
        const status = String(payload?.scrape?.status || '').toLowerCase();

        if (status === 'running') {
          const progress = summarizeTrackingRun(payload.scrape);
          setStatus([payload.scrape?.progress_message || `Rastreando ${username}...`, progress].filter(Boolean).join(' · '));
          scheduleTrackingPolling(username);
          return;
        }

        setButtonBusy(elements.submitButton, 'Rastrear', false);
        setButtonBusy(elements.refreshButton, 'Actualizar', false);

        if (status === 'success') {
          setStatus(`Tracking terminado para ${username}.`);
          await Promise.all([loadDashboard(), loadPublications()]);
        } else if (status === 'failed') {
          setStatus(payload.scrape?.progress_message || 'El tracking falló.', true);
        }
      } catch (error) {
        setButtonBusy(elements.submitButton, 'Rastrear', false);
        setButtonBusy(elements.refreshButton, 'Actualizar', false);
        setStatus(error.message, true);
      }
    }, 1500)
  );
}

async function trackUsername(rawValue) {
  const input = rawValue.trim();
  if (!input) {
    setStatus('La búsqueda es obligatoria.', true);
    return;
  }

  const label = isHashtagQuery(input) ? input : input.replace(/^@+/, '@');
  state.currentTrackQuery = input;
  state.currentTrackLimit = state.currentTrackBatchSize;
  state.currentTrackPage = 1;
  state.currentTrackTotalAvailable = 0;
  state.currentItems = [];
  state.currentTrackingRun = null;
  state.currentTrackingProfile = null;
  state.selectedTrackIds.clear();
  setActiveView('tracking');
  setButtonBusy(elements.submitButton, 'Rastreando...', true);
  setButtonBusy(elements.refreshButton, 'Actualizando...', true);
  setStatus(`Leyendo ${label}... esto puede tardar unos minutos.`);

  try {
    const result = await postJson('/api/profiles/track', { username: input, limit: state.currentTrackLimit });
    state.currentUsername = result.profile?.username || input.replace(/^@+/, '').trim();
    state.currentTrackingRun = result.scrape || null;
    await loadTrackingStatus(state.currentUsername);
    if (String(state.currentTrackingRun?.status || '').toLowerCase() === 'running') {
      scheduleTrackingPolling(state.currentUsername);
    } else {
      setButtonBusy(elements.submitButton, 'Rastrear', false);
      setButtonBusy(elements.refreshButton, 'Actualizar', false);
    }
    setStatus(
      result.alreadyRunning
        ? `Ya había un tracking corriendo para ${label}. Estoy mostrando el progreso.`
        : `Tracking iniciado para ${label}.`
    );
  } catch (error) {
    setStatus(error.message, true);
    setButtonBusy(elements.submitButton, 'Rastrear', false);
    setButtonBusy(elements.refreshButton, 'Actualizar', false);
  }
}

async function expandTrackingResults() {
  if (!state.currentTrackQuery) {
    setStatus('Primero rastreá un perfil o hashtag.', true);
    return;
  }
  const previousLimit = state.currentTrackLimit;
  state.currentTrackLimit += state.currentTrackBatchSize;
  try {
    await postJson('/api/profiles/track', { username: state.currentTrackQuery, limit: state.currentTrackLimit });
    await loadTrackingStatus(state.currentUsername || state.currentTrackQuery.replace(/^@+/, '').trim());
    setStatus('Se amplió la cantidad de resultados disponibles.');
  } catch (error) {
    state.currentTrackLimit = previousLimit;
    setStatus(error.message, true);
  }
}

async function queueTrackingSelection({ publishNow = false } = {}) {
  const mediaIds = Array.from(state.selectedTrackIds);
  const youtubeAccountId = Number(elements.queueAccountSelect.value || state.selectedAccountId);
  if (!mediaIds.length) {
    setStatus('Seleccioná al menos un video.', true);
    return;
  }
  if (!Number.isFinite(youtubeAccountId)) {
    setStatus('Elegí un perfil destino antes de mandar a cola.', true);
    return;
  }
  const response = await postJson('/api/publications', { mediaIds, youtubeAccountId });
  if (publishNow) {
    await Promise.all((response.items || []).map((item) => postJson(`/api/publications/${item.id}/publish`, {})));
  }
  state.selectedTrackIds.clear();
  await Promise.all([loadPublications(), loadLibrary(), loadAccounts(), loadDashboard()]);
  setStatus(publishNow ? 'Los videos se mandaron a la cola y se intentó publicar.' : 'Los videos fueron enviados a la cola.');
  setActiveView('queue');
}

async function saveTrackingSelectionToLibrary() {
  const mediaIds = Array.from(state.selectedTrackIds);
  if (!mediaIds.length) {
    setStatus('Seleccioná al menos un video para guardarlo.', true);
    return;
  }
  await postJson('/api/library/capture-media', {
    mediaIds,
    label: state.currentUsername ? `captura-${state.currentUsername}` : 'captura-manual'
  });
  state.selectedTrackIds.clear();
  await Promise.all([loadLibrary(), loadDashboard()]);
  setStatus('Los videos quedaron guardados en biblioteca.');
  setActiveView('library');
}

async function sendLibraryVideoToQueue(libraryVideoId, youtubeAccountId, publishNow = false) {
  if (!Number.isFinite(Number(youtubeAccountId))) {
    setStatus('Elegí un perfil destino primero.', true);
    return;
  }
  const response = await postJson('/api/publications', {
    libraryVideoIds: [libraryVideoId],
    youtubeAccountId: Number(youtubeAccountId)
  });
  if (publishNow) {
    await Promise.all((response.items || []).map((item) => postJson(`/api/publications/${item.id}/publish`, {})));
  }
  await Promise.all([loadPublications(), loadLibrary(), loadAccounts(), loadDashboard()]);
  setStatus(publishNow ? 'Se creó la publicación y se intentó subir ahora.' : 'El video se agregó a la cola del perfil.');
  if (publishNow) {
    setActiveView('queue');
  }
}

async function publishExistingPublication(publicationId) {
  await postJson(`/api/publications/${publicationId}/publish`, {});
  await Promise.all([loadPublications(), loadAccounts(), loadDashboard()]);
  setStatus(`La publicación ${publicationId} fue enviada a YouTube.`);
}

async function syncExistingPublication(publicationId) {
  await postJson(`/api/publications/${publicationId}/sync`, {});
  await Promise.all([loadPublications(), loadAccounts(), loadDashboard()]);
  setStatus(`La publicación ${publicationId} fue sincronizada.`);
}

function bindStaticEvents() {
  elements.navTabs.forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  });

  elements.trackForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await trackUsername(elements.username.value);
  });

  elements.refreshButton.addEventListener('click', async () => {
    if (!state.currentTrackQuery) {
      setStatus('Primero rastreá un perfil o hashtag.', true);
      return;
    }
    await trackUsername(state.currentTrackQuery);
  });

  elements.queueAccountSelect.addEventListener('change', () => renderTracking());
  elements.saveLibraryButton.addEventListener('click', () => saveTrackingSelectionToLibrary().catch((error) => setStatus(error.message, true)));
  elements.queueSelectedButton.addEventListener('click', () => queueTrackingSelection().catch((error) => setStatus(error.message, true)));
  elements.trackPrevPage.addEventListener('click', () => {
    state.currentTrackPage = Math.max(1, state.currentTrackPage - 1);
    renderTracking();
  });
  elements.trackNextPage.addEventListener('click', () => {
    state.currentTrackPage += 1;
    renderTracking();
  });
  elements.loadMoreMediaButton.addEventListener('click', () => expandTrackingResults().catch((error) => setStatus(error.message, true)));

  elements.mediaGrid.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.action !== 'toggle-track') return;
    const id = String(target.dataset.id);
    if (target.checked) state.selectedTrackIds.add(id);
    else state.selectedTrackIds.delete(id);
    renderTracking();
  });

  elements.librarySearchInput.addEventListener('input', () => {
    state.libraryFilters.search = elements.librarySearchInput.value;
    state.libraryPage = 1;
    renderLibrary();
  });
  elements.libraryStatusFilter.addEventListener('change', () => {
    state.libraryFilters.status = elements.libraryStatusFilter.value;
    state.libraryPage = 1;
    renderLibrary();
  });
  elements.librarySourceFilter.addEventListener('change', () => {
    state.libraryFilters.source = elements.librarySourceFilter.value;
    state.libraryPage = 1;
    renderLibrary();
  });
  elements.libraryPrevPageButton.addEventListener('click', () => {
    state.libraryPage = Math.max(1, state.libraryPage - 1);
    renderLibrary();
  });
  elements.libraryNextPageButton.addEventListener('click', () => {
    state.libraryPage += 1;
    renderLibrary();
  });
  elements.libraryVideoList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="library-queue"]');
    if (!button) return;
    const accountId = Number(elements.libraryTargetAccountSelect.value || state.selectedAccountId);
    sendLibraryVideoToQueue(button.dataset.id, accountId).catch((error) => setStatus(error.message, true));
  });

  elements.refreshAccountsButton.addEventListener('click', () => loadAccounts().catch((error) => setStatus(error.message, true)));
  elements.profilesPrevPage.addEventListener('click', () => {
    state.profileListPage = Math.max(1, state.profileListPage - 1);
    renderProfiles();
  });
  elements.profilesNextPage.addEventListener('click', () => {
    state.profileListPage += 1;
    renderProfiles();
  });

  elements.profilesList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="select-profile"]');
    if (!button) return;
    state.selectedAccountId = button.dataset.id;
    state.currentProfileTab = 'summary';
    state.profileUploadsPage = 1;
    state.profileQueuePage = 1;
    state.profilePublishPage = 1;
    ensureSelectedAccountVideos().then(() => renderProfiles());
  });

  elements.profileTabBar.addEventListener('click', (event) => {
    const button = event.target.closest('.profile-tab');
    if (!button) return;
    state.currentProfileTab = button.dataset.tab;
    renderProfiles();
  });

  elements.profileTabContent.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === 'profile-uploads-prev') {
      state.profileUploadsPage = Math.max(1, state.profileUploadsPage - 1);
      renderProfiles();
      return;
    }
    if (action === 'profile-uploads-next') {
      state.profileUploadsPage += 1;
      renderProfiles();
      return;
    }
    if (action === 'profile-queue-prev') {
      state.profileQueuePage = Math.max(1, state.profileQueuePage - 1);
      renderProfiles();
      return;
    }
    if (action === 'profile-queue-next') {
      state.profileQueuePage += 1;
      renderProfiles();
      return;
    }
    if (action === 'profile-publish-prev') {
      state.profilePublishPage = Math.max(1, state.profilePublishPage - 1);
      renderProfiles();
      return;
    }
    if (action === 'profile-publish-next') {
      state.profilePublishPage += 1;
      renderProfiles();
      return;
    }
    if (action === 'publish-add-to-queue') {
      sendLibraryVideoToQueue(actionTarget.dataset.id, actionTarget.dataset.accountId).catch((error) => setStatus(error.message, true));
      return;
    }
    if (action === 'publish-now-from-library') {
      sendLibraryVideoToQueue(actionTarget.dataset.id, actionTarget.dataset.accountId, true).catch((error) => setStatus(error.message, true));
      return;
    }
    if (action === 'publication-publish') {
      publishExistingPublication(actionTarget.dataset.id).catch((error) => setStatus(error.message, true));
      return;
    }
    if (action === 'publication-sync') {
      syncExistingPublication(actionTarget.dataset.id).catch((error) => setStatus(error.message, true));
    }
  });

  elements.profileTabContent.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.id === 'profile-publish-search') {
      state.profilePublishFilters.search = target.value;
      state.profilePublishPage = 1;
      renderProfiles();
    }
  });
  elements.profileTabContent.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.id === 'profile-publish-source') {
      state.profilePublishFilters.source = target.value;
      state.profilePublishPage = 1;
      renderProfiles();
      return;
    }
    if (target.id === 'profile-publish-availability') {
      state.profilePublishFilters.availability = target.value;
      state.profilePublishPage = 1;
      renderProfiles();
    }
  });

  elements.profileSideActions.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === 'refresh-profile-videos') {
      ensureSelectedAccountVideos(true).then(() => {
        renderProfiles();
        setStatus('Se refrescaron los videos del perfil activo.');
      });
      return;
    }
    if (action === 'open-queue-view') {
      setActiveView('queue');
    }
  });

  elements.youtubeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runWithBusyButton(elements.youtubeForm.querySelector('button[type="submit"]'), 'Guardando...', async () => {
      await postJson('/api/youtube/accounts', {
        channelTitle: elements.channelTitle.value,
        channelHandle: elements.channelHandle.value,
        channelId: elements.channelId.value,
        contactEmail: elements.contactEmail.value
      });
      elements.youtubeForm.reset();
      await Promise.all([loadAccounts(), loadDashboard()]);
      setStatus('El canal fue agregado.');
    }).catch((error) => setStatus(error.message, true));
  });

  elements.youtubeBulkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const accounts = parseBulkYoutubeAccounts(elements.youtubeBulkInput.value);
    if (!accounts.length) {
      setStatus('Pegá al menos una cuenta válida para importar.', true);
      return;
    }
    await runWithBusyButton(elements.youtubeBulkButton, 'Importando...', async () => {
      await postJson('/api/youtube/accounts/bulk', { accounts });
      elements.youtubeBulkForm.reset();
      await Promise.all([loadAccounts(), loadDashboard()]);
      setStatus(`Se importaron ${accounts.length} canales.`);
    }).catch((error) => setStatus(error.message, true));
  });

  elements.queueTabBar.addEventListener('click', (event) => {
    const button = event.target.closest('.queue-tab');
    if (!button) return;
    state.queueTab = button.dataset.queueTab;
    state.queuePage = 1;
    renderQueue();
  });
  elements.queuePrevPage.addEventListener('click', () => {
    state.queuePage = Math.max(1, state.queuePage - 1);
    renderQueue();
  });
  elements.queueNextPage.addEventListener('click', () => {
    state.queuePage += 1;
    renderQueue();
  });
  elements.refreshPublicationsButton.addEventListener('click', () => loadPublications().catch((error) => setStatus(error.message, true)));
  elements.publicationList.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    if (actionTarget.dataset.action === 'publication-publish') {
      publishExistingPublication(actionTarget.dataset.id).catch((error) => setStatus(error.message, true));
      return;
    }
    if (actionTarget.dataset.action === 'publication-sync') {
      syncExistingPublication(actionTarget.dataset.id).catch((error) => setStatus(error.message, true));
    }
  });
}

async function init() {
  handleOauthFeedback();
  bindStaticEvents();
  setActiveView('tracking');
  setStatus('Cargando workspace...');

  try {
    await Promise.all([loadDashboard(), loadAccounts(), loadLibrary(), loadPublications()]);
    renderTracking();
    setStatus('Workspace listo. El flujo ahora es: rastrear → biblioteca → perfil → cola.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
