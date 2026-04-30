 const THEME_STORAGE_KEY = "multidrive-theme";
      function applyTheme(theme) {
        const useDark = theme === "dark";
        document.body.classList.toggle("darkMode", useDark);
        const btn = document.getElementById("themeSwitchBtn");
        const icon = document.getElementById("themeSwitchIcon");
        if (!btn || !icon) return;
        if (useDark) {
          icon.textContent = "light_mode";
          btn.setAttribute("aria-label", "Switch to light mode");
          btn.setAttribute("title", "Switch to light mode");
        } else {
          icon.textContent = "dark_mode";
          btn.setAttribute("aria-label", "Switch to dark mode");
          btn.setAttribute("title", "Switch to dark mode");
        }
      }
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      applyTheme(savedTheme === "dark" ? "dark" : "light");
      document
        .getElementById("themeSwitchBtn")
        .addEventListener("click", function () {
          const next = document.body.classList.contains("darkMode")
            ? "light"
            : "dark";
          localStorage.setItem(THEME_STORAGE_KEY, next);
          applyTheme(next);
        });