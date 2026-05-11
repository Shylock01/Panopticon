// ============================================================
// store.js — Panopticon State Management (global namespace)
// ============================================================
window.Store = (() => {

  const KEYS = {
    LINKED_APPS: 'panopticon_linked_apps',
    GITHUB_TOKEN: 'panopticon_github_token',
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

  return { getToken, saveToken, clearToken, getLinkedApps, isLinked, linkApp, unlinkApp, updateAppIcon, updateAppDescription };
})();
