import {
  elements,
  runWithBusyButton,
  setActiveView,
  setButtonBusy,
  setStatus,
  setTrackingPollTimer,
  setYoutubeContextOpen,
  state,
  stopTrackingPolling
} from "./scripts/dom.js";
import { fetchJson, isHashtagQuery, postJson, summarizeTrackingRun } from "./scripts/utils.js";
import { renderOverview, renderQueue, renderScrapedProfiles, renderYoutubeAccounts } from "./scripts/render-content.js";

function bindGlobalImageFallback() {
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || target.dataset.fallbackThumb !== "true") {
        return;
      }
      target.parentElement?.classList.add("is-fallback");
    },
    true
  );
}

function formatUsernameForInput(username) {
  if (!username) return "";
  return String(username).startsWith("tag-") ? `#${String(username).replace(/^tag-/, "")}` : `@${username}`;
}

function handleOauthFeedback() {
  const params = new URLSearchParams(window.location.search);
  const oauthStatus = params.get("youtube_oauth");
  if (!oauthStatus) return;

  const accountId = params.get("account_id");
  if (accountId) {
    state.selectedAccountId = accountId;
  }

  if (oauthStatus === "success") {
    setStatus(`La cuenta ${accountId || ""} quedó conectada.`);
    setActiveView("youtube");
  } else {
    setStatus(params.get("message") || "Falló Google OAuth.", true);
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("youtube_oauth");
  cleanUrl.searchParams.delete("account_id");
  cleanUrl.searchParams.delete("message");
  window.history.replaceState({}, "", cleanUrl);
}

async function loadDashboard() {
  try {
    const { summary } = await fetchJson("/api/dashboard/summary");
    state.dashboardSummary = summary;
  } catch {
    state.dashboardSummary = null;
  }
  renderOverview();
}

async function loadScrapedProfiles() {
  const { items } = await fetchJson("/api/scraped-profiles");
  state.scrapedProfiles = Array.isArray(items) ? items : [];

  if (!state.selectedScrapedUsername && state.scrapedProfiles.length) {
    state.selectedScrapedUsername = state.scrapedProfiles[0].username;
  }
  if (
    state.selectedScrapedUsername &&
    !state.scrapedProfiles.some((item) => String(item.username) === String(state.selectedScrapedUsername))
  ) {
    state.selectedScrapedUsername = state.scrapedProfiles[0]?.username || null;
  }

  if (!state.cloneForm.trackedProfileId && state.scrapedProfiles.length) {
    state.cloneForm.trackedProfileId = String(state.scrapedProfiles[0].id);
  }

  renderScrapedProfiles();
  renderYoutubeAccounts();
}

async function loadScrapedProfile(username) {
  if (!username) return;
  const payload = await fetchJson(
    `/api/scraped-profiles/${encodeURIComponent(username)}?limit=${encodeURIComponent(state.currentTrackLimit)}`
  );
  state.selectedScrapedUsername = payload.profile?.username || username;
  state.currentTrackingProfile = payload.profile || null;
  state.currentTrackingRun = payload.scrape || null;
  state.currentItems = Array.isArray(payload.items) ? payload.items : [];
  state.currentTrackTotalAvailable = Number(payload.profile?.total_media_count || state.currentItems.length || 0);
  state.currentTrackQuery = formatUsernameForInput(state.selectedScrapedUsername);
  state.scrapedVideosPage = 1;
  state.selectedTrackIds.clear();
  renderScrapedProfiles();
}

async function loadTrackingStatus(username) {
  const payload = await fetchJson(
    `/api/scraped-profiles/${encodeURIComponent(username)}?limit=${encodeURIComponent(state.currentTrackLimit)}`
  );
  state.currentTrackingProfile = payload.profile || null;
  state.currentTrackingRun = payload.scrape || null;
  state.currentItems = Array.isArray(payload.items) ? payload.items : [];
  state.currentTrackTotalAvailable = Number(payload.profile?.total_media_count || state.currentItems.length || 0);
  renderScrapedProfiles();
  return payload;
}

function scheduleTrackingPolling(username) {
  stopTrackingPolling();
  setTrackingPollTimer(
    window.setTimeout(async () => {
      try {
        const payload = await loadTrackingStatus(username);
        const status = String(payload?.scrape?.status || "").toLowerCase();

        if (status === "running") {
          const progress = summarizeTrackingRun(payload.scrape);
          setStatus([payload.scrape?.progress_message || `Escaneando ${username}...`, progress].filter(Boolean).join(" · "));
          scheduleTrackingPolling(username);
          return;
        }

        setButtonBusy(elements.submitButton, "Escanear", false);
        setButtonBusy(elements.refreshButton, "Reescanear actual", false);
        await Promise.all([loadScrapedProfiles(), loadDashboard(), loadPublications()]);

        if (status === "success") {
          setStatus(`Escaneo terminado para ${username}.`);
        } else if (status === "failed") {
          setStatus(payload.scrape?.progress_message || "El escaneo falló.", true);
        }
      } catch (error) {
        setButtonBusy(elements.submitButton, "Escanear", false);
        setButtonBusy(elements.refreshButton, "Reescanear actual", false);
        setStatus(error.message, true);
      }
    }, 1500)
  );
}

async function trackUsername(rawValue) {
  const input = String(rawValue || "").trim();
  if (!input) {
    setStatus("La búsqueda es obligatoria.", true);
    return;
  }

  const label = isHashtagQuery(input) ? input : input.replace(/^@+/, "@");
  state.currentTrackQuery = input;
  state.currentTrackLimit = state.currentTrackBatchSize;
  state.currentTrackingProfile = null;
  state.currentTrackingRun = null;
  state.currentItems = [];
  state.currentTrackTotalAvailable = 0;
  state.selectedTrackIds.clear();
  state.scrapedVideosPage = 1;
  setActiveView("scraped");
  setButtonBusy(elements.submitButton, "Escaneando...", true);
  setButtonBusy(elements.refreshButton, "Actualizando...", true);
  setStatus(`Leyendo ${label}... esto puede tardar unos minutos.`);

  try {
    const result = await postJson("/api/profiles/track", { username: input, limit: state.currentTrackLimit });
    state.selectedScrapedUsername = result.profile?.username || input.replace(/^@+/, "").trim();
    await Promise.all([loadScrapedProfiles(), loadTrackingStatus(state.selectedScrapedUsername)]);
    if (String(state.currentTrackingRun?.status || "").toLowerCase() === "running") {
      scheduleTrackingPolling(state.selectedScrapedUsername);
    } else {
      setButtonBusy(elements.submitButton, "Escanear", false);
      setButtonBusy(elements.refreshButton, "Reescanear actual", false);
    }
    setStatus(
      result.alreadyRunning
        ? `Ya había un escaneo corriendo para ${label}. Estoy mostrando el progreso.`
        : `Escaneo iniciado para ${label}.`
    );
  } catch (error) {
    setStatus(error.message, true);
    setButtonBusy(elements.submitButton, "Escanear", false);
    setButtonBusy(elements.refreshButton, "Reescanear actual", false);
  }
}

async function expandTrackingResults() {
  if (!state.currentTrackQuery) {
    setStatus("Primero escaneá un perfil o hashtag.", true);
    return;
  }
  const previousLimit = state.currentTrackLimit;
  state.currentTrackLimit += state.currentTrackBatchSize;
  try {
    await postJson("/api/profiles/track", { username: state.currentTrackQuery, limit: state.currentTrackLimit });
    await loadTrackingStatus(state.selectedScrapedUsername || state.currentTrackQuery.replace(/^@+/, "").trim());
    setStatus("Se amplió la cantidad de resultados disponibles.");
  } catch (error) {
    state.currentTrackLimit = previousLimit;
    setStatus(error.message, true);
  }
}

async function saveTrackingSelectionToLibrary() {
  const mediaIds = Array.from(state.selectedTrackIds);
  if (!mediaIds.length) {
    setStatus("Seleccioná al menos un video para guardarlo.", true);
    return;
  }
  await postJson("/api/library/capture-media", {
    mediaIds,
    label: state.selectedScrapedUsername ? `captura-${state.selectedScrapedUsername}` : "captura-manual"
  });
  state.selectedTrackIds.clear();
  await Promise.all([loadLibrary(), loadDashboard()]);
  renderScrapedProfiles();
  setStatus("Los videos quedaron guardados en biblioteca.");
}

async function loadAccounts(forceSelected = false) {
  const { accounts, oauth } = await fetchJson("/api/youtube/accounts");
  state.accounts = Array.isArray(accounts) ? accounts : [];
  state.oauth = oauth || null;

  if (!state.selectedAccountId && state.accounts.length) {
    state.selectedAccountId = String(
      state.accounts.find((item) => item.oauth_status === "connected")?.id || state.accounts[0].id
    );
  }
  if (state.selectedAccountId && !state.accounts.some((item) => String(item.id) === String(state.selectedAccountId))) {
    state.selectedAccountId = state.accounts[0] ? String(state.accounts[0].id) : null;
  }

  await Promise.all([ensureSelectedAccountVideos(forceSelected), ensureSelectedAccountClones(forceSelected)]);
  renderYoutubeAccounts();
}

async function ensureSelectedAccountVideos(force = false) {
  if (!state.selectedAccountId) return;
  const accountId = String(state.selectedAccountId);
  if (!force && state.accountVideosById[accountId]) return;
  try {
    const payload = await fetchJson(`/api/youtube/accounts/${accountId}/videos?limit=12`);
    state.accountVideosById[accountId] = Array.isArray(payload.items) ? payload.items : [];
    state.accountChannelById[accountId] = payload.channel || null;
  } catch {
    state.accountVideosById[accountId] = [];
    state.accountChannelById[accountId] = null;
  }
}

async function ensureSelectedAccountClones(force = false) {
  if (!state.selectedAccountId) return;
  const accountId = String(state.selectedAccountId);
  if (!force && state.accountClonesById[accountId]) return;
  try {
    const payload = await fetchJson(`/api/youtube/accounts/${accountId}/clones`);
    state.accountClonesById[accountId] = Array.isArray(payload.items) ? payload.items : [];
  } catch {
    state.accountClonesById[accountId] = [];
  }
}

async function loadLibrary() {
  const { items } = await fetchJson("/api/library/videos");
  state.libraryItems = Array.isArray(items) ? items : [];
  renderYoutubeAccounts();
}

async function loadPublications() {
  const { items } = await fetchJson("/api/publications");
  state.publications = Array.isArray(items) ? items : [];
  renderQueue();
  renderYoutubeAccounts();
}

async function sendLibraryVideoToQueue(libraryVideoId, youtubeAccountId, publishNow = false) {
  const response = await postJson("/api/publications", {
    libraryVideoIds: [Number(libraryVideoId)],
    youtubeAccountId: Number(youtubeAccountId)
  });
  if (publishNow) {
    await Promise.all((response.items || []).map((item) => postJson(`/api/publications/${item.id}/publish`, {})));
  }
  await Promise.all([loadPublications(), loadLibrary(), loadAccounts(), loadDashboard()]);
  setStatus(publishNow ? "Se creó la publicación y se intentó subir ahora." : "El video se agregó a la cola del perfil.");
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

async function createClone() {
  if (!state.selectedAccountId) {
    setStatus("Elegí una cuenta de YouTube primero.", true);
    return;
  }
  if (!state.cloneForm.trackedProfileId) {
    setStatus("Elegí un perfil scrapeado para clonar.", true);
    return;
  }
  await postJson(`/api/youtube/accounts/${state.selectedAccountId}/clones`, {
    trackedProfileId: Number(state.cloneForm.trackedProfileId),
    dailyLimit: Number(state.cloneForm.dailyLimit || 1)
  });
  await Promise.all([ensureSelectedAccountClones(true), loadPublications(), loadDashboard(), loadAccounts()]);
  setStatus("La clonación quedó creada y sus publicaciones fueron programadas.");
}

function bindStaticEvents() {
  elements.navTabs.forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  });

  elements.toggleYoutubeContextButton?.addEventListener("click", () => {
    if (state.currentView !== "youtube") {
      setActiveView("youtube");
    }
    setYoutubeContextOpen(!state.youtubeContextOpen);
  });

  document.addEventListener("click", (event) => {
    if (state.currentView !== "youtube" || !state.youtubeContextOpen) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".youtube-toolbar-actions")) return;
    setYoutubeContextOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.youtubeContextOpen) {
      setYoutubeContextOpen(false);
    }
  });

  elements.trackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await trackUsername(elements.username.value);
  });

  elements.refreshButton.addEventListener("click", async () => {
    if (!state.selectedScrapedUsername && !state.currentTrackQuery) {
      setStatus("Primero elegí o escaneá un perfil.", true);
      return;
    }
    await trackUsername(state.currentTrackQuery || formatUsernameForInput(state.selectedScrapedUsername));
  });

  elements.refreshScrapedButton.addEventListener("click", () =>
    loadScrapedProfiles()
      .then(() => (state.selectedScrapedUsername ? loadScrapedProfile(state.selectedScrapedUsername) : null))
      .catch((error) => setStatus(error.message, true))
  );

  elements.scrapedProfilesPrevPage.addEventListener("click", () => {
    state.scrapedProfilesPage = Math.max(1, state.scrapedProfilesPage - 1);
    renderScrapedProfiles();
  });
  elements.scrapedProfilesNextPage.addEventListener("click", () => {
    state.scrapedProfilesPage += 1;
    renderScrapedProfiles();
  });
  elements.scrapedVideosPrevPage.addEventListener("click", () => {
    state.scrapedVideosPage = Math.max(1, state.scrapedVideosPage - 1);
    renderScrapedProfiles();
  });
  elements.scrapedVideosNextPage.addEventListener("click", () => {
    state.scrapedVideosPage += 1;
    renderScrapedProfiles();
  });
  elements.loadMoreMediaButton.addEventListener("click", () => expandTrackingResults().catch((error) => setStatus(error.message, true)));
  elements.saveLibraryButton.addEventListener("click", () => saveTrackingSelectionToLibrary().catch((error) => setStatus(error.message, true)));

  elements.scrapedProfilesList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="select-scraped-profile"]');
    if (!button) return;
    loadScrapedProfile(button.dataset.username).catch((error) => setStatus(error.message, true));
  });

  elements.scrapedProfileHeader.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="rescan-scraped-profile"]');
    if (!button || !state.selectedScrapedUsername) return;
    trackUsername(formatUsernameForInput(state.selectedScrapedUsername)).catch((error) => setStatus(error.message, true));
  });

  elements.scrapedVideosGrid.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "toggle-track") return;
    const id = String(target.dataset.id);
    if (target.checked) state.selectedTrackIds.add(id);
    else state.selectedTrackIds.delete(id);
    renderScrapedProfiles();
  });

  elements.refreshAccountsButton.addEventListener("click", () => loadAccounts(true).catch((error) => setStatus(error.message, true)));
  elements.addYoutubeAccountButton.addEventListener("click", (event) => {
    if (elements.addYoutubeAccountButton.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      setStatus("Google OAuth no está configurado todavía.", true);
    }
  });
  elements.youtubeProfilesPrevPage.addEventListener("click", () => {
    state.youtubeListPage = Math.max(1, state.youtubeListPage - 1);
    renderYoutubeAccounts();
  });
  elements.youtubeProfilesNextPage.addEventListener("click", () => {
    state.youtubeListPage += 1;
    renderYoutubeAccounts();
  });
  elements.youtubeProfilesList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="select-youtube-profile"]');
    if (!button) return;
    state.selectedAccountId = String(button.dataset.id);
    state.currentYoutubeTab = "videos";
    state.youtubeVideosPage = 1;
    state.profilePublishPage = 1;
    setYoutubeContextOpen(false);
    Promise.all([ensureSelectedAccountVideos(), ensureSelectedAccountClones()])
      .then(() => renderYoutubeAccounts())
      .catch((error) => setStatus(error.message, true));
  });

  elements.youtubeProfileTabBar.addEventListener("click", (event) => {
    const button = event.target.closest(".profile-tab");
    if (!button) return;
    state.currentYoutubeTab = button.dataset.tab;
    renderYoutubeAccounts();
  });

  elements.youtubeProfileTabContent.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === "youtube-videos-prev") {
      state.youtubeVideosPage = Math.max(1, state.youtubeVideosPage - 1);
      renderYoutubeAccounts();
      return;
    }
    if (action === "youtube-videos-next") {
      state.youtubeVideosPage += 1;
      renderYoutubeAccounts();
      return;
    }
    if (action === "profile-publish-prev") {
      state.profilePublishPage = Math.max(1, state.profilePublishPage - 1);
      renderYoutubeAccounts();
      return;
    }
    if (action === "profile-publish-next") {
      state.profilePublishPage += 1;
      renderYoutubeAccounts();
      return;
    }
    if (action === "publish-add-to-queue") {
      sendLibraryVideoToQueue(actionTarget.dataset.id, actionTarget.dataset.accountId).catch((error) => setStatus(error.message, true));
      return;
    }
    if (action === "publish-now-from-library") {
      sendLibraryVideoToQueue(actionTarget.dataset.id, actionTarget.dataset.accountId, true).catch((error) => setStatus(error.message, true));
      return;
    }
  });

  elements.youtubeProfileTabContent.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.id === "profile-publish-search") {
      state.profilePublishFilters.search = target.value;
      state.profilePublishPage = 1;
      renderYoutubeAccounts();
      return;
    }
    if (target.id === "clone-daily-limit-input") {
      state.cloneForm.dailyLimit = Math.max(1, Number(target.value || 1));
      renderYoutubeAccounts();
    }
  });

  elements.youtubeProfileTabContent.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.id === "profile-publish-source") {
      state.profilePublishFilters.source = target.value;
      state.profilePublishPage = 1;
      renderYoutubeAccounts();
      return;
    }
    if (target.id === "profile-publish-availability") {
      state.profilePublishFilters.availability = target.value;
      state.profilePublishPage = 1;
      renderYoutubeAccounts();
      return;
    }
    if (target.id === "clone-tracked-profile-select") {
      state.cloneForm.trackedProfileId = target.value;
      renderYoutubeAccounts();
    }
  });

  elements.youtubeProfileTabContent.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "clone-form") return;
    event.preventDefault();
    runWithBusyButton(form.querySelector('button[type="submit"]'), "Creando...", createClone).catch((error) =>
      setStatus(error.message, true)
    );
  });

  elements.queueTabBar.addEventListener("click", (event) => {
    const button = event.target.closest(".queue-tab");
    if (!button) return;
    state.queueTab = button.dataset.queueTab;
    state.queuePage = 1;
    renderQueue();
  });
  elements.queuePrevPage.addEventListener("click", () => {
    state.queuePage = Math.max(1, state.queuePage - 1);
    renderQueue();
  });
  elements.queueNextPage.addEventListener("click", () => {
    state.queuePage += 1;
    renderQueue();
  });
  elements.refreshPublicationsButton.addEventListener("click", () => loadPublications().catch((error) => setStatus(error.message, true)));
  elements.publicationList.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    if (actionTarget.dataset.action === "publication-publish") {
      publishExistingPublication(actionTarget.dataset.id).catch((error) => setStatus(error.message, true));
      return;
    }
    if (actionTarget.dataset.action === "publication-sync") {
      syncExistingPublication(actionTarget.dataset.id).catch((error) => setStatus(error.message, true));
    }
  });
}

async function init() {
  handleOauthFeedback();
  bindGlobalImageFallback();
  bindStaticEvents();
  setActiveView("scraped");
  setStatus("Cargando workspace...");

  try {
    await Promise.all([loadDashboard(), loadScrapedProfiles(), loadAccounts(), loadLibrary(), loadPublications()]);
    if (state.selectedScrapedUsername) {
      await loadScrapedProfile(state.selectedScrapedUsername);
    } else {
      renderScrapedProfiles();
    }
    renderYoutubeAccounts();
    renderQueue();
    setStatus("Workspace listo. Flujo activo: perfiles scrapeados → perfiles YouTube → publicar o clonar.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
