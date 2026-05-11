// ============================================================
// main.js — Panopticon Bootstrap & UI Wiring (no ES modules)
// Depends on: window.Store, window.GH, window.PanopticonSphere
// ============================================================

(function () {

  // ─── State ──────────────────────────────────────────────────────────────
  let sphere        = null;
  let cachedRepos   = [];
  let activePopupApp = null;

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
  const toastContainer = document.getElementById('toast-container');
  const appShell       = document.getElementById('app-shell');
  const appFrame       = document.getElementById('app-frame');
  const shellTab           = document.getElementById('shell-tab');
  const shellControls      = document.getElementById('shell-controls');
  const shellBackgroundBtn = document.getElementById('shell-background-btn');
  const shellCloseBtn      = document.getElementById('shell-close-btn');
  const appUpdateBtn   = document.getElementById('app-update-btn');
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
  function boot() {
    const token = Store.getToken();
    if (!token) {
      showTokenScreen();
      setTabBadge('settings-tab-connect', true);
    } else {
      hideTokenScreen();
      initSphere();
    }
  }

  function initSphere() {
    try {
      if (sphere) sphere.destroy();
      sphere = new PanopticonSphere(canvas, showNodePopup);
      const apps = Store.getLinkedApps();
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
      if (!sphere) initSphere();
      showToast('GitHub connected! ✓', 'success');
    } catch (e) {
      // Distinguish network errors from auth errors
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
      renderRepoList(cachedRepos);
    } catch (e) {
      showToast(e.message || 'Failed to load repos.', 'error');
      repoLoading.setAttribute('hidden', '');
    }
  }

  function renderRepoList(repos) {
    repoLoading.setAttribute('hidden', '');
    repoList.innerHTML = '';

    const q = repoSearch.value.toLowerCase();
    const filtered = repos.filter(r => r.repoName.toLowerCase().includes(q));

    if (!filtered.length) { repoEmpty.removeAttribute('hidden'); return; }
    repoEmpty.setAttribute('hidden', '');

    filtered.forEach(repo => {
      const linked = Store.isLinked(repo.repoName);
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
    });
  }

  async function handleLink(repo, itemEl) {
    if (Store.isLinked(repo.repoName)) {
      showToast(`${repo.repoName} is already linked. Tap its node on the sphere to manage it.`, 'info');
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

    Store.linkApp(entry);
    sphere?.addNode(entry);
    closeDrawer();
    showToast(`${repo.repoName} added to the sphere!`, 'success');

    // Async favicon upgrade
    GH.fetchFavicon(repo.pagesUrl).then(favUrl => {
      if (favUrl) {
        Store.updateAppIcon(repo.repoName, favUrl);
        sphere?.updateNodeIcon(repo.repoName, favUrl);
      }
    }).catch(() => {});
  }

  repoSearch.addEventListener('input', () => renderRepoList(cachedRepos));

  // ─── Node popup ───────────────────────────────────────────────────────────
  function showNodePopup(appEntry) {
    activePopupApp = appEntry;
    popupIcon.src              = appEntry.iconDataUrl;
    popupIcon.alt              = appEntry.repoName;
    popupName.textContent      = appEntry.repoName;
    popupDesc.textContent      = appEntry.description || 'No description provided.';
    popupLaunch.href           = appEntry.pagesUrl;
    popupUnlink.classList.remove('btn-danger-confirm');

    // Always start in View mode
    exitEditMode();

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
    
    // If it's already in background, just show it. Otherwise load it.
    if (!backgroundApps.has(activePopupApp.repoName)) {
      appFrame.src = activePopupApp.pagesUrl;
    }
    
    appShell.removeAttribute('hidden');
    appShell.classList.remove('app-shell--hiding');
    shellControls.setAttribute('hidden', ''); // Ensure controls are closed on launch
    hideNodePopup();
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
    if (!activePopupApp) return;
    const repo = activePopupApp.repoName;
    
    backgroundApps.add(repo);
    sphere?.setNodeBackground(repo, true);
    
    appShell.classList.add('app-shell--hiding');
    setTimeout(() => {
      appShell.setAttribute('hidden', '');
      appShell.classList.remove('app-shell--hiding');
    }, 400);
    
    showToast(`${repo} is now running in the background.`, 'success');
  });

  shellCloseBtn.addEventListener('click', () => {
    if (!activePopupApp) return;
    const repo = activePopupApp.repoName;
    
    backgroundApps.delete(repo);
    sphere?.setNodeBackground(repo, false);
    
    appShell.classList.add('app-shell--hiding');
    setTimeout(() => {
      appShell.setAttribute('hidden', '');
      appShell.classList.remove('app-shell--hiding');
      appFrame.src = 'about:blank';
    }, 400);
    
    showToast(`${repo} closed.`, 'info');
  });

  popupUnlink.addEventListener('click', () => {
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
      Store.unlinkApp(name);
      sphere?.removeNode(name);
      hideNodePopup();
      showToast(`${name} unlinked.`, 'info');
    }
  });

  // Edit Mode Flow
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

  popupSaveBtn.addEventListener('click', () => {
    if (!activePopupApp) return;
    const newDesc = popupDescEdit.value.trim();
    Store.updateAppDescription(activePopupApp.repoName, newDesc);
    activePopupApp.description = newDesc;
    popupDesc.textContent = newDesc || 'No description provided.';
    
    exitEditMode();
    showToast('Changes saved!', 'success');
  });

  // Icon Editing
  popupIconEditBtn.addEventListener('click', () => popupIconInput.click());
  popupIconInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !activePopupApp) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      Store.updateAppIcon(activePopupApp.repoName, dataUrl);
      activePopupApp.iconDataUrl = dataUrl;
      popupIcon.src = dataUrl;
      sphere?.updateNodeIcon(activePopupApp.repoName, dataUrl);
      showToast('Icon updated!', 'success');
    };
    reader.readAsDataURL(file);
    popupIconInput.value = '';
  });

  // ─── Maintenance ──────────────────────────────────────────────────────────
  appUpdateBtn.addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      // If there's already a worker waiting, just activate it
      if (reg.waiting) {
        showToast('Activating update...', 'info');
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }

      showToast('Checking for updates...', 'info');
      await reg.update();
      
      // Short delay to see if an update was found
      setTimeout(() => {
        if (reg.installing) {
          showToast('Update found! Downloading...', 'success');
        } else if (reg.waiting) {
          showToast('Update ready. Click again to apply.', 'success');
        } else {
          showToast('Panopticon is up to date.', 'success');
          if (badgeTabSystem) badgeTabSystem.setAttribute('hidden', '');
          checkGlobalBadge();
        }
      }, 1500);
    }
  });

  appResetBtn.addEventListener('click', async () => {
    if (confirm('This will clear the app cache and reload. Continue?')) {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
          await registration.unregister();
        }
      }
      const names = await caches.keys();
      for (let name of names) {
        await caches.delete(name);
      }
      window.location.reload(true);
    }
  });

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
  // Use window.onload so THREE (CDN script) is guaranteed loaded before boot runs
  if (document.readyState === 'complete') {
    boot();
  } else {
    window.addEventListener('load', boot);
  }

})();
