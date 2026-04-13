import {
  elements,
  runWithBusyButton,
  setActiveView,
  setStatus,
  setTrackingControlsBusy,
  setTrackingPollTimer,
  state,
  stopTrackingPolling,
  syncLibrarySelectionBar,
  syncSeedQueryPlaceholder,
  syncTrackResultsControls,
  syncSelectionBar
} from "./scripts/dom.js";
import {
  fetchJson,
  formatDate,
  formatIsoDuration,
  formatMetric,
  isHashtagQuery,
  parseBulkYoutubeAccounts,
  postBlob,
  postJson,
  summarizeTrackingRun,
  translateStatus,
  triggerBlobDownload
} from "./scripts/utils.js";
import {
  renderDashboardSummary,
  renderPublicationJobs,
  renderSummary,
  renderTrackingBox,
  renderWorkers,
  setOverviewActions
} from "./scripts/render-overview.js";
import {
  getPrimaryConnectedAccount,
  renderAccountSchedule,
  renderActiveAccountSummary,
  renderCandidates,
  renderLibraryVideos,
  renderMedia,
  renderPublications,
  renderSeeds,
  renderYoutubeAccounts,
  setContentActions
} from "./scripts/render-content.js";

setOverviewActions({
  loadDashboard,
  loadProfile,
  loadPublicationJobs,
  loadPublications
});

setContentActions({
  loadAccounts,
  loadCandidates,
  loadDashboard,
  loadLibrary,
  loadPublications,
  loadSeeds,
  loadYoutubeChannelVideos
});

function handleOauthFeedback() {
  const params = new URLSearchParams(window.location.search);
  const oauthStatus = params.get("youtube_oauth");
  if (!oauthStatus) {
    return;
  }

  if (oauthStatus === "success") {
    setStatus(`La cuenta de YouTube ${params.get("account_id") || ""} quedó conectada.`);
  } else {
    setStatus(params.get("message") || "Falló Google OAuth.", true);
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("youtube_oauth");
  cleanUrl.searchParams.delete("account_id");
  cleanUrl.searchParams.delete("message");
  window.history.replaceState({}, "", cleanUrl);
}

async function loadProfile(username) {
  const payload = await loadTrackingStatus(username).catch(async () => {
    const profileData = await fetchJson(`/api/profiles/${encodeURIComponent(username)}`);
    const mediaData = await fetchJson(`/api/profiles/${encodeURIComponent(username)}/media?limit=${state.currentTrackLimit}`);
    return {
      profile: profileData.profile,
      scrape: null,
      items: mediaData.items
    };
  });

  state.selectedIds.clear();
  state.currentTrackingRun = payload.scrape || null;
  renderSummary(payload.profile, state.currentTrackingRun);
  renderTrackingBox(payload.profile, state.currentTrackingRun);
  renderMedia(payload.items || []);
}

async function loadTrackingStatus(username) {
  const payload = await fetchJson(
    `/api/profiles/${encodeURIComponent(username)}/tracking-status?limit=${encodeURIComponent(state.currentTrackLimit)}`
  );
  state.currentTrackingRun = payload.scrape || null;

  if (payload.profile) {
    state.currentTrackTotalAvailable = Number(payload.profile.total_media_count || payload.items?.length || 0);
    renderSummary(payload.profile, payload.scrape || null);
    renderTrackingBox(payload.profile, payload.scrape || null);
  }

  if (Array.isArray(payload.items)) {
    renderMedia(payload.items);
  }

  syncTrackResultsControls();
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
          const progressSummary = summarizeTrackingRun(payload.scrape);
          setStatus(
            [payload.scrape?.progress_message || `Rastreando ${username}...`, progressSummary]
              .filter(Boolean)
              .join(" | ")
          );
          scheduleTrackingPolling(username);
          return;
        }

        setTrackingControlsBusy(false);

        if (status === "success") {
          stopTrackingPolling();
          setStatus(`Tracking terminado para ${username}.`);
          await Promise.all([loadCandidates(), loadDashboard(), loadPublications()]);
          return;
        }

        if (status === "failed") {
          stopTrackingPolling();
          setStatus(payload.scrape?.progress_message || "El tracking falló.", true);
        }
      } catch (error) {
        stopTrackingPolling();
        setTrackingControlsBusy(false);
        setStatus(error.message, true);
      }
    }, 1500)
  );
}

async function loadDashboard() {
  const { summary } = await fetchJson("/api/dashboard/summary");
  renderDashboardSummary(summary);
}

async function loadPublicationJobs() {
  const jobs = await fetchJson("/api/jobs/publications?limit=25");
  renderPublicationJobs(jobs);
}

async function loadWorkers() {
  const workers = await fetchJson("/api/workers");
  renderWorkers(workers);
}

async function loadSeeds() {
  const { seeds } = await fetchJson("/api/discovery/seeds");
  renderSeeds(seeds);
}

async function loadAccounts() {
  const { accounts, oauth } = await fetchJson("/api/youtube/accounts");
  renderYoutubeAccounts(accounts, oauth);
  const activeAccount = getPrimaryConnectedAccount();
  await loadYoutubeChannelVideos(activeAccount?.id);
}

async function loadYoutubeChannelVideos(accountId) {
  if (!accountId) {
    state.currentChannelVideos = [];
    elements.channelVideosList.innerHTML = '<p class="empty-state">Conecta un canal de YouTube para ver sus métricas.</p>';
    renderActiveAccountSummary();
    return;
  }

  const data = await fetchJson(`/api/youtube/accounts/${accountId}/videos?limit=12`);
  const items = Array.isArray(data.items) ? data.items : [];
  state.currentChannelVideos = items;
  renderActiveAccountSummary();

  if (items.length === 0) {
    elements.channelVideosList.innerHTML =
      '<p class="empty-state">YouTube todavía no devolvió videos para este canal.</p>';
    return;
  }

  elements.channelVideosList.innerHTML = items
    .map(
      (item) => `
        <article class="list-row channel-row">
          <img
            class="list-thumb"
            src="${item.thumbnails?.medium?.url || item.thumbnails?.default?.url || ""}"
            alt="${item.title || ""}"
          />
          <div class="list-row-main">
            <strong>${item.title || ""}</strong>
            <p>${formatDate(item.publishedAt)} · ${translateStatus(item.privacyStatus || "unknown")}</p>
          </div>
          <div class="list-row-meta compact-end">
            <span>${formatMetric(item.viewCount)} vistas</span>
            <span>${formatMetric(item.likeCount)} likes</span>
            ${item.duration ? `<span>${formatIsoDuration(item.duration)}</span>` : ""}
            ${
              item.url
                ? `<a class="ghost-button" href="${item.url}" target="_blank" rel="noreferrer">Abrir</a>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");
}

async function loadLibrary() {
  const { items } = await fetchJson("/api/library/videos");
  renderLibraryVideos(items);
}

function resetLibraryPagination() {
  state.currentLibraryPage = 1;
}

async function loadCandidates() {
  const params = new URLSearchParams();
  if (elements.candidateFilterStatus.value) {
    params.set("reviewStatus", elements.candidateFilterStatus.value);
  }

  if (elements.candidateFilterCategory.value) {
    params.set("editorialCategory", elements.candidateFilterCategory.value);
  }

  const query = params.toString();
  const { items } = await fetchJson(`/api/candidates${query ? `?${query}` : ""}`);
  renderCandidates(items);
}

async function loadPublications() {
  const { items } = await fetchJson("/api/publications");
  state.currentPublications = items;
  renderPublications(items);
}

async function trackUsername(username) {
  const input = username.trim();
  const searchingHashtag = isHashtagQuery(input);
  const normalizedLabel = searchingHashtag ? input : input.replace(/^@+/, "@");
  state.currentTrackQuery = input;
  state.currentTrackLimit = state.currentTrackBatchSize;
  state.currentTrackTotalAvailable = 0;
  stopTrackingPolling();
  state.currentItems = [];
  state.selectedIds.clear();
  state.currentTrackingRun = null;
  setActiveView("tracking");
  setStatus(
    searchingHashtag
      ? `Leyendo ${input} en TikTok... esto puede tardar unos minutos mientras se recopilan posts.`
      : `Leyendo ${normalizedLabel} con yt-dlp y fallback de navegador... esto puede tardar unos minutos en perfiles grandes.`
  );
  setTrackingControlsBusy(true);

  try {
    const result = await postJson("/api/profiles/track", {
      username: input,
      limit: state.currentTrackLimit
    });
    state.currentUsername = result.profile?.username || input.replace(/^@+/, "").trim();
    state.currentTrackingRun = result.scrape || null;
    await loadTrackingStatus(state.currentUsername);
    scheduleTrackingPolling(state.currentUsername);
    setStatus(
      result.alreadyRunning
        ? `Ya había un tracking corriendo para ${normalizedLabel}. Estoy mostrando el progreso en vivo.`
        : `Tracking iniciado para ${normalizedLabel}. Voy a ir mostrando el progreso y los videos guardados.`
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    if (!state.currentTrackingRun || String(state.currentTrackingRun.status || "").toLowerCase() !== "running") {
      setTrackingControlsBusy(false);
    }
  }
}

async function expandTrackingResults() {
  if (!state.currentTrackQuery) {
    setStatus("Primero rastrea un perfil o hashtag.", true);
    return;
  }

  const previousLimit = state.currentTrackLimit;
  state.currentTrackLimit += state.currentTrackBatchSize;
  const input = state.currentTrackQuery;
  const searchingHashtag = isHashtagQuery(input);
  const normalizedLabel = searchingHashtag ? input : input.replace(/^@+/, "@");
  setStatus(`Buscando 20 items más para ${normalizedLabel}...`);
  setTrackingControlsBusy(true);
  elements.loadMoreMediaButton.disabled = true;

  try {
    const result = await postJson("/api/profiles/track", {
      username: input,
      limit: state.currentTrackLimit
    });
    state.currentTrackingRun = result.scrape || null;
    await loadTrackingStatus(state.currentUsername || input.replace(/^@+/, "").trim());
    scheduleTrackingPolling(state.currentUsername || input.replace(/^@+/, "").trim());
  } catch (error) {
    state.currentTrackLimit = previousLimit;
    setStatus(error.message, true);
    setTrackingControlsBusy(false);
    syncTrackResultsControls();
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = elements.username.value;

  if (!username.trim()) {
    setStatus("La búsqueda es obligatoria.", true);
    return;
  }

  await trackUsername(username);
});

elements.refreshButton.addEventListener("click", async () => {
  if (!state.currentTrackQuery) {
    setStatus("Primero rastrea un perfil o hashtag.", true);
    return;
  }

  await trackUsername(state.currentTrackQuery);
});

elements.loadMoreMediaButton.addEventListener("click", async () => {
  await expandTrackingResults();
});

elements.queueAccountSelect.addEventListener("change", syncSelectionBar);
elements.libraryQueueAccountSelect.addEventListener("change", syncLibrarySelectionBar);

elements.selectAllButton.addEventListener("click", () => {
  state.currentItems.forEach((item) => state.selectedIds.add(String(item.id)));
  renderMedia(state.currentItems);
});

elements.clearSelectionButton.addEventListener("click", () => {
  state.selectedIds.clear();
  renderMedia(state.currentItems);
});

elements.librarySelectAllButton.addEventListener("click", () => {
  const searchTerm = elements.librarySearchInput.value.trim().toLowerCase();
  const statusFilter = elements.libraryStatusFilter.value;
  const assignmentFilter = elements.libraryAssignmentFilter.value;
  const sourceFilter = elements.librarySourceFilter.value;

  state.currentLibraryItems
    .filter((item) => {
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
      const provider = String(item.storage_provider || "").toLowerCase();
      const sourceKind = String(item.source_kind || item.kind || "").toLowerCase();
      const matchesSearch = !searchTerm || haystack.includes(searchTerm);
      const matchesStatus = !statusFilter || publicationStatus === statusFilter;
      const matchesAssignment =
        !assignmentFilter || (assignmentFilter === "assigned" ? hasChannel : !hasChannel);
      const matchesSource =
        !sourceFilter ||
        (sourceFilter === "tracked" && (sourceKind.includes("tracked") || provider === "remote_url")) ||
        (sourceFilter === "zip" && (provider === "zip_import" || Boolean(item.source_archive_path))) ||
        (sourceFilter === "cloud" && (provider === "s3-compatible" || Boolean(item.storage_object_key))) ||
        (sourceFilter === "direct" && provider === "local" && !item.source_archive_path);

      return matchesSearch && matchesStatus && matchesAssignment && matchesSource;
    })
    .forEach((item) => state.selectedLibraryIds.add(String(item.id)));
  renderLibraryVideos(state.currentLibraryItems);
});

elements.libraryClearSelectionButton.addEventListener("click", () => {
  state.selectedLibraryIds.clear();
  renderLibraryVideos(state.currentLibraryItems);
});

elements.libraryAddSelectedButton.addEventListener("click", async () => {
  const libraryVideoIds = Array.from(state.selectedLibraryIds)
    .map((value) => Number(value))
    .filter(Number.isFinite);
  const youtubeAccountId = Number(elements.libraryQueueAccountSelect.value || state.currentActiveAccountId);

  if (libraryVideoIds.length === 0) {
    setStatus("Selecciona al menos un video de la biblioteca.", true);
    return;
  }

  if (!Number.isFinite(youtubeAccountId)) {
    setStatus("Elige un perfil antes de mandar videos a la cola.", true);
    return;
  }

  await runWithBusyButton(elements.libraryAddSelectedButton, "Agregando...", async () => {
    setStatus(`Mandando ${libraryVideoIds.length} videos a la cola del perfil...`);
    try {
      await postJson("/api/publications", { libraryVideoIds, youtubeAccountId });
      state.selectedLibraryIds.clear();
      await Promise.all([loadPublications(), loadLibrary(), loadDashboard()]);
      setStatus("Los videos seleccionados fueron agregados a la cola.");
      setActiveView("accounts");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      syncLibrarySelectionBar();
    }
  });
});

[elements.librarySearchInput, elements.libraryStatusFilter, elements.libraryAssignmentFilter, elements.librarySourceFilter].forEach(
  (input) => {
    input.addEventListener(input.tagName === "INPUT" ? "input" : "change", () => {
      resetLibraryPagination();
      renderLibraryVideos(state.currentLibraryItems);
    });
  }
);

elements.libraryPrevPageButton.addEventListener("click", () => {
  state.currentLibraryPage = Math.max(1, state.currentLibraryPage - 1);
  renderLibraryVideos(state.currentLibraryItems);
});

elements.libraryNextPageButton.addEventListener("click", () => {
  state.currentLibraryPage += 1;
  renderLibraryVideos(state.currentLibraryItems);
});

elements.saveLibraryButton.addEventListener("click", async () => {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) {
    setStatus("Selecciona al menos un video para guardarlo en biblioteca.", true);
    return;
  }

  await runWithBusyButton(elements.saveLibraryButton, "Guardando...", async () => {
    setStatus(`Guardando ${ids.length} videos encontrados en la biblioteca reusable...`);

    try {
      const result = await postJson("/api/library/capture-media", {
        mediaIds: ids,
        label: state.currentUsername ? `captura-${state.currentUsername}` : "captura-manual"
      });
      await Promise.all([loadLibrary(), loadDashboard(), loadPublications()]);
      setStatus(
        `Se guardaron ${result.result?.createdCount || 0} videos en biblioteca. Ya puedes mandarlos al perfil que quieras.`
      );
      setActiveView("accounts");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      syncSelectionBar();
    }
  });
});

elements.downloadSelectedButton.addEventListener("click", async () => {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) {
    setStatus("Selecciona al menos un video.", true);
    return;
  }

  elements.downloadSelectedButton.disabled = true;
  setStatus(`Preparando ZIP para ${ids.length} videos seleccionados...`);

  try {
    const { blob, filename } = await postBlob("/api/media/download-selected.zip", { ids });
    triggerBlobDownload(blob, filename);
    setStatus(`Se descargaron ${ids.length} videos seleccionados.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.downloadSelectedButton.disabled = false;
    syncSelectionBar();
  }
});

elements.queueSelectedButton.addEventListener("click", async () => {
  const ids = Array.from(state.selectedIds);
  const youtubeAccountId = Number(elements.queueAccountSelect.value || state.currentActiveAccountId);

  if (ids.length === 0) {
    setStatus("Selecciona al menos un video.", true);
    return;
  }

  if (!Number.isFinite(youtubeAccountId)) {
    setStatus("Elige una cuenta de YouTube antes de enviar videos a la cola.", true);
    return;
  }

  await runWithBusyButton(elements.queueSelectedButton, "Enviando...", async () => {
    setStatus(`Enviando ${ids.length} videos a la cola de YouTube Shorts...`);

    try {
      await postJson("/api/publications", { mediaIds: ids, youtubeAccountId });
      await Promise.all([loadPublications(), loadDashboard(), loadLibrary()]);
      setStatus(`Se enviaron ${ids.length} videos a la cola de publicación.`);
      setActiveView("queue");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      syncSelectionBar();
    }
  });
});

elements.seedForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await postJson("/api/discovery/seeds", {
      seedType: elements.seedType.value,
      query: elements.seedQuery.value,
      label: elements.seedLabel.value
    });
    elements.seedForm.reset();
    await Promise.all([loadSeeds(), loadDashboard()]);
    setStatus("La semilla fue guardada.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.youtubeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  await runWithBusyButton(elements.youtubeForm.querySelector('button[type="submit"]'), "Guardando canal...", async () => {
    try {
      await postJson("/api/youtube/accounts", {
        channelTitle: elements.channelTitle.value,
        channelHandle: elements.channelHandle.value,
        channelId: elements.channelId.value,
        contactEmail: elements.contactEmail.value
      });
      elements.youtubeForm.reset();
      await Promise.all([loadAccounts(), loadDashboard()]);
      setStatus("El canal de YouTube fue agregado.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

elements.youtubeBulkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const accounts = parseBulkYoutubeAccounts(elements.youtubeBulkInput.value);
  if (accounts.length === 0) {
    setStatus("Pega al menos una cuenta válida.", true);
    return;
  }

  await runWithBusyButton(elements.youtubeBulkButton, "Importando...", async () => {
    try {
      await postJson("/api/youtube/accounts/bulk", { accounts });
      elements.youtubeBulkForm.reset();
      await Promise.all([loadAccounts(), loadDashboard()]);
      setStatus(`Se importaron ${accounts.length} cuentas de YouTube.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

elements.libraryImportForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  await runWithBusyButton(elements.libraryImportButton, "Importando ZIP...", async () => {
    try {
      await postJson("/api/library/import-zip", {
        zipPath: elements.libraryZipPath.value,
        label: elements.libraryLabel.value,
        youtubeAccountId: elements.libraryAccountSelect.value ? Number(elements.libraryAccountSelect.value) : null,
        privacyStatus: elements.libraryPrivacyStatus.value,
        startAt: elements.libraryStartAt.value ? new Date(elements.libraryStartAt.value).toISOString() : null,
        intervalDays: Number(elements.libraryIntervalDays.value || 1),
        scheduleDaily: elements.libraryScheduleDaily.checked
      });
      elements.libraryImportForm.reset();
      await Promise.all([loadLibrary(), loadPublications(), loadDashboard()]);
      setStatus("El ZIP fue importado a la biblioteca.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

elements.libraryVideoForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  await runWithBusyButton(elements.libraryVideoButton, "Guardando video...", async () => {
    try {
      const payload = {
        label: elements.libraryVideoLabel.value,
        title: elements.libraryVideoTitle.value,
        filePath: elements.libraryVideoPath.value,
        sourceUrl: elements.libraryVideoUrl.value,
        storageProvider: elements.libraryVideoProvider.value,
        youtubeAccountId: elements.libraryVideoAccountSelect.value ? Number(elements.libraryVideoAccountSelect.value) : null
      };
      const result = await postJson("/api/library/videos", payload);
      await Promise.all([loadLibrary(), loadPublications(), loadDashboard()]);
      setStatus(
        `El video se guardó en biblioteca. ${(result.queuedItems || []).length} publicación${
          (result.queuedItems || []).length === 1 ? "" : "es"
        } creada${(result.queuedItems || []).length === 1 ? "" : "s"}.`
      );
      elements.libraryVideoForm.reset();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

elements.distributionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const libraryVideoIds = Array.from(state.selectedLibraryIds)
    .map((value) => Number(value))
    .filter(Number.isFinite);
  const youtubeAccountIds = Array.from(
    elements.distributionAccountList.querySelectorAll(".distribution-account-checkbox:checked")
  )
    .map((checkbox) => Number(checkbox.value))
    .filter(Number.isFinite);

  if (libraryVideoIds.length === 0) {
    setStatus("Selecciona al menos un video de la biblioteca para distribuir.", true);
    return;
  }

  if (youtubeAccountIds.length === 0) {
    setStatus("Selecciona al menos una cuenta destino.", true);
    return;
  }

  await runWithBusyButton(elements.distributionSubmitButton, "Creando cola...", async () => {
    setStatus(`Distribuyendo ${libraryVideoIds.length} videos entre ${youtubeAccountIds.length} cuentas...`);

    try {
      await postJson("/api/publications/auto-distribute", {
        libraryVideoIds,
        youtubeAccountIds,
        privacyStatus: elements.distributionPrivacyStatus.value,
        startAt: elements.distributionStartAt.value ? new Date(elements.distributionStartAt.value).toISOString() : null,
        intervalHours: Number(elements.distributionIntervalHours.value || 24)
      });
      state.selectedLibraryIds.clear();
      await Promise.all([loadLibrary(), loadPublications(), loadPublicationJobs(), loadDashboard()]);
      setStatus("La distribución automática quedó cargada en la cola.");
      setActiveView("queue");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      syncLibrarySelectionBar();
    }
  });
});

elements.refreshCandidatesButton.addEventListener("click", async () => {
  try {
    await loadCandidates();
    setStatus("La lista de candidatos fue actualizada.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.navTabs.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveView(button.dataset.view);
  });
});

elements.heroTrackButton.addEventListener("click", () => {
  setActiveView("tracking");
  elements.username.focus();
});

elements.heroQueueButton.addEventListener("click", () => {
  setActiveView("queue");
});

elements.seedType.addEventListener("change", syncSeedQueryPlaceholder);
elements.candidateFilterStatus.addEventListener("change", loadCandidates);
elements.candidateFilterCategory.addEventListener("change", loadCandidates);

elements.refreshPublicationsButton.addEventListener("click", async () => {
  try {
    await loadPublications();
    setStatus("La cola de publicación fue actualizada.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.refreshChannelVideosButton.addEventListener("click", async () => {
  try {
    const currentAccount = getPrimaryConnectedAccount();
    await loadYoutubeChannelVideos(currentAccount?.id);
    setStatus("Las métricas del canal fueron actualizadas.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.refreshJobsButton.addEventListener("click", async () => {
  try {
    await loadPublicationJobs();
    setStatus("El dashboard de jobs fue actualizado.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.refreshWorkersButton.addEventListener("click", async () => {
  try {
    await loadWorkers();
    setStatus("El estado de workers fue actualizado.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

Promise.all([
  loadDashboard(),
  loadSeeds(),
  loadAccounts(),
  loadCandidates(),
  loadPublications(),
  loadLibrary(),
  loadPublicationJobs(),
  loadWorkers()
]).catch((error) => setStatus(error.message, true));

setActiveView("tracking");
syncSeedQueryPlaceholder();
handleOauthFeedback();
