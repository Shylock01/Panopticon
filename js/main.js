// ============================================================
// main.js — Panopticon Bootstrap & UI Wiring (no ES modules)
// Depends on: window.Store, window.GH, window.PanopticonSphere
// ============================================================

(function () {

  // ─── State ──────────────────────────────────────────────────────────────
  let sphere        = null;
  let cachedRepos   = [];
  let activePopupApp = null;
  let currentShellApp = null;

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const canvas         = document.getElementById('sphere-canvas');
  const tokenScreen    = document.getElementById('token-screen');
  const tokenInput     = document.getElementById('token-input');
  const tokenSaveBtn   = document.getElementById('token-save-btn');
  const tokenToggle    = document.getElementById('token-toggle');
  const tokenCloseBtn  = document.getElementById('token-close-btn');
  const settingsBtn    = document.getElementById('settings-btn');
  const addAppBtn      = document.getElementById('add-app-btn');
  const repoDrawer     = document.getElementById('repo-drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerCloseBtn = document.getElementById('drawer-close-btn');
  const repoSearch     = document.getElementById('repo-search');
  const repoList       = document.getElementById('repo-list');
  const repoLoading    = document.getElementById('repo-loading');
  const repoEmpty      = document.getElementById('repo-empty');
  const nodePopup      = document.getElementById('node-popup');
  const popupIcon      = document.getElementById('popup-icon');
  const popupName      = document.getElementById('popup-app-name');
  const popupDesc      = document.getElementById('popup-app-desc');
  const popupLaunch    = document.getElementById('popup-launch-btn');
  const popupUnlink    = document.getElementById('popup-unlink-btn');
  const popupClose     = document.getElementById('popup-close-btn');
  const popupEditTrigger = document.getElementById('popup-edit-trigger');
  const popupEditActions = document.getElementById('popup-edit-actions');
  const popupDescView    = document.getElementById('popup-desc-view');
  const popupDescEditWrap= document.getElementById('popup-desc-edit-wrap');
  const popupSaveBtn     = document.getElementById('popup-save-btn');
  const popupDescEdit    = document.getElementById('popup-app-desc-edit');
  const popupIconEditBtn = document.getElementById('popup-icon-edit-btn');
  const popupIconInput   = document.getElementById('popup-icon-input');
  const popupBgMgmt      = document.getElementById('popup-bg-mgmt');
  const popupResumeBtn   = document.getElementById('popup-resume-btn');
  const popupTerminateBtn= document.getElementById('popup-terminate-btn');
  const toastContainer = document.getElementById('toast-container');
  const appShell       = document.getElementById('app-shell');
  const appFrame       = document.getElementById('app-frame');
  const shellTab           = document.getElementById('shell-tab');
  const shellControls      = document.getElementById('shell-controls');
  const shellBackgroundBtn = document.getElementById('shell-background-btn');
  const shellCloseBtn      = document.getElementById('shell-close-btn');
  const appResetBtn    = document.getElementById('app-reset-btn');
  const settingsBadge  = document.getElementById('settings-badge');
  const badgeTabLink   = document.getElementById('badge-tab-link');
  const badgeTabLogin  = document.getElementById('badge-tab-login');
  const badgeTabSystem = document.getElementById('badge-tab-system');

  const backgroundApps = new Set(); // repoNames

  // ─── Settings Tabs ────────────────────────────────────────────────────────
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const targetId = btn.dataset.tab;
      document.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');

      // Clear badges for the visited tab
      if (targetId === 'settings-tab-connect') badgeTabLink.setAttribute('hidden', '');
      if (targetId === 'settings-tab-cloud')   badgeTabLogin.setAttribute('hidden', '');
      if (targetId === 'settings-tab-system')  badgeTabSystem.setAttribute('hidden', '');
      checkGlobalBadge();
    });
  });

  function checkGlobalBadge() {
    const anyTabBadge = !badgeTabLink.hasAttribute('hidden') || 
                        !badgeTabLogin.hasAttribute('hidden') || 
                        !badgeTabSystem.hasAttribute('hidden');
    if (!anyTabBadge) settingsBadge.setAttribute('hidden', '');
  }

  // ─── Badge API ─────────────────────────────────────────────────────────────
  function setTabBadge(tabId, visible) {
    let badge;
    if (tabId === 'settings-tab-connect') badge = badgeTabLink;
    if (tabId === 'settings-tab-cloud')   badge = badgeTabLogin;
    if (tabId === 'settings-tab-system')  badge = badgeTabSystem;

    if (!badge) return;

    if (visible) {
      badge.removeAttribute('hidden');
      settingsBadge.removeAttribute('hidden');
    } else {
      badge.setAttribute('hidden', '');
      checkGlobalBadge();
    }
  }

  window.Main = {
    setTabBadge
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────
  async function boot() {
    const token = Store.getToken();
    if (!token) {
      showTokenScreen();
      setTabBadge('settings-tab-connect', true);
    } else {
      hideTokenScreen();
      await initSphere();
    }
  }

  async function initSphere() {
    try {
      if (sphere) sphere.destroy();
      sphere = new PanopticonSphere(canvas, showNodePopup);
      const apps = await Store.getLinkedApps();
      apps.forEach(app => sphere.addNode(app));
      // Start camera facing the most recently added app
      if (apps.length > 0) {
        sphere.focusNode(apps[apps.length - 1].repoName);
      }
    } catch (e) {
      console.error('Sphere init failed:', e);
      showToast('3D engine error: ' + e.message, 'error');
    }
  }

  // ─── Token screen ────────────────────────────────────────────────────────
  function showTokenScreen() {
    tokenScreen.removeAttribute('hidden');
    requestAnimationFrame(() => tokenScreen.classList.add('visible'));
  }
  function hideTokenScreen() {
    tokenScreen.classList.remove('visible');
    setTimeout(() => tokenScreen.setAttribute('hidden', ''), 400);
  }

  tokenSaveBtn.addEventListener('click', async () => {
    const val = tokenInput.value.trim();
    if (!val) { showToast('Please enter a token.', 'error'); return; }
    tokenSaveBtn.disabled = true;
    tokenSaveBtn.textContent = 'Verifying…';
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${val}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `GitHub returned ${res.status}`);
      }
      Store.saveToken(val);
      if (window.Auth) window.Auth.syncToken(val);
      hideTokenScreen();
      if (!sphere) await initSphere();
      showToast('GitHub connected! ✓', 'success');
    } catch (e) {
      if (e.message.includes('fetch') || e.message.includes('network') || e.message.includes('Failed')) {
        showToast('Network error — check your internet connection.', 'error');
      } else {
        showToast(`GitHub error: ${e.message}`, 'error');
      }
    } finally {
      tokenSaveBtn.disabled = false;
      tokenSaveBtn.textContent = 'Connect GitHub';
    }
  });

  tokenToggle.addEventListener('click', () => {
    const show = tokenInput.type === 'password';
    tokenInput.type = show ? 'text' : 'password';
    tokenToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
  });

  tokenCloseBtn.addEventListener('click', hideTokenScreen);

  settingsBtn.addEventListener('click', () => {
    tokenInput.value = Store.getToken();
    showTokenScreen();
  });

  // ─── Repo drawer ──────────────────────────────────────────────────────────
  addAppBtn.addEventListener('click', openDrawer);
  drawerCloseBtn.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);

  function openDrawer() {
    repoDrawer.removeAttribute('hidden');
    requestAnimationFrame(() => repoDrawer.classList.add('open'));
    loadRepos();
  }
  function closeDrawer() {
    repoDrawer.classList.remove('open');
    setTimeout(() => repoDrawer.setAttribute('hidden', ''), 350);
  }

  async function loadRepos() {
    const token = Store.getToken();
    if (!token) { showToast('Connect GitHub first — click ⚙ in the top right.', 'error'); return; }

    repoLoading.removeAttribute('hidden');
    repoList.innerHTML = '';
    repoEmpty.setAttribute('hidden', '');

    try {
      cachedRepos = await GH.fetchRepos(token);
      await renderRepoList(cachedRepos);
    } catch (e) {
      showToast(e.message || 'Failed to load repos.', 'error');
      repoLoading.setAttribute('hidden', '');
    }
  }

  async function renderRepoList(repos) {
    repoLoading.setAttribute('hidden', '');
    repoList.innerHTML = '';

    const q = repoSearch.value.toLowerCase();
    const filtered = repos.filter(r => r.repoName.toLowerCase().includes(q));

    if (!filtered.length) { repoEmpty.removeAttribute('hidden'); return; }
    repoEmpty.setAttribute('hidden', '');

    for (const repo of filtered) {
      const linked = await Store.isLinked(repo.repoName);
      const item = document.createElement('div');
      item.className = 'repo-item' + (linked ? ' repo-item--linked' : '');
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <div class="repo-item-info">
          <span class="repo-item-name">${esc(repo.repoName)}</span>
          ${repo.isPrivate ? '<span class="repo-badge">Private</span>' : ''}
          ${repo.description ? `<span class="repo-item-desc">${esc(repo.description)}</span>` : ''}
        </div>
        <button class="btn ${linked ? 'btn-linked' : 'btn-link-repo'}" data-repo="${esc(repo.repoName)}"
                aria-label="${linked ? 'Unlink' : 'Link'} ${esc(repo.repoName)}">
          ${linked ? '✓ Linked' : '+ Link'}
        </button>`;
      item.querySelector('button').addEventListener('click', () => handleLink(repo, item));
      repoList.appendChild(item);
    }
  }

  async function handleLink(repo, itemEl) {
    if (await Store.isLinked(repo.repoName)) {
      showToast(`${repo.repoName} is already linked.`, 'info');
      return;
    }
    const btn = itemEl.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Linking…';

    const { dataUrl, color } = GH.generateLetterIcon(repo.repoName);
    const entry = {
      repoName:    repo.repoName,
      pagesUrl:    repo.pagesUrl,
      description: repo.description,
      iconDataUrl: dataUrl,
      iconColor:   color,
    };

    await Store.linkApp(entry);
    sphere?.addNode(entry);
    closeDrawer();
    showToast(`${repo.repoName} added to the sphere!`, 'success');

    // Sync to cloud
    if (window.Auth) window.Auth.syncAll();

    GH.fetchFavicon(repo.pagesUrl).then(async favUrl => {
      if (favUrl) {
        await Store.updateAppIcon(repo.repoName, favUrl);
        sphere?.updateNodeIcon(repo.repoName, favUrl);
        if (window.Auth) window.Auth.syncAll();
      }
    }).catch(() => {});
  }

  repoSearch.addEventListener('input', () => renderRepoList(cachedRepos));

  // ─── Node popup ───────────────────────────────────────────────────────────
  async function showNodePopup(appEntry) {
    activePopupApp = appEntry;
    popupIcon.src              = appEntry.iconDataUrl;
    popupIcon.alt              = appEntry.repoName;
    popupName.textContent      = appEntry.repoName;
    popupDesc.textContent      = appEntry.description || 'No description provided.';
    popupLaunch.href           = appEntry.pagesUrl;
    popupUnlink.classList.remove('btn-danger-confirm');

    exitEditMode();

    if (backgroundApps.has(appEntry.repoName)) {
      popupLaunch.setAttribute('hidden', '');
      popupBgMgmt.removeAttribute('hidden');
      popupResumeBtn.href = appEntry.pagesUrl;
    } else {
      popupLaunch.removeAttribute('hidden');
      popupBgMgmt.setAttribute('hidden', '');
      popupLaunch.classList.add('btn-primary');
      popupLaunch.classList.remove('btn-success');
      popupLaunch.textContent = 'Launch App';
    }

    nodePopup.removeAttribute('hidden');
    requestAnimationFrame(() => nodePopup.classList.add('visible'));

    if (sphere) sphere.setFocusedNode(appEntry.repoName);
  }

  function hideNodePopup() {
    nodePopup.classList.remove('visible');
    setTimeout(() => nodePopup.setAttribute('hidden', ''), 300);
    activePopupApp = null;
    if (sphere) sphere.clearFocusedNode();
  }

  popupClose.addEventListener('click', hideNodePopup);
  
  popupLaunch.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activePopupApp) return;
    currentShellApp = activePopupApp;
    if (!backgroundApps.has(currentShellApp.repoName)) {
      appFrame.src = currentShellApp.pagesUrl;
    }
    appShell.removeAttribute('hidden');
    appShell.classList.remove('app-shell--hiding');
    shellControls.setAttribute('hidden', '');
    hideNodePopup();
  });

  popupResumeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activePopupApp) return;
    currentShellApp = activePopupApp;
    appShell.removeAttribute('hidden');
    appShell.classList.remove('app-shell--hiding');
    shellControls.setAttribute('hidden', '');
    hideNodePopup();
  });

  popupTerminateBtn.addEventListener('click', () => {
    if (!activePopupApp) return;
    const repo = activePopupApp.repoName;
    backgroundApps.delete(repo);
    sphere?.setNodeBackground(repo, false);
    appFrame.src = 'about:blank';
    currentShellApp = null;
    hideNodePopup();
    showToast(`${repo} closed.`, 'info');
  });

  shellTab.addEventListener('click', () => {
    const isHidden = shellControls.hasAttribute('hidden');
    if (isHidden) {
      shellControls.removeAttribute('hidden');
      shellTab.setAttribute('aria-expanded', 'true');
    } else {
      shellControls.setAttribute('hidden', '');
      shellTab.setAttribute('aria-expanded', 'false');
    }
  });

  shellBackgroundBtn.addEventListener('click', () => {
    if (!currentShellApp) return;
    const repo = currentShellApp.repoName;
    backgroundApps.add(repo);
    sphere?.setNodeBackground(repo, true);
    appShell.classList.add('app-shell--hiding');
    setTimeout(() => {
      appShell.setAttribute('hidden', '');
      appShell.classList.remove('app-shell--hiding');
      currentShellApp = null;
    }, 400);
    showToast(`${repo} is backgrounded.`, 'success');
  });

  shellCloseBtn.addEventListener('click', () => {
    if (!currentShellApp) return;
    const repo = currentShellApp.repoName;
    backgroundApps.delete(repo);
    sphere?.setNodeBackground(repo, false);
    appShell.classList.add('app-shell--hiding');
    setTimeout(() => {
      appShell.setAttribute('hidden', '');
      appShell.classList.remove('app-shell--hiding');
      appFrame.src = 'about:blank';
      currentShellApp = null;
    }, 400);
    showToast(`${repo} closed.`, 'info');
  });

  popupUnlink.addEventListener('click', async () => {
    if (popupUnlink.dataset.state === 'idle') {
      popupUnlink.dataset.state = 'confirm';
      popupUnlink.textContent   = 'Confirm Unlink?';
      popupUnlink.classList.add('btn-danger-confirm');
      setTimeout(() => {
        if (popupUnlink.dataset.state === 'confirm') {
          popupUnlink.dataset.state = 'idle';
          popupUnlink.textContent   = 'Unlink';
          popupUnlink.classList.remove('btn-danger-confirm');
        }
      }, 4000);
    } else if (activePopupApp) {
      const name = activePopupApp.repoName;
      await Store.unlinkApp(name);
      sphere?.removeNode(name);
      hideNodePopup();
      showToast(`${name} unlinked.`, 'info');
      if (window.Auth) window.Auth.syncAll();
    }
  });

  function enterEditMode() {
    nodePopup.classList.add('node-popup--editing');
    popupEditTrigger.setAttribute('hidden', '');
    popupLaunch.setAttribute('hidden', '');
    popupDescView.setAttribute('hidden', '');
    popupDescEditWrap.removeAttribute('hidden');
    popupEditActions.removeAttribute('hidden');
    popupIconEditBtn.removeAttribute('hidden');
    popupDescEdit.value = activePopupApp?.description || '';
  }

  function exitEditMode() {
    nodePopup.classList.remove('node-popup--editing');
    popupEditTrigger.removeAttribute('hidden');
    popupLaunch.removeAttribute('hidden');
    popupDescView.removeAttribute('hidden');
    popupDescEditWrap.setAttribute('hidden', '');
    popupEditActions.setAttribute('hidden', '');
    popupIconEditBtn.setAttribute('hidden', '');
  }

  popupEditTrigger.addEventListener('click', enterEditMode);

  popupSaveBtn.addEventListener('click', async () => {
    if (!activePopupApp) return;
    const newDesc = popupDescEdit.value.trim();
    await Store.updateAppDescription(activePopupApp.repoName, newDesc);
    activePopupApp.description = newDesc;
    popupDesc.textContent = newDesc || 'No description provided.';
    exitEditMode();
    showToast('Changes saved!', 'success');
    if (window.Auth) window.Auth.syncAll();
  });

  popupIconEditBtn.addEventListener('click', () => popupIconInput.click());
  popupIconInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !activePopupApp) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      await Store.updateAppIcon(activePopupApp.repoName, dataUrl);
      activePopupApp.iconDataUrl = dataUrl;
      popupIcon.src = dataUrl;
      sphere?.updateNodeIcon(activePopupApp.repoName, dataUrl);
      showToast('Icon updated!', 'success');
      if (window.Auth) window.Auth.syncAll();
    };
    reader.readAsDataURL(file);
    popupIconInput.value = '';
  });

  // ─── Communication Bridge ──────────────────────────────────────────────────
  window.addEventListener('message', async (event) => {
    if (!currentShellApp) return;
    const { type, payload } = event.data;

    if (type === 'PANOPTICON_SYNC') {
      await Store.setAppState(currentShellApp.repoName, payload);
      showToast(`${currentShellApp.repoName} state synced!`, 'success');
      if (window.Auth) window.Auth.syncAll();
    }
    
    if (type === 'PANOPTICON_READY') {
      const state = await Store.getAppState(currentShellApp.repoName);
      if (state) {
        appFrame.contentWindow.postMessage({ type: 'PANOPTICON_LOAD', payload: state }, '*');
      }
    }
  });

  // ─── Update Manager ───────────────────────────────────────────────────────
  class UpdateManager {
    constructor() {
      this.registration = null;
      this.waitingWorker = null;
      this.init();
    }

    async init() {
      if (!('serviceWorker' in navigator)) return;
      try {
        this.registration = await navigator.serviceWorker.register('./sw.js');
        if (this.registration.waiting) {
          this.waitingWorker = this.registration.waiting;
          this.showUpdateUI();
        }
        this.registration.addEventListener('updatefound', () => {
          const installing = this.registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              this.waitingWorker = installing;
              this.showUpdateUI();
            }
          });
        });
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          window.location.reload();
          refreshing = true;
        });
        this.setupUI();
      } catch (err) {
        console.error('SW Registration failed:', err);
      }
    }

    showUpdateUI() {
      const toast = document.getElementById('update-toast');
      const badge = document.getElementById('settings-badge');
      const status = document.getElementById('update-status-text');
      const action = document.getElementById('update-action-container');
      toast?.removeAttribute('hidden');
      badge?.removeAttribute('hidden');
      if (status) status.textContent = 'Update available';
      action?.removeAttribute('hidden');
    }

    setupUI() {
      const toastBtn = document.getElementById('update-toast-btn');
      const checkBtn = document.getElementById('check-update-btn');
      const nowBtn   = document.getElementById('update-now-btn');
      const cancelBtn = document.getElementById('update-cancel-btn');
      const confirmBtn = document.getElementById('update-confirm-btn');
      const modal = document.getElementById('update-modal');
      const warning = document.getElementById('update-warning-apps');

      const triggerPrompt = () => {
        if (!this.waitingWorker) {
          showToast('Checking server...', 'info');
          this.registration.update();
          return;
        }
        if (backgroundApps.size > 0) {
          warning?.removeAttribute('hidden');
          modal?.removeAttribute('hidden');
        } else {
          this.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      };

      toastBtn?.addEventListener('click', triggerPrompt);
      nowBtn?.addEventListener('click', triggerPrompt);
      
      checkBtn?.addEventListener('click', async () => {
        const btnText = checkBtn.textContent;
        checkBtn.textContent = 'Checking...';
        checkBtn.disabled = true;
        try {
          await this.registration.update();
          setTimeout(() => {
            if (!this.registration.waiting && !this.registration.installing) {
              showToast('Panopticon is up to date.', 'info');
            }
            checkBtn.textContent = btnText;
            checkBtn.disabled = false;
          }, 1500);
        } catch (e) {
          checkBtn.textContent = btnText;
          checkBtn.disabled = false;
        }
      });

      cancelBtn?.addEventListener('click', () => modal?.setAttribute('hidden', ''));
      confirmBtn?.addEventListener('click', async () => {
        showToast('Performing Hard Refresh...', 'info');
        if (this.waitingWorker) this.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let r of registrations) await r.unregister();
          const cacheNames = await caches.keys();
          for (let name of cacheNames) await caches.delete(name);
          window.location.reload(true);
        } catch (e) {
          window.location.reload();
        }
      });

      const cloudBtn = document.getElementById('cloud-sync-btn');
      cloudBtn?.addEventListener('click', async () => {
        cloudBtn.disabled = true;
        cloudBtn.textContent = 'Syncing...';
        try {
          if (window.Auth) await window.Auth.syncAll();
          showToast('All apps synced to cloud!', 'success');
        } catch (e) {
          showToast('Sync failed: ' + e.message, 'error');
        } finally {
          cloudBtn.disabled = false;
          cloudBtn.textContent = 'Force Cloud Sync';
        }
      });

      appResetBtn?.addEventListener('click', async () => {
        if (confirm('Nuclear Reset? This clears EVERYTHING.')) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let registration of registrations) await registration.unregister();
          const names = await caches.keys();
          for (let name of names) await caches.delete(name);
          window.location.reload();
        }
      });
    }
  }

  const updater = new UpdateManager();

  // ─── Toast ────────────────────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className   = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--show'));
    setTimeout(() => {
      toast.classList.remove('toast--show');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  // ─── Util ─────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ─── Go! ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'complete') {
    boot();
  } else {
    window.addEventListener('load', boot);
  }

})();
