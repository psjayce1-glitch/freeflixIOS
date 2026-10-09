// FreeFlix catalog and streaming player
let catalog = [];
let currentView = "home";
let myList = [];
let resumeItems = [];
let catalogSplashDismissTimer;

try {
  const saved = localStorage.getItem("freeflix_my_list");
  if (saved) myList = JSON.parse(saved);
} catch (e) { myList = []; }

function saveMyList() {
  try { localStorage.setItem("freeflix_my_list", JSON.stringify(myList)); } catch (e) {}
}

// --- Auth Flow ---
const authScreen = document.getElementById("authScreen");
const profilePicker = document.getElementById("profilePicker");
const profilePickerGrid = document.getElementById("profilePickerGrid");
const appFrame = document.getElementById("appFrame");
const authForm = document.getElementById("authForm");
const authUserInput = document.getElementById("authUser");
const authPassInput = document.getElementById("authPass");
const authConfirmField = document.getElementById("authConfirmField");
const authConfirmInput = document.getElementById("authConfirm");
const authError = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmit");
const authSwitchLink = document.getElementById("authSwitchLink");
const authHint = document.getElementById("authHint");
const authTabs = document.querySelectorAll(".auth-tab");

let authMode = "login"; // "login" | "signup"
let currentUsername = "";
let currentProfiles = [];
let currentProfile = null;
let pendingWatchRequest = null;
let startedWatchRequestKey = "";
let creatingProfile = false;
let profileDraftId = "";
let controllerKeyboardTarget = null;
let selectedAvatar = "";
const profileAvatars = {
  comet: "☄️",
  popcorn: "🍿",
  astronaut: "🧑‍🚀",
  fox: "🦊",
  alien: "👾",
  tiger: "🐯",
  robot: "🤖",
  spark: "⚡",
};

function watchRequestKey(request) {
  return `${request.tmdbId}:${request.kind}:${request.season || 1}:${request.episode || 1}`;
}

function acceptWatchRequest(request) {
  if (!request || !Number.isSafeInteger(Number(request.tmdbId)) || !request.title) return;
  if (watchRequestKey(request) === startedWatchRequestKey) return;
  pendingWatchRequest = request;
  startPendingWatchRequest();
}

window.freeflix.onWatchRequest?.(acceptWatchRequest);
window.freeflix.getPendingWatchRequest?.().then(acceptWatchRequest).catch(() => {});

function startPendingWatchRequest() {
  const request = pendingWatchRequest;
  if (!request || !currentProfile || !catalog.length) return;
  pendingWatchRequest = null;
  startedWatchRequestKey = watchRequestKey(request);

  const isSeries = request.kind === "tv";
  const item = catalog.find((entry) => Number(entry.tmdbId) === Number(request.tmdbId)
    && (entry.kind === "tv") === isSeries) || {
      id: `tmdb-${isSeries ? "series" : "movie"}-${request.tmdbId}`,
      tmdbId: Number(request.tmdbId),
      kind: isSeries ? "tv" : "movie",
      type: isSeries ? "series" : "movie",
      title: request.title,
      year: "",
      poster: "",
      still: "",
      synopsis: "",
    };

  handleWatchNow(item, request.season || 1, request.episode || 1, 0, request.episodeTitle || "");
}

function watchProgressStorageKey(profileId) {
  return profileId ? `freeflix_watch_progress_${profileId}` : "";
}

function loadWatchProgress(profileId = currentProfile?.id) {
  const key = watchProgressStorageKey(profileId);
  if (!key) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(saved)
      ? saved.filter((entry) => entry && Number.isFinite(Number(entry.currentTime)) && Number.isFinite(Number(entry.duration)))
        .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
      : [];
  } catch {
    return [];
  }
}

function watchProgressEntryKey(entry) {
  return entry.isSeries
    ? `${entry.tmdbId}:s${entry.season || 1}:e${entry.episode || 1}`
    : `${entry.tmdbId}:movie`;
}

function saveWatchProgress(progress) {
  if (!progress || !progress.profileId || !progress.tmdbId) return;
  const currentTime = Number(progress.currentTime);
  const duration = Number(progress.duration);
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || currentTime < 0 || duration <= 0) return;

  const items = loadWatchProgress(progress.profileId);
  const key = watchProgressEntryKey(progress);
  const remaining = duration - currentTime;
  const updatedItems = currentTime / duration >= 0.95 || remaining <= 45
    ? items.filter((entry) => watchProgressEntryKey(entry) !== key)
    : [
        { ...progress, currentTime, duration, updatedAt: Date.now() },
        ...items.filter((entry) => watchProgressEntryKey(entry) !== key),
      ].slice(0, 18);

  try {
    localStorage.setItem(watchProgressStorageKey(progress.profileId), JSON.stringify(updatedItems));
  } catch {}

  if (currentProfile?.id === progress.profileId) {
    resumeItems = updatedItems;
    updateContinueWatchingRow();
  }
}

window.freeflix.onWatchProgress?.(saveWatchProgress);

function formatResumeTime(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function renderContinueWatchingRow() {
  if (!resumeItems.length) return null;
  const section = document.createElement("section");
  section.className = "row resume-row";
  const heading = document.createElement("h2");
  heading.textContent = `Continue Watching for ${currentProfile?.displayName || currentUsername}`;
  section.appendChild(heading);

  const scroller = document.createElement("div");
  scroller.className = "scroller resume-scroller";
  for (const entry of resumeItems) {
    const card = document.createElement("article");
    card.className = "resume-card";
    const progress = Math.max(0, Math.min(100, (entry.currentTime / entry.duration) * 100));
    const remaining = formatResumeTime(Math.max(0, entry.duration - entry.currentTime));
    const imageUrl = entry.still || entry.poster || "";
    const episodeLabel = entry.isSeries
      ? `S${entry.season || 1}:E${entry.episode || 1}${entry.episodeTitle ? ` · ${escapeHtml(entry.episodeTitle)}` : ""}`
      : entry.year || "Movie";
    const resumeButton = document.createElement("button");
    resumeButton.type = "button";
    resumeButton.className = "resume-card-main";
    resumeButton.setAttribute("aria-label", `Resume ${entry.title}`);
    resumeButton.innerHTML = `
      <span class="resume-card-art">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />` : `<span class="resume-art-fallback">${escapeHtml(entry.title)}</span>`}
        <span class="resume-card-shade"></span>
        <span class="resume-card-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
        <span class="resume-card-progress" aria-label="${Math.round(progress)} percent watched"><span style="width:${progress}%"></span></span>
      </span>
      <span class="resume-card-details">
        <strong class="resume-card-title">${escapeHtml(entry.title)}</strong>
        <span class="resume-card-subtitle">${episodeLabel}</span>
        <span class="resume-card-remaining">${remaining} left</span>
      </span>
    `;
    resumeButton.addEventListener("click", () => {
      const isSeries = Boolean(entry.isSeries);
      const item = {
        id: `tmdb-${isSeries ? "series" : "movie"}-${entry.tmdbId}`,
        tmdbId: Number(entry.tmdbId),
        kind: entry.kind || (isSeries ? "tv" : "movie"),
        type: isSeries ? "series" : "movie",
        title: entry.title,
        year: entry.year || "",
        poster: entry.poster || "",
        still: entry.still || "",
        synopsis: entry.synopsis || "",
      };
      handleWatchNow(item, entry.season || 1, entry.episode || 1, entry.currentTime, entry.episodeTitle || "");
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "resume-card-remove";
    removeButton.title = "Remove from Continue Watching";
    removeButton.setAttribute("aria-label", `Remove ${entry.title} from Continue Watching`);
    removeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      resumeItems = resumeItems.filter((item) => watchProgressEntryKey(item) !== watchProgressEntryKey(entry));
      try {
        localStorage.setItem(watchProgressStorageKey(currentProfile?.id), JSON.stringify(resumeItems));
      } catch {}
      updateContinueWatchingRow();
    });

    card.append(resumeButton, removeButton);
    scroller.appendChild(card);
  }
  section.appendChild(scroller);
  return section;
}

function updateContinueWatchingRow() {
  if (currentView !== "home" || !stage) return;
  const currentRow = stage.querySelector(".resume-row");
  const nextRow = renderContinueWatchingRow();
  if (currentRow && nextRow) currentRow.replaceWith(nextRow);
  else if (currentRow) currentRow.remove();
  else if (nextRow) {
    const hero = stage.querySelector(".hero");
    if (hero) hero.after(nextRow);
    else stage.prepend(nextRow);
  }
}

function profileStorageKey(username) {
  return `freeflix_profile_${username}`;
}

function profilesStorageKey(username) {
  return `freeflix_profiles_${username}`;
}

function newProfileId() {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadProfile(username) {
  try {
    const saved = JSON.parse(localStorage.getItem(profileStorageKey(username)) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function saveProfiles(username, profiles) {
  localStorage.setItem(profilesStorageKey(username), JSON.stringify(profiles));
}

function loadProfiles(username) {
  try {
    const saved = JSON.parse(localStorage.getItem(profilesStorageKey(username)) || "null");
    if (Array.isArray(saved)) {
      const valid = saved.filter((profile) => profile && typeof profile.id === "string" && typeof profile.displayName === "string");
      if (valid.length) return valid;
    }
  } catch {}

  const legacy = loadProfile(username);
  const profile = {
    id: newProfileId(),
    displayName: typeof legacy.displayName === "string" && legacy.displayName.trim()
      ? legacy.displayName.trim()
      : username.charAt(0).toUpperCase() + username.slice(1),
    avatar: Object.hasOwn(profileAvatars, legacy.avatar) ? legacy.avatar : "",
  };
  currentProfiles = [profile];
  try { saveProfiles(username, currentProfiles); } catch {}
  return currentProfiles;
}

function renderProfile(username, profile = currentProfile) {
  const avatar = document.getElementById("userAvatar");
  const name = document.getElementById("userName");
  const displayName = typeof profile?.displayName === "string" && profile.displayName.trim()
    ? profile.displayName.trim()
    : username.charAt(0).toUpperCase() + username.slice(1);
  selectedAvatar = Object.hasOwn(profileAvatars, profile?.avatar) ? profile.avatar : "";

  if (avatar) {
    avatar.textContent = selectedAvatar ? profileAvatars[selectedAvatar] : (username || "?")[0].toUpperCase();
    avatar.dataset.avatar = selectedAvatar;
  }
  if (name) name.textContent = displayName;
}

function setAuthMode(mode) {
  authMode = mode;
  authError.textContent = "";
  authTabs.forEach(t => {
    t.classList.toggle("active", t.dataset.tab === mode);
  });
  if (mode === "signup") {
    authConfirmField.style.display = "";
    authSubmitBtn.textContent = "Create Account";
    authHint.innerHTML = 'Already have an account? <a href="#" id="authSwitchLink">Log in</a>';
  } else {
    authConfirmField.style.display = "none";
    authSubmitBtn.textContent = "Log In";
    authHint.innerHTML = 'Don\'t have an account? <a href="#" id="authSwitchLink">Sign up</a>';
  }
  document.getElementById("authSwitchLink").addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode(mode === "login" ? "signup" : "login");
  });
}

authTabs.forEach(t => {
  t.addEventListener("click", () => setAuthMode(t.dataset.tab));
});

authSwitchLink.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "signup" : "login");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  authSubmitBtn.disabled = true;

  const username = authUserInput.value.trim();
  const password = authPassInput.value;

  if (username.length < 3) {
    authError.textContent = "Username must be at least 3 characters.";
    authSubmitBtn.disabled = false;
    authUserInput.focus();
    return;
  }
  if (password.length < 4) {
    authError.textContent = "Password must be at least 4 characters.";
    authSubmitBtn.disabled = false;
    authPassInput.focus();
    return;
  }

  if (authMode === "signup") {
    if (password !== authConfirmInput.value) {
      authError.textContent = "Passwords do not match.";
      authSubmitBtn.disabled = false;
      return;
    }
    const res = await window.freeflix.authSignup(username, password);
    if (!res.ok) {
      authError.textContent = res.error;
      authSubmitBtn.disabled = false;
      return;
    }
    enterApp(res.username);
  } else {
    const res = await window.freeflix.authLogin(username, password);
    if (!res.ok) {
      authError.textContent = res.error;
      authSubmitBtn.disabled = false;
      return;
    }
    enterApp(res.username);
  }
});

function enterApp(username) {
  currentUsername = username;
  showProfilePicker(username);
}

function showProfilePicker(username) {
  currentUsername = username;
  currentProfile = null;
  currentProfiles = loadProfiles(username);
  authScreen.classList.remove("auth-leaving");
  authScreen.style.display = "none";
  appFrame.style.display = "none";
  profilePicker.hidden = false;
  document.getElementById("profilePickerAccount").textContent = `Signed in as ${username}`;
  profilePickerGrid.replaceChildren();

  for (const profile of currentProfiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-choice";
    button.dataset.profileId = profile.id;
    const avatar = document.createElement("span");
    avatar.className = "profile-choice-avatar";
    avatar.textContent = profileAvatars[profile.avatar] || (profile.displayName || username).charAt(0).toUpperCase();
    const label = document.createElement("span");
    label.className = "profile-choice-name";
    label.textContent = profile.displayName;
    button.append(avatar, label);
    button.addEventListener("click", () => startWatchingProfile(profile));
    profilePickerGrid.appendChild(button);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "profile-choice profile-choice-add";
  addButton.innerHTML = '<span class="profile-choice-avatar">+</span><span class="profile-choice-name">Add profile</span>';
  addButton.addEventListener("click", openCreateProfile);
  profilePickerGrid.appendChild(addButton);
  requestAnimationFrame(() => profilePickerGrid.querySelector(".profile-choice")?.focus());
}

function startWatchingProfile(profile) {
  currentProfile = profile;
  resumeItems = loadWatchProgress(profile.id);
  renderProfile(currentUsername, profile);
  profilePicker.hidden = true;
  appFrame.style.display = "";
  init().then(() => {
    requestAnimationFrame(() => document.querySelector(".nav-item.active")?.focus());
    startPendingWatchRequest();
  });
}

function openCreateProfile() {
  creatingProfile = true;
  profileDraftId = newProfileId();
  selectedAvatar = "comet";
  document.getElementById("profileSettingsTitle").textContent = "Create profile";
  profileDisplayName.value = "";
  profileSettingsError.textContent = "";
  currentPasswordInput.value = "";
  newPasswordInput.value = "";
  profilePasswordSection.hidden = true;
  profileSettingsSave.textContent = "Create profile";
  document.querySelectorAll(".avatar-option").forEach((option) => {
    option.setAttribute("aria-pressed", String(option.dataset.avatar === selectedAvatar));
  });
  profileSettings.hidden = false;
  profileDisplayName.focus();
}

function closeCreateProfile() {
  creatingProfile = false;
  profileDraftId = "";
  profilePasswordSection.hidden = false;
  profileSettingsTitle.textContent = "Account settings";
  profileSettingsSave.textContent = "Save changes";
  profileSettings.hidden = true;
  profileSettingsError.textContent = "";

  if (currentUsername) showProfilePicker(currentUsername);
}

const profileSettings = document.getElementById("profileSettings");
const profileSettingsForm = document.getElementById("profileSettingsForm");
const profileSettingsTitle = document.getElementById("profileSettingsTitle");
const profilePasswordSection = document.getElementById("profilePasswordSection");
const profileDisplayName = document.getElementById("profileDisplayName");
const profileSettingsError = document.getElementById("profileSettingsError");
const currentPasswordInput = document.getElementById("currentPassword");
const newPasswordInput = document.getElementById("newPassword");
const profileSettingsSave = document.getElementById("profileSettingsSave");

function closeProfileSettings() {
  if (creatingProfile) {
    closeCreateProfile();
    return;
  }
  profileSettings.hidden = true;
  profileSettingsError.textContent = "";
}

document.getElementById("profileSettingsBtn").addEventListener("click", () => {
  const profile = currentProfile || loadProfile(currentUsername);
  creatingProfile = false;
  profilePasswordSection.hidden = false;
  profileSettingsTitle.textContent = "Account settings";
  profileSettingsSave.textContent = "Save changes";
  const fallbackName = currentUsername.charAt(0).toUpperCase() + currentUsername.slice(1);
  profileDisplayName.value = typeof profile.displayName === "string" ? profile.displayName : fallbackName;
  selectedAvatar = Object.hasOwn(profileAvatars, profile.avatar) ? profile.avatar : "";
  document.querySelectorAll(".avatar-option").forEach((option) => {
    option.setAttribute("aria-pressed", String(option.dataset.avatar === selectedAvatar));
  });
  currentPasswordInput.value = "";
  newPasswordInput.value = "";
  profileSettingsError.textContent = "";
  profileSettings.hidden = false;
  profileDisplayName.focus();
});

document.querySelectorAll(".avatar-option").forEach((option) => {
  option.addEventListener("click", () => {
    selectedAvatar = option.dataset.avatar;
    document.querySelectorAll(".avatar-option").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === option));
    });
  });
});

document.getElementById("profileSettingsClose").addEventListener("click", closeProfileSettings);
document.getElementById("profileSettingsCancel").addEventListener("click", () => {
  if (creatingProfile) closeCreateProfile();
  else closeProfileSettings();
});
profileSettings.addEventListener("click", (event) => {
  if (event.target === profileSettings) {
    if (creatingProfile) closeCreateProfile();
    else closeProfileSettings();
  }
});

profileSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = profileDisplayName.value.trim();
  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;

  if (!displayName) {
    profileSettingsError.textContent = "Display name can't be empty.";
    profileDisplayName.focus();
    return;
  }

  if (creatingProfile) {
    const profile = { id: profileDraftId, displayName, avatar: selectedAvatar };
    const updatedProfiles = [...currentProfiles, profile];
    profileSettingsSave.disabled = true;
    try {
      saveProfiles(currentUsername, updatedProfiles);
      currentProfiles = updatedProfiles;
      creatingProfile = false;
      profileDraftId = "";
      profilePasswordSection.hidden = false;
      profileSettings.hidden = true;
      showProfilePicker(currentUsername);
    } catch {
      profileSettingsError.textContent = "Couldn't create this profile. Please try again.";
    } finally {
      profileSettingsSave.disabled = false;
    }
    return;
  }

  if (Boolean(currentPassword) !== Boolean(newPassword)) {
    profileSettingsError.textContent = "Enter both password fields to change your password.";
    return;
  }

  profileSettingsSave.disabled = true;
  profileSettingsError.textContent = "";
  try {
    if (currentPassword && newPassword) {
      const result = await window.freeflix.authUpdatePassword(currentPassword, newPassword);
      if (!result.ok) {
        profileSettingsError.textContent = result.error;
        return;
      }
    }

    currentProfile.displayName = displayName;
    currentProfile.avatar = selectedAvatar;
    saveProfiles(currentUsername, currentProfiles);
    localStorage.setItem(profileStorageKey(currentUsername), JSON.stringify({ displayName, avatar: selectedAvatar }));
    renderProfile(currentUsername, currentProfile);
    closeProfileSettings();
  } catch {
    profileSettingsError.textContent = "Couldn't save your settings. Please try again.";
  } finally {
    profileSettingsSave.disabled = false;
  }
});

document.getElementById("switchProfileBtn").addEventListener("click", () => showProfilePicker(currentUsername));
document.getElementById("profilePickerSignout").addEventListener("click", async () => {
  await window.freeflix.authLogout();
  currentUsername = "";
  currentProfile = null;
  currentProfiles = [];
  profilePicker.hidden = true;
  catalog = [];
  currentView = "home";
  const stageEl = document.getElementById("stage");
  if (stageEl) stageEl.innerHTML = "";
  authForm.reset();
  authError.textContent = "";
  authSubmitBtn.disabled = false;
  authScreen.style.display = "";
  setAuthMode("login");
  requestAnimationFrame(() => authUserInput.focus());
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileSettings.hidden) closeProfileSettings();
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await window.freeflix.authLogout();
  currentUsername = "";
  currentProfile = null;
  currentProfiles = [];
  selectedAvatar = "";
  // Reset state
  catalog = [];
  currentView = "home";
  const stageEl = document.getElementById("stage");
  if (stageEl) stageEl.innerHTML = "";
  // Show auth screen again
  appFrame.style.display = "none";
  profilePicker.hidden = true;
  authScreen.style.display = "";
  authScreen.classList.remove("auth-leaving");
  authForm.reset();
  authError.textContent = "";
  authSubmitBtn.disabled = false;
  setAuthMode("login");
  requestAnimationFrame(() => authUserInput.focus());
});

// Check if already logged in
(async () => {
  const sess = await window.freeflix.authCheck();
  if (sess.loggedIn) {
    enterApp(sess.username);
  } else {
    requestAnimationFrame(() => authUserInput.focus());
  }
  // Auth screen is already visible by default
})();

// --- DOM References (deferred since app-frame starts hidden) ---
let stage, detail, searchInput;

function ensureDomRefs() {
  if (!stage) stage = document.getElementById("stage");
  if (!detail) detail = document.getElementById("detail");
  if (!searchInput) searchInput = document.getElementById("search");
}

// --- Window Controls ---
document.querySelectorAll(".traffic .dot").forEach((btn) => {
  btn.addEventListener("click", () => {
    window.freeflix.windowControl(btn.dataset.win);
  });
});

// --- Nav Tabs ---
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    btn.classList.add("active");
    ensureDomRefs();
    if (btn.dataset.view === "search") {
      searchInput?.focus();
      openControllerKeyboard();
      return;
    }
    currentView = btn.dataset.view;
    if (searchInput) searchInput.value = "";
    renderCurrentView();
    btn.focus();
  });
});

function visibleNavigationItems() {
  const keyboard = document.getElementById("controllerKeyboard");
  const root = keyboard && !keyboard.hasAttribute("hidden")
    ? keyboard
    : profileSettings && !profileSettings.hidden ? profileSettings
      : profilePicker && !profilePicker.hidden ? profilePicker
        : authScreen.style.display !== "none" ? authScreen
          : detail && !detail.hasAttribute("hidden") ? detail : document;
  return Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), .card[tabindex="0"]'))
    .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}

function moveSpatialFocus(direction) {
  const items = visibleNavigationItems();
  if (!items.length) return;
  const current = document.activeElement;
  const currentRect = current?.getBoundingClientRect();
  if (!currentRect || !items.includes(current)) {
    (direction === "left" || direction === "up" ? items.at(-1) : items[0]).focus();
    return;
  }

  const originX = currentRect.left + currentRect.width / 2;
  const originY = currentRect.top + currentRect.height / 2;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item === current) continue;
    const rect = item.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - originX;
    const dy = rect.top + rect.height / 2 - originY;
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 1) continue;
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + cross * 1.8 + (cross * cross) / Math.max(primary, 1);
    if (score < bestScore) { best = item; bestScore = score; }
  }

  if (!best) {
    const currentIndex = items.indexOf(current);
    const step = direction === "left" || direction === "up" ? -1 : 1;
    best = items[(currentIndex + step + items.length) % items.length];
  }
  best.focus({ preventScroll: false });
  if (best.classList.contains("card")) best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function activateFocusedItem() {
  const active = document.activeElement;
  if (active instanceof HTMLSelectElement) {
    if (typeof active.showPicker === "function") active.showPicker();
    else active.click();
    return;
  }
  if (active?.matches("input[type='text'], input[type='password'], input[type='search']")) {
    openControllerKeyboard(active);
    return;
  }
  if (active && typeof active.click === "function") active.click();
}

function openControllerKeyboard(target = searchInput) {
  const keyboard = document.getElementById("controllerKeyboard");
  if (!keyboard) return;
  controllerKeyboardTarget = target;
  const title = document.getElementById("keyboardQuery");
  const heading = keyboard.querySelector(".keyboard-heading span");
  if (heading) heading.textContent = target?.type === "password" ? "PASSWORD" : target?.id === "authUser" ? "USERNAME" : "FREEFLIX INPUT";
  if (title) title.textContent = target?.type === "password" ? "Enter password" : target?.placeholder || "Type here";
  keyboard.removeAttribute("hidden");
  updateKeyboardQuery();
  keyboard.querySelector("[data-key='q']")?.focus();
}

function closeControllerKeyboard() {
  const keyboard = document.getElementById("controllerKeyboard");
  if (!keyboard || keyboard.hasAttribute("hidden")) return false;
  keyboard.setAttribute("hidden", "true");
  const target = controllerKeyboardTarget;
  controllerKeyboardTarget = null;
  target?.focus();
  return true;
}

function updateKeyboardQuery() {
  const query = document.getElementById("keyboardQuery");
  if (!query) return;
  const target = controllerKeyboardTarget;
  const value = target?.value || "";
  if (target?.type === "password") query.textContent = value ? "•".repeat(value.length) : "Enter password";
  else query.textContent = value || target?.placeholder || "Type here";
}

document.getElementById("controllerKeyboard").addEventListener("click", (event) => {
  const key = event.target.closest("[data-key]")?.dataset.key;
  if (!key) return;
  if (key === "close") { closeControllerKeyboard(); return; }
  const target = controllerKeyboardTarget;
  if (!target) return;
  if (key === "clear") target.value = "";
  else if (key === "backspace") target.value = target.value.slice(0, -1);
  else target.value += key === "space" ? " " : key;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  updateKeyboardQuery();
});

function closeTopLayer() {
  if (closeControllerKeyboard()) return true;
  if (profileSettings && !profileSettings.hidden) { closeProfileSettings(); return true; }
  if (detail && !detail.hasAttribute("hidden")) { closeDetail(); return true; }
  if (trailerOverlay && !trailerOverlay.hasAttribute("hidden")) { closeTrailer(); return true; }
  if (currentView !== "home") {
    document.querySelector('.nav-item[data-view="home"]')?.click();
    return true;
  }
  return false;
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeTopLayer(); return; }
  const keyboard = document.getElementById("controllerKeyboard");
  if (keyboard && !keyboard.hasAttribute("hidden") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    ensureDomRefs();
    if (/^[a-z0-9]$/i.test(event.key)) searchInput.value += event.key;
    else if (event.key === " ") searchInput.value += " ";
    else if (event.key === "Backspace") searchInput.value = searchInput.value.slice(0, -1);
    else if (event.key === "Enter") { event.preventDefault(); closeControllerKeyboard(); return; }
    else if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      updateKeyboardQuery();
      return;
    }
  }
  if (event.target instanceof HTMLSelectElement && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    event.target.selectedIndex = Math.max(0, Math.min(event.target.options.length - 1, event.target.selectedIndex + direction));
    event.target.dispatchEvent(new Event("change", { bubbles: true }));
    event.preventDefault();
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target.matches("input, textarea, [contenteditable='true']")) return;
  event.preventDefault();
  moveSpatialFocus(event.key.replace("Arrow", "").toLowerCase());
});

let previousGamepadButtons = new Map();
let lastGamepadAxisMove = 0;
window.addEventListener("pointerdown", () => document.body.classList.remove("controller-mode"));
function pollGamepads() {
  const pads = navigator.getGamepads?.() || [];
  for (const pad of pads) {
    if (!pad) continue;
    const previous = previousGamepadButtons.get(pad.index) || [];
    const pressed = (index) => Boolean(pad.buttons[index]?.pressed && !previous[index]);
    const hasInput = pad.buttons.some((button) => button.pressed) || pad.axes.some((axis) => Math.abs(axis) > 0.58);
    if (hasInput) document.body.classList.add("controller-mode");
    let handled = false;
    if (document.activeElement instanceof HTMLSelectElement && (pressed(12) || pressed(13))) {
      const direction = pressed(13) ? 1 : -1;
      const select = document.activeElement;
      select.selectedIndex = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + direction));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      handled = true;
    }
    else if (pressed(12)) { moveSpatialFocus("up"); handled = true; }
    else if (pressed(13)) { moveSpatialFocus("down"); handled = true; }
    else if (pressed(14)) { moveSpatialFocus("left"); handled = true; }
    else if (pressed(15)) { moveSpatialFocus("right"); handled = true; }
    else if (pressed(0)) { activateFocusedItem(); handled = true; }
    else if (pressed(1)) { closeTopLayer(); handled = true; }
    else if (pressed(4) || pressed(5)) {
      const navItems = Array.from(document.querySelectorAll(".nav-item"));
      const activeIndex = navItems.findIndex((item) => item.classList.contains("active"));
      const delta = pressed(5) ? 1 : -1;
      navItems[(activeIndex + delta + navItems.length) % navItems.length]?.click();
      handled = true;
    }
    if (!handled && Date.now() - lastGamepadAxisMove > 220) {
      const horizontal = pad.axes[0] || 0;
      const vertical = pad.axes[1] || 0;
      if (Math.abs(horizontal) > 0.58 || Math.abs(vertical) > 0.58) {
        moveSpatialFocus(Math.abs(horizontal) > Math.abs(vertical)
          ? horizontal < 0 ? "left" : "right"
          : vertical < 0 ? "up" : "down");
        lastGamepadAxisMove = Date.now();
      }
    }
    previousGamepadButtons.set(pad.index, pad.buttons.map((button) => button.pressed));
    if (handled) break;
  }
}
window.setInterval(pollGamepads, 80);
window.addEventListener("gamepadconnected", () => {
  document.body.classList.add("controller-mode");
  if (!profilePicker.hidden) profilePickerGrid.querySelector(".profile-choice")?.focus();
  else if (authScreen.style.display !== "none") authUserInput.focus();
  else document.querySelector(".nav-item.active")?.focus();
});

// --- Search ---
let searchTimer = null;
function setupSearch() {
  ensureDomRefs();
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchTimer);
      if (!q) { renderCurrentView(); return; }
      searchTimer = setTimeout(async () => {
        stage.innerHTML = '<div class="empty">Searching...</div>';
        try {
          const results = await searchTmdb(q);
          renderSearchResults(results, q);
        } catch {
          stage.innerHTML = '<div class="empty">Search failed.</div>';
        }
      }, 320);
    });
  }
}

// --- PLAY: opens dedicated BrowserWindow with the stream ---
async function handleWatchNow(item, season = 1, episode = 1, resumeAt = 0, episodeTitle = "") {
  if (!item) return;
  closeDetail();
  showToast(`Connecting to stream for "${item.title}"...`);

  try {
    let imdbId = null;

    if (window.freeflix.getImdbId) {
      imdbId = await window.freeflix.getImdbId({ tmdbId: item.tmdbId, kind: item.kind, title: item.title });
    }
    if (!imdbId && window.freeflix.imdbSearch) {
      const r = await window.freeflix.imdbSearch(item.title);
      if (r && r.length) imdbId = r[0].imdbId;
    }

    if (!imdbId) {
      alert(`Could not find an IMDb ID for "${item.title}".`);
      return;
    }

    const isSeries = item.type === "series" || item.kind === "tv";
    const streamUrl = isSeries
      ? `https://imdb.su/embed/tv/${imdbId}/${season}/${episode}`
      : `https://imdb.su/title/${imdbId}`;

    showToast(`Opening "${item.title}" in player...`);

    // Open in dedicated BrowserWindow — proper GPU acceleration, no webview scaling issues
    await window.freeflix.openStream({
      streamUrl,
      title: item.title,
      isSeries,
      tmdbId: item.tmdbId,
      kind: item.kind,
      poster: item.poster || "",
      still: item.still || "",
      year: item.year || "",
      synopsis: item.synopsis || "",
      season,
      episode,
      episodeTitle,
      resumeAt,
      profileId: currentProfile?.id || "",
    });

  } catch (err) {
    console.error("WatchNow Error:", err);
    alert("Error: " + err.message);
  }
}

// --- TRAILER: in-page iframe player (YouTube, safe) ---
async function handleWatchTrailer(item) {
  if (!item) return;
  showToast(`Loading trailer for "${item.title}"...`);
  try {
    const embedUrl = await fetchTmdbTrailer(item);
    if (!embedUrl) { alert(`No trailer found for "${item.title}".`); return; }
    openTrailerPlayer(embedUrl, item.title);
  } catch { alert("Could not load trailer."); }
}

const trailerOverlay = document.getElementById("player");

function openTrailerPlayer(embedUrl, title) {
  trailerOverlay.innerHTML = `
    <div class="player-box">
      <div class="player-viewport">
        <iframe
          src="${embedUrl}"
          allow="autoplay; encrypted-media; fullscreen"
          allowfullscreen
          style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
        ></iframe>
      </div>
      <div class="player-bar">
        <div class="player-info">
          <span class="player-badge" style="background:#ff0000;">YouTube</span>
          <span class="player-title-text">${escapeHtml(title)} · Official Trailer</span>
        </div>
        <button class="btn ghost" id="btn-close-trailer">Close</button>
      </div>
    </div>
  `;
  trailerOverlay.removeAttribute("hidden");
  document.getElementById("btn-close-trailer").onclick = closeTrailer;
}

function closeTrailer() {
  const frame = trailerOverlay.querySelector("iframe");
  if (frame) frame.src = "about:blank";
  trailerOverlay.setAttribute("hidden", "true");
  trailerOverlay.innerHTML = "";
}

trailerOverlay.addEventListener("click", (e) => { if (e.target === trailerOverlay) closeTrailer(); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!trailerOverlay.hasAttribute("hidden")) closeTrailer();
    else {
      ensureDomRefs();
      if (detail && !detail.hasAttribute("hidden")) closeDetail();
    }
  }
});

// --- Detail Modal ---
async function loadEpisodePicker(item) {
  const picker = detail.querySelector(".episode-picker");
  if (!picker) return;
  const seasonSelect = picker.querySelector("#detailSeason");
  const episodeList = picker.querySelector(".episode-list");
  const status = picker.querySelector(".episode-picker-status");
  const playButton = detail.querySelector(".btn-modal-watch");
  let episodeRequest = 0;
  playButton.disabled = true;

  try {
    const seasons = await fetchTmdbShowSeasons(item.tmdbId);
    if (!picker.isConnected) return;
    if (!seasons.length) {
      status.textContent = "No seasons are available for this show.";
      return;
    }

    seasonSelect.replaceChildren(...seasons.map((season) => {
      const option = document.createElement("option");
      option.value = String(season.number);
      option.textContent = season.name;
      return option;
    }));
    seasonSelect.disabled = false;

    const loadEpisodes = async () => {
      const request = ++episodeRequest;
      const seasonNumber = Number(seasonSelect.value);
      playButton.disabled = true;
      playButton.textContent = "Loading episodes...";
      status.textContent = `Season ${seasonNumber}`;
      episodeList.innerHTML = '<div class="episode-list-state" role="status">Loading episodes...</div>';
      try {
        const episodes = await fetchTmdbSeasonEpisodes(item.tmdbId, seasonNumber);
        if (!picker.isConnected || request !== episodeRequest) return;
        episodeList.replaceChildren();
        if (!episodes.length) {
          status.textContent = "No episodes available for this season.";
          episodeList.innerHTML = '<div class="episode-list-state">No episodes found.</div>';
          playButton.textContent = "Play Now";
          return;
        }

        picker.dataset.firstEpisode = String(episodes[0].number);
        for (const episode of episodes) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "episode-row";
          row.setAttribute("aria-label", `Play season ${seasonNumber}, episode ${episode.number}: ${episode.name}`);
          const still = episode.still
            ? `<img src="${escapeHtml(episode.still)}" alt="" loading="lazy" />`
            : `<span class="episode-art-fallback">EP ${episode.number}</span>`;
          const runtime = episode.runtime ? `<span class="episode-runtime">${episode.runtime} min</span>` : "";
          const description = episode.overview || "No episode description available.";
          row.innerHTML = `
            <span class="episode-number">${String(episode.number).padStart(2, "0")}</span>
            <span class="episode-art">${still}<span class="episode-play-icon" aria-hidden="true">▶</span></span>
            <span class="episode-copy">
              <span class="episode-title"><strong>${escapeHtml(episode.name)}</strong>${runtime}</span>
              <span class="episode-description">${escapeHtml(description)}</span>
            </span>
            <span class="episode-arrow" aria-hidden="true">›</span>
          `;
          row.addEventListener("click", () => handleWatchNow(item, seasonNumber, episode.number, 0, episode.name));
          episodeList.appendChild(row);
        }

        picker.dataset.season = String(seasonNumber);
        playButton.disabled = episodes.length === 0;
        playButton.textContent = `▶ Play S${seasonNumber}:E${episodes[0].number}`;
        status.textContent = `${episodes.length} episodes`;
        if (document.body.classList.contains("controller-mode")) seasonSelect.focus();
      } catch {
        if (request !== episodeRequest) return;
        status.textContent = "Episodes couldn't load. Select the season again to retry.";
        episodeList.innerHTML = '<div class="episode-list-state">Episodes couldn\'t load. Select the season again to retry.</div>';
        playButton.textContent = "Play Now";
      }
    };

    seasonSelect.addEventListener("change", loadEpisodes);
    await loadEpisodes();
  } catch {
    status.textContent = "Season list couldn't load. Close and reopen this show to retry.";
  }
}

function openDetail(item) {
  ensureDomRefs();
  const isSaved = myList.some(m => m.id === item.id);
  const isSeries = item.type === "series" || item.kind === "tv";
  const posterUrl = item.still || item.poster || "";
  const tagsHtml = (item.tags || []).map(t => `<span class="kicker">${escapeHtml(t)}</span>`).join(" · ");

  detail.innerHTML = `
    <div class="modal ${isSeries ? "modal-series" : ""}">
      ${posterUrl ? `<img class="banner" src="${posterUrl}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'" />` : ""}
      <div class="modal-body">
        <h2>${escapeHtml(item.title)}</h2>
        <div class="meta">
          <span>${item.year || "N/A"}</span>
          ${item.rating ? `<span> · ${item.rating}</span>` : ""}
          ${item.type ? `<span> · ${item.type.toUpperCase()}</span>` : ""}
          ${tagsHtml ? `<div style="margin-top:6px">${tagsHtml}</div>` : ""}
        </div>
        <p style="color:var(--muted);line-height:1.55;margin:14px 0 22px;max-height:130px;overflow:auto;">
          ${escapeHtml(item.synopsis)}
        </p>
        <div class="actions">
          <button class="btn primary btn-modal-watch"
            ${isSeries ? "disabled" : ""}
              >
            ▶ Play Now
          </button>
          <button class="btn ghost btn-modal-trailer">🎬 Trailer</button>
          <button class="btn ghost btn-modal-list">${isSaved ? "✓ In My List" : "+ Add to List"}</button>
          <button class="btn ghost btn-modal-close" style="margin-left:auto;">Close</button>
        </div>
        ${isSeries ? `
          <section class="episode-picker" aria-label="Episodes">
            <div class="episode-picker-heading">
              <div>
                <h3>Episodes</h3>
                <span class="episode-picker-status" role="status">Loading seasons...</span>
              </div>
              <label for="detailSeason">Season
                <select id="detailSeason" disabled><option>Loading seasons...</option></select>
              </label>
            </div>
            <div class="episode-list" aria-live="polite"></div>
          </section>
        ` : ""}
      </div>
    </div>
  `;
  detail.removeAttribute("hidden");

  detail.querySelector(".btn-modal-watch").onclick  = () => {
    const season = isSeries ? Number(detail.querySelector("#detailSeason").value) : 1;
    const episode = isSeries ? Number(detail.querySelector(".episode-picker")?.dataset.firstEpisode) || 1 : 1;
    if (isSeries && (!Number.isInteger(season) || !Number.isInteger(episode))) return;
    handleWatchNow(item, season, episode);
  };
  detail.querySelector(".btn-modal-trailer").onclick = () => handleWatchTrailer(item);
  detail.querySelector(".btn-modal-close").onclick  = closeDetail;
  if (isSeries) loadEpisodePicker(item);
  else detail.querySelector(".btn-modal-watch").focus();

  const listBtn = detail.querySelector(".btn-modal-list");
  listBtn.onclick = () => {
    const idx = myList.findIndex(m => m.id === item.id);
    if (idx >= 0) {
      myList.splice(idx, 1);
      listBtn.textContent = "+ Add to List";
      showToast("Removed from My List");
    } else {
      myList.push(item);
      listBtn.textContent = "✓ In My List";
      showToast("Added to My List");
    }
    saveMyList();
  };
}

function closeDetail() {
  ensureDomRefs();
  detail.setAttribute("hidden", "true");
  detail.innerHTML = "";
}

document.getElementById("detail").addEventListener("click", (e) => { if (e.target.id === "detail") closeDetail(); });

// --- Cards & Rows ---
function renderCard(item) {
  const div = document.createElement("div");
  div.className = "card";
  div.tabIndex = 0;
  div.setAttribute("role", "button");
  div.setAttribute("aria-label", `More information about ${item.title}`);
  const imgUrl = item.poster || item.still || "";
  div.innerHTML = `
    <div class="poster">
      ${imgUrl ? `<img src="${imgUrl}" alt="${escapeHtml(item.title)}" loading="lazy" />` : ""}
    </div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${item.year || ""} ${item.rating ? "· " + item.rating : ""}</p>
  `;
  div.onclick = () => openDetail(item);
  div.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(item);
    }
  });
  return div;
}

function renderRow(title, items) {
  if (!items || !items.length) return null;
  const section = document.createElement("section");
  section.className = "row";
  section.innerHTML = `<h2>${escapeHtml(title)}</h2>`;
  const scroller = document.createElement("div");
  scroller.className = "scroller";
  for (const item of items) scroller.appendChild(renderCard(item));
  scroller.addEventListener("wheel", (e) => {
    if (e.deltaY !== 0) { scroller.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  section.appendChild(scroller);
  return section;
}

function renderHero(item) {
  if (!item) return null;
  const bg = item.still || item.poster || "";
  const sec = document.createElement("section");
  sec.className = "hero";
  sec.innerHTML = `
    ${bg ? `<img src="${bg}" alt="${escapeHtml(item.title)}" />` : ""}
    <div class="hero-copy">
      <div class="kicker">Featured</div>
      <h1>${escapeHtml(item.title)}</h1>
      <div class="meta">
        ${item.year ? `<span>${item.year}</span>` : ""}
        ${item.rating ? `<span> · ${item.rating}</span>` : ""}
        ${item.tags && item.tags[0] ? `<span> · ${escapeHtml(item.tags[0])}</span>` : ""}
      </div>
      <div class="actions">
        <button class="btn primary btn-hero-watch"
          style="background:linear-gradient(135deg,#7c5cff,#3ee0c4);color:#fff;font-weight:700;">
          ▶ Play Now
        </button>
        <button class="btn ghost btn-hero-trailer">🎬 Trailer</button>
        <button class="btn ghost btn-hero-info">More Info</button>
      </div>
    </div>
  `;
  sec.querySelector(".btn-hero-watch").onclick  = () => {
    if (item.type === "series" || item.kind === "tv") openDetail(item);
    else handleWatchNow(item);
  };
  sec.querySelector(".btn-hero-trailer").onclick = () => handleWatchTrailer(item);
  sec.querySelector(".btn-hero-info").onclick   = () => openDetail(item);
  return sec;
}

// --- Views ---
function renderHome() {
  ensureDomRefs();
  stage.innerHTML = "";
  if (!catalog.length) { stage.innerHTML = '<div class="empty">No catalog loaded.</div>'; return; }
  const hero = catalog.find(i => i.featured) || catalog[0];
  if (hero) stage.appendChild(renderHero(hero));
  const resumeRow = renderContinueWatchingRow();
  if (resumeRow) stage.appendChild(resumeRow);
  [
    ["Trending This Week",   catalog.filter(i => i.rows?.includes("trending"))],
    ["Popular Movies",       catalog.filter(i => i.type === "movie" && i.rows?.includes("popular"))],
    ["Popular Series",       catalog.filter(i => i.type === "series" && i.rows?.includes("popular"))],
    ["Now Playing / On Air", catalog.filter(i => i.rows?.includes("now"))],
    ["Top Rated",            catalog.filter(i => i.rows?.includes("top"))],
    ["Upcoming",             catalog.filter(i => i.rows?.includes("upcoming"))],
  ].forEach(([title, items]) => { const r = renderRow(title, items); if (r) stage.appendChild(r); });
}

function renderMoviesView() {
  ensureDomRefs();
  stage.innerHTML = "";
  const movies = catalog.filter(i => i.type === "movie");
  if (movies[0]) stage.appendChild(renderHero(movies[0]));
  [
    ["Popular Movies",    movies.filter(i => i.rows?.includes("popular"))],
    ["In Theaters",       movies.filter(i => i.rows?.includes("now"))],
    ["Top Rated",         movies.filter(i => i.rows?.includes("top"))],
    ["Coming Soon",       movies.filter(i => i.rows?.includes("upcoming"))],
  ].forEach(([t, items]) => { const r = renderRow(t, items); if (r) stage.appendChild(r); });
}

function renderSeriesView() {
  ensureDomRefs();
  stage.innerHTML = "";
  const series = catalog.filter(i => i.type === "series");
  if (series[0]) stage.appendChild(renderHero(series[0]));
  [
    ["Popular Series",   series.filter(i => i.rows?.includes("popular"))],
    ["Airing Now",       series.filter(i => i.rows?.includes("now"))],
    ["Top Rated",        series.filter(i => i.rows?.includes("top"))],
  ].forEach(([t, items]) => { const r = renderRow(t, items); if (r) stage.appendChild(r); });
}

function renderNewView() {
  ensureDomRefs();
  stage.innerHTML = "";
  const items = catalog.filter(i => i.new || i.rows?.includes("upcoming"));
  if (items[0]) stage.appendChild(renderHero(items[0]));
  const r = renderRow("Fresh & Upcoming", items);
  if (r) stage.appendChild(r);
}

function renderMyListView() {
  ensureDomRefs();
  stage.innerHTML = "";
  if (!myList.length) {
    stage.innerHTML = `
      <div class="empty" style="text-align:center;padding:80px 20px;">
        <h2 style="font-size:24px;margin-bottom:8px;">Your Watchlist is Empty</h2>
        <p style="color:var(--muted);">Click "+ Add to List" on any movie or series.</p>
      </div>`;
    return;
  }
  const r = renderRow("My List", myList);
  if (r) stage.appendChild(r);
}

function renderSearchResults(items, query) {
  ensureDomRefs();
  stage.innerHTML = "";
  if (!items.length) {
    stage.innerHTML = `<div class="empty">No results for "${escapeHtml(query)}"</div>`;
    return;
  }
  const section = document.createElement("section");
  section.className = "row";
  section.innerHTML = `<h2>Results for "${escapeHtml(query)}" (${items.length})</h2>`;
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;padding:10px 0;";
  for (const item of items) grid.appendChild(renderCard(item));
  section.appendChild(grid);
  stage.appendChild(section);
}

function renderCurrentView() {
  switch (currentView) {
    case "movies":  renderMoviesView(); break;
    case "series":  renderSeriesView(); break;
    case "new":     renderNewView();    break;
    case "list":    renderMyListView(); break;
    default:        renderHome();       break;
  }
}

// --- Toast ---
function showToast(msg) {
  let t = document.getElementById("ff-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "ff-toast";
    Object.assign(t.style, {
      position: "fixed", bottom: "24px", right: "24px",
      background: "rgba(22,22,28,0.92)", backdropFilter: "blur(16px)",
      border: "1px solid rgba(255,255,255,0.2)", padding: "12px 20px",
      borderRadius: "14px", color: "#fff", fontSize: "13px", fontWeight: "500",
      boxShadow: "0 10px 30px rgba(0,0,0,0.5)", zIndex: "9999",
      transition: "all 0.3s ease",
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  t.style.transform = "translateY(0)";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(8px)";
  }, 3000);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showCatalogSplash() {
  const splash = document.getElementById("catalogSplash");
  clearTimeout(catalogSplashDismissTimer);
  splash.classList.remove("is-leaving");
  splash.hidden = false;
}

function hideCatalogSplash() {
  const splash = document.getElementById("catalogSplash");
  splash.classList.add("is-leaving");
  catalogSplashDismissTimer = setTimeout(() => {
    splash.hidden = true;
    splash.classList.remove("is-leaving");
  }, 560);
}

// --- Boot ---
async function init() {
  ensureDomRefs();
  setupSearch();
  showCatalogSplash();
  let catalogTimeout;
  try {
    const catalogRequest = fetchTmdbCatalog();
    const catalogDeadline = new Promise((_, reject) => {
      catalogTimeout = setTimeout(() => {
        reject(new Error("The catalog is taking too long to load. Check your connection and retry."));
      }, 25000);
    });
    catalog = await Promise.race([catalogRequest, catalogDeadline]);
    if (!catalog.length) {
      throw new Error("The catalog service returned no titles. Check your connection and retry.");
    }
    renderCurrentView();
    hideCatalogSplash();
  } catch (err) {
    stage.innerHTML = `
      <div class="empty" style="text-align:center;padding:80px 20px;">
        <h2 style="font-size:22px;color:var(--danger);margin-bottom:8px;">Load Failed</h2>
        <p style="color:var(--muted);margin-bottom:16px;">${escapeHtml(err.message)}</p>
        <button class="btn primary" onclick="init()">Retry</button>
      </div>`;
    hideCatalogSplash();
  } finally {
    clearTimeout(catalogTimeout);
  }
}
