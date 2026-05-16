// ============================================================
// main.js — Panopticon Bootstrap & UI Wiring (no ES modules)
// Depends on: window.Store, window.GH, window.PanopticonSphere
// ============================================================

(function () {

  // ─── State ──────────────────────────────────────────────────────────────
  let sphere = null;
  let cachedRepos = [];
  let activePopupApp = null;
  let currentShellApp = null;
  let shellHideTimeout = null;

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const canvas = document.getElementById('sphere-canvas');
  const tokenScreen = document.getElementById('token-screen');
  const tokenInput = document.getElementById('token-input');
  const tokenSaveBtn = document.getElementById('token-save-btn');
  const tokenToggle = document.getElementById('token-toggle');
  const tokenCloseBtn = document.getElementById('token-close-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const addAppBtn = document.getElementById('add-app-btn');
  const repoDrawer = document.getElementById('repo-drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerCloseBtn = document.getElementById('drawer-close-btn');
  const repoSearch = document.getElementById('repo-search');
  const repoList = document.getElementById('repo-list');
  const repoLoading = document.getElementById('repo-loading');
  const repoEmpty = document.getElementById('repo-empty');
  const nodePopup = document.getElementById('node-popup');
  const popupIcon = document.getElementById('popup-icon');
  const popupName = document.getElementById('popup-app-name');
  const popupDesc = document.getElementById('popup-app-desc');
  const popupLaunch = document.getElementById('popup-launch-btn');
  const popupUnlink = document.getElementById('popup-unlink-btn');
  const popupClose = document.getElementById('popup-close-btn');
  const popupRefreshBtn = document.getElementById('popup-refresh-btn');
  const popupEditTrigger = document.getElementById('popup-edit-trigger');
  const popupEditActions = document.getElementById('popup-edit-actions');
  const popupDescView = document.getElementById('popup-desc-view');
  const popupDescEditWrap = document.getElementById('popup-desc-edit-wrap');
  const popupSaveBtn = document.getElementById('popup-save-btn');
  const popupDescEdit = document.getElementById('popup-app-desc-edit');
  const popupIconEditBtn = document.getElementById('popup-icon-edit-btn');
  const popupIconInput = document.getElementById('popup-icon-input');
  const popupBgMgmt = document.getElementById('popup-bg-mgmt');
  const popupResumeBtn = document.getElementById('popup-resume-btn');
  const popupTerminateBtn = document.getElementById('popup-terminate-btn');
  const toastContainer = document.getElementById('toast-container');
  const appShell = document.getElementById('app-shell');
  const framesContainer = document.getElementById('frames-container');
  const iframes = new Map(); // repoName -> HTMLIFrameElement
  const shellTab = document.getElementById('shell-tab');
  const shellControls = document.getElementById('shell-controls');
  const shellBackgroundBtn = document.getElementById('shell-background-btn');
  const shellCloseBtn = document.getElementById('shell-close-btn');
  const appResetBtn = document.getElementById('app-reset-btn');
  const settingsBadge = document.getElementById('settings-badge');
  const badgeTabLink = document.getElementById('badge-tab-link');
  const badgeTabLogin = document.getElementById('badge-tab-login');
  const badgeTabSystem = document.getElementById('badge-tab-system');
  const styleThemeInputs = document.querySelectorAll('.theme-swatch-input');
  const styleIconScale = document.getElementById('style-icon-scale');
  const styleIconScaleVal = document.getElementById('style-icon-scale-val');
  const styleAccountSync = document.getElementById('style-account-sync');
  const styleResetBtn = document.getElementById('style-reset-btn');

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
      if (targetId === 'settings-tab-cloud') badgeTabLogin.setAttribute('hidden', '');
      if (targetId === 'settings-tab-system') badgeTabSystem.setAttribute('hidden', '');
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
    if (tabId === 'settings-tab-cloud') badge = badgeTabLogin;
    if (tabId === 'settings-tab-system') badge = badgeTabSystem;

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
    setTabBadge,
    initSphere,
    showToast
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────
  async function boot() {
    await initStyles();
    const token = Store.getToken();
    if (!token) {
      showTokenScreen();
      setTabBadge('settings-tab-connect', true);
    } else {
      hideTokenScreen();
      await initSphere();
    }
  }

  async function initStyles() {
    const config = await Store.getStyles();
    if (config) {
      if (config.theme) {
        document.documentElement.setAttribute('data-theme', config.theme);
        document.documentElement.style.removeProperty('--bg');
        document.documentElement.style.removeProperty('--accent');
        styleThemeInputs.forEach(input => {
          input.checked = (input.value === config.theme);
        });
      } else if (config.colors) {
        document.documentElement.setAttribute('data-theme', 'blue');
        document.documentElement.style.removeProperty('--bg');
        document.documentElement.style.removeProperty('--accent');
      }
      if (config.iconScale !== undefined) {
        styleIconScale.value = config.iconScale;
        styleIconScaleVal.textContent = parseFloat(config.iconScale).toFixed(1);
        window.GlobalIconScale = parseFloat(config.iconScale);
      }
      if (config.accountSync !== undefined) {
        styleAccountSync.checked = config.accountSync;
      }
    }
  }

  async function initSphere() {
    try {
      if (sphere) sphere.destroy();
      const zoom = await Store.getZoom();
      sphere = new PanopticonSphere(canvas, showNodePopup, zoom);

      // Apply theme's accent color
      requestAnimationFrame(() => {
        const computedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (computedAccent) {
          sphere.updateAccentColor(computedAccent);
        }
      });

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

  // ─── Style Tab Events ─────────────────────────────────────────────────────
  styleThemeInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      if (e.target.checked) {
        document.documentElement.setAttribute('data-theme', e.target.value);
        document.documentElement.style.removeProperty('--bg');
        document.documentElement.style.removeProperty('--accent');
        if (sphere && sphere.updateAccentColor) {
          requestAnimationFrame(() => {
            const computedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
            sphere.updateAccentColor(computedAccent);
          });
        }
        autoSaveStyles();
      }
    });
  });
  styleIconScale.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    styleIconScaleVal.textContent = val.toFixed(1);
    window.GlobalIconScale = val;
    autoSaveStyles();
  });
  styleAccountSync.addEventListener('change', () => {
    autoSaveStyles();
  });

  styleResetBtn.addEventListener('click', () => {
    const defTheme = 'blue';
    const defScale = 1.0;

    document.documentElement.setAttribute('data-theme', defTheme);
    document.documentElement.style.removeProperty('--bg');
    document.documentElement.style.removeProperty('--accent');
    styleThemeInputs.forEach(input => input.checked = (input.value === defTheme));
    
    styleIconScale.value = defScale;
    styleIconScaleVal.textContent = '1.0';

    window.GlobalIconScale = defScale;

    if (sphere && sphere.updateAccentColor) {
      requestAnimationFrame(() => {
        const computedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f8ef7';
        sphere.updateAccentColor(computedAccent);
      });
    }

    autoSaveStyles();
    showToast('Styles reset to defaults.', 'info');
  });

  let styleSaveTimeout = null;
  function autoSaveStyles() {
    clearTimeout(styleSaveTimeout);
    styleSaveTimeout = setTimeout(async () => {
      const selectedThemeInput = document.querySelector('.theme-swatch-input:checked');
      const config = {
        theme: selectedThemeInput ? selectedThemeInput.value : 'blue',
        iconScale: parseFloat(styleIconScale.value),
        accountSync: styleAccountSync.checked
      };
      await Store.saveStyles(config);
      // If sync is enabled, push to cloud
      if (config.accountSync && window.Auth && window.Auth.syncAll) {
        window.Auth.syncAll();
      }
    }, 1000);
  }

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

    const fragment = document.createDocumentFragment();
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
          <span class="linked-text">${linked ? '✓ Linked' : '+ Link'}</span>
          ${linked ? '<span class="unlink-text">Unlink</span>' : ''}
        </button>`;
      item.querySelector('button').addEventListener('click', () => handleLink(repo, item));
      fragment.appendChild(item);
    }
    repoList.appendChild(fragment);
  }

  async function handleLink(repo, itemEl) {
    if (await Store.isLinked(repo.repoName)) {
      await Store.unlinkApp(repo.repoName);
      sphere?.removeNode(repo.repoName);
      showToast(`${repo.repoName} unlinked.`, 'info');
      if (window.Auth) window.Auth.syncAll();
      itemEl.classList.remove('repo-item--linked');
      const btn = itemEl.querySelector('button');
      btn.className = 'btn btn-link-repo';
      btn.innerHTML = '<span class="linked-text">+ Link</span>';
      return;
    }
    const btn = itemEl.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Linking…';

    const { dataUrl, color } = GH.generateLetterIcon(repo.repoName);
    const entry = {
      repoName: repo.repoName,
      pagesUrl: repo.pagesUrl,
      description: repo.description,
      iconDataUrl: dataUrl,
      iconColor: color,
    };

    let manifestIconUrl = null;
    if (GH.fetchAppMeta) {
      const meta = await GH.fetchAppMeta(repo.pagesUrl);
      if (meta) {
        if (meta.description) entry.description = meta.description;
        if (meta.iconUrl) manifestIconUrl = meta.iconUrl;
      }
    }

    await Store.linkApp(entry);
    sphere?.addNode(entry);
    closeDrawer();
    showToast(`${repo.repoName} added to the sphere!`, 'success');

    // Sync to cloud
    if (window.Auth) window.Auth.syncAll();

    GH.fetchFavicon(repo.pagesUrl, manifestIconUrl).then(async favUrl => {
      if (favUrl) {
        await Store.updateAppIcon(repo.repoName, favUrl);
        sphere?.updateNodeIcon(repo.repoName, favUrl);
        if (window.Auth) window.Auth.syncAll();
      }
    }).catch(() => { });
  }

  repoSearch.addEventListener('input', () => renderRepoList(cachedRepos));

  // ─── Node popup ───────────────────────────────────────────────────────────
  async function showNodePopup(appEntry) {
    activePopupApp = appEntry;
    popupIcon.src = appEntry.iconDataUrl;
    popupIcon.alt = appEntry.repoName;
    popupName.textContent = appEntry.repoName;
    popupDesc.textContent = appEntry.description || 'No description provided.';
    popupLaunch.href = appEntry.pagesUrl;
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

  function getIframe(appEntry) {
    const repo = appEntry.repoName;
    if (iframes.has(repo)) {
      return iframes.get(repo);
    }
    const frame = document.createElement('iframe');
    frame.className = 'app-frame hidden';
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('allow', 'autoplay; fullscreen; geolocation; microphone; camera; midi; encrypted-media; gyroscope; accelerometer;');
    frame.src = appEntry.pagesUrl;
    framesContainer.appendChild(frame);
    iframes.set(repo, frame);
    return frame;
  }

  function activateIframe(appEntry) {
    iframes.forEach((frame, repo) => {
      if (repo === appEntry.repoName) {
        frame.classList.remove('hidden');
      } else {
        frame.classList.add('hidden');
      }
    });
  }

  function openApp(appEntry) {
    if (!appEntry) return;
    currentShellApp = appEntry;

    // Clear any pending hide timeout to prevent race conditions
    if (shellHideTimeout) {
      clearTimeout(shellHideTimeout);
      shellHideTimeout = null;
    }

    getIframe(appEntry);
    activateIframe(appEntry);

    appShell.removeAttribute('hidden');
    appShell.classList.remove('app-shell--hiding');
    shellControls.setAttribute('hidden', '');
    hideNodePopup();
  }

  popupLaunch.addEventListener('click', (e) => {
    e.preventDefault();
    openApp(activePopupApp);
  });

  popupResumeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openApp(activePopupApp);
  });

  popupTerminateBtn.addEventListener('click', () => {
    if (!activePopupApp) return;
    const repo = activePopupApp.repoName;
    backgroundApps.delete(repo);
    sphere?.setNodeBackground(repo, false);

    if (iframes.has(repo)) {
      iframes.get(repo).remove();
      iframes.delete(repo);
    }

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
    if (shellHideTimeout) clearTimeout(shellHideTimeout);

    appShell.classList.add('app-shell--hiding');
    shellHideTimeout = setTimeout(() => {
      appShell.setAttribute('hidden', '');
      appShell.classList.remove('app-shell--hiding');
      currentShellApp = null;
      shellHideTimeout = null;
    }, 400);
    showToast(`${repo} is backgrounded.`, 'success');
  });

  shellCloseBtn.addEventListener('click', () => {
    if (!currentShellApp) return;
    const repo = currentShellApp.repoName;
    backgroundApps.delete(repo);
    sphere?.setNodeBackground(repo, false);
    if (shellHideTimeout) clearTimeout(shellHideTimeout);

    appShell.classList.add('app-shell--hiding');
    shellHideTimeout = setTimeout(() => {
      appShell.setAttribute('hidden', '');
      appShell.classList.remove('app-shell--hiding');

      if (iframes.has(repo)) {
        iframes.get(repo).remove();
        iframes.delete(repo);
      }

      currentShellApp = null;
      shellHideTimeout = null;
    }, 400);
    showToast(`${repo} closed.`, 'info');
  });

  popupUnlink.addEventListener('click', async () => {
    if (popupUnlink.dataset.state === 'idle') {
      popupUnlink.dataset.state = 'confirm';
      popupUnlink.textContent = 'Confirm Unlink?';
      popupUnlink.classList.add('btn-danger-confirm');
      setTimeout(() => {
        if (popupUnlink.dataset.state === 'confirm') {
          popupUnlink.dataset.state = 'idle';
          popupUnlink.textContent = 'Unlink';
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

  popupRefreshBtn.addEventListener('click', async () => {
    if (!activePopupApp) return;
    const repo = activePopupApp;
    popupRefreshBtn.classList.add('spin-anim');
    try {
      let manifestIconUrl = null;
      if (GH.fetchAppMeta) {
        const meta = await GH.fetchAppMeta(repo.pagesUrl);
        if (meta) {
          if (meta.description) {
            repo.description = meta.description;
            await Store.updateAppDescription(repo.repoName, meta.description);
            popupDesc.textContent = meta.description;
          }
          if (meta.iconUrl) manifestIconUrl = meta.iconUrl;
        }
      }

      const favUrl = await GH.fetchFavicon(repo.pagesUrl, manifestIconUrl);
      if (favUrl) {
        await Store.updateAppIcon(repo.repoName, favUrl);
        repo.iconDataUrl = favUrl;
        popupIcon.src = favUrl;
        sphere?.updateNodeIcon(repo.repoName, favUrl);
      }
      showToast(`${repo.repoName} refreshed!`, 'success');
      if (window.Auth) window.Auth.syncAll();
    } catch (e) {
      showToast(`Refresh failed: ${e.message}`, 'error');
    } finally {
      popupRefreshBtn.classList.remove('spin-anim');
    }
  });

  // ─── Communication Bridge ──────────────────────────────────────────────────
  window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    const { type, payload } = event.data;

    let sourceRepo = null;
    for (const [repo, frame] of iframes.entries()) {
      if (frame.contentWindow === event.source) {
        sourceRepo = repo;
        break;
      }
    }

    if (!sourceRepo) return; // Ignore messages not from our apps

    if (type === 'PANOPTICON_SYNC') {
      await Store.setAppState(sourceRepo, payload);
      showToast(`${sourceRepo} state synced!`, 'success');
      if (window.Auth) window.Auth.syncAll();
    }

    if (type === 'PANOPTICON_READY') {
      const state = await Store.getAppState(sourceRepo);
      if (state && iframes.has(sourceRepo)) {
        const frame = iframes.get(sourceRepo);
        frame.contentWindow.postMessage({ type: 'PANOPTICON_LOAD', payload: state }, '*');
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
      const nowBtn = document.getElementById('update-now-btn');
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
    toast.className = `toast toast--${type}`;
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
