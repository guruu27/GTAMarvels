const STORAGE_KEY = "teamflow-ui-v3";
const PROFILE_TABLE = "team_profiles";
const TEAM_TABLE = "teams";
const EVENT_TABLE = "team_events";
const AVAILABILITY_TABLE = "team_event_availability";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  teamId: "gta-marvels",
  teamName: "GTA Marvels",
};

const TYPE_META = {
  practice: { label: "Practice", accent: "#2c8f78" },
  game: { label: "Game", accent: "#ec6b56" },
  tournament: { label: "Tournament", accent: "#4d8cc8" },
  social: { label: "Team event", accent: "#b85a77" },
};

const RESPONSE_META = {
  pending: "Waiting",
  available: "Available",
  maybe: "Maybe",
  unavailable: "Unavailable",
};

const CHECKIN_META = {
  pending: "Not tracked yet",
  on_time: "On time",
  late: "Late",
  excused: "Excused absence",
  unexcused: "Unexcused absence",
};

const refs = {
  authScreen: document.querySelector("#authScreen"),
  authTabs: document.querySelector("#authTabs"),
  authNotice: document.querySelector("#authNotice"),
  authMessage: document.querySelector("#authMessage"),
  authNoticeActions: document.querySelector("#authNoticeActions"),
  setupHelp: document.querySelector("#setupHelp"),
  signInForm: document.querySelector("#signInForm"),
  signUpForm: document.querySelector("#signUpForm"),
  resetRequestForm: document.querySelector("#resetRequestForm"),
  passwordUpdateForm: document.querySelector("#passwordUpdateForm"),
  appShell: document.querySelector("#appShell"),
  appNotice: document.querySelector("#appNotice"),
  appNoticeMessage: document.querySelector("#appNoticeMessage"),
  appNoticeActions: document.querySelector("#appNoticeActions"),
  sessionBadge: document.querySelector("#sessionBadge"),
  typeFilters: document.querySelector("#typeFilters"),
  miniTimeline: document.querySelector("#miniTimeline"),
  feedList: document.querySelector("#feedList"),
  heroTitle: document.querySelector("#heroTitle"),
  heroSubtitle: document.querySelector("#heroSubtitle"),
  syncNotice: document.querySelector("#syncNotice"),
  nextEventLabel: document.querySelector("#nextEventLabel"),
  availabilityLabel: document.querySelector("#availabilityLabel"),
  pendingLabel: document.querySelector("#pendingLabel"),
  viewSwitch: document.querySelector("#viewSwitch"),
  rangeLabel: document.querySelector("#rangeLabel"),
  showCancelledToggle: document.querySelector("#showCancelledToggle"),
  todayBtn: document.querySelector("#todayBtn"),
  calendarSurface: document.querySelector("#calendarSurface"),
  agendaPreview: document.querySelector("#agendaPreview"),
  rosterBoard: document.querySelector("#rosterBoard"),
  eventDrawer: document.querySelector("#eventDrawer"),
  createEventBtn: document.querySelector("#createEventBtn"),
  seedDemoBtn: document.querySelector("#seedDemoBtn"),
  signOutBtn: document.querySelector("#signOutBtn"),
  eventModal: document.querySelector("#eventModal"),
  modalTitle: document.querySelector("#modalTitle"),
  eventForm: document.querySelector("#eventForm"),
};

const appConfig = normalizeConfig(window.TEAMFLOW_CONFIG);
const app = {
  supabase: null,
  authSubscription: null,
  loadingData: false,
};

let state = {
  team: {
    id: appConfig.teamId,
    name: appConfig.teamName,
  },
  auth: {
    status: "loading",
    view: "sign-in",
    message: "",
    messageTone: "info",
    messageActions: [],
    profile: null,
    session: null,
  },
  notice: defaultNoticeState(),
  members: [],
  events: [],
  feed: [],
  ui: loadUiState(),
};

boot();

async function boot() {
  wireEvents();

  if (!hasSupabaseConfig()) {
    state.auth.status = "setup";
    state.auth.view = "setup";
    setAuthNotice("Supabase credentials are missing. Add config.js values or GitHub Actions secrets.", {
      tone: "warning",
    });
    render();
    return;
  }

  app.supabase = window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const { data } = app.supabase.auth.onAuthStateChange((event, session) => {
    void handleAuthStateChange(event, session);
  });
  app.authSubscription = data.subscription;

  const { data: sessionData, error } = await app.supabase.auth.getSession();
  if (error) {
    state.auth.status = "signed_out";
    setAuthNotice(extractErrorMessage(error), { tone: "warning" });
    render();
    return;
  }

  if (sessionData.session) {
    state.auth.session = sessionData.session;
    await loadAuthedData(sessionData.session.user);
    return;
  }

  state.auth.status = "signed_out";
  state.auth.view = "sign-in";
  render();
}

function wireEvents() {
  refs.createEventBtn.addEventListener("click", () => openModal());
  refs.seedDemoBtn.addEventListener("click", () => {
    void handleSeedDemo();
  });
  refs.signOutBtn.addEventListener("click", () => {
    void handleSignOut();
  });
  refs.todayBtn.addEventListener("click", () => {
    state.ui.anchorDate = toDateKey(new Date());
    renderApp();
    persistUi();
  });
  refs.showCancelledToggle.addEventListener("change", (event) => {
    state.ui.showCancelled = event.target.checked;
    renderApp();
    persistUi();
  });
  refs.viewSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) {
      return;
    }
    state.ui.view = button.dataset.view;
    renderApp();
    persistUi();
  });
  refs.signInForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSignIn();
  });
  refs.signUpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlePlayerSignUp();
  });
  refs.resetRequestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlePasswordResetRequest();
  });
  refs.passwordUpdateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlePasswordUpdate();
  });
  refs.eventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleEventFormSubmit();
  });
  refs.eventDrawer.addEventListener("click", (event) => {
    void handleDrawerClick(event);
  });
  refs.eventDrawer.addEventListener("change", (event) => {
    void handleDrawerChange(event);
  });
  document.addEventListener("click", (event) => {
    void handleDocumentClick(event);
  });
}

async function handleDocumentClick(event) {
  const noticeButton = event.target.closest("[data-notice-action]");
  if (noticeButton) {
    handleNoticeAction(noticeButton.dataset.noticeAction, noticeButton.dataset.noticeTarget);
    return;
  }

  const authButton = event.target.closest("[data-auth-view]");
  if (authButton) {
    setAuthView(authButton.dataset.authView);
    return;
  }

  const filterButton = event.target.closest("[data-filter-type]");
  if (filterButton && isSignedIn()) {
    toggleFilter(filterButton.dataset.filterType);
    return;
  }

  const navButton = event.target.closest("[data-nav]");
  if (navButton && isSignedIn()) {
    shiftRange(navButton.dataset.nav);
    return;
  }

  const eventButton = event.target.closest("[data-select-event]");
  if (eventButton && isSignedIn()) {
    state.ui.selectedEventId = eventButton.dataset.selectEvent;
    renderApp();
    persistUi();
    return;
  }

  const openEditButton = event.target.closest("[data-edit-event]");
  if (openEditButton && isSignedIn()) {
    openModal(openEditButton.dataset.editEvent);
    return;
  }

  const closeModalButton = event.target.closest("[data-close-modal]");
  if (closeModalButton) {
    closeModal();
  }
}

async function handleAuthStateChange(event, session) {
  if (event === "PASSWORD_RECOVERY") {
    state.auth.session = session;
    state.auth.status = "password_recovery";
    state.auth.view = "update-password";
    setAuthNotice("Reset link confirmed. Enter a new password.", { tone: "info" });
    render();
    return;
  }

  if (event === "SIGNED_OUT") {
    clearAuthedState();
    render();
    return;
  }

  if (!session) {
    clearAuthedState();
    render();
    return;
  }

  state.auth.session = session;
  await loadAuthedData(session.user);
}

async function loadAuthedData(user) {
  if (!app.supabase || !user) {
    return;
  }

  state.auth.status = "loading";
  clearAuthNotice();
  render();

  try {
    app.loadingData = true;
    clearAuthNotice();

    const profile = await fetchCurrentProfile(user.id);
    if (!profile) {
      state.auth.status = "signed_out";
      setAuthNotice(
        "This login is authenticated, but no player or manager profile is linked yet. Players should use the sign-up form, and managers must be created manually in Supabase.",
        {
          tone: "warning",
          actions: [{ id: "open-sign-up", label: "Player sign up", variant: "primary" }],
        },
      );
      state.auth.profile = null;
      state.auth.session = null;
      render();
      return;
    }

    const team = await fetchTeam(profile.team_id);
    const members = await fetchMembers(profile.team_id);
    const eventRows = await fetchEvents(profile.team_id);
    const availabilityRows = eventRows.length ? await fetchAvailabilityRows(eventRows.map((item) => item.id)) : [];

    state.auth.profile = {
      id: profile.id,
      teamId: profile.team_id,
      username: profile.username,
      email: profile.email,
      displayName: profile.display_name,
      role: profile.role,
    };
    state.team = {
      id: team?.id || profile.team_id,
      name: team?.name || appConfig.teamName,
    };
    state.members = members.map(mapProfileToMember);
    state.events = buildEventRecords(eventRows, availabilityRows, state.members);
    state.feed = buildFeed(state.events, availabilityRows, state.members);
    state.auth.status = "signed_in";
    state.auth.view = "sign-in";
    clearAuthNotice();
    state.ui.selectedEventId = ensureSelectedEventId();
    render();
    persistUi();
  } catch (error) {
    state.auth.status = "signed_out";
    setAuthNotice(extractErrorMessage(error), { tone: "warning" });
    state.auth.profile = null;
    state.auth.session = null;
    render();
  } finally {
    app.loadingData = false;
  }
}

async function fetchCurrentProfile(userId) {
  const { data, error } = await app.supabase
    .from(PROFILE_TABLE)
    .select("id, team_id, username, email, display_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchTeam(teamId) {
  const { data, error } = await app.supabase
    .from(TEAM_TABLE)
    .select("id, name")
    .eq("id", teamId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchMembers(teamId) {
  const { data, error } = await app.supabase
    .from(PROFILE_TABLE)
    .select("id, team_id, username, email, display_name, role")
    .eq("team_id", teamId)
    .order("display_name", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchEvents(teamId) {
  const { data, error } = await app.supabase
    .from(EVENT_TABLE)
    .select(
      "id, team_id, type, title, start_at, end_at, meet_time, opponent, location, address, required_players, notes, status, recurring_group_id, created_at, updated_at",
    )
    .eq("team_id", teamId)
    .order("start_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchAvailabilityRows(eventIds) {
  const { data, error } = await app.supabase
    .from(AVAILABILITY_TABLE)
    .select("event_id, user_id, response, check_in, updated_at")
    .in("event_id", eventIds);

  if (error) {
    throw error;
  }

  return data || [];
}

async function refreshData() {
  if (state.auth.session?.user) {
    await loadAuthedData(state.auth.session.user);
  }
}

async function handleSignIn() {
  if (!app.supabase) {
    return;
  }

  const formData = new FormData(refs.signInForm);
  const loginIdentifier = compactString(formData.get("login"));
  const password = compactString(formData.get("password"));

  if (!loginIdentifier || !password) {
    setAuthNotice("Enter your username or email and password.", { tone: "warning" });
    renderAuth();
    return;
  }

  setAuthNotice("Signing you in...", { tone: "info" });
  renderAuth();

  try {
    const email = await resolveLoginEmail(loginIdentifier);
    const { error } = await app.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw error;
    }
  } catch (error) {
    setAuthNotice(extractErrorMessage(error), {
      tone: "warning",
      actions: [{ id: "open-reset", label: "Reset password", variant: "primary" }],
    });
    renderAuth();
  }
}

async function handlePlayerSignUp() {
  if (!app.supabase) {
    return;
  }

  const formData = new FormData(refs.signUpForm);
  const email = compactString(formData.get("email")).toLowerCase();
  const username = normalizeUsername(formData.get("username"));
  const displayName = compactString(formData.get("displayName"));
  const password = compactString(formData.get("password"));
  const confirmPassword = compactString(formData.get("confirmPassword"));

  if (!email || !username || !displayName || !password || !confirmPassword) {
    setAuthNotice("Fill in every signup field to create a player account.", { tone: "warning" });
    renderAuth();
    return;
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    setAuthNotice("Enter a valid email address.", { tone: "warning" });
    renderAuth();
    return;
  }

  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    setAuthNotice("Use 3-30 lowercase letters, numbers, dots, hyphens, or underscores for the username.", {
      tone: "warning",
    });
    renderAuth();
    return;
  }

  if (displayName.length < 2) {
    setAuthNotice("Enter the name you want teammates to see.", { tone: "warning" });
    renderAuth();
    return;
  }

  if (password.length < 8) {
    setAuthNotice("Use a password with at least 8 characters.", { tone: "warning" });
    renderAuth();
    return;
  }

  if (password !== confirmPassword) {
    setAuthNotice("The passwords do not match.", { tone: "warning" });
    renderAuth();
    return;
  }

  setAuthNotice("Creating your player account...", { tone: "info" });
  renderAuth();

  try {
    const { data, error } = await app.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          registration_mode: "player_self_signup",
          team_id: appConfig.teamId,
          username,
          display_name: displayName,
        },
      },
    });

    if (error) {
      throw error;
    }

    refs.signUpForm.reset();
    setSignInLoginValue(username);

    if (data.session) {
      setAuthNotice("Player account created. Loading your team workspace...", { tone: "success" });
      renderAuth();
      return;
    }

    state.auth.status = "signed_out";
    state.auth.view = "sign-in";
    setAuthNotice("Player account created. Check your email to confirm it, then sign in with your username or email.", {
      tone: "success",
      actions: [{ id: "open-sign-in", label: "Back to sign in", variant: "primary" }],
    });
    renderAuth();
  } catch (error) {
    setAuthNotice(extractErrorMessage(error), { tone: "warning" });
    renderAuth();
  }
}

async function handlePasswordResetRequest() {
  if (!app.supabase) {
    return;
  }

  const formData = new FormData(refs.resetRequestForm);
  const loginIdentifier = compactString(formData.get("login"));
  if (!loginIdentifier) {
    setAuthNotice("Enter the username or email for the account you want to reset.", { tone: "warning" });
    renderAuth();
    return;
  }

  setAuthNotice("Sending a reset link...", { tone: "info" });
  renderAuth();

  try {
    const email = await resolveLoginEmail(loginIdentifier);
    const { error } = await app.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildPasswordResetRedirect(),
    });
    if (error) {
      throw error;
    }
    setAuthNotice("Reset link sent. Check the account email inbox, then open the link and set a new password.", {
      tone: "success",
      actions: [{ id: "open-sign-in", label: "Back to sign in", variant: "primary" }],
    });
    renderAuth();
  } catch (error) {
    setAuthNotice(extractErrorMessage(error), { tone: "warning" });
    renderAuth();
  }
}

async function handlePasswordUpdate() {
  if (!app.supabase) {
    return;
  }

  const formData = new FormData(refs.passwordUpdateForm);
  const password = compactString(formData.get("password"));
  const confirmPassword = compactString(formData.get("confirmPassword"));

  if (!password || password.length < 8) {
    setAuthNotice("Use a password with at least 8 characters.", { tone: "warning" });
    renderAuth();
    return;
  }

  if (password !== confirmPassword) {
    setAuthNotice("The passwords do not match.", { tone: "warning" });
    renderAuth();
    return;
  }

  setAuthNotice("Saving your new password...", { tone: "info" });
  renderAuth();

  const { error } = await app.supabase.auth.updateUser({ password });
  if (error) {
    setAuthNotice(extractErrorMessage(error), { tone: "warning" });
    renderAuth();
    return;
  }

  setAuthNotice("Password updated. Reloading your team workspace...", { tone: "success" });
  if (state.auth.session?.user) {
    await loadAuthedData(state.auth.session.user);
    return;
  }
  state.auth.status = "signed_out";
  state.auth.view = "sign-in";
  render();
}

async function handleSignOut() {
  if (!app.supabase) {
    return;
  }

  const { error } = await app.supabase.auth.signOut();
  if (error) {
    showAppNotice(extractErrorMessage(error), {
      tone: "warning",
      actions: [{ id: "sign-out", label: "Try again", variant: "danger" }],
    });
  }
}

async function resolveLoginEmail(identifier) {
  const normalized = compactString(identifier).toLowerCase();
  const { data, error } = await app.supabase.rpc("resolve_login_identifier", {
    p_identifier: normalized,
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("No account matches that username or email.");
  }

  return data;
}

function buildPasswordResetRedirect() {
  return window.location.origin + window.location.pathname;
}

function handleNoticeAction(action, target) {
  if (!action) {
    return;
  }

  if (action === "dismiss") {
    if (target === "app") {
      clearAppNotice();
      renderApp();
      return;
    }
    clearAuthNotice();
    renderAuth();
    return;
  }

  if (action === "open-sign-in") {
    setAuthView("sign-in");
    return;
  }

  if (action === "open-sign-up") {
    setAuthView("sign-up");
    return;
  }

  if (action === "open-reset") {
    setAuthView("reset");
    return;
  }

  if (action === "sign-out") {
    void handleSignOut();
  }
}

function render() {
  renderAuth();
  renderApp();
}

function renderAuth() {
  const shouldShowAuth =
    state.auth.status === "signed_out" ||
    state.auth.status === "password_recovery" ||
    state.auth.status === "setup" ||
    (state.auth.status === "loading" && !state.auth.profile);
  refs.authScreen.classList.toggle("hidden", !shouldShowAuth);
  refs.appShell.classList.toggle("hidden", shouldShowAuth && !isSignedIn());
  refs.setupHelp.classList.toggle("hidden", state.auth.status !== "setup");
  renderNotice({
    container: refs.authNotice,
    messageNode: refs.authMessage,
    actionsNode: refs.authNoticeActions,
    notice: {
      message: state.auth.message,
      tone: state.auth.messageTone,
      actions: state.auth.messageActions,
    },
    target: "auth",
  });

  const activeView = state.auth.status === "setup" ? "setup" : state.auth.view;
  [...refs.authTabs.querySelectorAll("button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.authView === activeView);
    button.disabled = state.auth.status === "loading" || state.auth.status === "setup";
  });

  refs.signInForm.classList.toggle("hidden", activeView !== "sign-in");
  refs.signUpForm.classList.toggle("hidden", activeView !== "sign-up");
  refs.resetRequestForm.classList.toggle("hidden", activeView !== "reset");
  refs.passwordUpdateForm.classList.toggle("hidden", activeView !== "update-password");
}

function renderApp() {
  if (!isSignedIn()) {
    return;
  }

  state.ui.selectedEventId = ensureSelectedEventId();
  refs.showCancelledToggle.checked = state.ui.showCancelled;
  refs.createEventBtn.classList.toggle("hidden", !isManager());
  refs.seedDemoBtn.classList.toggle("hidden", !isManager());
  refs.sessionBadge.textContent = `${state.auth.profile.displayName} | ${capitalize(state.auth.profile.role)}`;
  renderNotice({
    container: refs.appNotice,
    messageNode: refs.appNoticeMessage,
    actionsNode: refs.appNoticeActions,
    notice: state.notice,
    target: "app",
  });

  renderFilters();
  renderHeader();
  renderFeed();
  renderMiniTimeline();
  renderCalendar();
  renderAgendaPreview();
  renderRosterBoard();
  renderDrawer();
  syncActiveView();
}

function renderNotice({ container, messageNode, actionsNode, notice, target }) {
  const message = notice?.message || "";
  if (!message) {
    container.className = "notice-banner hidden";
    messageNode.textContent = "";
    actionsNode.innerHTML = "";
    return;
  }

  container.className = `notice-banner is-${notice.tone || "info"}`;
  messageNode.textContent = message;
  actionsNode.innerHTML = (notice.actions || [])
    .map((action) => {
      const variantClass = action.variant === "primary"
        ? "primary-btn"
        : action.variant === "danger"
          ? "danger-btn"
          : "ghost-btn";

      return `
        <button
          type="button"
          class="${variantClass}"
          data-notice-action="${escapeAttribute(action.id)}"
          data-notice-target="${escapeAttribute(target)}"
        >
          ${escapeHtml(action.label)}
        </button>
      `;
    })
    .join("");
}

function renderHeader() {
  const nextEvent = getNextUpcomingEvent();
  const selectedEvent = getSelectedEvent();
  const focusEvent = selectedEvent || nextEvent;
  const responseSummary = focusEvent ? getResponseSummary(focusEvent) : null;
  const currentAvailability = focusEvent ? getCurrentUserAttendance(focusEvent) : null;

  refs.heroTitle.textContent = `${escapeText(state.team.name)} Calendar`;
  refs.heroSubtitle.textContent = isManager()
    ? "Manager access: create events, view full team availability, and keep the schedule moving."
    : "Player access: review upcoming events and submit only your own availability.";
  refs.syncNotice.textContent = isManager()
    ? `Signed in as manager @${state.auth.profile.username}. Password resets are handled by email links.`
    : `Signed in as player @${state.auth.profile.username}. You can update only your own availability.`;
  refs.nextEventLabel.textContent = nextEvent
    ? `${formatShortDate(nextEvent.start)} at ${formatTime(nextEvent.start)}`
    : "No upcoming event";

  if (isManager()) {
    refs.availabilityLabel.textContent = responseSummary
      ? `${responseSummary.available}/${focusEvent.requiredPlayers} ready`
      : "-";
    refs.pendingLabel.textContent = responseSummary ? `${responseSummary.pending} waiting` : "-";
    return;
  }

  refs.availabilityLabel.textContent = currentAvailability
    ? RESPONSE_META[currentAvailability.response]
    : "No reply";
  refs.pendingLabel.textContent = capitalize(state.auth.profile.role);
}

function renderFilters() {
  const counts = countByType(state.events);
  refs.typeFilters.innerHTML = Object.entries(TYPE_META)
    .map(([type, meta]) => {
      const active = state.ui.filterTypes.includes(type);
      return `
        <button class="filter-chip ${active ? "active" : ""}" data-filter-type="${type}">
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${counts[type] || 0} events</span>
        </button>
      `;
    })
    .join("");
}

function renderFeed() {
  refs.feedList.innerHTML = state.feed.length
    ? state.feed
        .slice(0, 6)
        .map((item) => {
          return `
            <article class="feed-item">
              <p>${escapeHtml(item.text)}</p>
              <time>${formatRelativeTime(item.createdAt)}</time>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-note"><p class="helper-line">Recent updates will appear here as people reply and managers adjust events.</p></div>`;
}

function renderMiniTimeline() {
  const now = new Date();
  const nextTenDays = Array.from({ length: 10 }, (_, index) => addDays(startOfDay(now), index));
  refs.miniTimeline.innerHTML = nextTenDays
    .map((date) => {
      const dayEvents = getVisibleEvents().filter((eventRecord) => {
        return eventRecord.start && isSameDay(new Date(eventRecord.start), date);
      });
      const label = `${DAY_NAMES[date.getDay()]} ${date.getDate()}`;
      if (!dayEvents.length) {
        return `
          <div class="timeline-item">
            <strong>${label}</strong>
            <span>No scheduled items</span>
          </div>
        `;
      }
      const title = dayEvents.length === 1 ? dayEvents[0].title : `${dayEvents.length} planned events`;
      return `
        <button class="timeline-item" data-select-event="${dayEvents[0].id}">
          <strong>${label}</strong>
          <span>${escapeHtml(title)}</span>
        </button>
      `;
    })
    .join("");
}

function renderCalendar() {
  refs.rangeLabel.textContent = getRangeLabel();
  if (state.ui.view === "month") {
    refs.calendarSurface.innerHTML = renderMonthView();
    return;
  }
  if (state.ui.view === "week") {
    refs.calendarSurface.innerHTML = renderWeekView();
    return;
  }
  refs.calendarSurface.innerHTML = renderAgendaView();
}

function renderMonthView() {
  const anchor = parseDateKey(state.ui.anchorDate);
  const firstVisibleDay = startOfWeek(startOfMonth(anchor));
  const cells = Array.from({ length: 42 }, (_, index) => addDays(firstVisibleDay, index))
    .map((date) => renderMonthCell(date, anchor))
    .join("");

  return `
    <div class="calendar-header">
      ${DAY_NAMES.map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="month-grid">
      ${cells}
    </div>
  `;
}

function renderMonthCell(date, anchor) {
  const events = getVisibleEvents().filter((eventRecord) => {
    return eventRecord.start && isSameDay(new Date(eventRecord.start), date);
  });
  const outside = date.getMonth() !== anchor.getMonth();
  const today = isSameDay(date, new Date());
  return `
    <section class="day-cell ${outside ? "outside" : ""} ${today ? "today" : ""}">
      <div class="day-meta">
        <span class="muted">${DAY_NAMES[date.getDay()]}</span>
        <strong class="day-number">${date.getDate()}</strong>
      </div>
      <div class="day-events">
        ${
          events.length
            ? events.map((item) => renderEventPill(item)).join("")
            : `<span class="empty-copy">No events</span>`
        }
      </div>
    </section>
  `;
}

function renderWeekView() {
  const anchor = parseDateKey(state.ui.anchorDate);
  const weekStart = startOfWeek(anchor);
  return `
    <div class="calendar-week">
      ${Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
        .map((date) => renderWeekDay(date))
        .join("")}
    </div>
  `;
}

function renderWeekDay(date) {
  const dayEvents = getVisibleEvents().filter((eventRecord) => {
    return eventRecord.start && isSameDay(new Date(eventRecord.start), date);
  });
  return `
    <section class="week-day ${isSameDay(date, new Date()) ? "today" : ""}">
      <div class="week-head">
        <strong>${DAY_NAMES[date.getDay()]} ${date.getDate()}</strong>
        <span>${formatMonthDay(date)}</span>
      </div>
      <div class="week-events">
        ${
          dayEvents.length
            ? dayEvents.map((eventRecord) => renderWeekEventCard(eventRecord)).join("")
            : `<div class="empty-note"><span>No events on deck.</span></div>`
        }
      </div>
    </section>
  `;
}

function renderAgendaView() {
  const anchor = parseDateKey(state.ui.anchorDate);
  const days = Array.from({ length: 14 }, (_, index) => addDays(startOfDay(anchor), index));
  const postponed = getVisibleEvents().filter((eventRecord) => {
    return !eventRecord.start && eventRecord.status === "postponed";
  });

  return `
    <div class="agenda-view">
      ${days
        .map((date) => {
          const events = getVisibleEvents().filter((eventRecord) => {
            return eventRecord.start && isSameDay(new Date(eventRecord.start), date);
          });
          return `
            <section class="agenda-day ${isSameDay(date, new Date()) ? "today" : ""}">
              <div class="agenda-head">
                <strong>${DAY_NAMES[date.getDay()]} ${date.getDate()}</strong>
                <span>${formatMonthDay(date)}</span>
              </div>
              <div class="agenda-events">
                ${
                  events.length
                    ? events.map((eventRecord) => renderAgendaEventCard(eventRecord)).join("")
                    : `<span class="empty-copy">Nothing scheduled.</span>`
                }
              </div>
            </section>
          `;
        })
        .join("")}
      ${
        postponed.length
          ? `
        <section class="postponed-section">
          <div class="agenda-head">
            <strong>Needs a new date</strong>
            <span>Postponed</span>
          </div>
          <div class="postponed-list">
            ${postponed.map((eventRecord) => renderAgendaEventCard(eventRecord)).join("")}
          </div>
        </section>
      `
          : ""
      }
    </div>
  `;
}

function renderAgendaPreview() {
  const list = getUpcomingEvents({ limit: 5, includePostponed: true });
  refs.agendaPreview.innerHTML = list.length
    ? list
        .map((eventRecord) => {
          return `
            <button class="preview-item" data-select-event="${eventRecord.id}">
              <strong>${escapeHtml(eventRecord.title)}</strong>
              <span>${escapeHtml(formatEventWindow(eventRecord))}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-note"><span>No future events yet.</span></div>`;
}

function renderRosterBoard() {
  const focusEvent = getSelectedEvent() || getNextUpcomingEvent();
  if (!focusEvent) {
    refs.rosterBoard.innerHTML = `<div class="empty-note"><span>Availability will appear once a manager creates an event.</span></div>`;
    return;
  }

  if (!isManager()) {
    const currentAttendance = getCurrentUserAttendance(focusEvent);
    refs.rosterBoard.innerHTML = `
      <div class="member-card">
        <strong>${escapeHtml(focusEvent.title)}</strong>
        <span>${escapeHtml(formatEventWindow(focusEvent))}</span>
      </div>
      <div class="member-card">
        <strong>Your reply</strong>
        <span>${escapeHtml(RESPONSE_META[currentAttendance.response])}</span>
      </div>
      <div class="member-card">
        <strong>Username</strong>
        <span>@${escapeHtml(state.auth.profile.username)}</span>
      </div>
    `;
    return;
  }

  const responseSummary = getResponseSummary(focusEvent);
  const focusLabel = focusEvent.start ? formatEventWindow(focusEvent) : "Waiting for a new date";
  refs.rosterBoard.innerHTML = `
    <div class="member-card">
      <strong>${escapeHtml(focusEvent.title)}</strong>
      <span>${escapeHtml(focusLabel)}</span>
    </div>
    <div class="member-card">
      <strong>${responseSummary.available} available</strong>
      <span>${responseSummary.pending} waiting, ${responseSummary.maybe} maybe, ${responseSummary.unavailable} unavailable</span>
    </div>
    ${state.members
      .map((member) => {
        const attendance = focusEvent.attendance[member.id] || {
          response: "pending",
          checkIn: "pending",
        };
        return `
          <button class="member-card" data-select-event="${focusEvent.id}">
            <strong>${escapeHtml(member.name)}</strong>
            <span>${escapeHtml(RESPONSE_META[attendance.response])} | ${escapeHtml(CHECKIN_META[attendance.checkIn])}</span>
          </button>
        `;
      })
      .join("")}
  `;
}

function renderDrawer() {
  const eventRecord = getSelectedEvent() || getNextUpcomingEvent();
  if (!eventRecord) {
    refs.eventDrawer.classList.add("empty");
    refs.eventDrawer.innerHTML = `
      <div class="empty-state">
        <p class="eyebrow">Event details</p>
        <h2>Pick an event</h2>
        <p class="muted">Create or select an event to track availability and manage the team schedule.</p>
      </div>
    `;
    return;
  }

  refs.eventDrawer.classList.remove("empty");
  const summary = getResponseSummary(eventRecord);
  const rescheduleStartValue = eventRecord.start ? toInputValue(eventRecord.start) : "";
  const rescheduleEndValue = eventRecord.end ? toInputValue(eventRecord.end) : "";

  refs.eventDrawer.innerHTML = `
    <div class="drawer-head">
      <p class="eyebrow">${escapeHtml(TYPE_META[eventRecord.type].label)}</p>
      <h2>${escapeHtml(eventRecord.title)}</h2>
      <div class="badge-row">
        <span class="badge status-${escapeHtml(eventRecord.status)}">${escapeHtml(capitalize(eventRecord.status))}</span>
        ${
          eventRecord.recurringGroupId
            ? `<span class="badge">Weekly recurring slot</span>`
            : ""
        }
        ${
          eventRecord.opponent
            ? `<span class="badge">vs ${escapeHtml(eventRecord.opponent)}</span>`
            : ""
        }
      </div>
      <p class="helper-line">${escapeHtml(formatEventWindow(eventRecord))}</p>
    </div>

    ${
      isManager()
        ? `
      <div class="drawer-actions">
        <button class="primary-btn" data-edit-event="${eventRecord.id}">Edit event</button>
        <button class="ghost-btn" data-action="copy-reminder" data-event-id="${eventRecord.id}">Copy reminder</button>
        ${
          eventRecord.status === "cancelled"
            ? `<button class="ghost-btn" data-action="restore-event" data-event-id="${eventRecord.id}">Restore event</button>`
            : `<button class="ghost-btn" data-action="cancel-event" data-event-id="${eventRecord.id}">Cancel</button>`
        }
        ${
          eventRecord.status === "postponed"
            ? ""
            : `<button class="ghost-btn" data-action="postpone-event" data-event-id="${eventRecord.id}">Postpone</button>`
        }
      </div>
    `
        : ""
    }

    <div class="drawer-block">
      <h3>Event snapshot</h3>
      <div class="summary-metrics">
        ${
          isManager()
            ? `
          <span class="summary-chip">${summary.available} available</span>
          <span class="summary-chip">${summary.pending} pending replies</span>
          <span class="summary-chip">${summary.maybe} maybe</span>
          <span class="summary-chip">${summary.unavailable} unavailable</span>
        `
            : `<span class="summary-chip">Your reply: ${escapeHtml(RESPONSE_META[getCurrentUserAttendance(eventRecord).response])}</span>`
        }
      </div>
      ${
        eventRecord.location || eventRecord.address || eventRecord.meetTime
          ? `
        <div class="pill-row">
          ${
            eventRecord.location
              ? `<span class="type-chip">${escapeHtml(eventRecord.location)}</span>`
              : ""
          }
          ${
            eventRecord.meetTime
              ? `<span class="type-chip">Meet ${escapeHtml(formatTime(eventRecord.meetTime))}</span>`
              : ""
          }
          ${
            eventRecord.address
              ? `<a class="type-chip" target="_blank" rel="noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(eventRecord.address)}">Open map</a>`
              : ""
          }
        </div>
      `
          : ""
      }
      ${
        eventRecord.notes
          ? `<p class="helper-line">${escapeHtml(eventRecord.notes)}</p>`
          : ""
      }
    </div>

    ${
      isManager()
        ? `
      <div class="drawer-block">
        <h3>Reschedule quickly</h3>
        <form class="reschedule-form" onsubmit="return false;">
          <div class="reschedule-grid">
            <label>
              <span>New start</span>
              <input id="rescheduleStart" type="datetime-local" value="${escapeAttribute(rescheduleStartValue)}" />
            </label>
            <label>
              <span>New end</span>
              <input id="rescheduleEnd" type="datetime-local" value="${escapeAttribute(rescheduleEndValue)}" />
            </label>
          </div>
          <div class="drawer-actions">
            <button class="ghost-btn" data-action="save-reschedule" data-event-id="${eventRecord.id}">Save new schedule</button>
          </div>
        </form>
      </div>
    `
        : ""
    }

    <div class="drawer-block">
      <h3>${isManager() ? "Availability tracking" : "Submit your availability"}</h3>
      <div class="attendance-summary">
        <span class="type-chip">Required players: ${eventRecord.requiredPlayers}</span>
        ${
          isManager()
            ? summary.available >= eventRecord.requiredPlayers
              ? `<span class="type-chip">Squad ready</span>`
              : `<span class="type-chip">${eventRecord.requiredPlayers - summary.available} more needed</span>`
            : `<span class="type-chip">Only your response is editable</span>`
        }
      </div>
      ${getVisibleMembersForDrawer().map((member) => renderMemberRow(eventRecord, member)).join("")}
    </div>
  `;
}

function getVisibleMembersForDrawer() {
  if (isManager()) {
    return state.members;
  }
  return state.members.filter((member) => member.id === state.auth.profile.id);
}

function renderMemberRow(eventRecord, member) {
  const attendance = eventRecord.attendance[member.id] || {
    response: "pending",
    checkIn: "pending",
  };
  return `
    <div class="member-row">
      <div class="member-top">
        <div class="member-ident">
          <div class="avatar" style="background:${escapeAttribute(member.color)}">${escapeHtml(initials(member.name))}</div>
          <div class="member-meta">
            <strong>${escapeHtml(member.name)}</strong>
            <span>${escapeHtml(member.role)}</span>
          </div>
        </div>
        <span class="helper">${escapeHtml(CHECKIN_META[attendance.checkIn])}</span>
      </div>
      <div class="member-actions">
        <div class="segmented">
          ${Object.entries(RESPONSE_META)
            .map(([responseKey, label]) => {
              return `
                <button
                  class="${attendance.response === responseKey ? "active" : ""}"
                  data-action="set-response"
                  data-event-id="${eventRecord.id}"
                  data-member-id="${member.id}"
                  data-response="${responseKey}"
                >
                  ${escapeHtml(label)}
                </button>
              `;
            })
            .join("")}
        </div>
        ${
          isManager()
            ? `
          <select class="status-select" data-checkin-event="${eventRecord.id}" data-member-id="${member.id}">
            ${Object.entries(CHECKIN_META)
              .map(([value, label]) => {
                const selected = attendance.checkIn === value ? "selected" : "";
                return `<option value="${value}" ${selected}>${escapeHtml(label)}</option>`;
              })
              .join("")}
          </select>
        `
            : ""
        }
      </div>
    </div>
  `;
}

function renderEventPill(eventRecord) {
  return `
    <button
      class="event-pill ${eventRecord.status === "cancelled" ? "cancelled" : ""}"
      data-type="${eventRecord.type}"
      data-select-event="${eventRecord.id}"
    >
      <span class="event-time">${escapeHtml(getEventPillTime(eventRecord))}</span>
      <span class="event-title">${escapeHtml(eventRecord.title)}</span>
    </button>
  `;
}

function renderWeekEventCard(eventRecord) {
  return `
    <button
      class="week-event-card ${eventRecord.status === "cancelled" ? "cancelled" : ""}"
      data-type="${eventRecord.type}"
      data-select-event="${eventRecord.id}"
    >
      <span class="event-time">${escapeHtml(formatEventWindow(eventRecord))}</span>
      <span class="event-title">${escapeHtml(eventRecord.title)}</span>
      ${
        eventRecord.location
          ? `<span class="helper">${escapeHtml(eventRecord.location)}</span>`
          : ""
      }
    </button>
  `;
}

function renderAgendaEventCard(eventRecord) {
  return `
    <button
      class="agenda-event-card ${eventRecord.status === "cancelled" ? "cancelled" : ""}"
      data-type="${eventRecord.type}"
      data-select-event="${eventRecord.id}"
    >
      <span class="event-time">${escapeHtml(formatEventWindow(eventRecord))}</span>
      <span class="event-title">${escapeHtml(eventRecord.title)}</span>
      ${
        eventRecord.opponent
          ? `<span class="helper">${escapeHtml(`vs ${eventRecord.opponent}`)}</span>`
          : ""
      }
    </button>
  `;
}

function getRangeLabel() {
  const anchor = parseDateKey(state.ui.anchorDate);
  if (state.ui.view === "month") {
    return anchor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  if (state.ui.view === "week") {
    const weekStart = startOfWeek(anchor);
    const weekEnd = addDays(weekStart, 6);
    return `${formatMonthDay(weekStart)} - ${formatMonthDay(weekEnd)}`;
  }
  const agendaEnd = addDays(anchor, 13);
  return `${formatMonthDay(anchor)} - ${formatMonthDay(agendaEnd)}`;
}

function getVisibleEvents() {
  return state.events
    .filter((eventRecord) => state.ui.filterTypes.includes(eventRecord.type))
    .filter((eventRecord) => state.ui.showCancelled || eventRecord.status !== "cancelled")
    .sort(sortEvents);
}

function getUpcomingEvents({ limit = 8, includePostponed = false } = {}) {
  const now = new Date();
  const events = getVisibleEvents().filter((eventRecord) => {
    if (!eventRecord.start) {
      return includePostponed && eventRecord.status === "postponed";
    }
    return new Date(eventRecord.end || eventRecord.start) >= now;
  });
  return events.slice(0, limit);
}

function getNextUpcomingEvent() {
  return getUpcomingEvents({ limit: 1, includePostponed: false })[0] || null;
}

function getSelectedEvent() {
  return getEventById(state.ui.selectedEventId) || null;
}

function getEventById(eventId) {
  return state.events.find((eventRecord) => eventRecord.id === eventId) || null;
}

function ensureSelectedEventId() {
  const visibleEvents = getVisibleEvents();
  const visibleIds = new Set(visibleEvents.map((eventRecord) => eventRecord.id));
  if (state.ui.selectedEventId && visibleIds.has(state.ui.selectedEventId)) {
    return state.ui.selectedEventId;
  }
  const nextEvent = getNextUpcomingEvent();
  return nextEvent ? nextEvent.id : visibleEvents[0]?.id || state.events[0]?.id || "";
}

function getResponseSummary(eventRecord) {
  return Object.values(eventRecord.attendance || {}).reduce(
    (summary, attendance) => {
      summary[attendance.response] += 1;
      return summary;
    },
    {
      pending: 0,
      available: 0,
      maybe: 0,
      unavailable: 0,
    },
  );
}

function getCurrentUserAttendance(eventRecord) {
  return (
    eventRecord.attendance[state.auth.profile.id] || {
      response: "pending",
      checkIn: "pending",
    }
  );
}

function toggleFilter(type) {
  const nextFilters = state.ui.filterTypes.includes(type)
    ? state.ui.filterTypes.filter((item) => item !== type)
    : [...state.ui.filterTypes, type];

  state.ui.filterTypes = nextFilters.length ? nextFilters : Object.keys(TYPE_META);
  state.ui.selectedEventId = ensureSelectedEventId();
  renderApp();
  persistUi();
}

function shiftRange(direction) {
  const anchor = parseDateKey(state.ui.anchorDate);
  const multiplier = direction === "next" ? 1 : -1;
  if (state.ui.view === "month") {
    anchor.setMonth(anchor.getMonth() + multiplier);
  } else if (state.ui.view === "week") {
    anchor.setDate(anchor.getDate() + 7 * multiplier);
  } else {
    anchor.setDate(anchor.getDate() + 14 * multiplier);
  }
  state.ui.anchorDate = toDateKey(anchor);
  renderApp();
  persistUi();
}

function openModal(eventId = "") {
  if (!isManager()) {
    return;
  }

  const eventRecord = eventId ? getEventById(eventId) : null;
  refs.modalTitle.textContent = eventRecord ? "Edit event" : "Create event";

  refs.eventForm.reset();
  refs.eventForm.eventId.value = eventRecord?.id || "";
  refs.eventForm.type.value = eventRecord?.type || "practice";
  refs.eventForm.title.value = eventRecord?.title || "";
  refs.eventForm.start.value = eventRecord?.start ? toInputValue(eventRecord.start) : "";
  refs.eventForm.end.value = eventRecord?.end ? toInputValue(eventRecord.end) : "";
  refs.eventForm.meetTime.value = eventRecord?.meetTime ? toInputValue(eventRecord.meetTime) : "";
  refs.eventForm.opponent.value = eventRecord?.opponent || "";
  refs.eventForm.location.value = eventRecord?.location || "";
  refs.eventForm.address.value = eventRecord?.address || "";
  refs.eventForm.requiredPlayers.value = eventRecord?.requiredPlayers || 8;
  refs.eventForm.notes.value = eventRecord?.notes || "";
  refs.eventForm.repeatWeekly.checked = false;
  refs.eventForm.repeatCount.value = 6;

  refs.eventModal.classList.remove("hidden");
  refs.eventModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  refs.eventModal.classList.add("hidden");
  refs.eventModal.setAttribute("aria-hidden", "true");
}

async function handleEventFormSubmit() {
  if (!isManager()) {
    return;
  }

  const formData = new FormData(refs.eventForm);
  const eventId = formData.get("eventId");
  const start = formData.get("start");
  const end = formData.get("end");

  if (!start || !end || new Date(end) <= new Date(start)) {
    showAppNotice("Please choose an end time after the start time.", { tone: "warning" });
    return;
  }

  const baseEvent = {
    team_id: state.auth.profile.teamId,
    type: formData.get("type"),
    title: compactString(formData.get("title")),
    start_at: toIsoString(start),
    end_at: toIsoString(end),
    meet_time: formData.get("meetTime") ? toIsoString(formData.get("meetTime")) : null,
    opponent: compactString(formData.get("opponent")) || null,
    location: compactString(formData.get("location")) || null,
    address: compactString(formData.get("address")) || null,
    required_players: clampNumber(formData.get("requiredPlayers"), 1, 60, 8),
    notes: compactString(formData.get("notes")) || null,
    created_by: state.auth.profile.id,
  };

  try {
    if (eventId) {
      const { error } = await app.supabase
        .from(EVENT_TABLE)
        .update(baseEvent)
        .eq("id", eventId);
      if (error) {
        throw error;
      }
    } else {
      const repeatWeekly = formData.get("repeatWeekly") === "on";
      const repeatCount = repeatWeekly ? clampNumber(formData.get("repeatCount"), 1, 20, 6) : 1;
      const recurringGroupId = repeatCount > 1 ? makeId("group") : null;
      const rows = Array.from({ length: repeatCount }, (_, index) => {
        const eventDateShift = index * 7;
        return {
          ...baseEvent,
          recurring_group_id: recurringGroupId,
          start_at: shiftIsoByDays(baseEvent.start_at, eventDateShift),
          end_at: shiftIsoByDays(baseEvent.end_at, eventDateShift),
          meet_time: baseEvent.meet_time ? shiftIsoByDays(baseEvent.meet_time, eventDateShift) : null,
          status: "scheduled",
        };
      });
      const { error } = await app.supabase.from(EVENT_TABLE).insert(rows);
      if (error) {
        throw error;
      }
    }

    closeModal();
    await refreshData();
    showAppNotice(eventId ? "Event updated successfully." : "Event saved successfully.", { tone: "success" });
  } catch (error) {
    showAppNotice(extractErrorMessage(error), { tone: "warning" });
  }
}

async function handleDrawerClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const { action, eventId, memberId, response } = button.dataset;
  if (!action || !eventId) {
    return;
  }

  if (action === "copy-reminder") {
    await copyReminder(eventId);
    return;
  }
  if (action === "cancel-event") {
    await updateEventStatus(eventId, { status: "cancelled" });
    return;
  }
  if (action === "restore-event") {
    await updateEventStatus(eventId, { status: "scheduled" });
    return;
  }
  if (action === "postpone-event") {
    await updateEventStatus(eventId, {
      status: "postponed",
      start_at: null,
      end_at: null,
      meet_time: null,
    });
    return;
  }
  if (action === "save-reschedule") {
    await saveReschedule(eventId);
    return;
  }
  if (action === "set-response" && memberId && response) {
    await updateAvailability(eventId, memberId, { response });
  }
}

async function handleDrawerChange(event) {
  const target = event.target;
  if (target.matches("[data-checkin-event]")) {
    await updateAvailability(target.dataset.checkinEvent, target.dataset.memberId, {
      check_in: target.value,
    });
  }
}

async function copyReminder(eventId) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }

  const reminder = `${eventRecord.title} - ${formatEventWindow(eventRecord)}${eventRecord.location ? ` - ${eventRecord.location}` : ""}`;
  try {
    await navigator.clipboard.writeText(reminder);
    showAppNotice("Reminder copied to your clipboard.", { tone: "success" });
  } catch (error) {
    showAppNotice(reminder, { tone: "info" });
  }
}

async function updateEventStatus(eventId, patch) {
  if (!isManager()) {
    return;
  }

  const { error } = await app.supabase
    .from(EVENT_TABLE)
    .update(patch)
    .eq("id", eventId);

  if (error) {
    showAppNotice(extractErrorMessage(error), { tone: "warning" });
    return;
  }

  await refreshData();
  showAppNotice("Event status updated.", { tone: "success" });
}

async function saveReschedule(eventId) {
  if (!isManager()) {
    return;
  }

  const startInput = document.querySelector("#rescheduleStart");
  const endInput = document.querySelector("#rescheduleEnd");
  const startValue = startInput?.value || "";
  const endValue = endInput?.value || "";

  if (!startValue || !endValue || new Date(endValue) <= new Date(startValue)) {
    showAppNotice("Please choose a valid new start and end time.", { tone: "warning" });
    return;
  }

  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }

  let meetTime = null;
  if (eventRecord.meetTime && eventRecord.start) {
    const diff = new Date(eventRecord.start).getTime() - new Date(eventRecord.meetTime).getTime();
    meetTime = new Date(new Date(startValue).getTime() - Math.abs(diff)).toISOString();
  }

  const { error } = await app.supabase
    .from(EVENT_TABLE)
    .update({
      start_at: toIsoString(startValue),
      end_at: toIsoString(endValue),
      meet_time: meetTime,
      status: "scheduled",
    })
    .eq("id", eventId);

  if (error) {
    showAppNotice(extractErrorMessage(error), { tone: "warning" });
    return;
  }

  await refreshData();
  showAppNotice("Event rescheduled.", { tone: "success" });
}

async function updateAvailability(eventId, memberId, patch) {
  const payload = {
    event_id: eventId,
    user_id: memberId,
    ...patch,
  };

  const { error } = await app.supabase
    .from(AVAILABILITY_TABLE)
    .upsert(payload, { onConflict: "event_id,user_id" });

  if (error) {
    showAppNotice(extractErrorMessage(error), { tone: "warning" });
    return;
  }

  await refreshData();
  showAppNotice("Availability updated.", { tone: "success" });
}

async function handleSeedDemo() {
  if (!isManager()) {
    return;
  }

  if (!window.confirm("Seed a demo schedule for this team? This adds sample events for testing manager and player logins.")) {
    return;
  }

  const rows = buildDemoEventRows(state.auth.profile.teamId, state.auth.profile.id);
  const { error } = await app.supabase.from(EVENT_TABLE).insert(rows);
  if (error) {
    showAppNotice(extractErrorMessage(error), { tone: "warning" });
    return;
  }

  await refreshData();
  showAppNotice("Demo schedule added for the team.", { tone: "success" });
}

function buildDemoEventRows(teamId, createdBy) {
  const now = new Date();
  const tuesday = nextWeekdayDate(now, 2, 18, 30);
  const thursday = nextWeekdayDate(now, 4, 18, 30);
  const saturday = nextWeekdayDate(now, 6, 15, 0);
  const monday = nextWeekdayDate(now, 1, 19, 15);
  const friday = nextWeekdayDate(now, 5, 20, 0);

  return [
    demoEventRow({
      teamId,
      createdBy,
      type: "practice",
      title: "High Tempo Practice",
      startDate: tuesday,
      durationHours: 1.5,
      meetOffsetMinutes: 30,
      location: "Northside Arena",
      address: "14 Station Road, Manchester",
      requiredPlayers: 8,
      notes: "Pressing drill, defensive shape, and finishing block.",
      recurringGroupId: makeId("group"),
    }),
    demoEventRow({
      teamId,
      createdBy,
      type: "practice",
      title: "Shape and Recovery Session",
      startDate: thursday,
      durationHours: 1.25,
      meetOffsetMinutes: 20,
      location: "Riverside Training Ground",
      address: "8 Canal Street, Manchester",
      requiredPlayers: 8,
      notes: "Smaller workload before the weekend fixture.",
      recurringGroupId: makeId("group"),
    }),
    demoEventRow({
      teamId,
      createdBy,
      type: "game",
      title: "League Matchday 6",
      startDate: saturday,
      durationHours: 2,
      meetOffsetMinutes: 60,
      location: "Harbor Park Stadium",
      address: "221 Waterside Way, Manchester",
      opponent: "Harbor United",
      requiredPlayers: 11,
      notes: "Bring away kit and travel by 1:45 PM.",
    }),
    demoEventRow({
      teamId,
      createdBy,
      type: "social",
      title: "Team Dinner",
      startDate: friday,
      durationHours: 2.5,
      meetOffsetMinutes: 0,
      location: "The Lantern Hall",
      address: "5 Market Lane, Manchester",
      requiredPlayers: 6,
      notes: "Families are welcome. RSVP helps reserve seats.",
    }),
    demoEventRow({
      teamId,
      createdBy,
      type: "practice",
      title: "Recovery and Analysis",
      startDate: monday,
      durationHours: 1,
      meetOffsetMinutes: 15,
      location: "Clubhouse Studio",
      address: "3 Newton Terrace, Manchester",
      requiredPlayers: 6,
      notes: "Mobility and match review.",
    }),
  ];
}

function demoEventRow({
  teamId,
  createdBy,
  type,
  title,
  startDate,
  durationHours,
  meetOffsetMinutes,
  location,
  address,
  opponent = null,
  requiredPlayers,
  notes,
  recurringGroupId = null,
}) {
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const meetTime = meetOffsetMinutes ? new Date(start.getTime() - meetOffsetMinutes * 60 * 1000) : null;

  return {
    team_id: teamId,
    created_by: createdBy,
    type,
    title,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    meet_time: meetTime ? meetTime.toISOString() : null,
    location,
    address,
    opponent,
    required_players: requiredPlayers,
    notes,
    status: "scheduled",
    recurring_group_id: recurringGroupId,
  };
}

function buildEventRecords(eventRows, availabilityRows, memberRows) {
  const availabilityByEvent = availabilityRows.reduce((accumulator, row) => {
    const existing = accumulator.get(row.event_id) || [];
    existing.push(row);
    accumulator.set(row.event_id, existing);
    return accumulator;
  }, new Map());

  return eventRows.map((row) => {
    const attendance = {};
    const rowAvailability = availabilityByEvent.get(row.id) || [];

    rowAvailability.forEach((entry) => {
      attendance[entry.user_id] = {
        response: entry.response,
        checkIn: entry.check_in,
        updatedAt: entry.updated_at,
      };
    });

    memberRows.forEach((member) => {
      if (!attendance[member.id]) {
        attendance[member.id] = {
          response: "pending",
          checkIn: "pending",
          updatedAt: row.updated_at,
        };
      }
    });

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      start: row.start_at,
      end: row.end_at,
      meetTime: row.meet_time,
      opponent: row.opponent || "",
      location: row.location || "",
      address: row.address || "",
      requiredPlayers: row.required_players,
      notes: row.notes || "",
      status: row.status,
      recurringGroupId: row.recurring_group_id || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attendance,
    };
  });
}

function buildFeed(eventRecords, availabilityRows, members) {
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const eventMap = new Map(eventRecords.map((eventRecord) => [eventRecord.id, eventRecord]));
  const items = [];

  eventRecords.forEach((eventRecord) => {
    items.push({
      createdAt: eventRecord.updatedAt,
      text: `${eventRecord.title} is ${eventRecord.status}.`,
    });
  });

  availabilityRows.forEach((row) => {
    const eventRecord = eventMap.get(row.event_id);
    const member = memberMap.get(row.user_id);
    if (!eventRecord || !member) {
      return;
    }
    if (row.response === "pending" && row.check_in === "pending") {
      return;
    }
    items.push({
      createdAt: row.updated_at,
      text: `${member.name} marked ${RESPONSE_META[row.response].toLowerCase()} for ${eventRecord.title}.`,
    });
  });

  return items.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, 16);
}

function mapProfileToMember(profile) {
  return {
    id: profile.id,
    name: profile.display_name,
    role: capitalize(profile.role),
    username: profile.username,
    email: profile.email,
    color: colorForString(profile.display_name),
  };
}

function normalizeConfig(rawConfig) {
  const config = {
    ...DEFAULT_CONFIG,
    ...(rawConfig || {}),
  };

  config.teamId = config.teamId || config.supabaseBoardId || DEFAULT_CONFIG.teamId;
  config.teamName = config.teamName || DEFAULT_CONFIG.teamName;
  return config;
}

function defaultNoticeState() {
  return {
    message: "",
    tone: "info",
    actions: [],
  };
}

function ensureNoticeActions(actions = []) {
  const normalized = actions.filter(Boolean);
  if (normalized.some((action) => action.id === "dismiss")) {
    return normalized;
  }
  return [...normalized, { id: "dismiss", label: "Dismiss", variant: "ghost" }];
}

function setAuthNotice(message, { tone = "info", actions = [] } = {}) {
  state.auth.message = message;
  state.auth.messageTone = tone;
  state.auth.messageActions = message
    ? actions.length || tone !== "info"
      ? ensureNoticeActions(actions)
      : []
    : [];
}

function clearAuthNotice() {
  state.auth.message = "";
  state.auth.messageTone = "info";
  state.auth.messageActions = [];
}

function showAppNotice(message, { tone = "warning", actions = [] } = {}) {
  state.notice = {
    message,
    tone,
    actions: message
      ? actions.length || tone !== "info"
        ? ensureNoticeActions(actions)
        : []
      : [],
  };
  if (isSignedIn()) {
    renderApp();
  }
}

function clearAppNotice() {
  state.notice = defaultNoticeState();
}

function hasSupabaseConfig() {
  return Boolean(appConfig.supabaseUrl && appConfig.supabaseKey && window.supabase?.createClient);
}

function clearAuthedState() {
  state.auth.status = "signed_out";
  state.auth.view = "sign-in";
  clearAuthNotice();
  clearAppNotice();
  state.auth.profile = null;
  state.auth.session = null;
  state.members = [];
  state.events = [];
  state.feed = [];
}

function setAuthView(nextView) {
  if (state.auth.status === "setup" || state.auth.status === "loading") {
    return;
  }
  state.auth.view = nextView;
  clearAuthNotice();
  renderAuth();
}

function isSignedIn() {
  return state.auth.status === "signed_in" && Boolean(state.auth.profile);
}

function isManager() {
  return isSignedIn() && state.auth.profile.role === "manager";
}

function loadUiState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultUiState();
    }
    const parsed = JSON.parse(raw);
    return {
      ...defaultUiState(),
      ...parsed,
      filterTypes:
        Array.isArray(parsed.filterTypes) && parsed.filterTypes.length
          ? parsed.filterTypes.filter((type) => TYPE_META[type])
          : Object.keys(TYPE_META),
    };
  } catch (error) {
    return defaultUiState();
  }
}

function defaultUiState() {
  return {
    view: "month",
    anchorDate: toDateKey(new Date()),
    filterTypes: Object.keys(TYPE_META),
    selectedEventId: "",
    showCancelled: false,
  };
}

function persistUi() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ui));
}

function syncActiveView() {
  [...refs.viewSwitch.querySelectorAll("button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.ui.view);
  });
}

function sortEvents(left, right) {
  if (!left.start && !right.start) {
    return left.title.localeCompare(right.title);
  }
  if (!left.start) {
    return 1;
  }
  if (!right.start) {
    return -1;
  }
  return new Date(left.start) - new Date(right.start);
}

function countByType(events) {
  return events.reduce((accumulator, eventRecord) => {
    accumulator[eventRecord.type] = (accumulator[eventRecord.type] || 0) + 1;
    return accumulator;
  }, {});
}

function getEventPillTime(eventRecord) {
  if (!eventRecord.start) {
    return "TBD";
  }
  return `${formatTime(eventRecord.start)} - ${formatTime(eventRecord.end)}`;
}

function formatEventWindow(eventRecord) {
  if (!eventRecord.start) {
    return "Postponed until a new date is confirmed";
  }
  return `${formatShortDate(eventRecord.start)} | ${formatTime(eventRecord.start)}-${formatTime(eventRecord.end)}`;
}

function formatShortDate(input) {
  return new Date(input).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatMonthDay(input) {
  return new Date(input).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatTime(input) {
  return new Date(input).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeTime(input) {
  const diff = Date.now() - new Date(input).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function startOfWeek(input) {
  const date = startOfDay(input);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function startOfMonth(input) {
  const date = startOfDay(input);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(input) {
  const date = new Date(input);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(input, days) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function toDateKey(input) {
  const date = new Date(input);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toInputValue(input) {
  const date = new Date(input);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function toIsoString(localDateTime) {
  return new Date(localDateTime).toISOString();
}

function shiftIsoByDays(isoString, days) {
  const date = new Date(isoString);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function nextWeekdayDate(baseDate, weekday, hour, minute) {
  const date = new Date(baseDate);
  const diff = (weekday - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function compactString(value) {
  return String(value || "").trim();
}

function normalizeUsername(value) {
  return compactString(value).toLowerCase();
}

function setSignInLoginValue(value) {
  const loginInput = refs.signInForm?.elements?.namedItem("login");
  if (loginInput && "value" in loginInput) {
    loginInput.value = value;
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function initials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function makeId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function colorForString(value) {
  const palette = ["#17324d", "#ec6b56", "#4d8cc8", "#2c8f78", "#b85a77", "#8b6f47", "#7b5ea7", "#2a7598", "#996f1e"];
  const hash = [...String(value || "")].reduce((accumulator, char) => accumulator + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function extractErrorMessage(error) {
  if (!error) {
    return "Unknown error.";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "Unknown error.";
}

function escapeText(value) {
  return String(value || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
