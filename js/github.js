// ============================================================
// github.js — GitHub API Integration (global namespace)
// ============================================================
window.GH = (() => {

  const API_BASE = 'https://api.github.com';

  const ICON_COLORS = [
    '#4f8ef7', '#7c6ef7', '#f74fa8', '#f7874f',
    '#4ff7c0', '#f7d44f', '#4fc9f7', '#a44ff7',
    '#f74f4f', '#4ff76a', '#f7a14f', '#4f7ff7',
  ];

  // ── Fetch repos ──────────────────────────────────────────────────────────
  async function fetchRepos(token) {
    const repos = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${API_BASE}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`,
        {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub API error ${res.status}`);
      }
      const batch = await res.json();
      repos.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return repos.map(r => ({
      repoName:    r.name,
      fullName:    r.full_name,
      description: r.description || '',
      htmlUrl:     r.html_url,
      pagesUrl:    r.homepage || `https://${r.owner.login}.github.io/${r.name}/`,
      isPrivate:   r.private,
      updatedAt:   r.updated_at,
    }));
  }

  // ── Favicon fetching ─────────────────────────────────────────────────────
  async function fetchFavicon(pagesUrl) {
    if (!pagesUrl) return null;
    const base = pagesUrl.replace(/\/$/, '');
    const candidates = [`${base}/favicon.ico`, `${base}/favicon.png`, `${base}/apple-touch-icon.png`];
    for (const url of candidates) {
      try { const d = await _loadImageAsDataUrl(url); if (d) return d; } catch { /* try next */ }
    }
    return null;
  }

  function _loadImageAsDataUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 128; canvas.height = 128;
          canvas.getContext('2d').drawImage(img, 0, 0, 128, 128);
          resolve(canvas.toDataURL('image/png'));
        } catch { reject(new Error('CORS taint')); }
      };
      img.onerror = () => reject(new Error('load failed'));
      setTimeout(() => reject(new Error('timeout')), 4000);
      img.src = url;
    });
  }

  // ── Letter icon generator ────────────────────────────────────────────────
  function generateLetterIcon(name, color) {
    const assignedColor = color || ICON_COLORS[
      [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % ICON_COLORS.length
    ];
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Glow ring
    const glow = ctx.createRadialGradient(size/2, size/2, size*0.35, size/2, size/2, size/2);
    glow.addColorStop(0, assignedColor + 'cc');
    glow.addColorStop(1, assignedColor + '00');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // Circle body
    const grad = ctx.createRadialGradient(size*0.38, size*0.32, 0, size/2, size/2, size*0.44);
    grad.addColorStop(0, _lighten(assignedColor, 0.25));
    grad.addColorStop(1, assignedColor);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size*0.42, 0, Math.PI*2);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Letter
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `bold ${Math.round(size*0.44)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name[0].toUpperCase(), size/2, size/2 + 2);

    return { dataUrl: canvas.toDataURL('image/png'), color: assignedColor };
  }

  function _lighten(hex, amount) {
    const num = parseInt(hex.replace('#',''), 16);
    const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  return { fetchRepos, fetchFavicon, generateLetterIcon, ICON_COLORS };
})();
