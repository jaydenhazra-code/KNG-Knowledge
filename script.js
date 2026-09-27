document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  // Hide the loading screen so the dashboard can appear
  const loader = $("siteLoader");
  if (loader) {
    setTimeout(() => {
      loader.classList.add("hidden");
      loader.style.display = "none";
    }, 800);
  }

  // Dashboard navigation
  const navButtons = document.querySelectorAll(".nav-btn");
  const pages = document.querySelectorAll(".page");
  const crumb = $("crumb");

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const sectionId = button.dataset.section;

      navButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      pages.forEach((page) => {
        page.classList.toggle("active", page.id === sectionId);
      });

      if (crumb) {
        crumb.textContent = button.querySelector("span:nth-child(2)")?.textContent || "Dashboard";
      }

      closeSidebar();
    });
  });

  // Sidebar for mobile
  const sidebar = $("sidebar");
  const overlay = $("mobileOverlay");

  function openSidebar() {
    sidebar?.classList.add("open");
    overlay?.classList.add("active");
  }

  function closeSidebar() {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("active");
  }

  $("openSidebar")?.addEventListener("click", openSidebar);
  $("closeSidebar")?.addEventListener("click", closeSidebar);
  overlay?.addEventListener("click", closeSidebar);

  // Theme toggle
  function toggleTheme() {
    const isLight = document.body.classList.toggle("light-mode");
    const label = $("themeLabel");
    const profileLabel = $("profileThemeText");

    if (label) label.textContent = isLight ? "Light" : "Dark";
    if (profileLabel) profileLabel.textContent = isLight ? "Light mode" : "Dark mode";

    localStorage.setItem("kt-theme", isLight ? "light" : "dark");
  }

  if (localStorage.getItem("kt-theme") === "light") {
    document.body.classList.add("light-mode");
    if ($("themeLabel")) $("themeLabel").textContent = "Light";
  }

  $("themeToggle")?.addEventListener("click", toggleTheme);
  $("profileThemeToggle")?.addEventListener("click", toggleTheme);

  // Load stats from the server
  async function loadStats() {
    const status = $("appySyncStatus");
    const livePill = $("livePill");

    try {
      if (status) status.textContent = "Appy Live • connecting to Discord…";

      const response = await fetch("/api/stats", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      const stats = data.stats || data;

      const total = Number(stats.total ?? stats.applications ?? 0);
      const accepted = Number(stats.accepted ?? 0);
      const denied = Number(stats.denied ?? stats.rejected ?? 0);
      const pending = Number(stats.pending ?? 0);
      const decided = accepted + denied;

      if ($("applicationsMonth")) $("applicationsMonth").textContent = total.toLocaleString();
      if ($("applicationsWeek")) $("applicationsWeek").textContent = `${total.toLocaleString()} total`;
      if ($("accepted")) $("accepted").textContent = accepted.toLocaleString();
      if ($("rejected")) $("rejected").textContent = denied.toLocaleString();
      if ($("trainingCount")) $("trainingCount").textContent = pending.toLocaleString();

      if ($("acceptRate")) {
        $("acceptRate").textContent = decided ? `${Math.round((accepted / decided) * 100)}%` : "0%";
      }

      if ($("rejectRate")) {
        $("rejectRate").textContent = decided ? `${Math.round((denied / decided) * 100)}%` : "0%";
      }

      if (status) status.textContent = "Appy Live • connected";
      if (livePill) livePill.style.display = "inline-flex";
    } catch (error) {
      console.error("Could not load dashboard stats:", error);

      if (status) status.textContent = "Appy Live • unable to connect";
      if (livePill) livePill.style.opacity = "0.5";
    }
  }

  $("refreshBtn")?.addEventListener("click", loadStats);

  // Profile name
  const savedName = localStorage.getItem("kt-profile-name") || "Team Admin";

  function updateProfileName(name) {
    ["profileFabName", "profileMenuName"].forEach((id) => {
      if ($(id)) $(id).textContent = name;
    });

    if ($("profileMenuAvatar")) {
      $("profileMenuAvatar").textContent = name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    }
  }

  updateProfileName(savedName);

  $("saveProfileName")?.addEventListener("click", () => {
    const input = $("profileNameInput");
    const name = input?.value.trim();

    if (!name) return;

    localStorage.setItem("kt-profile-name", name);
    updateProfileName(name);

    const menu = $("profileMenu");
    menu?.classList.add("hidden");
  });

  // Profile menu
  $("profileFab")?.addEventListener("click", () => {
    const menu = $("profileMenu");
    menu?.classList.toggle("hidden");
  });

  // Initial data load
  loadStats();
});