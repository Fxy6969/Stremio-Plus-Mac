// Full colour picker for Stremio+: saturation/brightness square, hue slider,
// R/G/B and hex fields, eyedropper (where supported), macOS system colours and
// recently used colours. Changes apply live while dragging.
//  - Upgrades the menu's swatch-grid picker (#__st_cpick__) in place, applying
//    through window.__stCpick (exposed by host.js).
//  - window.__spColorPicker.open(anchor, color, { onInput, onCommit }) shows it
//    as a popover anywhere (used by the Theme Editor).
(function () {
    if (window.__spColorPicker) return;

    var RECENTS_KEY = 'sp_recent_colors';
    var MAX_RECENTS = 8;
    // macOS system colours (dark appearance)
    var SYSTEM = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ffffff', '#8e8e93', '#1c1c1e'];

    var css = '' +
        '#__st_root__ #__st_cpick__.sp-cp-host { width:248px !important; padding:12px !important; border-radius:14px !important;' +
        '  background:rgba(36,36,38,0.92) !important; backdrop-filter:blur(30px) saturate(160%) !important; -webkit-backdrop-filter:blur(30px) saturate(160%) !important;' +
        '  border:0.5px solid rgba(255,255,255,0.14) !important; box-shadow:0 18px 50px rgba(0,0,0,0.5) !important;' +
        '  transition:opacity .18s ease, transform .22s cubic-bezier(0.32,0.72,0,1) !important; }' +
        '#__st_cpick__.sp-cp-host .st-cpick-grid, #__st_cpick__.sp-cp-host .st-cpick-hex-row { display:none !important; }' +
        '#sp-cp-pop { position:fixed; z-index:2147483647; width:248px; padding:12px; border-radius:14px; box-sizing:border-box;' +
        '  background:rgba(36,36,38,0.94); backdrop-filter:blur(30px) saturate(160%); -webkit-backdrop-filter:blur(30px) saturate(160%);' +
        '  border:0.5px solid rgba(255,255,255,0.14); box-shadow:0 18px 50px rgba(0,0,0,0.5); font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;' +
        '  opacity:0; transform:scale(0.97); transform-origin:top right; transition:opacity .16s ease, transform .22s cubic-bezier(0.32,0.72,0,1); }' +
        '#sp-cp-pop.in { opacity:1; transform:none; }' +
        '.sp-cp .sp-cp-sv { position:relative; height:150px; border-radius:9px; cursor:crosshair; touch-action:none;' +
        '  background-image:linear-gradient(0deg,#000,rgba(0,0,0,0)),linear-gradient(90deg,#fff,rgba(255,255,255,0)); }' +
        '.sp-cp .sp-cp-hue { position:relative; height:12px; border-radius:6px; margin:12px 0 10px; cursor:pointer; touch-action:none;' +
        '  background:linear-gradient(90deg,#f00 0%,#ff0 16.66%,#0f0 33.33%,#0ff 50%,#00f 66.66%,#f0f 83.33%,#f00 100%); }' +
        '.sp-cp .sp-cp-knob { position:absolute; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; pointer-events:none;' +
        '  border:2.5px solid #fff; box-shadow:0 0 0 0.5px rgba(0,0,0,0.35),0 2px 6px rgba(0,0,0,0.35); transition:transform .12s ease; box-sizing:border-box; }' +
        '.sp-cp .sp-cp-hue .sp-cp-knob { top:50%; }' +
        '.sp-cp .sp-cp-dragging .sp-cp-knob { transform:scale(1.15); }' +
        '.sp-cp .sp-cp-row { display:flex; align-items:center; gap:6px; }' +
        '.sp-cp .sp-cp-field { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:3px; }' +
        '.sp-cp .sp-cp-field input { all:unset; box-sizing:border-box; width:100%; text-align:center; font-size:12px; font-variant-numeric:tabular-nums;' +
        '  padding:5px 0; border-radius:6px; background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.9); }' +
        '.sp-cp .sp-cp-field input:focus { border-color:rgba(255,255,255,0.35); }' +
        '.sp-cp .sp-cp-field span { font-size:9.5px; letter-spacing:0.06em; color:rgba(255,255,255,0.4); }' +
        '.sp-cp .sp-cp-field.hex { flex:2.2; }' +
        '.sp-cp .sp-cp-eye { all:unset; cursor:pointer; width:28px; height:26px; flex-shrink:0; display:flex; align-items:center; justify-content:center; align-self:flex-start;' +
        '  border-radius:6px; background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.75); }' +
        '.sp-cp .sp-cp-eye:hover { background:rgba(255,255,255,0.13); }' +
        '.sp-cp .sp-cp-eye:active { transform:scale(0.94); }' +
        '.sp-cp .sp-cp-label { font-size:10px; letter-spacing:0.04em; color:rgba(255,255,255,0.4); margin:11px 0 5px; }' +
        '.sp-cp .sp-cp-swatches { display:grid; grid-template-columns:repeat(12,1fr); gap:4px; }' +
        '.sp-cp .sp-cp-swatches.recents { grid-template-columns:repeat(8,1fr); }' +
        '.sp-cp .sp-cp-sw { aspect-ratio:1; border-radius:50%; cursor:pointer; box-shadow:inset 0 0 0 0.5px rgba(255,255,255,0.25); transition:transform .1s ease; }' +
        '.sp-cp .sp-cp-sw:hover { transform:scale(1.15); }' +
        '.sp-cp .sp-cp-sw:active { transform:scale(0.95); }' +
        '@media (prefers-reduced-motion: reduce) { .sp-cp .sp-cp-knob, .sp-cp .sp-cp-sw, #sp-cp-pop { transition:none; } }';

    function ensureStyle() {
        if (document.getElementById('sp-color-picker-style')) return;
        var style = document.createElement('style');
        style.id = 'sp-color-picker-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ── Colour maths ─────────────────────────────────────────────────────────
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    function hsvToRgb(h, s, v) {
        var f = function (n) {
            var k = (n + h / 60) % 6;
            return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
        };
        return [f(5), f(3), f(1)];
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return [h, max ? d / max : 0, max];
    }

    function toHex(rgb) {
        return '#' + rgb.map(function (n) { return clamp(n, 0, 255).toString(16).padStart(2, '0'); }).join('');
    }

    function parseColor(value) {
        value = String(value || '').trim();
        var m = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (m) {
            var hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
            return [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
        }
        m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        return m ? [+m[1], +m[2], +m[3]] : null;
    }

    function recents() {
        try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]').filter(parseColor).slice(0, MAX_RECENTS); }
        catch (e) { return []; }
    }

    function remember(hex) {
        var list = recents().filter(function (c) { return c.toLowerCase() !== hex.toLowerCase(); });
        list.unshift(hex);
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))); } catch (e) {}
    }

    // ── Picker component ─────────────────────────────────────────────────────
    // createPicker({ onInput(hex), onCommit(hex), onDone() }) -> { nodes, set(color), focus() }
    function createPicker(callbacks) {
        var hsv = [0, 0, 1];
        var ui = {};
        var pendingApply = null;

        function currentHex() { return toHex(hsvToRgb(hsv[0], hsv[1], hsv[2])); }

        // Applies at most once per frame while dragging; commit applies immediately
        function apply(commit) {
            if (commit) {
                if (pendingApply) cancelAnimationFrame(pendingApply);
                pendingApply = null;
                var hex = currentHex();
                callbacks.onCommit(hex);
                remember(hex);
                renderRecents();
                return;
            }
            if (pendingApply) return;
            pendingApply = requestAnimationFrame(function () {
                pendingApply = null;
                callbacks.onInput(currentHex());
            });
        }

        function render(skipField) {
            var rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
            var hex = toHex(rgb);
            ui.sv.style.backgroundColor = 'hsl(' + hsv[0] + ',100%,50%)';
            ui.svKnob.style.left = (hsv[1] * 100) + '%';
            ui.svKnob.style.top = ((1 - hsv[2]) * 100) + '%';
            ui.svKnob.style.background = hex;
            ui.hueKnob.style.left = (hsv[0] / 360 * 100) + '%';
            ui.hueKnob.style.background = 'hsl(' + hsv[0] + ',100%,50%)';
            ['r', 'g', 'b'].forEach(function (k, i) { if (skipField !== k) ui[k].value = rgb[i]; });
            if (skipField !== 'hex') ui.hex.value = hex;
        }

        function setFromRgb(rgb, skipField) {
            var next = rgbToHsv(rgb[0], rgb[1], rgb[2]);
            // Keep the hue when the colour is grey, so the slider doesn't jump to red
            if (next[1] === 0 || next[2] === 0) next[0] = hsv[0];
            hsv = next;
            render(skipField);
        }

        // 1:1 pointer tracking with capture; the value changes on press, not release
        function track(el, onMove) {
            el.addEventListener('pointerdown', function (e) {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                el.setPointerCapture(e.pointerId);
                el.classList.add('sp-cp-dragging');
                var move = function (ev) {
                    var r = el.getBoundingClientRect();
                    onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
                    render();
                    apply(false);
                };
                var up = function (ev) {
                    el.releasePointerCapture(ev.pointerId);
                    el.classList.remove('sp-cp-dragging');
                    el.removeEventListener('pointermove', move);
                    el.removeEventListener('pointerup', up);
                    el.removeEventListener('pointercancel', up);
                    apply(true);
                };
                move(e);
                el.addEventListener('pointermove', move);
                el.addEventListener('pointerup', up);
                el.addEventListener('pointercancel', up);
            });
            el.addEventListener('click', function (e) { e.stopPropagation(); });
        }

        function swatch(color) {
            var sw = document.createElement('div');
            sw.className = 'sp-cp-sw';
            sw.style.background = color;
            sw.title = color;
            sw.addEventListener('click', function (e) {
                e.stopPropagation();
                setFromRgb(parseColor(color));
                apply(true);
            });
            return sw;
        }

        function renderRecents() {
            var list = recents();
            ui.recentsLabel.style.display = ui.recents.style.display = list.length ? '' : 'none';
            ui.recents.replaceChildren.apply(ui.recents, list.map(swatch));
        }

        function field(key, label, numeric) {
            var wrap = document.createElement('label');
            wrap.className = 'sp-cp-field' + (key === 'hex' ? ' hex' : '');
            var input = document.createElement('input');
            input.spellcheck = false;
            input.setAttribute('aria-label', label);
            input.maxLength = numeric ? 3 : 7;
            if (numeric) input.inputMode = 'numeric';
            var caption = document.createElement('span');
            caption.textContent = label;
            wrap.append(input, caption);

            input.addEventListener('click', function (e) { e.stopPropagation(); });
            input.addEventListener('input', function () {
                if (key === 'hex') {
                    var rgb = parseColor(input.value);
                    if (rgb && /^#?[0-9a-f]{6}$/i.test(input.value.trim())) { setFromRgb(rgb, 'hex'); apply(false); }
                } else {
                    setFromRgb(['r', 'g', 'b'].map(function (k) { return clamp(parseInt(ui[k].value, 10) || 0, 0, 255); }), key);
                    apply(false);
                }
            });
            input.addEventListener('keydown', function (e) {
                e.stopPropagation();
                if (e.key === 'Enter') { render(); apply(true); if (callbacks.onDone) callbacks.onDone(); }
                if (e.key === 'Escape' && callbacks.onDone) callbacks.onDone();
                if (numeric && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    input.value = clamp((parseInt(input.value, 10) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 255);
                    input.dispatchEvent(new Event('input'));
                }
            });
            input.addEventListener('change', function () { render(); apply(true); });
            ui[key] = input;
            return wrap;
        }

        ui.sv = document.createElement('div');
        ui.sv.className = 'sp-cp-sv';
        ui.svKnob = document.createElement('div');
        ui.svKnob.className = 'sp-cp-knob';
        ui.sv.appendChild(ui.svKnob);
        track(ui.sv, function (x, y) { hsv[1] = x; hsv[2] = 1 - y; });

        ui.hue = document.createElement('div');
        ui.hue.className = 'sp-cp-hue';
        ui.hueKnob = document.createElement('div');
        ui.hueKnob.className = 'sp-cp-knob';
        ui.hue.appendChild(ui.hueKnob);
        track(ui.hue, function (x) { hsv[0] = Math.round(x * 360) % 360; });

        var row = document.createElement('div');
        row.className = 'sp-cp-row';
        row.append(field('hex', 'HEX'), field('r', 'R', true), field('g', 'G', true), field('b', 'B', true));

        if ('EyeDropper' in window) {
            var eye = document.createElement('button');
            eye.className = 'sp-cp-eye';
            eye.title = 'Pick a colour from the screen';
            eye.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
            eye.addEventListener('click', function (e) {
                e.stopPropagation();
                new window.EyeDropper().open().then(function (result) {
                    setFromRgb(parseColor(result.sRGBHex));
                    apply(true);
                }).catch(function () { /* cancelled */ });
            });
            row.appendChild(eye);
        }

        var systemLabel = document.createElement('div');
        systemLabel.className = 'sp-cp-label';
        systemLabel.textContent = 'SYSTEM';
        var system = document.createElement('div');
        system.className = 'sp-cp-swatches';
        SYSTEM.forEach(function (c) { system.appendChild(swatch(c)); });

        ui.recentsLabel = document.createElement('div');
        ui.recentsLabel.className = 'sp-cp-label';
        ui.recentsLabel.textContent = 'RECENT';
        ui.recents = document.createElement('div');
        ui.recents.className = 'sp-cp-swatches recents';
        renderRecents();

        return {
            nodes: [ui.sv, ui.hue, row, systemLabel, system, ui.recentsLabel, ui.recents],
            set: function (color) { setFromRgb(parseColor(color) || [255, 255, 255]); renderRecents(); },
            focus: function () { ui.hex.focus(); ui.hex.select(); },
        };
    }

    function keepOnScreen(el) {
        var r = el.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 12) el.style.top = Math.max(12, window.innerHeight - r.height - 12) + 'px';
        if (r.right > window.innerWidth - 12) el.style.left = Math.max(12, window.innerWidth - r.width - 12) + 'px';
        if (r.left < 12) el.style.left = '12px';
    }

    // ── The menu's own picker, upgraded in place ─────────────────────────────
    function upgrade(picker) {
        ensureStyle();
        picker.classList.add('sp-cp-host', 'sp-cp');
        var cpick = function () { return window.__stCpick; };
        var component = createPicker({
            onInput: function (hex) { if (cpick()) cpick().apply(hex); },
            onCommit: function (hex) { if (cpick()) cpick().apply(hex); },
            onDone: function () { if (cpick()) cpick().close(); },
        });
        picker.prepend.apply(picker, component.nodes);

        // Each time the menu opens the picker, start from the setting's colour
        var onOpen = function () {
            if (!picker.classList.contains('open')) return;
            var hexInput = document.getElementById('__st_cp_hex__');
            component.set(hexInput && hexInput.value);
            requestAnimationFrame(function () {
                // The menu places it under the swatch; flip above when it would overflow
                var r = picker.getBoundingClientRect();
                if (r.bottom > window.innerHeight - 12) picker.style.top = Math.max(12, r.top - r.height - 40) + 'px';
                keepOnScreen(picker);
                component.focus();
            });
        };
        new MutationObserver(onOpen).observe(picker, { attributes: true, attributeFilter: ['class'] });
        // The first time, the menu creates and opens the picker in one go
        onOpen();
    }

    function watchMenuPicker() {
        var root = document.getElementById('__st_root__');
        if (!root) return setTimeout(watchMenuPicker, 200);
        var existing = document.getElementById('__st_cpick__');
        if (existing) return upgrade(existing);
        var observer = new MutationObserver(function () {
            var picker = document.getElementById('__st_cpick__');
            if (picker) { observer.disconnect(); upgrade(picker); }
        });
        observer.observe(root, { childList: true });
    }

    // ── Popover anywhere ─────────────────────────────────────────────────────
    var popover = null;

    function closePopover() {
        if (!popover) return;
        var el = popover.el;
        document.removeEventListener('pointerdown', popover.outside, true);
        popover = null;
        el.classList.remove('in');
        setTimeout(function () { el.remove(); }, 200);
    }

    function open(anchor, color, callbacks) {
        ensureStyle();
        closePopover();
        var el = document.createElement('div');
        el.id = 'sp-cp-pop';
        el.className = 'sp-cp';
        var component = createPicker({
            onInput: callbacks.onInput || function () {},
            onCommit: callbacks.onCommit || function () {},
            onDone: closePopover,
        });
        el.append.apply(el, component.nodes);
        document.body.appendChild(el);
        var r = anchor.getBoundingClientRect();
        el.style.top = (r.bottom + 6) + 'px';
        el.style.left = (r.right - 248) + 'px';
        component.set(color);
        keepOnScreen(el);
        requestAnimationFrame(function () { el.classList.add('in'); component.focus(); });
        var outside = function (e) { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover(); };
        document.addEventListener('pointerdown', outside, true);
        el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } });
        popover = { el: el, outside: outside };
    }

    window.__spColorPicker = { open: open, close: closePopover, parse: parseColor, toHex: toHex };
    watchMenuPicker();
})();
