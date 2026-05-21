// ============================================================
// audio.js — Panopticon Audio Engine
// ============================================================
window.AudioEngine = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _initialized = false;
  let _masterMuted = false;

  const _categories = {
    ambience: { volume: 0.5, muted: false },
    effects:  { volume: 0.25, muted: false },
    buttons:  { volume: 0.5, muted: false }
  };

  // ── Ambience Tracks ────────────────────────────────────────────────────────
  // Each track uses two Audio elements that crossfade for seamless looping.
  const _ambienceTracks = [];

  const CROSSFADE_DURATION = 3;   // seconds of crossfade overlap
  const INITIAL_FADE_IN    = 3;   // seconds to fade in on first play

  function _createAmbienceTrack(src, trimStart = 0, trimEnd = 0, relativeVolume = 1.0) {
    const track = {
      src,
      trimStart,
      trimEnd,
      relativeVolume,
      elements: [new Audio(src), new Audio(src)],
      activeIndex: 0,
      duration: 0,
      loopTimer: null,
      fading: false
    };

    // Pre-configure both elements
    track.elements.forEach(el => {
      el.loop = false;
      el.volume = 0;
      el.preload = 'auto';
    });

    // Capture metadata safely
    const onMetadata = () => {
      track.duration = track.elements[0].duration;
    };
    track.elements[0].addEventListener('loadedmetadata', onMetadata);
    if (track.elements[0].duration) {
      onMetadata();
    }

    return track;
  }

  function _getEffectiveVolume(category) {
    if (_masterMuted || _categories[category].muted) return 0;
    return _categories[category].volume;
  }

  function _startAmbienceTrack(track, fadeIn = INITIAL_FADE_IN) {
    const el = track.elements[track.activeIndex];
    el.currentTime = track.trimStart;
    el.volume = 0;
    el.play().catch(() => {});

    // Fade in
    const targetVol = _getEffectiveVolume('ambience') * (track.relativeVolume || 1.0);
    _fadeVolume(el, 0, targetVol, fadeIn);

    // Schedule the crossfade loop
    _scheduleAmbienceCrossfade(track);
  }

  function _scheduleAmbienceCrossfade(track) {
    clearTimeout(track.loopTimer);

    const el = track.elements[track.activeIndex];
    if (!el.duration) {
      // If duration not loaded yet, retry shortly
      track.loopTimer = setTimeout(() => _scheduleAmbienceCrossfade(track), 200);
      return;
    }

    const effectiveEnd = el.duration - track.trimEnd;
    const crossfadeStart = effectiveEnd - CROSSFADE_DURATION;

    const check = () => {
      // Safety: If this element is no longer the active track element,
      // terminate this check loop immediately to prevent overlapping double-crossfades!
      if (track.elements[track.activeIndex] !== el) {
        return;
      }

      if (el.currentTime >= crossfadeStart && !track.fading) {
        track.fading = true;
        _crossfadeAmbience(track);
        return; // End this check loop
      }

      if (!el.paused && el.currentTime < effectiveEnd) {
        track.loopTimer = setTimeout(check, 100);
      }
    };

    // Calculate delay until crossfadeStart
    const remainingTime = crossfadeStart - el.currentTime;
    const delayMs = Math.max(0, remainingTime * 1000 - 500); // Start polling 500ms before crossfade

    track.loopTimer = setTimeout(check, delayMs);
  }

  function _crossfadeAmbience(track) {
    const outEl = track.elements[track.activeIndex];
    const nextIndex = (track.activeIndex + 1) % 2;
    const inEl = track.elements[nextIndex];

    // Prepare the incoming element while silent
    inEl.volume = 0;
    inEl.currentTime = track.trimStart;
    inEl.play().catch(() => {});

    const targetVol = _getEffectiveVolume('ambience') * (track.relativeVolume || 1.0);

    // Fade out old, fade in new
    _fadeVolume(outEl, outEl.volume, 0, CROSSFADE_DURATION, () => {
      outEl.pause();
    });
    _fadeVolume(inEl, inEl.volume, targetVol, CROSSFADE_DURATION);

    track.activeIndex = nextIndex;
    track.fading = false;

    // Schedule next crossfade
    _scheduleAmbienceCrossfade(track);
  }

  function _fadeVolume(audioEl, from, to, durationSec, onComplete) {
    if (audioEl._fadeInterval) {
      clearInterval(audioEl._fadeInterval);
    }
    const steps = Math.ceil(durationSec * 20); // 20 steps/sec = 50ms intervals
    const stepSize = (to - from) / steps;
    let current = from;
    let step = 0;

    audioEl.volume = Math.max(0, Math.min(1, current));

    audioEl._fadeInterval = setInterval(() => {
      step++;
      current += stepSize;
      audioEl.volume = Math.max(0, Math.min(1, current));
      if (step >= steps) {
        audioEl.volume = Math.max(0, Math.min(1, to));
        clearInterval(audioEl._fadeInterval);
        audioEl._fadeInterval = null;
        if (onComplete) onComplete();
      }
    }, 50);
  }

  // ── Pulse Effect ───────────────────────────────────────────────────────────
  // Pool-based: create clones so overlapping plays don't cut each other off
  const PULSE_POOL_SIZE = 6;
  let _pulsePool = [];
  let _pulsePoolIndex = 0;

  function _initPulsePool() {
    _pulsePool = [];
    for (let i = 0; i < PULSE_POOL_SIZE; i++) {
      const a = new Audio('audio/pulse_effect.mp3');
      a.preload = 'auto';
      a.volume = _getEffectiveVolume('effects');
      _pulsePool.push(a);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Create ambience tracks
    _ambienceTracks.push(_createAmbienceTrack('audio/ambience_1.mp3', 0, 0, 1.0));
    _ambienceTracks.push(_createAmbienceTrack('audio/ambience_2.mp3', 2, 4, 0.30));

    // Start ambience with fade-in (wait for metadata to load)
    _ambienceTracks.forEach(track => {
      const el = track.elements[0];
      if (el.readyState >= 1) {
        track.duration = el.duration;
        _startAmbienceTrack(track, INITIAL_FADE_IN);
      } else {
        el.addEventListener('loadedmetadata', () => {
          track.duration = el.duration;
          _startAmbienceTrack(track, INITIAL_FADE_IN);
        }, { once: true });
      }
    });

    // Init pulse effect pool
    _initPulsePool();
  }

  function playPulse() {
    if (!_initialized || _masterMuted || _categories.effects.muted) return;

    const audio = _pulsePool[_pulsePoolIndex];
    audio.volume = _getEffectiveVolume('effects');
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _pulsePoolIndex = (_pulsePoolIndex + 1) % PULSE_POOL_SIZE;
  }

  function playButton() {
    // Placeholder for future button sounds
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    // No button sounds yet
  }

  function setVolume(category, value) {
    if (!_categories[category]) return;
    _categories[category].volume = Math.max(0, Math.min(1, value));

    if (category === 'ambience') {
      _updateAmbienceVolume();
    } else if (category === 'effects') {
      _pulsePool.forEach(a => {
        if (a._fadeInterval) clearInterval(a._fadeInterval);
        a.volume = _getEffectiveVolume('effects');
      });
    }
  }

  function setMute(category, muted) {
    if (!_categories[category]) return;
    _categories[category].muted = muted;

    if (category === 'ambience') {
      _updateAmbienceVolume();
    } else if (category === 'effects') {
      _pulsePool.forEach(a => {
        if (a._fadeInterval) clearInterval(a._fadeInterval);
        a.volume = _getEffectiveVolume('effects');
      });
    }
  }

  function setMasterMute(muted) {
    _masterMuted = muted;
    _updateAmbienceVolume();
    _pulsePool.forEach(a => {
      if (a._fadeInterval) clearInterval(a._fadeInterval);
      a.volume = _getEffectiveVolume('effects');
    });
  }

  function _updateAmbienceVolume() {
    const vol = _getEffectiveVolume('ambience');
    _ambienceTracks.forEach(track => {
      const activeEl = track.elements[track.activeIndex];
      if (!activeEl.paused) {
        // Smoothly fade to the new volume over 0.5s to prevent pops!
        _fadeVolume(activeEl, activeEl.volume, vol * (track.relativeVolume || 1.0), 0.5);
      }
    });
  }

  function getConfig() {
    return {
      masterMuted: _masterMuted,
      ambience: { ..._categories.ambience },
      effects:  { ..._categories.effects },
      buttons:  { ..._categories.buttons }
    };
  }

  // Helper to sync volume levels when applying config dynamically
  function applyConfig(config) {
    if (!config) return;
    if (config.masterMuted !== undefined) _masterMuted = config.masterMuted;
    if (config.ambience) {
      if (config.ambience.volume !== undefined) _categories.ambience.volume = config.ambience.volume;
      if (config.ambience.muted !== undefined) _categories.ambience.muted = config.ambience.muted;
    }
    if (config.effects) {
      if (config.effects.volume !== undefined) _categories.effects.volume = config.effects.volume;
      if (config.effects.muted !== undefined) _categories.effects.muted = config.effects.muted;
    }
    if (config.buttons) {
      if (config.buttons.volume !== undefined) _categories.buttons.volume = config.buttons.volume;
      if (config.buttons.muted !== undefined) _categories.buttons.muted = config.buttons.muted;
    }

    // Update live volumes if already initialized
    if (_initialized) {
      _updateAmbienceVolume();
      _pulsePool.forEach(a => { a.volume = _getEffectiveVolume('effects'); });
    }
  }

  function isMasterMuted() { return _masterMuted; }
  function getCategory(cat) { return _categories[cat] ? { ..._categories[cat] } : null; }

  return {
    init,
    playPulse,
    playButton,
    setVolume,
    setMute,
    setMasterMute,
    isMasterMuted,
    getCategory,
    getConfig,
    applyConfig
  };
})();
