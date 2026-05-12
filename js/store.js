// ============================================================
// store.js — Panopticon State Management (IndexedDB)
// ============================================================
window.Store = (() => {

  const DB_NAME = 'PanopticonDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'kv';

  let _db = null;

  // --- DB Helper ---
  async function getDB() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = async (e) => {
        _db = e.target.result;
        // Migration check
        const migratedKey = 'panopticon_idb_migrated';
        if (!localStorage.getItem(migratedKey)) {
          console.log('Migrating localStorage to IndexedDB...');
          try {
            const apps = JSON.parse(localStorage.getItem('panopticon_linked_apps')) || [];
            const zoom = JSON.parse(localStorage.getItem('panopticon_zoom_state'));
            const tx = _db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            if (apps.length > 0) store.put(apps, 'linked_apps');
            if (zoom) store.put(zoom, 'zoom_state');
            localStorage.setItem(migratedKey, 'true');
            tx.oncomplete = () => resolve(_db);
            tx.onerror = () => resolve(_db);
          } catch (err) {
            console.error('Migration failed:', err);
            resolve(_db);
          }
        } else {
          resolve(_db);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function get(key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function set(key, val) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = val === null ? store.delete(key) : store.put(val, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Token ----------------------------------------------------------------
  function getToken()        { return localStorage.getItem('panopticon_github_token') || ''; }
  function saveToken(token)  { localStorage.setItem('panopticon_github_token', token.trim()); }
  function clearToken()      { localStorage.removeItem('panopticon_github_token'); }

  // --- Linked Apps ----------------------------------------------------------
  async function getLinkedApps() {
    return (await get('linked_apps')) || [];
  }

  async function isLinked(repoName) {
    const apps = await getLinkedApps();
    return apps.some(a => a.repoName === repoName);
  }

  async function linkApp(entry) {
    const apps = (await getLinkedApps()).filter(a => a.repoName !== entry.repoName);
    apps.push(entry);
    await set('linked_apps', apps);
  }

  async function unlinkApp(repoName) {
    const apps = (await getLinkedApps()).filter(a => a.repoName !== repoName);
    await set('linked_apps', apps);
    // Also clean up state
    await set(`state_${repoName}`, null);
  }

  async function updateAppIcon(repoName, iconDataUrl) {
    const apps = (await getLinkedApps()).map(a =>
      a.repoName === repoName ? { ...a, iconDataUrl } : a
    );
    await set('linked_apps', apps);
  }

  async function updateAppDescription(repoName, description) {
    const apps = (await getLinkedApps()).map(a =>
      a.repoName === repoName ? { ...a, description } : a
    );
    await set('linked_apps', apps);
  }

  // --- App State Persistence (The "Sync" Feature) ---------------------------
  async function getAppState(repoName) {
    return await get(`state_${repoName}`);
  }

  async function setAppState(repoName, data) {
    await set(`state_${repoName}`, data);
  }

  // --- Zoom Persistence -----------------------------------------------------
  async function getZoom() {
    return (await get('zoom_state')) || null;
  }

  async function saveZoom(zoom) {
    await set('zoom_state', zoom);
  }

  return { 
    getToken, saveToken, clearToken, 
    getLinkedApps, isLinked, linkApp, unlinkApp, 
    updateAppIcon, updateAppDescription,
    getAppState, setAppState,
    getZoom, saveZoom 
  };
})();
