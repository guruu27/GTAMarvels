const STORAGE_KEY = "teamflow-scheduler-v1";
const CLOUD_TABLE = "teamflow_boards";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_CONFIG = {
  storageMode: "local",
  supabaseUrl: "",
  supabaseKey: "",
  supabaseBoardId: "northside-falcons",
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
  resetDemoBtn: document.querySelector("#resetDemoBtn"),
  eventModal: document.querySelector("#eventModal"),
  modalTitle: document.querySelector("#modalTitle"),
  eventForm: document.querySelector("#eventForm"),
};

const appConfig = normalizeConfig(window.TEAMFLOW_CONFIG);
const syncState = {
  mode: "local",
  client: null,
  saveTimer: 0,
  pollingTimer: 0,
  savePending: false,
  saving: false,
  lastSavedAt: "",
  lastError: "",
};

let state = createSeedState();

boot();

async function boot() {
  renderLoadingState();
  state = await initializeAppState();
  render();
  wireEvents();
}

function renderLoadingState() {
  refs.heroSubtitle.textContent = "Preparing the scheduler...";
  refs.syncNotice.textContent = "Storage mode: loading";
  refs.calendarSurface.innerHTML = `
    <div class="empty-note">
      <strong>Loading scheduler</strong>
      <span class="helper-line">We are preparing the calendar and syncing the latest data.</span>
    </div>
  `;
}

async function initializeAppState() {
  const localSnapshot = loadState();
  syncState.mode = "local";

  if (!isSupabaseConfigured()) {
    return localSnapshot;
  }

  try {
    syncState.client = window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    syncState.mode = "supabase";
    const remoteRecord = await fetchCloudState();
    if (remoteRecord?.state) {
      syncState.lastSavedAt = remoteRecord.updated_at || "";
      startCloudPolling();
      return normalizeState({
        ...remoteRecord.state,
        ui: localSnapshot.ui,
      });
    }

    const seededState = normalizeState(localSnapshot);
    const createdRecord = await writeCloudState(seededState);
    syncState.lastSavedAt = createdRecord?.updated_at || new Date().toISOString();
    startCloudPolling();
    return seededState;
  } catch (error) {
    syncState.mode = "local";
    syncState.lastError = `Cloud sync unavailable. ${extractErrorMessage(error)}`;
    return localSnapshot;
  }
}

function wireEvents() {
  refs.createEventBtn.addEventListener("click", () => openModal());
  refs.resetDemoBtn.addEventListener("click", handleResetDemo);
  refs.todayBtn.addEventListener("click", () => {
    state.ui.anchorDate = toDateKey(new Date());
    render();
    persist();
  });
  refs.showCancelledToggle.addEventListener("change", (event) => {
    state.ui.showCancelled = event.target.checked;
    render();
    persist();
  });
  refs.viewSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) {
      return;
    }
    state.ui.view = button.dataset.view;
    render();
    persist();
  });
  document.addEventListener("click", handleDocumentClick);
  refs.eventForm.addEventListener("submit", handleEventFormSubmit);
  refs.eventDrawer.addEventListener("click", handleDrawerClick);
  refs.eventDrawer.addEventListener("change", handleDrawerChange);
}

function handleDocumentClick(event) {
  const filterButton = event.target.closest("[data-filter-type]");
  if (filterButton) {
    toggleFilter(filterButton.dataset.filterType);
    return;
  }

  const navButton = event.target.closest("[data-nav]");
  if (navButton) {
    shiftRange(navButton.dataset.nav);
    return;
  }

  const eventButton = event.target.closest("[data-select-event]");
  if (eventButton) {
    const eventId = eventButton.dataset.selectEvent;
    state.ui.selectedEventId = eventId;
    render();
    persist();
    return;
  }

  const openEditButton = event.target.closest("[data-edit-event]");
  if (openEditButton) {
    openModal(openEditButton.dataset.editEvent);
    return;
  }

  const closeModalButton = event.target.closest("[data-close-modal]");
  if (closeModalButton) {
    closeModal();
  }
}

function handleDrawerClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const { action, eventId, memberId, response } = button.dataset;
  if (action === "send-reminder" && eventId) {
    sendReminder(eventId);
    return;
  }
  if (action === "cancel-event" && eventId) {
    cancelEvent(eventId);
    return;
  }
  if (action === "postpone-event" && eventId) {
    postponeEvent(eventId);
    return;
  }
  if (action === "restore-event" && eventId) {
    restoreEvent(eventId);
    return;
  }
  if (action === "save-reschedule" && eventId) {
    saveReschedule(eventId);
    return;
  }
  if (action === "set-response" && eventId && memberId && response) {
    updateAttendance(eventId, memberId, { response });
  }
}

function handleDrawerChange(event) {
  const target = event.target;
  if (target.matches("[data-checkin-event]")) {
    updateAttendance(target.dataset.checkinEvent, target.dataset.memberId, {
      checkIn: target.value,
    });
  }
}

function handleResetDemo() {
  if (!window.confirm("Reset the app back to the seeded demo schedule?")) {
    return;
  }
  state = createSeedState();
  closeModal();
  render();
  persist();
}

function toggleFilter(type) {
  const nextFilters = state.ui.filterTypes.includes(type)
    ? state.ui.filterTypes.filter((item) => item !== type)
    : [...state.ui.filterTypes, type];

  state.ui.filterTypes = nextFilters.length ? nextFilters : Object.keys(TYPE_META);
  state.ui.selectedEventId = ensureSelectedEventId();
  render();
  persist();
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
  render();
  persist();
}

function handleEventFormSubmit(event) {
  event.preventDefault();
  const formData = new FormData(refs.eventForm);
  const eventId = formData.get("eventId");
  const start = formData.get("start");
  const end = formData.get("end");

  if (!start || !end || new Date(end) <= new Date(start)) {
    window.alert("Please choose an end time after the start time.");
    return;
  }

  const baseEvent = {
    type: formData.get("type"),
    title: compactString(formData.get("title")),
    start,
    end,
    meetTime: formData.get("meetTime") || "",
    opponent: compactString(formData.get("opponent")),
    location: compactString(formData.get("location")),
    address: compactString(formData.get("address")),
    requiredPlayers: clampNumber(formData.get("requiredPlayers"), 1, 60, 8),
    notes: compactString(formData.get("notes")),
    updatedAt: new Date().toISOString(),
  };

  if (eventId) {
    const existing = getEventById(eventId);
    if (!existing) {
      return;
    }
    const updated = {
      ...existing,
      ...baseEvent,
    };
    replaceEvent(updated);
    pushFeedItem({
      eventId,
      tone: "edit",
      text: `${updated.title} was updated.`,
    });
    state.ui.selectedEventId = eventId;
  } else {
    const repeatWeekly = formData.get("repeatWeekly") === "on";
    const repeatCount = repeatWeekly
      ? clampNumber(formData.get("repeatCount"), 1, 20, 6)
      : 1;
    const recurringGroupId = repeatCount > 1 ? makeId("group") : "";
    const createdEvents = [];

    for (let index = 0; index < repeatCount; index += 1) {
      const eventDateShift = index * 7;
      const created = {
        id: makeId("event"),
        title: baseEvent.title,
        type: baseEvent.type,
        start: shiftDateTime(baseEvent.start, eventDateShift),
        end: shiftDateTime(baseEvent.end, eventDateShift),
        meetTime: baseEvent.meetTime ? shiftDateTime(baseEvent.meetTime, eventDateShift) : "",
        opponent: baseEvent.opponent,
        location: baseEvent.location,
        address: baseEvent.address,
        requiredPlayers: baseEvent.requiredPlayers,
        notes: baseEvent.notes,
        status: "scheduled",
        recurringGroupId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attendance: buildAttendanceTemplate(),
        originalStart: "",
      };
      createdEvents.push(created);
    }

    state.events = [...state.events, ...createdEvents];
    pushFeedItem({
      eventId: createdEvents[0].id,
      tone: "create",
      text:
        createdEvents.length > 1
          ? `${createdEvents.length} weekly ${TYPE_META[baseEvent.type].label.toLowerCase()} events were scheduled.`
          : `${baseEvent.title} was added to the calendar.`,
    });
    state.ui.selectedEventId = createdEvents[0].id;
  }

  state.events.sort(sortEvents);
  closeModal();
  render();
  persist();
}

function openModal(eventId = "") {
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

function render() {
  state.ui.selectedEventId = ensureSelectedEventId();
  refs.showCancelledToggle.checked = state.ui.showCancelled;
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

function renderHeader() {
  const nextEvent = getNextUpcomingEvent();
  const selectedEvent = getSelectedEvent();
  const focusEvent = selectedEvent || nextEvent;
  const responseSummary = focusEvent ? getResponseSummary(focusEvent) : null;
  const pendingCount = getVisibleEvents().reduce((sum, item) => {
    return sum + Object.values(item.attendance).filter((entry) => entry.response === "pending").length;
  }, 0);

  refs.heroTitle.textContent = `${escapeText(state.team.name)} Calendar`;
  refs.heroSubtitle.textContent = nextEvent
    ? `${TYPE_META[nextEvent.type].label} planning with live RSVPs, recurring sessions, and last-minute rescheduling.`
    : "Create your first event to start mapping the season.";
  refs.syncNotice.textContent = describeSyncStatus();
  refs.nextEventLabel.textContent = nextEvent
    ? `${formatShortDate(nextEvent.start)} at ${formatTime(nextEvent.start)}`
    : "No upcoming event";
  refs.availabilityLabel.textContent = responseSummary
    ? `${responseSummary.available}/${focusEvent.requiredPlayers} ready`
    : "-";
  refs.pendingLabel.textContent = `${pendingCount} waiting`;
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
    : `<div class="empty-note"><p class="helper-line">Updates you trigger in the app will show up here.</p></div>`;
}

function renderMiniTimeline() {
  const now = new Date();
  const nextTenDays = Array.from({ length: 10 }, (_, index) => addDays(startOfDay(now), index));
  refs.miniTimeline.innerHTML = nextTenDays
    .map((date) => {
      const dayEvents = getVisibleEvents().filter((eventRecord) => {
        if (!eventRecord.start) {
          return false;
        }
        return isSameDay(new Date(eventRecord.start), date);
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
    if (!eventRecord.start) {
      return false;
    }
    return isSameDay(new Date(eventRecord.start), date);
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
    if (!eventRecord.start) {
      return false;
    }
    return isSameDay(new Date(eventRecord.start), date);
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
  const postponed = getVisibleEvents().filter((eventRecord) => !eventRecord.start && eventRecord.status === "postponed");

  return `
    <div class="agenda-view">
      ${days
        .map((date) => {
          const events = getVisibleEvents().filter((eventRecord) => {
            if (!eventRecord.start) {
              return false;
            }
            return isSameDay(new Date(eventRecord.start), date);
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
    refs.rosterBoard.innerHTML = `<div class="empty-note"><span>Availability will appear once an event exists.</span></div>`;
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
            <span>${RESPONSE_META[attendance.response]} | ${CHECKIN_META[attendance.checkIn]}</span>
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
        <p class="muted">Create or select an event to track availability and manage last-minute changes.</p>
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

    <div class="drawer-actions">
      <button class="primary-btn" data-edit-event="${eventRecord.id}">Edit event</button>
      <button class="ghost-btn" data-action="send-reminder" data-event-id="${eventRecord.id}">Send reminder</button>
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

    <div class="drawer-block">
      <h3>Event snapshot</h3>
      <div class="summary-metrics">
        <span class="summary-chip">${summary.available} available</span>
        <span class="summary-chip">${summary.pending} pending replies</span>
        <span class="summary-chip">${summary.maybe} maybe</span>
        <span class="summary-chip">${summary.unavailable} unavailable</span>
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

    <div class="drawer-block">
      <h3>Attendance tracking</h3>
      <div class="attendance-summary">
        <span class="type-chip">Required players: ${eventRecord.requiredPlayers}</span>
        ${
          summary.available >= eventRecord.requiredPlayers
            ? `<span class="type-chip">Squad ready</span>`
            : `<span class="type-chip">${eventRecord.requiredPlayers - summary.available} more needed</span>`
        }
      </div>
      ${state.members.map((member) => renderMemberRow(eventRecord, member)).join("")}
    </div>
  `;
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
        <select class="status-select" data-checkin-event="${eventRecord.id}" data-member-id="${member.id}">
          ${Object.entries(CHECKIN_META)
            .map(([value, label]) => {
              const selected = attendance.checkIn === value ? "selected" : "";
              return `<option value="${value}" ${selected}>${escapeHtml(label)}</option>`;
            })
            .join("")}
        </select>
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

function replaceEvent(nextEvent) {
  state.events = state.events.map((eventRecord) => {
    return eventRecord.id === nextEvent.id ? nextEvent : eventRecord;
  });
}

function updateAttendance(eventId, memberId, patch) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }
  const currentAttendance = eventRecord.attendance[memberId] || {
    response: "pending",
    checkIn: "pending",
  };
  eventRecord.attendance[memberId] = {
    ...currentAttendance,
    ...patch,
  };
  eventRecord.updatedAt = new Date().toISOString();
  state.ui.selectedEventId = eventId;
  render();
  persist();
}

function sendReminder(eventId) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }
  const summary = getResponseSummary(eventRecord);
  pushFeedItem({
    eventId,
    tone: "reminder",
    text: `Reminder sent for ${eventRecord.title}. ${summary.pending} replies were still pending.`,
  });
  render();
  persist();
}

function cancelEvent(eventId) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }
  eventRecord.status = "cancelled";
  eventRecord.updatedAt = new Date().toISOString();
  pushFeedItem({
    eventId,
    tone: "cancel",
    text: `${eventRecord.title} was cancelled and everyone was notified.`,
  });
  render();
  persist();
}

function restoreEvent(eventId) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }
  eventRecord.status = "scheduled";
  eventRecord.updatedAt = new Date().toISOString();
  pushFeedItem({
    eventId,
    tone: "restore",
    text: `${eventRecord.title} is back on the calendar.`,
  });
  render();
  persist();
}

function postponeEvent(eventId) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }
  eventRecord.originalStart = eventRecord.originalStart || eventRecord.start;
  eventRecord.status = "postponed";
  eventRecord.start = "";
  eventRecord.end = "";
  eventRecord.meetTime = "";
  eventRecord.updatedAt = new Date().toISOString();
  pushFeedItem({
    eventId,
    tone: "postpone",
    text: `${eventRecord.title} was postponed without a confirmed new date.`,
  });
  render();
  persist();
}

function saveReschedule(eventId) {
  const eventRecord = getEventById(eventId);
  if (!eventRecord) {
    return;
  }
  const startInput = document.querySelector("#rescheduleStart");
  const endInput = document.querySelector("#rescheduleEnd");
  const startValue = startInput?.value || "";
  const endValue = endInput?.value || "";
  if (!startValue || !endValue || new Date(endValue) <= new Date(startValue)) {
    window.alert("Please choose a valid new start and end time.");
    return;
  }

  eventRecord.originalStart = eventRecord.originalStart || eventRecord.start;
  const oldStart = eventRecord.start ? new Date(eventRecord.start) : null;
  const newStart = new Date(startValue);
  eventRecord.start = startValue;
  eventRecord.end = endValue;
  eventRecord.status = "scheduled";
  eventRecord.updatedAt = new Date().toISOString();

  if (eventRecord.meetTime) {
    const oldMeet = new Date(eventRecord.meetTime);
    const diff = oldStart ? oldStart.getTime() - oldMeet.getTime() : 30 * 60 * 1000;
    const shiftedMeet = new Date(newStart.getTime() - Math.abs(diff));
    eventRecord.meetTime = toInputValue(shiftedMeet);
  }

  pushFeedItem({
    eventId,
    tone: "reschedule",
    text: `${eventRecord.title} was rescheduled to ${formatShortDate(startValue)}.`,
  });
  render();
  persist();
}

function getResponseSummary(eventRecord) {
  const values = Object.values(eventRecord.attendance || {});
  return values.reduce(
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

function buildAttendanceTemplate() {
  return state.members.reduce((accumulator, member) => {
    accumulator[member.id] = {
      response: "pending",
      checkIn: "pending",
    };
    return accumulator;
  }, {});
}

function normalizeConfig(rawConfig) {
  return {
    ...DEFAULT_CONFIG,
    ...(rawConfig || {}),
  };
}

function isSupabaseConfigured() {
  return Boolean(
    appConfig.storageMode === "supabase" &&
      appConfig.supabaseUrl &&
      appConfig.supabaseKey &&
      appConfig.supabaseBoardId &&
      window.supabase?.createClient,
  );
}

async function fetchCloudState() {
  const { data, error } = await syncState.client
    .from(CLOUD_TABLE)
    .select("id, state, updated_at")
    .eq("id", appConfig.supabaseBoardId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function writeCloudState(nextState) {
  const { data, error } = await syncState.client
    .from(CLOUD_TABLE)
    .upsert(
      {
        id: appConfig.supabaseBoardId,
        state: serializeCloudState(nextState),
      },
      {
        onConflict: "id",
      },
    )
    .select("id, updated_at, state")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function serializeCloudState(nextState) {
  return {
    team: nextState.team,
    members: nextState.members,
    events: nextState.events,
    feed: nextState.feed,
  };
}

function persistSnapshot() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function queueCloudSave() {
  syncState.savePending = true;
  if (syncState.saveTimer) {
    window.clearTimeout(syncState.saveTimer);
  }
  syncState.saveTimer = window.setTimeout(() => {
    syncState.saveTimer = 0;
    void flushCloudSave();
  }, 500);
  renderHeader();
}

async function flushCloudSave() {
  if (syncState.mode !== "supabase" || !syncState.client) {
    return;
  }

  if (syncState.saving) {
    syncState.savePending = true;
    return;
  }

  syncState.saving = true;
  syncState.savePending = false;
  syncState.lastError = "";
  renderHeader();

  try {
    const savedRecord = await writeCloudState(state);
    syncState.lastSavedAt = savedRecord?.updated_at || new Date().toISOString();
  } catch (error) {
    syncState.lastError = `Cloud save failed. ${extractErrorMessage(error)}`;
  } finally {
    syncState.saving = false;
    renderHeader();
    if (syncState.savePending) {
      queueCloudSave();
    }
  }
}

function startCloudPolling() {
  if (syncState.pollingTimer) {
    window.clearInterval(syncState.pollingTimer);
  }

  syncState.pollingTimer = window.setInterval(() => {
    void pollCloudState();
  }, 20000);
}

async function pollCloudState() {
  if (
    syncState.mode !== "supabase" ||
    !syncState.client ||
    syncState.saving ||
    syncState.savePending ||
    document.hidden
  ) {
    return;
  }

  try {
    const remoteRecord = await fetchCloudState();
    if (!remoteRecord?.state || remoteRecord.updated_at === syncState.lastSavedAt) {
      return;
    }

    syncState.lastSavedAt = remoteRecord.updated_at || "";
    state = normalizeState({
      ...remoteRecord.state,
      ui: state.ui,
    });
    persistSnapshot();
    render();
  } catch (error) {
    syncState.lastError = `Cloud refresh failed. ${extractErrorMessage(error)}`;
    renderHeader();
  }
}

function describeSyncStatus() {
  if (syncState.mode === "supabase") {
    if (syncState.lastError) {
      return syncState.lastError;
    }
    if (syncState.saving || syncState.savePending) {
      return "Cloud sync: saving your latest changes";
    }
    if (syncState.lastSavedAt) {
      return `Cloud sync: live via Supabase, last sync ${formatRelativeTime(syncState.lastSavedAt)}`;
    }
    return "Cloud sync: connected to Supabase";
  }

  if (syncState.lastError) {
    return `${syncState.lastError} Using browser storage only.`;
  }

  return "Storage mode: local browser only";
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

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createSeedState();
    }
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    return createSeedState();
  }
}

function normalizeState(inputState) {
  const fallback = createSeedState();
  const members = Array.isArray(inputState.members) && inputState.members.length ? inputState.members : fallback.members;
  const events = Array.isArray(inputState.events) && inputState.events.length ? inputState.events : fallback.events;
  const feed = Array.isArray(inputState.feed) ? inputState.feed : fallback.feed;
  const ui = {
    view: ["month", "week", "agenda"].includes(inputState.ui?.view) ? inputState.ui.view : "month",
    anchorDate: inputState.ui?.anchorDate || fallback.ui.anchorDate,
    filterTypes: Array.isArray(inputState.ui?.filterTypes) && inputState.ui.filterTypes.length
      ? inputState.ui.filterTypes.filter((type) => TYPE_META[type])
      : Object.keys(TYPE_META),
    selectedEventId: inputState.ui?.selectedEventId || "",
    showCancelled: Boolean(inputState.ui?.showCancelled),
  };
  const normalized = {
    team: inputState.team || fallback.team,
    members,
    events,
    feed,
    ui,
  };
  normalized.ui.selectedEventId = normalized.ui.selectedEventId || findDefaultSelectedEventId(events);
  return normalized;
}

function findDefaultSelectedEventId(events) {
  const nextEvent = [...events].sort(sortEvents).find((eventRecord) => {
    return eventRecord.start && new Date(eventRecord.end || eventRecord.start) >= new Date();
  });
  return nextEvent?.id || events[0]?.id || "";
}

function createSeedState() {
  const members = [
    { id: "m1", name: "Amara Bello", role: "Coach", color: "#17324d" },
    { id: "m2", name: "Jules Carter", role: "Captain", color: "#ec6b56" },
    { id: "m3", name: "Lina Ortiz", role: "Forward", color: "#4d8cc8" },
    { id: "m4", name: "Noah Patel", role: "Midfielder", color: "#2c8f78" },
    { id: "m5", name: "Mia Laurent", role: "Defender", color: "#b85a77" },
    { id: "m6", name: "Theo Brooks", role: "Defender", color: "#8b6f47" },
    { id: "m7", name: "Sara Nordin", role: "Goalkeeper", color: "#7b5ea7" },
    { id: "m8", name: "Kai Mensah", role: "Utility", color: "#2a7598" },
    { id: "m9", name: "Iris Novak", role: "Winger", color: "#996f1e" },
    { id: "m10", name: "Zoe Kim", role: "Physio", color: "#3b4a69" },
  ];

  const now = new Date();
  const tuesday = nextWeekdayDate(now, 2, 18, 30);
  const thursday = nextWeekdayDate(now, 4, 18, 30);
  const saturday = nextWeekdayDate(now, 6, 15, 0);
  const monday = nextWeekdayDate(now, 1, 19, 15);
  const friday = nextWeekdayDate(now, 5, 20, 0);
  const tournament = addDays(nextWeekdayDate(now, 6, 9, 0), 14);

  const events = [
    seedEvent({
      id: "event-practice-1",
      type: "practice",
      title: "High Tempo Practice",
      startDate: tuesday,
      durationHours: 1.5,
      meetOffsetMinutes: 30,
      location: "Northside Arena",
      address: "14 Station Road, Manchester",
      requiredPlayers: 8,
      notes: "Pressing drill, defensive shape, 15 minutes of finishing.",
      recurringGroupId: "group-practice-a",
      attendance: buildSeedAttendance(members, {
        m1: { response: "available", checkIn: "on_time" },
        m2: { response: "available" },
        m3: { response: "available" },
        m4: { response: "maybe" },
        m5: { response: "available" },
        m6: { response: "pending" },
        m7: { response: "available" },
        m8: { response: "pending" },
        m9: { response: "available" },
        m10: { response: "available" },
      }),
    }),
    seedEvent({
      id: "event-practice-2",
      type: "practice",
      title: "Shape and Recovery Session",
      startDate: thursday,
      durationHours: 1.25,
      meetOffsetMinutes: 20,
      location: "Riverside Training Ground",
      address: "8 Canal Street, Manchester",
      requiredPlayers: 8,
      notes: "Smaller workload before the weekend fixture.",
      recurringGroupId: "group-practice-b",
      attendance: buildSeedAttendance(members, {
        m1: { response: "available" },
        m2: { response: "available" },
        m3: { response: "available" },
        m4: { response: "available" },
        m5: { response: "pending" },
        m6: { response: "available" },
        m7: { response: "available" },
        m8: { response: "maybe" },
        m9: { response: "available" },
        m10: { response: "available" },
      }),
    }),
    seedEvent({
      id: "event-game-1",
      type: "game",
      title: "League Matchday 6",
      startDate: saturday,
      durationHours: 2,
      meetOffsetMinutes: 60,
      location: "Harbor Park Stadium",
      address: "221 Waterside Way, Manchester",
      opponent: "Harbor United",
      requiredPlayers: 11,
      notes: "Bring away kit. Video analyst will clip first-half transitions.",
      attendance: buildSeedAttendance(members, {
        m1: { response: "available" },
        m2: { response: "available" },
        m3: { response: "available" },
        m4: { response: "available" },
        m5: { response: "available" },
        m6: { response: "available" },
        m7: { response: "available" },
        m8: { response: "available" },
        m9: { response: "maybe" },
        m10: { response: "available" },
      }),
    }),
    seedEvent({
      id: "event-social-1",
      type: "social",
      title: "Team Dinner",
      startDate: friday,
      durationHours: 2.5,
      meetOffsetMinutes: 0,
      location: "The Lantern Hall",
      address: "5 Market Lane, Manchester",
      requiredPlayers: 6,
      notes: "Families are welcome. RSVP helps reserve the right number of seats.",
      attendance: buildSeedAttendance(members, {
        m1: { response: "available" },
        m2: { response: "available" },
        m3: { response: "maybe" },
        m4: { response: "available" },
        m5: { response: "available" },
        m6: { response: "pending" },
        m7: { response: "available" },
        m8: { response: "pending" },
        m9: { response: "available" },
        m10: { response: "available" },
      }),
    }),
    seedEvent({
      id: "event-recovery-1",
      type: "practice",
      title: "Recovery and Analysis",
      startDate: monday,
      durationHours: 1,
      meetOffsetMinutes: 15,
      location: "Clubhouse Studio",
      address: "3 Newton Terrace, Manchester",
      requiredPlayers: 6,
      notes: "Light mobility followed by 25 minutes of match review.",
      attendance: buildSeedAttendance(members, {
        m1: { response: "available" },
        m2: { response: "available" },
        m3: { response: "available" },
        m4: { response: "pending" },
        m5: { response: "available" },
        m6: { response: "pending" },
        m7: { response: "available" },
        m8: { response: "maybe" },
        m9: { response: "available" },
        m10: { response: "available" },
      }),
    }),
    seedEvent({
      id: "event-tournament-1",
      type: "tournament",
      title: "Spring Cup Qualifier",
      startDate: tournament,
      durationHours: 6,
      meetOffsetMinutes: 50,
      location: "Central Sports Campus",
      address: "44 Regent Drive, Leeds",
      opponent: "Regional pool draw",
      requiredPlayers: 12,
      notes: "Packed lunch, medical forms, and travel list due 48 hours before departure.",
      attendance: buildSeedAttendance(members, {
        m1: { response: "available" },
        m2: { response: "available" },
        m3: { response: "available" },
        m4: { response: "available" },
        m5: { response: "available" },
        m6: { response: "available" },
        m7: { response: "available" },
        m8: { response: "pending" },
        m9: { response: "maybe" },
        m10: { response: "available" },
      }),
    }),
    {
      id: "event-game-2",
      type: "game",
      title: "Friendly vs West Didsbury",
      start: "",
      end: "",
      meetTime: "",
      location: "To be confirmed",
      address: "",
      opponent: "West Didsbury",
      requiredPlayers: 11,
      notes: "Opponent asked for a rain-check. Waiting on the new slot.",
      status: "postponed",
      recurringGroupId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attendance: buildSeedAttendance(members, {
        m1: { response: "available" },
        m2: { response: "available" },
        m3: { response: "available" },
        m4: { response: "pending" },
        m5: { response: "available" },
        m6: { response: "available" },
        m7: { response: "pending" },
        m8: { response: "available" },
        m9: { response: "maybe" },
        m10: { response: "available" },
      }),
      originalStart: "",
    },
  ].sort(sortEvents);

  return {
    team: {
      name: "Northside Falcons",
    },
    members,
    events,
    feed: [
      {
        id: makeId("feed"),
        createdAt: new Date().toISOString(),
        eventId: "event-game-2",
        tone: "postpone",
        text: "Friendly vs West Didsbury was postponed while the clubs confirm a new date.",
      },
      {
        id: makeId("feed"),
        createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
        eventId: "event-game-1",
        tone: "reminder",
        text: "Reminder sent for League Matchday 6 to everyone still waiting to RSVP.",
      },
      {
        id: makeId("feed"),
        createdAt: new Date(Date.now() - 1000 * 60 * 70).toISOString(),
        eventId: "event-practice-1",
        tone: "create",
        text: "High Tempo Practice was added as part of the weekly training block.",
      },
    ],
    ui: {
      view: "month",
      anchorDate: toDateKey(new Date()),
      filterTypes: Object.keys(TYPE_META),
      selectedEventId: "event-practice-1",
      showCancelled: false,
    },
  };
}

function seedEvent({
  id,
  type,
  title,
  startDate,
  durationHours,
  meetOffsetMinutes,
  location,
  address,
  opponent = "",
  requiredPlayers,
  notes,
  recurringGroupId = "",
  attendance,
}) {
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const meetTime = new Date(start.getTime() - meetOffsetMinutes * 60 * 1000);
  return {
    id,
    type,
    title,
    start: toInputValue(start),
    end: toInputValue(end),
    meetTime: meetOffsetMinutes ? toInputValue(meetTime) : "",
    location,
    address,
    opponent,
    requiredPlayers,
    notes,
    status: "scheduled",
    recurringGroupId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attendance,
    originalStart: "",
  };
}

function buildSeedAttendance(members, overrides = {}) {
  return members.reduce((accumulator, member) => {
    accumulator[member.id] = {
      response: "pending",
      checkIn: "pending",
      ...(overrides[member.id] || {}),
    };
    return accumulator;
  }, {});
}

function pushFeedItem({ eventId = "", tone = "info", text }) {
  state.feed.unshift({
    id: makeId("feed"),
    createdAt: new Date().toISOString(),
    eventId,
    tone,
    text,
  });
  state.feed = state.feed.slice(0, 18);
}

function persist() {
  state.ui.selectedEventId = ensureSelectedEventId();
  persistSnapshot();
  if (syncState.mode === "supabase") {
    queueCloudSave();
  }
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

function shiftDateTime(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return toInputValue(date);
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

window.appState = {
  reset: handleResetDemo,
};
