/**
 * segment.js — Adaptive segmentation for static landing pages
 * Drop into <head> as an inline <script> (before CSS loads)
 * No dependencies, no cookies required, GDPR-safe
 */

(function () {
  // ─── 1. INSTANT SIGNALS (available before paint) ─────────────────────────

  const instant = {
    device: getDevice(),
    connection: getConnection(),
    timeSlot: getTimeSlot(),
    returning: getReturning(),
    darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    language: navigator.language?.slice(0, 2) || 'fr',
    touchScreen: navigator.maxTouchPoints > 0,
    referrer: getReferrer(),
    screenSize: getScreenSize(),
  };

  // ─── 2. APPLY INSTANT ATTRIBUTES TO <html> ───────────────────────────────

  const html = document.documentElement;
  html.dataset.device    = instant.device;
  html.dataset.conn      = instant.connection;
  html.dataset.time      = instant.timeSlot;
  html.dataset.visit     = instant.returning;
  html.dataset.ref       = instant.referrer;
  html.dataset.screen    = instant.screenSize;
  if (instant.darkMode)      html.dataset.theme   = 'dark';
  if (instant.reducedMotion) html.dataset.motion  = 'reduced';
  if (instant.touchScreen)   html.dataset.input   = 'touch';

  // ─── 3. BEHAVIORAL SIGNALS (collected during session) ────────────────────

  const behavior = {
    scrollDepth: 0,
    scrollSpeed: 'unknown',   // 'fast' | 'medium' | 'slow'
    timeOnPage: 0,
    idleTime: 0,
    sectionsFocused: [],
    clickCount: 0,
    mouseMovements: 0,
    profile: 'unknown',       // resolved after ~10s
  };

  let lastScrollY = 0;
  let lastScrollTime = Date.now();
  let scrollSpeeds = [];
  let startTime = Date.now();
  let idleTimer = null;
  let resolved = false;

  // Scroll tracking
  window.addEventListener('scroll', () => {
    const now = Date.now();
    const dy = Math.abs(window.scrollY - lastScrollY);
    const dt = now - lastScrollTime;
    if (dt > 0 && dy > 0) {
      const speed = dy / dt; // px/ms
      scrollSpeeds.push(speed);
      if (scrollSpeeds.length > 20) scrollSpeeds.shift();
    }
    const maxDepth = document.body.scrollHeight - window.innerHeight;
    behavior.scrollDepth = maxDepth > 0
      ? Math.round((window.scrollY / maxDepth) * 100)
      : 0;
    lastScrollY = window.scrollY;
    lastScrollTime = now;
    resetIdle();
  }, { passive: true });

  // Click tracking
  document.addEventListener('click', () => {
    behavior.clickCount++;
    resetIdle();
  });

  // Mouse movement (desktop)
  document.addEventListener('mousemove', () => {
    behavior.mouseMovements++;
    resetIdle();
  }, { passive: true });

  // Idle detection
  function resetIdle() {
    behavior.idleTime = 0;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      behavior.idleTime = Math.round((Date.now() - startTime) / 1000);
      resolveProfile();
    }, 5000);
  }

  // Section focus tracking (IntersectionObserver)
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const id = e.target.id || e.target.dataset.section;
          if (id && !behavior.sectionsFocused.includes(id)) {
            behavior.sectionsFocused.push(id);
          }
        }
      });
    }, { threshold: 0.5 });

    document.querySelectorAll('section, [data-section]').forEach(s => {
      sectionObserver.observe(s);
    });
  }

  // ─── 4. PROFILE RESOLUTION ───────────────────────────────────────────────

  function resolveProfile() {
    if (resolved) return;

    behavior.timeOnPage = Math.round((Date.now() - startTime) / 1000);

    // Average scroll speed
    const avgSpeed = scrollSpeeds.length > 0
      ? scrollSpeeds.reduce((a, b) => a + b, 0) / scrollSpeeds.length
      : 0;

    if (avgSpeed > 2)       behavior.scrollSpeed = 'fast';
    else if (avgSpeed > 0.5) behavior.scrollSpeed = 'medium';
    else if (avgSpeed > 0)   behavior.scrollSpeed = 'slow';

    // Profile scoring
    const scores = {
      scanner:   0,  // rapide, survole, peu de temps
      reader:    0,  // lent, deep scroll, long time on page
      evaluator: 0,  // medium speed, clics, sections multiples
      bouncer:   0,  // très peu de scroll, pas d'interaction
    };

    // Scroll speed signals
    if (behavior.scrollSpeed === 'fast')   { scores.scanner += 3; scores.bouncer += 1; }
    if (behavior.scrollSpeed === 'medium') { scores.evaluator += 2; }
    if (behavior.scrollSpeed === 'slow')   { scores.reader += 3; }

    // Scroll depth signals
    if (behavior.scrollDepth > 70)        { scores.reader += 2; scores.evaluator += 1; }
    if (behavior.scrollDepth > 40)        { scores.evaluator += 1; }
    if (behavior.scrollDepth < 15)        { scores.bouncer += 3; scores.scanner += 1; }

    // Time signals
    if (behavior.timeOnPage > 60)         { scores.reader += 3; }
    if (behavior.timeOnPage > 20)         { scores.evaluator += 2; }
    if (behavior.timeOnPage < 8)          { scores.bouncer += 2; scores.scanner += 1; }

    // Engagement signals
    if (behavior.clickCount > 3)          { scores.evaluator += 3; scores.reader += 1; }
    if (behavior.clickCount === 0)        { scores.bouncer += 1; scores.scanner += 1; }
    if (behavior.sectionsFocused.length > 3) { scores.reader += 2; scores.evaluator += 1; }

    // Device modifier
    if (instant.device === 'mobile' && behavior.scrollSpeed === 'fast') {
      scores.scanner += 2;
    }
    if (instant.device === 'desktop' && behavior.timeOnPage > 30) {
      scores.evaluator += 1;
    }

    // Resolve winner
    const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    behavior.profile = winner;
    resolved = true;

    // Apply to DOM
    html.dataset.profile = winner;
    applyProfileTheme(winner);

    // Dispatch event for custom handlers
    window.dispatchEvent(new CustomEvent('segmentResolved', {
      detail: { profile: winner, behavior, instant }
    }));

    if (window.__SEG_DEBUG) {
      console.group('[segment.js] Profile resolved');
      console.log('Profile:', winner);
      console.log('Scores:', scores);
      console.log('Behavior:', behavior);
      console.log('Instant:', instant);
      console.groupEnd();
    }
  }

  // Resolve after 15s max even without idle
  setTimeout(resolveProfile, 15000);
  // Quick resolve at 8s for bouncer detection
  setTimeout(() => {
    if (!resolved && behavior.scrollDepth < 10 && behavior.clickCount === 0) {
      behavior.profile = 'bouncer';
      html.dataset.profile = 'bouncer';
      applyProfileTheme('bouncer');
    }
  }, 8000);

  // ─── 5. THEME APPLICATION ────────────────────────────────────────────────

  function applyProfileTheme(profile) {
    const themes = {
      scanner: {
        '--lp-font-size-body': '15px',
        '--lp-line-height': '1.5',
        '--lp-section-padding': '3rem 0',
        '--lp-cta-size': '1.1rem',
        '--lp-hero-headline-size': 'clamp(2.2rem, 5vw, 3.8rem)',
        '--lp-content-width': '680px',
        '--lp-animation-speed': '0.2s',
        '--lp-summary-display': 'block',   // affiche les bullet points résumés
        '--lp-longform-display': 'none',   // cache les blocs de texte long
      },
      reader: {
        '--lp-font-size-body': '17px',
        '--lp-line-height': '1.85',
        '--lp-section-padding': '5rem 0',
        '--lp-cta-size': '1rem',
        '--lp-hero-headline-size': 'clamp(1.8rem, 3.5vw, 2.8rem)',
        '--lp-content-width': '720px',
        '--lp-animation-speed': '0.5s',
        '--lp-summary-display': 'none',
        '--lp-longform-display': 'block',  // affiche les textes détaillés
      },
      evaluator: {
        '--lp-font-size-body': '16px',
        '--lp-line-height': '1.7',
        '--lp-section-padding': '4rem 0',
        '--lp-cta-size': '1.05rem',
        '--lp-hero-headline-size': 'clamp(2rem, 4vw, 3.2rem)',
        '--lp-content-width': '700px',
        '--lp-animation-speed': '0.35s',
        '--lp-summary-display': 'block',
        '--lp-longform-display': 'block',
      },
      bouncer: {
        '--lp-font-size-body': '16px',
        '--lp-line-height': '1.6',
        '--lp-section-padding': '3rem 0',
        '--lp-cta-size': '1.15rem',
        '--lp-hero-headline-size': 'clamp(2.4rem, 5.5vw, 4rem)',
        '--lp-content-width': '640px',
        '--lp-animation-speed': '0.15s',
        '--lp-summary-display': 'block',
        '--lp-longform-display': 'none',
      },
    };

    const vars = themes[profile] || themes.evaluator;
    Object.entries(vars).forEach(([k, v]) => {
      document.documentElement.style.setProperty(k, v);
    });

    // Bouncer: show sticky exit-intent banner after 3s
    if (profile === 'bouncer') {
      setTimeout(showExitBanner, 3000);
    }

    // Reader: reveal long-form sections
    if (profile === 'reader') {
      document.querySelectorAll('.lp-longform').forEach(el => {
        el.style.display = 'block';
      });
    }

    // Scanner: show summary bullets, hide verbose blocks
    if (profile === 'scanner') {
      document.querySelectorAll('.lp-summary').forEach(el => {
        el.style.display = 'block';
      });
      document.querySelectorAll('.lp-longform').forEach(el => {
        el.style.display = 'none';
      });
    }
  }

  // ─── 6. EXIT INTENT BANNER (pour bouncers) ───────────────────────────────

  function showExitBanner() {
    if (document.getElementById('seg-exit-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'seg-exit-banner';
    banner.innerHTML = `
      <div style="
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
        background: var(--lp-accent, #1a1a1a); color: #fff;
        padding: 1rem 1.5rem; display: flex; align-items: center;
        justify-content: space-between; gap: 1rem;
        border-top: 2px solid var(--lp-highlight, #fff);
        animation: slideUp 0.3s ease;
      ">
        <p style="margin:0;font-size:14px;">
          <strong>Avant de partir</strong> — Livraison en 24h, garanti.
        </p>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <a href="#contact" style="
            background:#fff; color:#1a1a1a; padding:8px 16px;
            border-radius:6px; font-size:13px; font-weight:600;
            text-decoration:none; white-space:nowrap;
          ">Voir l'offre</a>
          <button onclick="this.closest('#seg-exit-banner').remove()" style="
            background:transparent; border:1px solid rgba(255,255,255,0.4);
            color:#fff; padding:8px 12px; border-radius:6px;
            font-size:13px; cursor:pointer;
          ">✕</button>
        </div>
      </div>
      <style>
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      </style>
    `;
    document.body.appendChild(banner);
  }

  // ─── 7. GOOGLE REFERRER KEYWORD DETECTION ────────────────────────────────

  function getReferrer() {
    const ref = document.referrer;
    if (!ref) return 'direct';
    if (ref.includes('google'))    return 'google';
    if (ref.includes('bing'))      return 'bing';
    if (ref.includes('instagram')) return 'instagram';
    if (ref.includes('linkedin'))  return 'linkedin';
    if (ref.includes('facebook'))  return 'facebook';
    if (ref.includes('twitter') || ref.includes('x.com')) return 'twitter';
    return 'other';
  }

  // ─── 8. HELPERS ──────────────────────────────────────────────────────────

  function getDevice() {
    const ua = navigator.userAgent;
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    if (/mobile|iphone|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function getConnection() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return 'unknown';
    const { effectiveType, saveData } = conn;
    if (saveData) return 'datasaver';
    if (effectiveType === '4g') return 'fast';
    if (effectiveType === '3g') return 'medium';
    return 'slow';
  }

  function getTimeSlot() {
    const h = new Date().getHours();
    if (h >= 6  && h < 10) return 'morning';
    if (h >= 10 && h < 14) return 'midday';
    if (h >= 14 && h < 18) return 'afternoon';
    if (h >= 18 && h < 23) return 'evening';
    return 'night';
  }

  function getReturning() {
    try {
      const key = 'seg_visits';
      const count = parseInt(localStorage.getItem(key) || '0') + 1;
      localStorage.setItem(key, count);
      if (count === 1) return 'new';
      if (count === 2) return 'returning';
      return 'loyal';
    } catch { return 'unknown'; }
  }

  function getScreenSize() {
    const w = window.screen.width;
    if (w < 390) return 'small';
    if (w < 768) return 'medium';
    if (w < 1280) return 'large';
    return 'xlarge';
  }

  // ─── 9. PUBLIC API ────────────────────────────────────────────────────────

  window.Segment = {
    getInstant: () => instant,
    getBehavior: () => behavior,
    getProfile: () => behavior.profile,
    onResolved: (cb) => window.addEventListener('segmentResolved', e => cb(e.detail)),
    debug: () => { window.__SEG_DEBUG = true; },
  };

})();
