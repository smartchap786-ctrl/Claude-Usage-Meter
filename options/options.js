// options.js (v1.4)

const SCOPES = ["session", "weekly"];

let state = {
  sessionThresholds: [],
  weeklyThresholds:  [],
  notificationsEnabled: true,
  pollMinutes: 1
};

async function load() {
  const { settings } = await chrome.runtime.sendMessage({ type: "get-state" });
  state.sessionThresholds = settings.sessionThresholds || [];
  state.weeklyThresholds  = settings.weeklyThresholds  || [];
  state.notificationsEnabled = settings.notificationsEnabled !== false;
  state.pollMinutes = settings.pollMinutes || 1;
  document.getElementById("notifications-enabled").checked = state.notificationsEnabled;
  document.getElementById("poll-minutes").value = state.pollMinutes;
  renderAll();
}

function renderAll() {
  for (const scope of SCOPES) {
    renderChips(`${scope}-grid`, state[`${scope}Thresholds`], scope);
  }
}

function renderChips(containerId, list, scope) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (const value of [...list].sort((a, b) => a - b)) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${value}%</span>`;
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", `Remove ${value}%`);
    btn.textContent = "×";
    btn.addEventListener("click", () => {
      const i = list.indexOf(value);
      if (i > -1) list.splice(i, 1);
      renderChips(containerId, list, scope);
    });
    chip.appendChild(btn);
    container.appendChild(chip);
  }
}

function addThreshold(scope) {
  const input = document.getElementById(`${scope}-input`);
  const raw = parseInt(input.value, 10);
  if (isNaN(raw) || raw < 1 || raw > 100) { input.focus(); return; }
  const list = state[`${scope}Thresholds`];
  if (!list.includes(raw)) list.push(raw);
  input.value = "";
  renderChips(`${scope}-grid`, list, scope);
}

async function save() {
  state.notificationsEnabled = document.getElementById("notifications-enabled").checked;
  const pm = parseInt(document.getElementById("poll-minutes").value, 10);
  state.pollMinutes = isNaN(pm) ? 1 : Math.max(1, Math.min(60, pm));
  document.getElementById("poll-minutes").value = state.pollMinutes;
  await chrome.runtime.sendMessage({
    type: "save-settings",
    settings: {
      sessionThresholds: state.sessionThresholds,
      weeklyThresholds:  state.weeklyThresholds,
      notificationsEnabled: state.notificationsEnabled,
      pollMinutes: state.pollMinutes
    }
  });
  const msg = document.getElementById("saved-msg");
  msg.classList.add("visible");
  setTimeout(() => msg.classList.remove("visible"), 1600);
}

for (const scope of SCOPES) {
  document.getElementById(`${scope}-add`).addEventListener("click", () => addThreshold(scope));
  document.getElementById(`${scope}-input`).addEventListener("keydown", (e) => {
    if (e.key === "Enter") addThreshold(scope);
  });
}
document.getElementById("save").addEventListener("click", save);

load();
