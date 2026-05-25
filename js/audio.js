// ============================================================
// audio.js — Panopticon Audio Engine
// ============================================================
window.AudioEngine = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _initialized = false;
  let _masterMuted = false;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  let _mobileHiddenMuted = false;
  let _appMuted = false;
  let _soundtrackPausedByApp = false;

  const _individualVolumes = {
    click: 0.2,
    select: 1.0,
    windowOpen: 1.0,
    appOpen: 1.0,
    windowClose: 1.0,
    refresh: 1.0,
    pulse: 1.0,
    hum: 1.0,
    ambience1: 1.0,
    ambience2: 0.3
  };

  // Web Audio API State for Premium Reverb
  let _audioCtx = null;
  let _masterUiGainNode = null;
  let _dryGainNode = null;
  let _wetGainNode = null;
  let _reverbNode = null;
  const _buffers = {};
  const _soundUrls = {
    click: 'audio/sound_click.wav',
    select: 'audio/sound_select.wav',
    windowOpen: 'audio/sound_window_open.wav',
    appOpen: 'audio/power_on.mp3',
    refresh: 'audio/refresh.wav'
  };
  let _webAudioSupported = false;
  let _webAudioInitialized = false;

  // Real-Time Synthesizer Hum State
  let _humOsc1 = null;
  let _humOsc2 = null;
  let _humOsc3 = null;
  let _humOsc2Gain = null;
  let _humOsc3Gain = null;
  let _humFilter = null;
  let _humGain = null;
  let _humLfo = null;
  let _humLfoGain = null;
  let _humFilterLfo = null;
  let _humFilterLfoGain = null;
  let _humActive = false;
  let _lastHumSpeed = 0.0;

  // UI Sound Pools
  const CLICK_POOL_SIZE = 8;
  let _clickPool = [];
  let _clickPoolIndex = 0;

  const SELECT_POOL_SIZE = 4;
  let _selectPool = [];
  let _selectPoolIndex = 0;

  const WINDOW_OPEN_POOL_SIZE = 4;
  let _windowOpenPool = [];
  let _windowOpenPoolIndex = 0;

  const APP_OPEN_POOL_SIZE = 4;
  let _appOpenPool = [];
  let _appOpenPoolIndex = 0;

  const REFRESH_POOL_SIZE = 4;
  let _refreshPool = [];
  let _refreshPoolIndex = 0;


  const _categories = {
    ambience: { volume: 0.5, muted: false },
    effects:  { volume: 0.25, muted: false },
    buttons:  { volume: 0.5, muted: false },
    soundtrack: { volume: 0.5, muted: false, url: '' }
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
    if (_appMuted && category !== 'buttons') return 0;
    if (category === 'ambience' && _mobileHiddenMuted) return 0;
    return _categories[category].volume;
  }

  function _startAmbienceTrack(track, fadeIn = INITIAL_FADE_IN) {
    const el = track.elements[track.activeIndex];
    el.currentTime = track.trimStart;
    el.volume = 0;
    el.play().catch(() => {});

    // Fade in
    const mult = track.src.includes('ambience_1') ? _individualVolumes.ambience1 : _individualVolumes.ambience2;
    const targetVol = _getEffectiveVolume('ambience') * mult;
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

    const mult = track.src.includes('ambience_1') ? _individualVolumes.ambience1 : _individualVolumes.ambience2;
    const targetVol = _getEffectiveVolume('ambience') * mult;

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

  // ── Web Audio API Reverb Engine ────────────────────────────────────────────

  function _createReverbImpulse(duration, decay) {
    const sampleRate = _audioCtx.sampleRate;
    const length = sampleRate * duration;
    const impulse = _audioCtx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    let leftLast = 0;
    let rightLast = 0;
    const damping = 0.15; // Running average one-pole filter damping coefficient (simulates material absorption)
    const energyCompensation = 2.5; // Compensate for volume attenuation of the filter

    for (let i = 0; i < length; i++) {
      // Exponential decay envelope
      const decayEnvelope = Math.exp(-i / (sampleRate * decay));
      
      // Uncorrelated noise for stereo spaciousness
      const leftNoise = Math.random() * 2 - 1;
      const rightNoise = Math.random() * 2 - 1;
      
      // Apply low-pass running average filter
      leftLast += damping * (leftNoise - leftLast);
      rightLast += damping * (rightNoise - rightLast);
      
      left[i] = leftLast * decayEnvelope * energyCompensation;
      right[i] = rightLast * decayEnvelope * energyCompensation;
    }
    return impulse;
  }

  function _createReversedBuffer(buffer) {
    if (!buffer || !_audioCtx) return null;
    try {
      const numberOfChannels = buffer.numberOfChannels;
      const length = buffer.length;
      const sampleRate = buffer.sampleRate;
      const reversedBuffer = _audioCtx.createBuffer(numberOfChannels, length, sampleRate);
      
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const srcData = buffer.getChannelData(channel);
        const destData = reversedBuffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          destData[i] = srcData[length - 1 - i];
        }
      }
      return reversedBuffer;
    } catch (e) {
      console.warn("Failed to create reversed buffer:", e);
      return null;
    }
  }

  async function _preloadBuffer(key, url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await _audioCtx.decodeAudioData(arrayBuffer);
      _buffers[key] = audioBuffer;
      
      if (key === 'windowOpen') {
        _buffers['windowClose'] = _createReversedBuffer(audioBuffer);
      } else if (key === 'appOpen') {
        _buffers['appClose'] = _createReversedBuffer(audioBuffer);
      }
    } catch (err) {
      console.warn(`Web Audio preload failed for ${key} (${url}):`, err);
    }
  }

  function _initWebAudio() {
    if (_webAudioInitialized) return;
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("Web Audio API not supported in this browser.");
      return;
    }
    
    try {
      _audioCtx = new AudioContextClass();
      _webAudioSupported = true;
      
      // Setup dry path, wet path, and master UI volume node
      _masterUiGainNode = _audioCtx.createGain();
      _masterUiGainNode.gain.value = _getEffectiveVolume('buttons');
      _masterUiGainNode.connect(_audioCtx.destination);
      
      _dryGainNode = _audioCtx.createGain();
      _dryGainNode.gain.value = 1.0;
      _dryGainNode.connect(_masterUiGainNode);
      
      _wetGainNode = _audioCtx.createGain();
      _wetGainNode.gain.value = 0.525; // Rich, prominent wet tail (reduced by 30% from 0.75)
      _wetGainNode.connect(_masterUiGainNode);
      
      _reverbNode = _audioCtx.createConvolver();
      _reverbNode.buffer = _createReverbImpulse(3.0, 1.0); // 3.0s tail, 1.0s decay constant (up from 1.8s/0.5s)
      _reverbNode.connect(_wetGainNode);
      
      _webAudioInitialized = true;
      
      // Preload buffers
      Object.entries(_soundUrls).forEach(([key, url]) => {
        _preloadBuffer(key, url);
      });
      
    } catch (e) {
      console.error("Failed to initialize Web Audio context:", e);
      _webAudioSupported = false;
    }
  }

  function _updateWebAudioButtonVolume() {
    if (_webAudioInitialized && _webAudioSupported && _masterUiGainNode) {
      try {
        _masterUiGainNode.gain.setValueAtTime(_getEffectiveVolume('buttons'), _audioCtx.currentTime);
      } catch (e) {
        console.warn("Failed to update Web Audio button volume:", e);
      }
    }
  }

  function _playUiSoundWithReverb(key, volMultiplier = 1.0) {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return false;
    
    // Lazy initialize if not already done
    if (!_webAudioInitialized) {
      _initWebAudio();
    }
    
    if (!_webAudioInitialized || !_webAudioSupported) return false;
    
    const buffer = _buffers[key];
    if (!buffer) {
      // Buffer not yet loaded, fallback to HTML5 pool
      return false;
    }
    
    try {
      if (_audioCtx.state === 'suspended') {
        _audioCtx.resume();
      }
      
      const source = _audioCtx.createBufferSource();
      source.buffer = buffer;
      
      const individualMult = _individualVolumes[key] !== undefined ? _individualVolumes[key] : 1.0;
      const finalVol = volMultiplier * individualMult;
      
      if (finalVol !== 1.0) {
        const sourceGain = _audioCtx.createGain();
        sourceGain.gain.setValueAtTime(finalVol, _audioCtx.currentTime);
        source.connect(sourceGain);
        sourceGain.connect(_dryGainNode);
        sourceGain.connect(_reverbNode);
      } else {
        source.connect(_dryGainNode);
        source.connect(_reverbNode);
      }
      
      source.start(0);
      return true;
    } catch (e) {
      console.warn(`Web Audio play failed for ${key}, falling back to legacy:`, e);
      return false;
    }
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

  function _initUiSoundPools() {
    _clickPool = [];
    for (let i = 0; i < CLICK_POOL_SIZE; i++) {
      const a = new Audio('audio/sound_click.wav');
      a.preload = 'auto';
      a.volume = _getEffectiveVolume('buttons') * 0.2;
      _clickPool.push(a);
    }

    _selectPool = [];
    for (let i = 0; i < SELECT_POOL_SIZE; i++) {
      const a = new Audio('audio/sound_select.wav');
      a.preload = 'auto';
      a.volume = _getEffectiveVolume('buttons');
      _selectPool.push(a);
    }

    _windowOpenPool = [];
    for (let i = 0; i < WINDOW_OPEN_POOL_SIZE; i++) {
      const a = new Audio('audio/sound_window_open.wav');
      a.preload = 'auto';
      a.volume = _getEffectiveVolume('buttons');
      _windowOpenPool.push(a);
    }

    _appOpenPool = [];
    for (let i = 0; i < APP_OPEN_POOL_SIZE; i++) {
      const a = new Audio('audio/power_on.mp3');
      a.preload = 'auto';
      a.volume = _getEffectiveVolume('buttons');
      _appOpenPool.push(a);
    }

    _refreshPool = [];
    for (let i = 0; i < REFRESH_POOL_SIZE; i++) {
      const a = new Audio('audio/refresh.wav');
      a.preload = 'auto';
      a.volume = _getEffectiveVolume('buttons');
      _refreshPool.push(a);
    }
  }


  // ── Soundtrack Player (YouTube IFrame API) ─────────────────────────────────
  let _ytPlayer = null;
  let _soundtrackPlaying = false;
  let _ytApiReady = false;
  const _ytCallbacks = [];

  // Expose onYouTubeIframeAPIReady globally for the YouTube script to call
  window.onYouTubeIframeAPIReady = () => {
    _ytApiReady = true;
    _ytCallbacks.forEach(cb => cb());
    _ytCallbacks.length = 0;
  };

  function _onYTApiReady(cb) {
    if (_ytApiReady || (window.YT && window.YT.Player)) {
      cb();
    } else {
      _ytCallbacks.push(cb);
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      }
    }
  }

  function _dispatchSoundtrackState() {
    const isPlaying = _soundtrackPlaying && !_masterMuted && !_categories.soundtrack.muted && _categories.soundtrack.url;
    const event = new CustomEvent('soundtrackstatechange', {
      detail: {
        isPlaying: !!isPlaying,
        url: _categories.soundtrack.url
      }
    });
    document.dispatchEvent(event);
  }

  function _extractYouTubeId(url) {
    if (!url) return '';
    url = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      return url;
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : '';
  }

  function _updateYTVolume() {
    if (!_ytPlayer || typeof _ytPlayer.setVolume !== 'function') return;
    const targetVol = _getEffectiveVolume('soundtrack'); // 0.0 to 1.0
    const ytVolume = Math.round(targetVol * 100);
    _ytPlayer.setVolume(ytVolume);

    const isMuted = _masterMuted || _categories.soundtrack.muted || _appMuted;
    if (isMuted) {
      _ytPlayer.mute();
    } else {
      _ytPlayer.unMute();
    }
  }

  function playSoundtrack(url, autoplay = true) {
    const videoId = _extractYouTubeId(url);
    if (!videoId) {
      console.error('Invalid YouTube URL or ID:', url);
      return;
    }

    _categories.soundtrack.url = url;
    _categories.soundtrack.muted = false;

    // If player exists and is for the same video, just play it
    if (_ytPlayer && typeof _ytPlayer.getVideoData === 'function') {
      try {
        const currentVideoId = _ytPlayer.getVideoData().video_id;
        if (currentVideoId === videoId) {
          if (autoplay) {
            if (_appMuted) {
              _soundtrackPlaying = false;
              _soundtrackPausedByApp = true;
            } else {
              _ytPlayer.playVideo();
              _soundtrackPlaying = true;
              _soundtrackPausedByApp = false;
            }
            _dispatchSoundtrackState();
          }
          return;
        }
      } catch (e) {
        console.warn('Could not read YT video data, recreating player:', e);
      }
    }

    // Destroy existing player first
    stopSoundtrack();

    _onYTApiReady(() => {
      const container = document.getElementById('soundtrack-video-container');
      if (!container) return;

      const placeholder = document.createElement('div');
      placeholder.id = 'yt-player-placeholder';
      container.appendChild(placeholder);

      _ytPlayer = new YT.Player('yt-player-placeholder', {
        width: '300',
        height: '168',
        videoId: videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: (autoplay && !_appMuted) ? 1 : 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          loop: 1,
          playlist: videoId, // looping on YT requires single-item playlist of the same video ID
          enablejsapi: 1,
          origin: window.location.protocol === 'file:' ? undefined : window.location.origin
        },
        events: {
          onReady: (event) => {
            _updateYTVolume();
            if (autoplay) {
              if (_appMuted) {
                _soundtrackPlaying = false;
                _soundtrackPausedByApp = true;
              } else {
                event.target.playVideo();
                _soundtrackPlaying = true;
                _soundtrackPausedByApp = false;
              }
            } else {
              _soundtrackPlaying = false;
              _soundtrackPausedByApp = false;
            }
            _dispatchSoundtrackState();
          },
          onStateChange: (event) => {
            if (event.data === 1) { // YT.PlayerState.PLAYING
              _soundtrackPlaying = true;
              _soundtrackPausedByApp = false;
            } else if (event.data === 2 || event.data === 0) { // YT.PlayerState.PAUSED or ENDED
              _soundtrackPlaying = false;
            }
            _dispatchSoundtrackState();
          }
        }
      });
    });
  }

  function pauseSoundtrack() {
    if (_ytPlayer && typeof _ytPlayer.pauseVideo === 'function') {
      _ytPlayer.pauseVideo();
    }
    _soundtrackPlaying = false;
    _soundtrackPausedByApp = false;
    _dispatchSoundtrackState();
  }

  function stopSoundtrack() {
    if (_ytPlayer) {
      try {
        _ytPlayer.destroy();
      } catch (e) {
        console.error('Error destroying YT player:', e);
      }
      _ytPlayer = null;
    }
    const container = document.getElementById('soundtrack-video-container');
    if (container) {
      container.innerHTML = '';
    }
    _soundtrackPlaying = false;
    _soundtrackPausedByApp = false;
    _dispatchSoundtrackState();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Initialize Web Audio graph
    _initWebAudio();

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
    _initUiSoundPools();

    // Handle mobile backgrounding page visibility API
    if (isMobile) {
      document.addEventListener('visibilitychange', () => {
        _mobileHiddenMuted = document.hidden;
        if (!document.hidden) {
          // Try to play in case the mobile OS paused it in the background
          _ambienceTracks.forEach(track => {
            const activeEl = track.elements[track.activeIndex];
            if (activeEl.paused) {
              activeEl.play().catch(() => {});
            }
          });
        }
        _updateAmbienceVolume();
      });
    }
  }

  function resumeAmbience() {
    // Ensure Web Audio is initialized & un-suspended
    if (!_webAudioInitialized) {
      _initWebAudio();
    } else if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }

    if (!_initialized) {
      init();
      return;
    }
    _ambienceTracks.forEach(track => {
      const activeEl = track.elements[track.activeIndex];
      if (activeEl.paused) {
        activeEl.play().catch(err => console.warn('Ambience play blocked:', err));
      }
    });
  }

  function playPulse() {
    if (!_initialized || _masterMuted || _categories.effects.muted) return;

    const audio = _pulsePool[_pulsePoolIndex];
    audio.volume = _getEffectiveVolume('effects');
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _pulsePoolIndex = (_pulsePoolIndex + 1) % PULSE_POOL_SIZE;
  }

  function playRefresh() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb
    if (_playUiSoundWithReverb('refresh', 1.0)) {
      return;
    }
    
    // Legacy HTML5 Audio Pool Fallback
    const audio = _refreshPool[_refreshPoolIndex];
    audio.volume = _getEffectiveVolume('buttons') * _individualVolumes.refresh;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _refreshPoolIndex = (_refreshPoolIndex + 1) % REFRESH_POOL_SIZE;
  }

  function playClick() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb
    if (_playUiSoundWithReverb('click', 1.0)) {
      return;
    }
    
    // Legacy HTML5 Audio Pool Fallback
    const audio = _clickPool[_clickPoolIndex];
    audio.volume = _getEffectiveVolume('buttons') * _individualVolumes.click;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _clickPoolIndex = (_clickPoolIndex + 1) % CLICK_POOL_SIZE;
  }

  function playSelect() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb
    if (_playUiSoundWithReverb('select', 1.0)) {
      return;
    }
    
    // Legacy HTML5 Audio Pool Fallback
    const audio = _selectPool[_selectPoolIndex];
    audio.volume = _getEffectiveVolume('buttons') * _individualVolumes.select;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _selectPoolIndex = (_selectPoolIndex + 1) % SELECT_POOL_SIZE;
  }

  function playWindowOpen() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb
    if (_playUiSoundWithReverb('windowOpen', 1.0)) {
      return;
    }
    
    // Legacy HTML5 Audio Pool Fallback
    const audio = _windowOpenPool[_windowOpenPoolIndex];
    audio.volume = _getEffectiveVolume('buttons') * _individualVolumes.windowOpen;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _windowOpenPoolIndex = (_windowOpenPoolIndex + 1) % WINDOW_OPEN_POOL_SIZE;
  }

  function playWindowClose() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb and reversed buffer
    if (_playUiSoundWithReverb('windowClose', 1.0)) {
      return;
    }
  }

  function playAppOpen() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb
    if (_playUiSoundWithReverb('appOpen', 1.0)) {
      return;
    }
    
    // Legacy HTML5 Audio Pool Fallback
    const audio = _appOpenPool[_appOpenPoolIndex];
    audio.volume = _getEffectiveVolume('buttons') * _individualVolumes.appOpen;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    _appOpenPoolIndex = (_appOpenPoolIndex + 1) % APP_OPEN_POOL_SIZE;
  }

  function playAppClose() {
    if (!_initialized || _masterMuted || _categories.buttons.muted) return;
    
    // Attempt Web Audio API with convolution reverb and reversed windowOpen buffer
    if (_playUiSoundWithReverb('windowClose', 1.0)) {
      return;
    }
  }

  function startHum() {
    // Lazy initialize Web Audio if not done yet
    if (!_webAudioInitialized) {
      _initWebAudio();
    }
    
    if (!_webAudioInitialized || !_webAudioSupported) return;
    
    // If already active, don't start it again
    if (_humActive) return;
    _humActive = true;

    try {
      if (_audioCtx.state === 'suspended') {
        _audioCtx.resume();
      }
      
      const now = _audioCtx.currentTime;
      
      // Create main Gain Node for the hum
      _humGain = _audioCtx.createGain();
      _humGain.gain.setValueAtTime(0, now);
      // Elevated idle drone volume (0.11 instead of 0.22, scaled by effects volume)
      const effectsVol = _getEffectiveVolume('effects');
      _humGain.gain.linearRampToValueAtTime(0.11 * effectsVol * _individualVolumes.hum, now + 0.15);
      
      // Create BiquadFilterNode (resonant low-pass filter)
      _humFilter = _audioCtx.createBiquadFilter();
      _humFilter.type = 'lowpass';
      _humFilter.Q.setValueAtTime(4.0, now); // Warm, organic resonance at idle
      _humFilter.frequency.setValueAtTime(220, now); // Warm low-pass cutoff frequency
      
      // Create Oscillator 1 (deep sub-bass triangle base drone at 48Hz, ~G1 note for lower hum)
      _humOsc1 = _audioCtx.createOscillator();
      _humOsc1.type = 'triangle';
      _humOsc1.frequency.setValueAtTime(48, now);
      
      // Create Oscillator 2 (cybernetic sawtooth octave harmonic at 96Hz, detuned)
      _humOsc2 = _audioCtx.createOscillator();
      _humOsc2.type = 'sawtooth';
      _humOsc2.frequency.setValueAtTime(96, now); // ~G2 octave
      _humOsc2.detune.setValueAtTime(-6, now); // Detuned by -6 cents for natural beating
      
      // Create Gain Node for Oscillator 2 to blend its buzz in subtly
      _humOsc2Gain = _audioCtx.createGain();
      _humOsc2Gain.gain.setValueAtTime(0.05, now); // Quiet, subtle textures at rest
      
      // Create Oscillator 3 (hollow cybernetic square fifth harmonic at 144Hz, detuned)
      _humOsc3 = _audioCtx.createOscillator();
      _humOsc3.type = 'square';
      _humOsc3.frequency.setValueAtTime(144, now); // ~D3 perfect fifth harmonic
      _humOsc3.detune.setValueAtTime(6, now); // Detuned by +6 cents
      
      // Create Gain Node for Oscillator 3 to blend its hollow tone in subtly
      _humOsc3Gain = _audioCtx.createGain();
      _humOsc3Gain.gain.setValueAtTime(0.02, now); // Barely audible at rest
      
      // Create LFO 1 (Low-Frequency Oscillator) for buzzing vibrato/wobble
      _humLfo = _audioCtx.createOscillator();
      _humLfo.type = 'sine';
      _humLfo.frequency.setValueAtTime(5.5, now); // 5.5 Hz pitch wobble rate at rest
      
      // Create LFO Gain node to control modulation depth
      _humLfoGain = _audioCtx.createGain();
      _humLfoGain.gain.setValueAtTime(12, now); // +-12 Hz pitch wobble depth at rest
      
      // Create LFO 2 (Filter LFO) for organic "wah-wah" breathing pulsations
      _humFilterLfo = _audioCtx.createOscillator();
      _humFilterLfo.type = 'sine';
      _humFilterLfo.frequency.setValueAtTime(1.8, now); // Slow 1.8 Hz throbbing rate at rest
      
      // Create Filter LFO Gain node to control cutoff sweep depth
      _humFilterLfoGain = _audioCtx.createGain();
      _humFilterLfoGain.gain.setValueAtTime(45, now); // +-45 Hz filter cutoff throb depth at rest
      
      // Connections
      
      // 1. Wobble LFO modulates Oscillator 2 and 3 pitches (deep base sub-bass remains solid and clean)
      _humLfo.connect(_humLfoGain);
      _humLfoGain.connect(_humOsc2.frequency);
      _humLfoGain.connect(_humOsc3.frequency);
      
      // 2. Filter LFO modulates Filter Cutoff directly
      _humFilterLfo.connect(_humFilterLfoGain);
      _humFilterLfoGain.connect(_humFilter.frequency);
      
      // 3. Connect oscillators to low-pass filter
      _humOsc1.connect(_humFilter);
      
      _humOsc2.connect(_humOsc2Gain);
      _humOsc2Gain.connect(_humFilter);
      
      _humOsc3.connect(_humOsc3Gain);
      _humOsc3Gain.connect(_humFilter);
      
      // 4. Connect filter output to main hum gain
      _humFilter.connect(_humGain);
      
      // 5. Connect hum gain to BOTH dry and wet/reverb nodes for massive spaciousness!
      _humGain.connect(_dryGainNode);
      _humGain.connect(_reverbNode);
      
      // Start all oscillators and LFOs
      _humLfo.start(now);
      _humFilterLfo.start(now);
      _humOsc1.start(now);
      _humOsc2.start(now);
      _humOsc3.start(now);
      
    } catch (e) {
      console.warn("Failed to start synth hum:", e);
      _humActive = false;
    }
  }

  function updateHum(speed) {
    if (!_humActive || !_webAudioInitialized || !_webAudioSupported || !_audioCtx) return;
    
    try {
      const now = _audioCtx.currentTime;
      // Clamp speed between 0.0 (idle/holding) and 1.0 (maximum spin velocity)
      const s = Math.max(0.0, Math.min(1.0, speed));
      _lastHumSpeed = s;
      
      // 1. Dynamic Pitch Sweep (extremely minor drift to keep the hum deep, low, and cybernetic)
      const baseFreq = 48 + s * 4; // 48 Hz -> 52 Hz (deep G1 sub-bass drone)
      const harmonicFreq2 = 96 + s * 8; // 96 Hz -> 104 Hz
      const harmonicFreq3 = 144 + s * 12; // 144 Hz -> 156 Hz
      
      // 2. Timbral Buzz Swells (higher speed morphs to brighter, harsher crackles)
      const osc2GainTarget = 0.05 + s * 0.35; // 5% -> 40% gain blend
      const osc3GainTarget = 0.02 + s * 0.20; // 2% -> 22% gain blend
      
      // 3. Dynamic Filter Cutoff & Resonance (Q) Sweeps (smoothly opening up filter)
      const filterCutoff = 220 + s * 880; // 220 Hz -> 1100 Hz (warm and heavy)
      const filterQ = 4.0 + s * 4.0; // Q factor of 4.0 -> 8.0 (resonant whistling, but not too piercing)
      
      // 4. Dynamic Volume Swell (reduced by half and scaled by active effects volume slider)
      const effectsVol = _getEffectiveVolume('effects');
      const targetVolume = (0.11 + s * 0.13) * effectsVol * _individualVolumes.hum;
      
      // 5. LFO Speed & Depth Sweeps (LFOs fade out at peak speed for a solid, steady sound!)
      const wobbleLfoSpeed = 5.5 + s * 4.5; // 5.5 Hz -> 10 Hz
      const wobbleLfoDepth = 12 * (1.0 - s); // 12 Hz -> 0 Hz depth (wobble fades out completely at peak!)
      
      const filterLfoSpeed = 1.8 + s * 2.2; // 1.8 Hz -> 4 Hz
      const filterLfoDepth = 45 * (1.0 - s); // 45 Hz -> 0 Hz depth (filter throb fades out completely at peak!)
      
      // Apply parameter changes smoothly using setTargetAtTime
      const timeConstant = 0.1; // 100ms response time constant
      
      _humOsc1.frequency.setTargetAtTime(baseFreq, now, timeConstant);
      _humOsc2.frequency.setTargetAtTime(harmonicFreq2, now, timeConstant);
      _humOsc3.frequency.setTargetAtTime(harmonicFreq3, now, timeConstant);
      
      _humOsc2Gain.gain.setTargetAtTime(osc2GainTarget, now, timeConstant);
      _humOsc3Gain.gain.setTargetAtTime(osc3GainTarget, now, timeConstant);
      
      _humFilter.frequency.setTargetAtTime(filterCutoff, now, timeConstant);
      _humFilter.Q.setTargetAtTime(filterQ, now, timeConstant);
      _humGain.gain.setTargetAtTime(targetVolume, now, timeConstant);
      
      _humLfo.frequency.setTargetAtTime(wobbleLfoSpeed, now, timeConstant);
      _humFilterLfo.frequency.setTargetAtTime(filterLfoSpeed, now, timeConstant);
      _humFilterLfoGain.gain.setTargetAtTime(filterLfoDepth, now, timeConstant);
      
    } catch (e) {
      console.warn("Failed to update synth hum parameters:", e);
    }
  }

  function stopHum() {
    if (!_humActive) return;
    _humActive = false;
    
    if (!_webAudioInitialized || !_webAudioSupported || !_audioCtx || !_humGain) return;
    
    try {
      const now = _audioCtx.currentTime;
      const fadeDuration = 0.25; // 250ms fade out to prevent clicking
      
      const osc1 = _humOsc1;
      const osc2 = _humOsc2;
      const osc3 = _humOsc3;
      const osc2Gain = _humOsc2Gain;
      const osc3Gain = _humOsc3Gain;
      const lfo = _humLfo;
      const lfoGain = _humLfoGain;
      const filterLfo = _humFilterLfo;
      const filterLfoGain = _humFilterLfoGain;
      const filter = _humFilter;
      const gain = _humGain;
      
      _humOsc1 = null;
      _humOsc2 = null;
      _humOsc3 = null;
      _humOsc2Gain = null;
      _humOsc3Gain = null;
      _humLfo = null;
      _humLfoGain = null;
      _humFilterLfo = null;
      _humFilterLfoGain = null;
      _humFilter = null;
      _humGain = null;
      
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.001, now + fadeDuration);
      
      setTimeout(() => {
        try {
          if (osc1) {
            osc1.stop();
            osc1.disconnect();
          }
          if (osc2) {
            osc2.stop();
            osc2.disconnect();
          }
          if (osc3) {
            osc3.stop();
            osc3.disconnect();
          }
          if (osc2Gain) {
            osc2Gain.disconnect();
          }
          if (osc3Gain) {
            osc3Gain.disconnect();
          }
          if (lfo) {
            lfo.stop();
            lfo.disconnect();
          }
          if (lfoGain) {
            lfoGain.disconnect();
          }
          if (filterLfo) {
            filterLfo.stop();
            filterLfo.disconnect();
          }
          if (filterLfoGain) {
            filterLfoGain.disconnect();
          }
          if (filter) {
            filter.disconnect();
          }
          if (gain) {
            gain.disconnect();
          }
        } catch (e) {
          // Ignore errors
        }
      }, fadeDuration * 1000 + 50);
      
    } catch (e) {
      console.warn("Failed to stop synth hum:", e);
    }
  }

  function playButton() {
    playClick();
  }

  function setVolume(category, value) {
    if (!_categories[category]) return;
    _categories[category].volume = Math.max(0, Math.min(1, value));

    if (category === 'ambience') {
      _updateAmbienceVolume();
    } else if (category === 'effects') {
      _pulsePool.forEach(a => {
        if (a._fadeInterval) clearInterval(a._fadeInterval);
        a.volume = _getEffectiveVolume('effects') * _individualVolumes.pulse;
      });
      if (_humActive) {
        updateHum(_lastHumSpeed);
      }
    } else if (category === 'buttons') {
      _clickPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.click; });
      _selectPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.select; });
      _windowOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.windowOpen; });
      _appOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.appOpen; });
      _refreshPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.refresh; });
      _updateWebAudioButtonVolume();
    } else if (category === 'soundtrack') {
      _updateYTVolume();
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
        a.volume = _getEffectiveVolume('effects') * _individualVolumes.pulse;
      });
      if (_humActive) {
        updateHum(_lastHumSpeed);
      }
    } else if (category === 'buttons') {
      _clickPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.click; });
      _selectPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.select; });
      _windowOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.windowOpen; });
      _appOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.appOpen; });
      _refreshPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.refresh; });
      _updateWebAudioButtonVolume();
    } else if (category === 'soundtrack') {
      _updateYTVolume();
      _dispatchSoundtrackState();
    }
  }

  function setMasterMute(muted) {
    _masterMuted = muted;
    _updateAmbienceVolume();
    _pulsePool.forEach(a => {
      if (a._fadeInterval) clearInterval(a._fadeInterval);
      a.volume = _getEffectiveVolume('effects') * _individualVolumes.pulse;
    });
    _clickPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.click; });
    _selectPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.select; });
    _windowOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.windowOpen; });
    _appOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.appOpen; });
    _refreshPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.refresh; });
    _updateWebAudioButtonVolume();
    if (_humActive) {
      updateHum(_lastHumSpeed);
    }

    if (_ytPlayer && typeof _ytPlayer.mute === 'function') {
      _updateYTVolume();
      if (muted) {
        _ytPlayer.pauseVideo();
      } else if (_soundtrackPlaying && !_categories.soundtrack.muted) {
        _ytPlayer.playVideo();
      }
    }
    _dispatchSoundtrackState();
  }

  function _updateAmbienceVolume() {
    const vol = _getEffectiveVolume('ambience');
    _ambienceTracks.forEach(track => {
      const activeEl = track.elements[track.activeIndex];
      if (!activeEl.paused) {
        // Smoothly fade to the new volume over 0.5s to prevent pops!
        const mult = track.src.includes('ambience_1') ? _individualVolumes.ambience1 : _individualVolumes.ambience2;
        _fadeVolume(activeEl, activeEl.volume, vol * mult, 0.5);
      }
    });
  }

  function getConfig() {
    return {
      masterMuted: _masterMuted,
      ambience: { ..._categories.ambience },
      effects:  { ..._categories.effects },
      buttons:  { ..._categories.buttons },
      soundtrack: { ..._categories.soundtrack },
      individualVolumes: { ..._individualVolumes }
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
    if (config.soundtrack) {
      if (config.soundtrack.volume !== undefined) _categories.soundtrack.volume = config.soundtrack.volume;
      if (config.soundtrack.muted !== undefined) _categories.soundtrack.muted = config.soundtrack.muted;
      if (config.soundtrack.url !== undefined) _categories.soundtrack.url = config.soundtrack.url;
    }
    if (config.individualVolumes) {
      Object.assign(_individualVolumes, config.individualVolumes);
    }

    // Update live volumes if already initialized
    if (_initialized) {
      _updateAmbienceVolume();
      _pulsePool.forEach(a => { a.volume = _getEffectiveVolume('effects') * _individualVolumes.pulse; });
      _clickPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.click; });
      _selectPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.select; });
      _windowOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.windowOpen; });
      _appOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.appOpen; });
      _refreshPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.refresh; });
      _updateWebAudioButtonVolume();
      _updateYTVolume();
    }
    _dispatchSoundtrackState();
  }

  function setAppMuted(muted) {
    if (_appMuted === muted) return;
    _appMuted = muted;

    _updateAmbienceVolume();
    _updateYTVolume();
    if (_humActive) {
      updateHum(_lastHumSpeed);
    }

    if (_ytPlayer && typeof _ytPlayer.mute === 'function') {
      if (muted) {
        if (_soundtrackPlaying) {
          _ytPlayer.pauseVideo();
          _soundtrackPlaying = false;
          _soundtrackPausedByApp = true;
          _dispatchSoundtrackState();
        }
      } else {
        if (_soundtrackPausedByApp) {
          _ytPlayer.playVideo();
          _soundtrackPlaying = true;
          _soundtrackPausedByApp = false;
          _dispatchSoundtrackState();
        }
      }
    }
  }

  function setIndividualVolume(key, value) {
    if (_individualVolumes[key] === undefined) return;
    _individualVolumes[key] = Math.max(0, Math.min(2.0, value)); // Allow up to 200% scaling boost

    // Dynamically update the specific sound levels in real-time
    if (!_initialized) return;

    if (key === 'click') {
      _clickPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.click; });
    } else if (key === 'select') {
      _selectPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.select; });
    } else if (key === 'windowOpen') {
      _windowOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.windowOpen; });
    } else if (key === 'appOpen') {
      _appOpenPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.appOpen; });
    } else if (key === 'refresh') {
      _refreshPool.forEach(a => { a.volume = _getEffectiveVolume('buttons') * _individualVolumes.refresh; });
    } else if (key === 'pulse') {
      _pulsePool.forEach(a => { a.volume = _getEffectiveVolume('effects') * _individualVolumes.pulse; });
    } else if (key === 'hum') {
      if (_humActive) {
        updateHum(_lastHumSpeed);
      }
    } else if (key === 'ambience1' || key === 'ambience2') {
      _updateAmbienceVolume();
    }
  }

  function getIndividualVolumes() {
    return { ..._individualVolumes };
  }

  function isMasterMuted() { return _masterMuted; }
  function getCategory(cat) { return _categories[cat] ? { ..._categories[cat] } : null; }

  return {
    init,
    resumeAmbience,
    playPulse,
    playButton,
    playClick,
    playRefresh,
    playSelect,
    playWindowOpen,
    playWindowClose,
    playAppOpen,
    playAppClose,
    startHum,
    updateHum,
    stopHum,
    setVolume,
    setMute,
    setMasterMute,
    setAppMuted,
    setIndividualVolume,
    getIndividualVolumes,
    isMasterMuted,
    getCategory,
    getConfig,
    applyConfig,
    playSoundtrack,
    pauseSoundtrack,
    stopSoundtrack
  };
})();
