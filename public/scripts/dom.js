export const elements = {
  navTabs: Array.from(document.querySelectorAll(".nav-tab")),
  form: document.getElementById("track-form"),
  username: document.getElementById("username"),
  submitButton: document.getElementById("submit-button"),
  refreshButton: document.getElementById("refresh-button"),
  zipButton: document.getElementById("zip-button"),
  statusText: document.getElementById("status-text"),
  summaryCard: document.getElementById("summary-card"),
  trackedKind: document.getElementById("tracked-kind"),
  avatar: document.getElementById("avatar"),
  displayName: document.getElementById("display-name"),
  profileLink: document.getElementById("profile-link"),
  totalMedia: document.getElementById("total-media"),
  videoCount: document.getElementById("video-count"),
  imageCount: document.getElementById("image-count"),
  lastScrape: document.getElementById("last-scrape"),
  mediaGrid: document.getElementById("media-grid"),
  loadMoreMediaButton: document.getElementById("load-more-media-button"),
  trackResultsMeta: document.getElementById("track-results-meta"),
  template: document.getElementById("media-card-template"),
  selectionBar: document.getElementById("selection-bar"),
  selectedCount: document.getElementById("selected-count"),
  selectAllButton: document.getElementById("select-all-button"),
  clearSelectionButton: document.getElementById("clear-selection-button"),
  saveLibraryButton: document.getElementById("save-library-button"),
  downloadSelectedButton: document.getElementById("download-selected-button"),
  queueSelectedButton: document.getElementById("queue-selected-button"),
  queueAccountSelect: document.getElementById("queue-account-select"),
  summaryStrip: document.getElementById("summary-strip"),
  seedForm: document.getElementById("seed-form"),
  seedType: document.getElementById("seed-type"),
  seedQuery: document.getElementById("seed-query"),
  seedLabel: document.getElementById("seed-label"),
  seedList: document.getElementById("seed-list"),
  youtubeForm: document.getElementById("youtube-form"),
  youtubeBulkForm: document.getElementById("youtube-bulk-form"),
  youtubeBulkInput: document.getElementById("youtube-bulk-input"),
  youtubeBulkButton: document.getElementById("youtube-bulk-button"),
  channelTitle: document.getElementById("channel-title"),
  channelHandle: document.getElementById("channel-handle"),
  channelId: document.getElementById("channel-id"),
  contactEmail: document.getElementById("contact-email"),
  libraryImportForm: document.getElementById("library-import-form"),
  libraryZipPath: document.getElementById("library-zip-path"),
  libraryLabel: document.getElementById("library-label"),
  libraryAccountSelect: document.getElementById("library-account-select"),
  libraryPrivacyStatus: document.getElementById("library-privacy-status"),
  libraryStartAt: document.getElementById("library-start-at"),
  libraryIntervalDays: document.getElementById("library-interval-days"),
  libraryScheduleDaily: document.getElementById("library-schedule-daily"),
  libraryImportButton: document.getElementById("library-import-button"),
  libraryVideoForm: document.getElementById("library-video-form"),
  libraryVideoLabel: document.getElementById("library-video-label"),
  libraryVideoTitle: document.getElementById("library-video-title"),
  libraryVideoPath: document.getElementById("library-video-path"),
  libraryVideoUrl: document.getElementById("library-video-url"),
  libraryVideoProvider: document.getElementById("library-video-provider"),
  libraryVideoAccountSelect: document.getElementById("library-video-account-select"),
  libraryVideoButton: document.getElementById("library-video-button"),
  librarySelectionBar: document.getElementById("library-selection-bar"),
  librarySelectedCount: document.getElementById("library-selected-count"),
  librarySelectAllButton: document.getElementById("library-select-all-button"),
  libraryClearSelectionButton: document.getElementById("library-clear-selection-button"),
  libraryVideoList: document.getElementById("library-video-list"),
  libraryQueueAccountSelect: document.getElementById("library-queue-account-select"),
  distributionForm: document.getElementById("distribution-form"),
  distributionAccountList: document.getElementById("distribution-account-list"),
  distributionStartAt: document.getElementById("distribution-start-at"),
  distributionIntervalHours: document.getElementById("distribution-interval-hours"),
  distributionPrivacyStatus: document.getElementById("distribution-privacy-status"),
  distributionSubmitButton: document.getElementById("distribution-submit-button"),
  channelVideosList: document.getElementById("channel-videos-list"),
  accountScheduleList: document.getElementById("account-schedule-list"),
  refreshChannelVideosButton: document.getElementById("refresh-channel-videos-button"),
  youtubeOauthBox: document.getElementById("youtube-oauth-box"),
  youtubeList: document.getElementById("youtube-list"),
  viewSections: Array.from(document.querySelectorAll(".view-section")),
  candidateGrid: document.getElementById("candidate-grid"),
  candidateFilterStatus: document.getElementById("candidate-filter-status"),
  candidateFilterCategory: document.getElementById("candidate-filter-category"),
  refreshCandidatesButton: document.getElementById("refresh-candidates-button"),
  publicationList: document.getElementById("publication-list"),
  refreshPublicationsButton: document.getElementById("refresh-publications-button"),
  refreshJobsButton: document.getElementById("refresh-jobs-button"),
  jobsSummaryStrip: document.getElementById("jobs-summary-strip"),
  jobsList: document.getElementById("jobs-list"),
  refreshWorkersButton: document.getElementById("refresh-workers-button"),
  workersSummaryStrip: document.getElementById("workers-summary-strip"),
  workersList: document.getElementById("workers-list"),
  heroTrackButton: document.getElementById("hero-track-button"),
  heroQueueButton: document.getElementById("hero-queue-button"),
  heroHealthStrip: document.getElementById("hero-health-strip"),
  dashboardAlert: document.getElementById("dashboard-alert"),
  recentProfilesList: document.getElementById("recent-profiles-list"),
  recentPublicationsList: document.getElementById("recent-publications-list"),
  recentErrorsList: document.getElementById("recent-errors-list"),
  scrapeStatusBox: document.getElementById("scrape-status-box")
};

export const state = {
  currentUsername: "",
  currentTrackQuery: "",
  currentItems: [],
  currentLibraryItems: [],
  currentAccounts: [],
  currentPublications: [],
  currentJobs: [],
  currentWorkers: [],
  currentTrackingRun: null,
  currentTrackLimit: 20,
  currentTrackBatchSize: 20,
  currentTrackTotalAvailable: 0,
  trackingPollTimer: null,
  currentView: "tracking",
  selectedIds: new Set(),
  selectedLibraryIds: new Set()
};

export function setActiveView(view) {
  state.currentView = view;
  elements.navTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  elements.viewSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
}

export function syncSeedQueryPlaceholder() {
  const type = elements.seedType.value;
  if (type === "hashtag") {
    elements.seedQuery.placeholder = "#tema";
    return;
  }

  if (type === "keyword") {
    elements.seedQuery.placeholder = "keyword o frase";
    return;
  }

  elements.seedQuery.placeholder = "@perfil";
}

export function setStatus(message, isError = false) {
  elements.statusText.textContent = message;
  elements.statusText.style.color = isError ? "#ff9e84" : "";
}

export function setButtonBusy(button, busyText, isBusy) {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  button.textContent = isBusy ? busyText : button.dataset.defaultLabel;
}

export async function runWithBusyButton(button, busyText, task) {
  if (!button) {
    return task();
  }

  const previousDisabled = button.disabled;
  button.disabled = true;
  setButtonBusy(button, busyText, true);

  try {
    return await task();
  } finally {
    button.disabled = previousDisabled;
    setButtonBusy(button, busyText, false);
  }
}

export function stopTrackingPolling() {
  if (state.trackingPollTimer) {
    window.clearTimeout(state.trackingPollTimer);
    state.trackingPollTimer = null;
  }
}

export function setTrackingPollTimer(timer) {
  state.trackingPollTimer = timer;
}

export function setTrackingControlsBusy(isBusy) {
  elements.submitButton.disabled = isBusy;
  elements.refreshButton.disabled = isBusy;
  setButtonBusy(elements.submitButton, "Rastreando...", isBusy);
  setButtonBusy(elements.refreshButton, "Actualizando...", isBusy);
}

export function syncSelectionBar() {
  const count = state.selectedIds.size;
  elements.selectionBar.classList.toggle("hidden", state.currentItems.length === 0);
  elements.selectedCount.textContent = `${count} seleccionados`;
  elements.saveLibraryButton.disabled = count === 0;
  elements.downloadSelectedButton.disabled = count === 0;
  elements.clearSelectionButton.disabled = count === 0;
  elements.selectAllButton.disabled = state.currentItems.length === 0 || count === state.currentItems.length;
  elements.queueSelectedButton.disabled = count === 0 || !elements.queueAccountSelect.value;
}

export function syncTrackResultsControls() {
  const visibleCount = state.currentItems.length;
  const totalAvailable = Math.max(Number(state.currentTrackTotalAvailable || 0), visibleCount);
  const hasItems = visibleCount > 0;
  const isRunning = String(state.currentTrackingRun?.status || "").toLowerCase() === "running";

  elements.trackResultsMeta.classList.toggle("hidden", !hasItems);
  elements.trackResultsMeta.textContent = hasItems
    ? `Mostrando ${visibleCount} de ${totalAvailable}${isRunning ? " | tracking en curso" : ""}`
    : "";

  const canLoadMore = hasItems && !isRunning && visibleCount >= state.currentTrackLimit;
  elements.loadMoreMediaButton.classList.toggle("hidden", !canLoadMore);
  elements.loadMoreMediaButton.disabled = isRunning;
}

export function syncLibrarySelectionBar() {
  const count = state.selectedLibraryIds.size;
  elements.librarySelectionBar.classList.toggle("hidden", state.currentLibraryItems.length === 0);
  elements.librarySelectedCount.textContent = `${count} seleccionados`;
  elements.librarySelectAllButton.disabled =
    state.currentLibraryItems.length === 0 || count === state.currentLibraryItems.length;
  elements.libraryClearSelectionButton.disabled = count === 0;
  elements.distributionSubmitButton.disabled = count === 0;
}
