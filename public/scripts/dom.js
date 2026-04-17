export const elements = {
  appShell: document.querySelector(".app-shell"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggleButton: document.getElementById("sidebar-toggle-button"),
  sidebarMobileButton: document.getElementById("sidebar-mobile-button"),
  sidebarDrawerBackdrop: document.getElementById("sidebar-drawer-backdrop"),
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
  scrapedContextTabBar: document.getElementById("scraped-context-tab-bar"),
  scrapedProfilesPane: document.getElementById("scraped-profiles-pane"),
  scrapedSearchPane: document.getElementById("scraped-search-pane"),
  scrapedProfilesList: document.getElementById("scraped-profiles-list"),
  scrapedProfilesPagerLabel: document.getElementById("scraped-profiles-pager-label"),
  scrapedProfilesPrevPage: document.getElementById("scraped-profiles-prev-page"),
  scrapedProfilesNextPage: document.getElementById("scraped-profiles-next-page"),
  scrapedSearchForm: document.getElementById("scraped-search-form"),
  scrapedSearchInput: document.getElementById("scraped-search-input"),
  scrapedSearchButton: document.getElementById("scraped-search-button"),
  scrapedSearchResults: document.getElementById("scraped-search-results"),
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
  youtubeProfilesList: document.getElementById("youtube-profiles-list"),
  youtubeProfilesPagerLabel: document.getElementById("youtube-profiles-pager-label"),
  youtubeProfilesPrevPage: document.getElementById("youtube-profiles-prev-page"),
  youtubeProfilesNextPage: document.getElementById("youtube-profiles-next-page"),
  youtubeProfileHeader: document.getElementById("youtube-profile-header"),
  youtubeProfileTabBar: document.getElementById("youtube-profile-tab-bar"),
  youtubeProfileTabContent: document.getElementById("youtube-profile-tab-content"),

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
  sidebarCollapsed: false,
  sidebarDrawerOpen: false,
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
  scrapedContextTab: "profiles",
  scrapedSearchQuery: "",
  scrapedSearchResults: [],
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
  youtubeVideosPage: 1,
  youtubeTabPageSize: 5,
  expandedChannelVideoId: null,
  expandedProfilePublicationId: null,
  profilePublishPage: 1,
  selectedLibraryIds: new Set(),
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
  scraped: ["TikTok", "Perfiles scrapeados"],
  youtube: ["YouTube", "Perfiles YouTube"],
  queue: ["Cola", "Cola general"],
  overview: ["Resumen", "Resumen general"]
};

const SIDEBAR_STORAGE_KEY = "studio.sidebar.collapsed";

function syncSidebarButtons() {
  elements.sidebarToggleButton?.setAttribute("aria-expanded", state.sidebarCollapsed ? "false" : "true");
  elements.sidebarToggleButton?.setAttribute("title", state.sidebarCollapsed ? "Expandir barra" : "Colapsar barra");
  const icon = elements.sidebarToggleButton?.querySelector(".sidebar-toggle-icon");
  if (icon) {
    icon.textContent = state.sidebarCollapsed ? ">>" : "<<";
  }

  elements.sidebarMobileButton?.setAttribute("aria-expanded", state.sidebarDrawerOpen ? "true" : "false");
}

export function initializeSidebarChrome() {
  try {
    state.sidebarCollapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    state.sidebarCollapsed = false;
  }

  elements.appShell?.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
  syncSidebarButtons();
}

export function setSidebarCollapsed(isCollapsed) {
  state.sidebarCollapsed = Boolean(isCollapsed);
  elements.appShell?.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, state.sidebarCollapsed ? "true" : "false");
  } catch {}

  syncSidebarButtons();
}

export function setSidebarDrawerOpen(isOpen) {
  state.sidebarDrawerOpen = Boolean(isOpen);
  elements.appShell?.classList.toggle("is-sidebar-drawer-open", state.sidebarDrawerOpen);
  elements.sidebar?.classList.toggle("is-drawer-open", state.sidebarDrawerOpen);
  elements.sidebarDrawerBackdrop?.classList.toggle("hidden", !state.sidebarDrawerOpen);
  syncSidebarButtons();
}

export function setActiveView(view) {
  state.currentView = view;
  if (state.sidebarDrawerOpen) {
    setSidebarDrawerOpen(false);
  }

  elements.navTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  elements.viewSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });

  const [eyebrow, title] = VIEW_META[view] || ["Studio", "Studio"];
  if (elements.headerEyebrow) elements.headerEyebrow.textContent = eyebrow;
  if (elements.pageTitle) elements.pageTitle.textContent = title;
}

let statusHideTimer = null;

export function setStatus(message, isError = false) {
  if (!elements.globalStatus) return;
  window.clearTimeout(statusHideTimer);

  if (!message) {
    elements.globalStatus.textContent = "";
    elements.globalStatus.classList.add("hidden");
    elements.globalStatus.classList.remove("is-error", "is-visible");
    return;
  }

  elements.globalStatus.textContent = message;
  elements.globalStatus.classList.toggle("is-error", Boolean(isError));
  elements.globalStatus.classList.remove("hidden");
  elements.globalStatus.classList.add("is-visible");

  if (!isError) {
    statusHideTimer = window.setTimeout(() => {
      elements.globalStatus.classList.remove("is-visible");
      window.setTimeout(() => elements.globalStatus.classList.add("hidden"), 180);
    }, 2200);
  }
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
