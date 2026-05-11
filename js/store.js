// ============================================================
// store.js — Panopticon State Management (global namespace)
// ============================================================
window.Store = (() => {

  const KEYS = {
    LINKED_APPS: 'panopticon_linked_apps',
    GITHUB_TOKEN: 'panopticon_github_token',
    ZOOM_STATE: 'panopticon_zoom_state',
  };

  // --- Token ----------------------------------------------------------------
  function getToken()        { return localStorage.getItem(KEYS.GITHUB_TOKEN) || ''; }
  function saveToken(token)  { localStorage.setItem(KEYS.GITHUB_TOKEN, token.trim()); }
  function clearToken()      { localStorage.removeItem(KEYS.GITHUB_TOKEN); }

  // --- Linked Apps ----------------------------------------------------------
  function getLinkedApps() {
    try { return JSON.parse(localStorage.getItem(KEYS.LINKED_APPS)) || []; }
    catch { return []; }
  }

  function isLinked(repoName) {
    return getLinkedApps().some(a => a.repoName === repoName);
  }

  function linkApp(entry) {
    const apps = getLinkedApps().filter(a => a.repoName !== entry.repoName);
    apps.push(entry);
    localStorage.setItem(KEYS.LINKED_APPS, JSON.stringify(apps));
  }

  function unlinkApp(repoName) {
    const apps = getLinkedApps().filter(a => a.repoName !== repoName);
    localStorage.setItem(KEYS.LINKED_APPS, JSON.stringify(apps));
  }

  function updateAppIcon(repoName, iconDataUrl) {
    const apps = getLinkedApps().map(a =>
      a.repoName === repoName ? { ...a, iconDataUrl } : a
    );
    localStorage.setItem(KEYS.LINKED_APPS, JSON.stringify(apps));
  }

  function updateAppDescription(repoName, description) {
    const apps = getLinkedApps().map(a =>
      a.repoName === repoName ? { ...a, description } : a
    );
    localStorage.setItem(KEYS.LINKED_APPS, JSON.stringify(apps));
  }

  // --- Zoom Persistence -----------------------------------------------------
  function getZoom() {
    try { return JSON.parse(localStorage.getItem(KEYS.ZOOM_STATE)) || null; }
    catch { return null; }
  }

  function saveZoom(zoom) {
    localStorage.setItem(KEYS.ZOOM_STATE, JSON.stringify(zoom));
  }

  return { 
    getToken, saveToken, clearToken, 
    getLinkedApps, isLinked, linkApp, unlinkApp, 
    updateAppIcon, updateAppDescription,
    getZoom, saveZoom 
  };
})();
