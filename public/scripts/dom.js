export const elements = {
  navTabs: Array.from(document.querySelectorAll('.nav-tab')),
  viewSections: Array.from(document.querySelectorAll('.view-section')),
  headerEyebrow: document.getElementById('header-eyebrow'),
  pageTitle: document.getElementById('page-title'),
  globalStatus: document.getElementById('global-status'),

  trackForm: document.getElementById('track-form'),
  username: document.getElementById('username'),
  submitButton: document.getElementById('submit-button'),
  refreshButton: document.getElementById('refresh-button'),
  trackingSummary: document.getElementById('tracking-summary'),
  mediaGrid: document.getElementById('media-grid'),
  trackResultsMeta: document.getElementById('track-results-meta'),
  queueAccountSelect: document.getElementById('queue-account-select'),
  saveLibraryButton: document.getElementById('save-library-button'),
  queueSelectedButton: document.getElementById('queue-selected-button'),
  trackPrevPage: document.getElementById('track-prev-page'),
  trackNextPage: document.getElementById('track-next-page'),
  trackingPagerLabel: document.getElementById('tracking-pager-label'),
  loadMoreMediaButton: document.getElementById('load-more-media-button'),

  librarySearchInput: document.getElementById('library-search-input'),
  libraryStatusFilter: document.getElementById('library-status-filter'),
  librarySourceFilter: document.getElementById('library-source-filter'),
  libraryTargetAccountSelect: document.getElementById('library-target-account-select'),
  libraryResultsMeta: document.getElementById('library-results-meta'),
  libraryPrevPageButton: document.getElementById('library-prev-page-button'),
  libraryNextPageButton: document.getElementById('library-next-page-button'),
  libraryVideoList: document.getElementById('library-video-list'),

  refreshAccountsButton: document.getElementById('refresh-accounts-button'),
  youtubeOauthBox: document.getElementById('youtube-oauth-box'),
  profilesList: document.getElementById('profiles-list'),
  profilesPagerLabel: document.getElementById('profiles-pager-label'),
  profilesPrevPage: document.getElementById('profiles-prev-page'),
  profilesNextPage: document.getElementById('profiles-next-page'),
  profileHeader: document.getElementById('profile-header'),
  profileTabBar: document.getElementById('profile-tab-bar'),
  profileTabContent: document.getElementById('profile-tab-content'),
  profileSideActions: document.getElementById('profile-side-actions'),

  youtubeForm: document.getElementById('youtube-form'),
  youtubeBulkForm: document.getElementById('youtube-bulk-form'),
  youtubeBulkButton: document.getElementById('youtube-bulk-button'),
  youtubeBulkInput: document.getElementById('youtube-bulk-input'),
  channelTitle: document.getElementById('channel-title'),
  channelHandle: document.getElementById('channel-handle'),
  channelId: document.getElementById('channel-id'),
  contactEmail: document.getElementById('contact-email'),

  queueSummaryStrip: document.getElementById('queue-summary-strip'),
  queueTabBar: document.getElementById('queue-tab-bar'),
  publicationList: document.getElementById('publication-list'),
  refreshPublicationsButton: document.getElementById('refresh-publications-button'),
  queuePrevPage: document.getElementById('queue-prev-page'),
  queueNextPage: document.getElementById('queue-next-page'),
  queuePagerLabel: document.getElementById('queue-pager-label'),

  summaryStrip: document.getElementById('summary-strip')
};

export const state = {
  currentView: 'tracking',
  currentTrackQuery: '',
  currentUsername: '',
  currentItems: [],
  currentTrackingProfile: null,
  currentTrackingRun: null,
  currentTrackLimit: 24,
  currentTrackBatchSize: 24,
  currentTrackTotalAvailable: 0,
  currentTrackPage: 1,
  currentTrackPageSize: 6,
  selectedTrackIds: new Set(),
  trackingPollTimer: null,

  accounts: [],
  oauth: null,
  selectedAccountId: null,
  accountVideosById: {},
  currentProfileTab: 'summary',
  profileListPage: 1,
  profileListPageSize: 5,
  profileUploadsPage: 1,
  profileQueuePage: 1,
  profilePublishPage: 1,
  profileTabPageSize: 5,

  libraryItems: [],
  libraryPage: 1,
  libraryPageSize: 6,
  libraryFilters: {
    search: '',
    status: '',
    source: ''
  },
  profilePublishFilters: {
    search: '',
    source: '',
    availability: 'available'
  },

  publications: [],
  queueTab: 'all',
  queuePage: 1,
  queuePageSize: 8,
  dashboardSummary: null
};

const VIEW_META = {
  tracking: ['Operación', 'Rastrear'],
  library: ['Biblioteca', 'Biblioteca'],
  profiles: ['Perfiles', 'Perfiles'],
  queue: ['Cola', 'Cola general'],
  overview: ['Resumen', 'Resumen']
};

export function setActiveView(view) {
  state.currentView = view;
  elements.navTabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  elements.viewSections.forEach((section) => {
    section.classList.toggle('active', section.dataset.view === view);
  });
  const [eyebrow, title] = VIEW_META[view] || ['Operación', 'Workspace'];
  if (elements.headerEyebrow) elements.headerEyebrow.textContent = eyebrow;
  if (elements.pageTitle) elements.pageTitle.textContent = title;
}

export function setStatus(message, isError = false) {
  if (!elements.globalStatus) return;
  elements.globalStatus.textContent = message;
  elements.globalStatus.classList.toggle('is-error', Boolean(isError));
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
