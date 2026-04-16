export const elements = {
  appShell: document.querySelector(".app-shell"),
  sidebar: document.querySelector(".sidebar"),
  navTabs: Array.from(document.querySelectorAll(".nav-tab")),
  viewSections: Array.from(document.querySelectorAll(".view-section")),
  headerEyebrow: document.getElementById("header-eyebrow"),
  pageTitle: document.getElementById("page-title"),
  globalStatus: document.getElementById("global-status"),

  trackForm: document.getElementById("track-form"),
  username: document.getElementById("username"),
  submitButton: document.getElementById("submit-button"),
  refreshButton: document.getElementById("refresh-button"),
  refreshScrapedButton: document.getElementById("refresh-scraped-button"),
  scrapedProfilesList: document.getElementById("scraped-profiles-list"),
  scrapedProfilesPagerLabel: document.getElementById("scraped-profiles-pager-label"),
  scrapedProfilesPrevPage: document.getElementById("scraped-profiles-prev-page"),
  scrapedProfilesNextPage: document.getElementById("scraped-profiles-next-page"),
  scrapedProfileHeader: document.getElementById("scraped-profile-header"),
  scrapedResultsMeta: document.getElementById("scraped-results-meta"),
  scrapedVideosGrid: document.getElementById("scraped-videos-grid"),
  scrapedVideosPagerLabel: document.getElementById("scraped-videos-pager-label"),
  scrapedVideosPrevPage: document.getElementById("scraped-videos-prev-page"),
  scrapedVideosNextPage: document.getElementById("scraped-videos-next-page"),
  saveLibraryButton: document.getElementById("save-library-button"),
  loadMoreMediaButton: document.getElementById("load-more-media-button"),

  refreshAccountsButton: document.getElementById("refresh-accounts-button"),
  addYoutubeAccountButton: document.getElementById("add-youtube-account-button"),
  youtubeOauthBox: document.getElementById("youtube-oauth-box"),
  youtubeContextPanel: document.getElementById("youtube-context-panel"),
  youtubeContextOverlay: document.getElementById("youtube-context-overlay"),
  toggleYoutubeContextButton: document.getElementById("toggle-youtube-context-button"),
  closeYoutubeContextButton: document.getElementById("close-youtube-context-button"),
  youtubeProfilesList: document.getElementById("youtube-profiles-list"),
  youtubeProfilesPagerLabel: document.getElementById("youtube-profiles-pager-label"),
  youtubeProfilesPrevPage: document.getElementById("youtube-profiles-prev-page"),
  youtubeProfilesNextPage: document.getElementById("youtube-profiles-next-page"),
  youtubeProfileHeader: document.getElementById("youtube-profile-header"),
  youtubeProfileTabBar: document.getElementById("youtube-profile-tab-bar"),
  youtubeProfileTabContent: document.getElementById("youtube-profile-tab-content"),
  youtubeSideActions: document.getElementById("youtube-side-actions"),

  queueSummaryStrip: document.getElementById("queue-summary-strip"),
  queueTabBar: document.getElementById("queue-tab-bar"),
  publicationList: document.getElementById("publication-list"),
  refreshPublicationsButton: document.getElementById("refresh-publications-button"),
  queuePrevPage: document.getElementById("queue-prev-page"),
  queueNextPage: document.getElementById("queue-next-page"),
  queuePagerLabel: document.getElementById("queue-pager-label"),

  summaryStrip: document.getElementById("summary-strip"),
  overviewScrapedList: document.getElementById("overview-scraped-list"),
  overviewPublicationsList: document.getElementById("overview-publications-list")
};

export const state = {
  currentView: "scraped",
  dashboardSummary: null,
  oauth: null,

  scrapedProfiles: [],
  selectedScrapedUsername: null,
  currentTrackQuery: "",
  currentTrackingProfile: null,
  currentTrackingRun: null,
  currentItems: [],
  currentTrackLimit: 24,
  currentTrackBatchSize: 24,
  currentTrackTotalAvailable: 0,
  scrapedProfilesPage: 1,
  scrapedProfilesPageSize: 6,
  scrapedVideosPage: 1,
  scrapedVideosPageSize: 6,
  selectedTrackIds: new Set(),
  trackingPollTimer: null,

  accounts: [],
  selectedAccountId: null,
  accountVideosById: {},
  accountChannelById: {},
  accountClonesById: {},
  youtubeListPage: 1,
  youtubeListPageSize: 5,
  currentYoutubeTab: "videos",
  youtubeContextOpen: false,
  youtubeVideosPage: 1,
  youtubeTabPageSize: 5,
  profilePublishPage: 1,
  profilePublishFilters: {
    search: "",
    source: "",
    availability: "available"
  },
  cloneForm: {
    trackedProfileId: "",
    dailyLimit: 3
  },

  libraryItems: [],
  publications: [],
  queueTab: "all",
  queuePage: 1,
  queuePageSize: 8
};

const VIEW_META = {
  scraped: ["Perfiles", "Perfiles scrapeados"],
  youtube: ["Canales", "Perfiles YouTube"],
  queue: ["Cola", "Cola general"],
  overview: ["Resumen", "Resumen"]
};

export function setActiveView(view) {
  state.currentView = view;
  elements.appShell?.classList.toggle("is-youtube-focus", view === "youtube");
  if (view !== "youtube") {
    setYoutubeContextOpen(false);
  }
  elements.navTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  elements.viewSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
  const [eyebrow, title] = VIEW_META[view] || ["Workspace", "Workspace"];
  if (elements.headerEyebrow) elements.headerEyebrow.textContent = eyebrow;
  if (elements.pageTitle) elements.pageTitle.textContent = title;
}

export function setYoutubeContextOpen(isOpen) {
  state.youtubeContextOpen = Boolean(isOpen);
  elements.appShell?.classList.toggle("youtube-context-open", state.youtubeContextOpen);
  elements.youtubeContextPanel?.classList.toggle("is-open", state.youtubeContextOpen);
  elements.youtubeContextOverlay?.classList.toggle("is-visible", state.youtubeContextOpen);
}

export function setStatus(message, isError = false) {
  if (!elements.globalStatus) return;
  elements.globalStatus.textContent = message;
  elements.globalStatus.classList.toggle("is-error", Boolean(isError));
}

export function setButtonBusy(button, busyText, isBusy) {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : button.dataset.defaultLabel;
}

export async function runWithBusyButton(button, busyText, task) {
  setButtonBusy(button, busyText, true);
  try {
    return await task();
  } finally {
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
