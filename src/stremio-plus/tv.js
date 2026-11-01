// TV mode and remotes. TV mode is Stremio for the couch: full screen, the
// interface scaled up, and a focus highlight that moves with the arrow keys, a
// game controller or the Siri Remote (select opens, back goes back). Remotes and
// media keys (src/remotecontrol.mm) also control the player in any mode, and
// what's playing is published to Control Center's Now Playing.
// Plugins reach it through window.stremioPlusShell.tvMode.
(function () {
    if (window.__spTv) return;
    window.__spTv = true;

    var runtime = window.__spRuntime;
    var commands = window.__spCommands;

    var FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [class*="button-container"]';
    var REPEAT_DELAY = 420, REPEAT_EVERY = 130;
    var PRIMARY = ['.cd-watch', '.hero-overlay-actions button', '[class*="action-button"][class*="wide"]', '[class*="meta-item-container"] > a'];

    var active = false;
    var focused = null;
    var idleTimer = null;

    function channel() { return window.__stremioPlusChannel; }
    function shell() { return channel().then(function (o) { return o.shellBridge; }); }
    function inPlayer() { return location.hash.indexOf('#/player') === 0; }
    function isHome() { var h = location.hash; return h === '' || h === '#' || h === '#/'; }

    var CSS = '' +
        // Focus: a bright ring drawn inside the element (scrolling rows can't clip
        // it), a soft halo and a slight lift
        'html.sp-tv .sp-tv-focus:not([class*="meta-item"]):not(.cd-card) { outline: none !important; transform: scale(1.06);' +
        '  box-shadow: inset 0 0 0 2.5px rgba(255,255,255,0.95), 0 0 0 5px rgba(255,255,255,0.14), 0 14px 36px rgba(0,0,0,0.45) !important;' +
        '  transition: transform .28s cubic-bezier(0.32,0.72,0,1), box-shadow .2s ease !important; }' +
        // Posters and episode cards: the whole card lifts and an inner ring is drawn
        // on its image. (Scaling the clipped image box itself lets the image escape
        // its rounded clip and cover the ring.)
        'html.sp-tv [class*="meta-item-container"] > a, html.sp-tv .cd-card { transition: transform .32s cubic-bezier(0.32,0.72,0,1) !important; }' +
        'html.sp-tv [class*="meta-item-container"] > a.sp-tv-focus, html.sp-tv .cd-card.sp-tv-focus { outline: none !important; box-shadow: none !important; transform: scale(1.06); }' +
        'html.sp-tv .cd-card.sp-tv-focus { transform: scale(1.04); transform-origin: center top; }' +
        'html.sp-tv [class*="meta-item-container"] > a.sp-tv-focus [class*="poster-container"], html.sp-tv .cd-card.sp-tv-focus .cd-thumb { box-shadow: 0 20px 48px rgba(0,0,0,0.55) !important; }' +
        'html.sp-tv [class*="meta-item-container"] > a.sp-tv-focus [class*="poster-container"]::after, html.sp-tv .cd-card.sp-tv-focus .cd-thumb::after {' +
        '  content: ""; position: absolute; inset: 0; z-index: 60; border-radius: inherit; box-shadow: inset 0 0 0 3px rgba(255,255,255,0.95); pointer-events: none; }' +
        // Scrolling rows clip what's drawn outside them; give the lift room
        'html.sp-tv .cd-rail { padding-top: 14px; padding-bottom: 18px; }' +
        'html.sp-tv [class*="meta-items-container"] { padding-top: 14px !important; padding-bottom: 18px !important; }' +
        '@media (prefers-reduced-motion: reduce) { html.sp-tv .sp-tv-focus { transform: none !important; } }' +
        // The pointer hides while the remote is in use
        'html.sp-tv.sp-tv-idle, html.sp-tv.sp-tv-idle * { cursor: none !important; }' +
        '';

    // ── Focus engine ─────────────────────────────────────────────────────────
    function isVisible(el) {
        var r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return false;
        if (r.bottom < -window.innerHeight || r.top > window.innerHeight * 2) return false;
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) return false;
        return el.offsetParent !== null || cs.position === 'fixed';
    }

    // Whatever is open on top takes the focus: a menu, a sheet, a popup
    function scope() {
        var layers = [
            // Stremio+'s own prompts sit above everything
            document.querySelector('#sp-permission .sp-perm-card'),
            document.querySelector('#sp-review .rv-card'),
            document.querySelector('.context-menu-portal [class*="menu-container"]'),
            document.querySelector('.sb-menu.open'),
            document.querySelector('.sb-searchbox.open'),
            window.__st_isOpen && window.__st_isOpen() ? document.getElementById('__st_panel__') : null,
            document.querySelector('.cd-on.cd-sheet [class*="streams-list-container"]'),
            document.querySelector('[class*="modal-container"]'),
        ];
        for (var i = 0; i < layers.length; i++) if (layers[i] && isVisible(layers[i])) return layers[i];
        return document.body;
    }

    function candidates(root) {
        var seen = new Set();
        return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
            // A poster's link stands for the whole poster
            if (el.closest('[class*="meta-item-container"]') && !el.matches('[class*="meta-item-container"] > a')) return false;
            // Skip wrappers whose own focusable child is the real target
            if (seen.has(el)) return false;
            seen.add(el);
            return !el.disabled && isVisible(el);
        });
    }

    function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }

    // The nearest candidate in a direction, preferring the same row or column
    function nearest(from, dir, list) {
        var r = from.getBoundingClientRect();
        var best = null, bestScore = Infinity;
        list.forEach(function (el) {
            if (el === from || el.contains(from) || from.contains(el)) return;
            var c = el.getBoundingClientRect();
            var primary, ortho;
            if (dir === 'right' || dir === 'left') {
                primary = dir === 'right' ? c.left - r.right : r.left - c.right;
                // The candidate's centre has to be past the edge in that direction
                if (dir === 'right' ? c.left + c.width / 2 < r.right - 4 : c.left + c.width / 2 > r.left + 4) return;
                ortho = overlap(r.top, r.bottom, c.top, c.bottom) > 0 ? 0 : Math.min(Math.abs(c.top - r.bottom), Math.abs(r.top - c.bottom));
            } else {
                primary = dir === 'down' ? c.top - r.bottom : r.top - c.bottom;
                if (dir === 'down' ? c.top + c.height / 2 < r.bottom - 4 : c.top + c.height / 2 > r.top + 4) return;
                ortho = overlap(r.left, r.right, c.left, c.right) > 0 ? 0 : Math.min(Math.abs(c.left - r.right), Math.abs(r.left - c.right));
            }
            var score = Math.max(0, primary) + ortho * 3;
            if (score < bestScore) { bestScore = score; best = el; }
        });
        return best;
    }

    function setFocus(el) {
        if (!el) return;
        if (focused) focused.classList.remove('sp-tv-focus');
        focused = el;
        if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
        el.classList.add('sp-tv-focus');
        reveal(el);
    }

    // Scrolls the focus into view. Unlike scrollIntoView, each container only
    // moves along the axis it scrolls on: a sideways row never shifts up and
    // hides the room left above its items for the focus ring.
    function reveal(el) {
        var behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        var r = el.getBoundingClientRect();
        var marginX = Math.min(120, window.innerWidth * 0.08), marginY = Math.min(160, window.innerHeight * 0.16);
        var doneX = false, doneY = false;
        for (var node = el.parentElement; node && !(doneX && doneY); node = node.parentElement) {
            var cs = getComputedStyle(node);
            var box = node === document.scrollingElement ? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight } : node.getBoundingClientRect();
            if (!doneX && /auto|scroll/.test(cs.overflowX) && node.scrollWidth > node.clientWidth + 1) {
                var dx = r.left < box.left + marginX ? r.left - box.left - marginX : r.right > box.right - marginX ? r.right - box.right + marginX : 0;
                if (dx) node.scrollBy({ left: dx, behavior: behavior });
                doneX = true;
            }
            if (!doneY && /auto|scroll/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) {
                var dy = r.top < box.top + marginY ? r.top - box.top - marginY : r.bottom > box.bottom - marginY ? r.bottom - box.bottom + marginY : 0;
                if (dy) node.scrollBy({ top: dy, behavior: behavior });
                doneY = true;
            }
        }
    }

    function current() {
        var root = scope();
        // A layer opened over the focus: start inside it
        if (focused && root !== document.body && !root.contains(focused)) { focused.classList.remove('sp-tv-focus'); focused = null; }
        if (focused && focused.isConnected && root.contains(focused) && isVisible(focused)) return focused;
        var a = document.activeElement;
        if (a && a !== document.body && root.contains(a) && a.matches(FOCUSABLE) && isVisible(a)) return a;
        return null;
    }

    // First focus: the first thing in reading order, past the navigation
    function focusFirst() {
        var root = scope();
        var list = candidates(root);
        // In a prompt, start on its main button (Allow, Save...)
        var primary = root !== document.body && list.filter(function (el) { return el.matches('button'); }).pop();
        if (primary && root.matches('.sp-perm-card, .rv-card')) return setFocus(primary);
        // The page's main action, when it has one (a title's Watch Now, the hero's play button)
        if (root === document.body) {
            var preferred = PRIMARY.map(function (sel) { return list.find(function (el) { return el.matches(sel); }); }).find(Boolean);
            if (preferred) return setFocus(preferred);
        }
        var main = list.filter(function (el) { return !el.closest('.sb, nav'); });
        var pool = main.length ? main : list;
        pool.sort(function (a, b) {
            var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return (ra.top - rb.top) || (ra.left - rb.left);
        });
        setFocus(pool.find(function (el) { var r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }) || pool[0]);
    }

    function move(dir) {
        var from = current();
        if (!from) return focusFirst();
        // Typing in a field: left and right move the text cursor
        if (from.matches('input, textarea') && (dir === 'left' || dir === 'right')) return;
        var next = nearest(from, dir, candidates(scope()));
        if (next) setFocus(next);
    }

    function select() {
        var el = current();
        if (!el) return focusFirst();
        if (el.matches('input, textarea, select')) { el.focus(); return; }
        el.click();
    }

    function back() {
        var root = scope();
        if (root !== document.body) {
            // Close what's on top, the way Escape does
            if (root.id === '__st_panel__' && window.__st_toggle) return window.__st_toggle();
            commands.pressKey('Escape', 'Escape', 27);
            return;
        }
        if (isHome()) {
            runtime.toast({ title: 'You’re on the Board', duration: 3000, action: { label: 'Leave TV Mode', run: function () { setActive(false); } } });
            return;
        }
        history.back();
    }

    // ── Player ───────────────────────────────────────────────────────────────
    var paused = false, position = 0, duration = 0;

    function playerCommand(name, value) {
        switch (name) {
            case 'left': case 'skipBackward': return commands.player('seek-back', 10);
            case 'right': case 'skipForward': return commands.player('seek-forward', 10);
            case 'up': return commands.player('volume-up');
            case 'down': return commands.player('volume-down');
            case 'select': case 'playPause': return commands.player('play-pause');
            case 'play': return commands.player('play');
            case 'pause': return commands.player('pause');
            case 'seek': return commands.player('seek-to', value);
            case 'next': return Promise.resolve(commands.player('next-episode')).catch(function () {});
            case 'previous': return commands.player('seek-to', 0);
            case 'back': return commands.player('exit');
        }
    }

    // ── Remote input ─────────────────────────────────────────────────────────
    var repeat = null;
    function stopRepeat() { if (repeat) { clearTimeout(repeat); repeat = null; } }

    function handle(name, value) {
        markIdle();
        var direction = name === 'up' || name === 'down' || name === 'left' || name === 'right';
        if (direction && value === false) return stopRepeat();
        if (inPlayer()) {
            if (direction) stopRepeat();
            return playerCommand(name, value);
        }
        if (name === 'play' || name === 'pause' || name === 'playPause' || name === 'seek' || name === 'next' || name === 'previous' || name === 'skipForward' || name === 'skipBackward') return;
        // A remote outside TV mode: offer it once
        if (!active) return offerTvMode();
        if (direction) {
            stopRepeat();
            move(name);
            var again = function () { move(name); repeat = setTimeout(again, REPEAT_EVERY); };
            repeat = setTimeout(again, REPEAT_DELAY);
        } else if (name === 'select') select();
        else if (name === 'back') back();
    }

    var offered = false;
    function offerTvMode() {
        if (offered) return;
        offered = true;
        runtime.toast({ title: 'Using a remote?', message: 'TV Mode makes everything bigger and easy to reach.', duration: 8000,
            action: { label: 'TV Mode', run: function () { setActive(true); } } });
    }

    // Keyboard in TV mode works like a remote (arrow keys, Return, Escape)
    var KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', Escape: 'back' };
    function onKey(e) {
        if (!active || inPlayer() || e.metaKey || e.ctrlKey || e.altKey || !e.isTrusted) return;
        var name = KEYS[e.key];
        var typing = document.activeElement && document.activeElement.matches('input, textarea');
        if (e.key === 'Backspace' && !typing) name = 'back';
        if (!name) return;
        if (typing && (name === 'left' || name === 'right' || (name === 'select' && document.activeElement.form))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        markIdle();
        if (name === 'up' || name === 'down' || name === 'left' || name === 'right') move(name);
        else if (name === 'select') select();
        else back();
    }

    function markIdle() {
        document.documentElement.classList.add('sp-tv-idle');
    }
    function onPointer() {
        document.documentElement.classList.remove('sp-tv-idle');
        if (idleTimer) clearTimeout(idleTimer);
        if (active) idleTimer = setTimeout(markIdle, 2500);
    }

    // ── Now Playing ──────────────────────────────────────────────────────────
    var published = { at: 0, position: 0, paused: null, title: '' };

    function playerInfo() {
        var state = null;
        return Promise.resolve(window.core && window.core.getState ? window.core.getState('player') : null)
            .then(function (s) { state = s; }, function () {})
            .then(function () {
                var meta = state && state.metaItem && state.metaItem.content && state.metaItem.content.content;
                var video = state && state.selected && state.selected.streamRequest && meta && meta.videos
                    ? meta.videos.find(function (v) { return state.selected.streamRequest.path && v.id === state.selected.streamRequest.path.id; })
                    : null;
                var stream = state && state.selected && state.selected.stream;
                var streamName = stream && (stream.title || stream.name || String(stream.description || '').split('\n')[0]);
                var title = (state && state.title) || streamName || 'Stremio';
                return {
                    title: video ? (video.title || video.name || title) : (meta ? meta.name : title),
                    subtitle: video && meta ? meta.name + ' · S' + video.season + ' E' + video.episode : (meta && meta.releaseInfo) || '',
                    artwork: meta ? (meta.background || meta.poster || '') : '',
                };
            });
    }

    function publish(force) {
        if (!inPlayer() || !duration) return;
        var now = Date.now();
        var expected = published.paused ? published.position : published.position + (now - published.at) / 1000;
        var drift = Math.abs(expected - position);
        if (!force && published.paused === paused && drift < 3 && now - published.at < 15000) return;
        published = { at: now, position: position, paused: paused, title: published.title };
        playerInfo().then(function (info) {
            channel().then(function (o) {
                if (!o.remoteControl) return;
                o.remoteControl.setNowPlaying({ title: info.title, subtitle: info.subtitle, artwork: info.artwork, duration: duration, position: position, paused: paused });
            });
        });
    }

    function clearNowPlaying() {
        published = { at: 0, position: 0, paused: null, title: '' };
        position = 0; duration = 0;
        channel().then(function (o) { if (o.remoteControl) o.remoteControl.clearNowPlaying(); });
    }

    function onShellMessage(e) {
        var msg;
        try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
        var args = msg && msg.args;
        if (!args || args[0] !== 'mpv-prop-change' || !args[1]) return;
        var name = args[1].name, data = args[1].data;
        if (name === 'pause') { paused = !!data; publish(true); }
        else if (name === 'time-pos' && typeof data === 'number') { position = data; publish(false); }
        else if (name === 'duration' && typeof data === 'number') { duration = data; publish(true); }
    }

    // ── TV mode ──────────────────────────────────────────────────────────────
    function setActive(on) {
        on = !!on;
        if (on === active) return Promise.resolve(active);
        active = on;
        document.documentElement.classList.toggle('sp-tv', on);
        if (!on) {
            document.documentElement.classList.remove('sp-tv-idle');
            if (focused) focused.classList.remove('sp-tv-focus');
            focused = null;
            stopRepeat();
        }
        runtime.toast({ title: on ? 'TV Mode' : 'TV Mode off', message: on ? 'Arrows or the remote move, Return selects, Escape goes back.' : null, duration: 2600 });
        return shell().then(function (b) { b.setTvMode(on, 0); return active; }).then(function () {
            if (on) setTimeout(focusFirst, 500);
            return active;
        });
    }

    function start() {
        var style = document.createElement('style');
        style.id = 'sp-tv-style';
        style.textContent = CSS;
        document.head.appendChild(style);

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('mousemove', onPointer, { passive: true });
        window.addEventListener('hashchange', function () {
            if (!inPlayer()) clearNowPlaying();
            if (active && !inPlayer()) setTimeout(function () { if (!current()) focusFirst(); }, 600);
        });
        if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', onShellMessage);

        channel().then(function (o) {
            if (!o.remoteControl) return;
            o.remoteControl.command.connect(handle);
            o.remoteControl.controllersChanged.connect(function (list) {
                if (list.length && !active) offerTvMode();
            });
        });

        commands.register({ id: 'app.tv-mode', title: 'TV Mode', subtitle: 'Full screen, bigger, made for a remote', group: 'App',
            keywords: 'television couch remote controller big screen siri apple tv', shortcut: 'Mod+Shift+T',
            run: function () { return setActive(!active); } });
    }

    if (window.stremioPlusShell) {
        window.stremioPlusShell.tvMode = {
            enter: function () { return setActive(true); },
            exit: function () { return setActive(false); },
            toggle: function () { return setActive(!active); },
            isActive: function () { return active; },
            // Sends a remote command as if it came from a remote, e.g. remote('down'),
            // remote('playPause'); directions take true (pressed) and false (released)
            remote: function (name, value) { handle(name, value); },
        };
    }

    if (runtime && commands) start();
})();
