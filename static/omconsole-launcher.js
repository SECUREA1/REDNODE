(() => {
  if (window.__omconsoleLauncherLoaded) return;
  window.__omconsoleLauncherLoaded = true;

  const PIN_KEY = 'omconsole_pinned';
  const OVERLAY_ID = 'omconsole-overlay';
  const BTN_ID = 'omconsole-launch-btn';
  const WRAP_ID = 'omconsole-launch-wrap';
  // Use an absolute URL so the iframe loads correctly from nested routes
  // (e.g., /live/) instead of resolving relative to the current page.
  const FRAME_URL = '/omconsole_render_single_games_ROUTING.html';
  const isConsolePage = location.pathname.includes('omconsole_render_single_games_ROUTING.html');

  let pinned = false;
  let overlay = null;
  let button = null;

  const applyStyles = (el, styles) => Object.assign(el.style, styles);

  function updateButton() {
    if (!button) return;
    button.textContent = pinned ? 'OMConsole Active' : 'Open OMConsole';
    button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    applyStyles(button, pinned
      ? { background: 'linear-gradient(135deg, #d4af37, #f2d57a)', color: '#061022', borderColor: 'rgba(255,255,255,0.35)' }
      : { background: 'linear-gradient(180deg, #0b2a66, #0a1e3a)', color: '#eaf2ff', borderColor: 'rgba(212,175,55,0.35)' }
    );
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function buildOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    applyStyles(overlay, {
      position: 'fixed',
      bottom: '76px',
      right: '16px',
      width: 'min(520px, 90vw)',
      height: 'min(380px, 70vh)',
      display: 'flex',
      flexDirection: 'column',
      backdropFilter: 'blur(12px)',
      background: 'rgba(7,20,40,0.82)',
      borderRadius: '18px',
      border: '1px solid rgba(212,175,55,0.35)',
      boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
      overflow: 'hidden',
      zIndex: '99998'
    });

    const bar = document.createElement('div');
    applyStyles(bar, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 12px',
      background: 'linear-gradient(180deg, rgba(13,31,60,0.82), rgba(7,20,40,0.68))',
      color: '#eaf2ff',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fontWeight: '700',
      letterSpacing: '.22px',
      borderBottom: '1px solid rgba(212,175,55,0.28)'
    });
    bar.textContent = 'OMConsole — Cursor + Control (active)';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    applyStyles(close, {
      marginLeft: '12px',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      width: '32px',
      height: '32px',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: '24px'
    });
    close.addEventListener('click', () => setPinned(false));
    bar.appendChild(close);

    const iframe = document.createElement('iframe');
    iframe.src = FRAME_URL;
    iframe.title = 'OMConsole';
    iframe.allow = 'camera; microphone; fullscreen; clipboard-read; clipboard-write';
    iframe.loading = 'lazy';
    applyStyles(iframe, {
      flex: '1 1 auto',
      border: '0',
      width: '100%',
      height: '100%',
      background: '#050b16'
    });

    overlay.append(bar, iframe);
    document.body.appendChild(overlay);
    return overlay;
  }

  function setPinned(next, skipSave = false) {
    pinned = !!next;
    if (!skipSave) {
      localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
    }
    if (pinned) {
      if (!isConsolePage) {
        buildOverlay();
      }
    } else {
      removeOverlay();
    }
    updateButton();
  }

  function syncFromStorage() {
    const next = localStorage.getItem(PIN_KEY) === '1';
    setPinned(next, true);
  }

  function buildButton() {
    if (button) return button;
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    applyStyles(wrap, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '99997',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    });

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Open OMConsole';
    btn.title = 'Launch the OMConsole cursor/control overlay';
    applyStyles(btn, {
      borderRadius: '14px',
      border: '1px solid rgba(212,175,55,0.35)',
      padding: '10px 14px',
      cursor: 'pointer',
      boxShadow: '0 18px 40px rgba(0,0,0,0.3)',
      fontWeight: '800',
      letterSpacing: '.2px',
      fontSize: '13px'
    });
    btn.addEventListener('click', () => setPinned(!pinned));

    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    button = btn;
    updateButton();
    return btn;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!isConsolePage) {
      buildButton();
    }
    syncFromStorage();

    window.addEventListener('storage', (e) => {
      if (e.key === PIN_KEY) {
        syncFromStorage();
      }
    });

    window.omconsoleLauncher = {
      open: () => setPinned(true),
      close: () => setPinned(false),
      isActive: () => pinned
    };
  });
})();
