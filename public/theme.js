// FILE: public/theme.js
// Shared dark/light theme toggle — include on every page before </head>
(function () {
    const KEY = 'nt-theme';
  
    function apply(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(KEY, theme);
      syncButtons(theme);
    }
  
    function syncButtons(theme) {
      const isDark = theme === 'dark';
      document.querySelectorAll('[data-theme-btn]').forEach(btn => {
        btn.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
        btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      });
      // Also handle the browse page button
      const b = document.getElementById('theme-btn');
      if (b) { b.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19'; }
    }
  
    function toggle() {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      apply(cur === 'dark' ? 'light' : 'dark');
    }
  
    // Apply immediately on load (prevent flash)
    const saved = localStorage.getItem(KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  
    // After DOM ready, sync button icons
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => syncButtons(saved));
    } else {
      syncButtons(saved);
    }
  
    window.NTTheme = { toggle, apply, sync: syncButtons };
  })();