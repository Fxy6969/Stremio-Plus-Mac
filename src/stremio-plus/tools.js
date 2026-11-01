// Stremio+ Tools: a "Tools" tab in the menu with Profiles, Plugin Health,
// Shortcuts, Widgets, Appearance and Developer pages, plus the docked Theme
// Editor. Also runs the light/dark schedule and profile switching.
(function () {
    if (window.__spTools) return;

    var host = window.__spHost;
    var runtime = window.__spRuntime;
    var commands = window.__spCommands;
    var native = runtime.native;

    // ── Small DOM helpers ────────────────────────────────────────────────────
    function h(tag, attrs, children) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            var v = attrs[k];
            if (v == null || v === false) return;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
            else if (k === 'style') el.style.cssText = v;
            else el.setAttribute(k, v === true ? '' : v);
        });
        (children || []).forEach(function (c) {
            if (c == null || c === false) return;
            el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return el;
    }

    function svg(path, size) {
        var span = h('span', { class: 'spt-svg' });
        span.innerHTML = '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
        return span;
    }

    var ICON = {
        profiles: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/>',
        health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        shortcuts: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
        editor: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
        widgets: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        appearance: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
        developer: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
        chevron: '<path d="m9 6 6 6-6 6"/>',
        back: '<path d="m15 6-6 6 6 6"/>',
        grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        conflicts: '<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>',
    };

    var css = '' +
        '#__st_panel__.sp-tools-active #__st_list__, #__st_panel__.sp-tools-active #__st_dev_wrap__, #__st_panel__.sp-tools-active #__st_marketplace_wrap__,' +
        '#__st_panel__.sp-tools-active #__st_activity_wrap__, #__st_panel__.sp-tools-active #__st_about_wrap__, #__st_panel__.sp-tools-active .st-url-row,' +
        '#__st_panel__.sp-tools-active #__st_safemode_banner__ { display:none !important; }' +
        '#sp-tools { display:none; flex:1; min-height:0; overflow-y:auto; padding:8px; color:rgba(255,255,255,0.92); font-size:13px; }' +
        '#__st_panel__.sp-tools-active #sp-tools { display:block; }' +
        '#__st_panel__.sp-tools-active #sp-widgets { display:none !important; }' +
        '#sp-tools .spt-notes { margin:3px 0 0; padding:0; list-style:none; font-size:11.5px; color:rgba(255,255,255,0.45); }' +
        '#sp-tools .spt-page { animation:spt-in .28s cubic-bezier(0.32,0.72,0,1); }' +
        '@keyframes spt-in { from { opacity:0; transform:translateX(8px); } to { opacity:1; transform:none; } }' +
        '#sp-tools .spt-head { display:flex; align-items:center; gap:8px; padding:4px 6px 10px; }' +
        '#sp-tools .spt-back { all:unset; cursor:pointer; display:flex; align-items:center; gap:2px; padding:4px 8px 4px 4px; border-radius:7px; color:rgba(255,255,255,0.6); font-size:12.5px; }' +
        '#sp-tools .spt-back:hover { background:rgba(255,255,255,0.07); color:#fff; }' +
        '#sp-tools .spt-title { font-size:15px; font-weight:600; letter-spacing:-0.01em; }' +
        '#sp-tools .spt-lede { color:rgba(255,255,255,0.5); font-size:12.5px; padding:0 8px 10px; line-height:1.45; }' +
        '#sp-tools .spt-row { display:flex; align-items:center; gap:12px; padding:9px 10px; border-radius:10px; }' +
        '#sp-tools .spt-row.link { cursor:pointer; } #sp-tools .spt-row.link:hover { background:rgba(255,255,255,0.06); }' +
        '#sp-tools .spt-row.link:active { transform:scale(0.99); }' +
        '#sp-tools .spt-ico { width:30px; height:30px; flex-shrink:0; border-radius:8px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.09); border:0.5px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.85); }' +
        '#sp-tools .spt-main { flex:1; min-width:0; }' +
        '#sp-tools .spt-name { font-weight:500; font-size:13.5px; }' +
        '#sp-tools .spt-sub { color:rgba(255,255,255,0.5); font-size:12px; margin-top:2px; line-height:1.4; }' +
        '#sp-tools .spt-trail { display:flex; align-items:center; gap:8px; flex-shrink:0; color:rgba(255,255,255,0.4); font-size:12px; }' +
        '#sp-tools .spt-card { background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.08); border-radius:12px; margin:0 2px 8px; }' +
        '#sp-tools .spt-card > .spt-row + .spt-row { border-top:0.5px solid rgba(255,255,255,0.06); border-radius:0; }' +
        '#sp-tools .spt-section { font-size:11.5px; font-weight:500; color:rgba(255,255,255,0.45); padding:12px 10px 6px; }' +
        '#sp-tools .spt-btn { all:unset; cursor:pointer; padding:5px 11px; border-radius:7px; font-size:12px; font-weight:500; background:rgba(255,255,255,0.09); border:0.5px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.9); white-space:nowrap; }' +
        '#sp-tools .spt-btn:hover { background:rgba(255,255,255,0.15); }' +
        '#sp-tools .spt-btn:active, #sp-te .spt-btn:active { transform:scale(0.96); }' +
        '#sp-tools .spt-btn.primary, #sp-te .spt-btn.primary { background:rgba(255,255,255,0.92); color:#111; border-color:transparent; font-weight:600; }' +
        '#sp-tools .spt-btn[disabled] { opacity:0.4; pointer-events:none; }' +
        '#sp-tools .spt-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }' +
        '#sp-tools .spt-dot.ok { background:#30d158; } #sp-tools .spt-dot.warn { background:#ffd60a; } #sp-tools .spt-dot.bad { background:#ff453a; } #sp-tools .spt-dot.off { background:rgba(255,255,255,0.25); }' +
        '#sp-tools .spt-issues { margin:4px 0 0; padding:0; list-style:none; font-size:12px; color:#ffd60a; }' +
        '#sp-tools .spt-issues.bad { color:#ff6961; }' +
        '#sp-tools .spt-metrics { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11.5px; color:rgba(255,255,255,0.5); margin-top:3px; font-variant-numeric:tabular-nums; }' +
        '#sp-tools .spt-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:11px; cursor:pointer; background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.75); }' +
        '#sp-tools .spt-chip.denied { text-decoration:line-through; color:rgba(255,255,255,0.4); }' +
        '#sp-tools .spt-chip.undeclared { border-style:dashed; }' +
        '#sp-tools .spt-key { all:unset; cursor:pointer; min-width:54px; text-align:center; padding:4px 9px; border-radius:6px; font-size:12px; font-variant-numeric:tabular-nums;' +
        '  background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.85); }' +
        '#sp-tools .spt-key:hover { background:rgba(255,255,255,0.13); }' +
        '#sp-tools .spt-key.recording { background:rgba(255,255,255,0.92); color:#111; }' +
        '#sp-tools .spt-key.empty { color:rgba(255,255,255,0.35); }' +
        '#sp-tools .spt-note { font-size:11.5px; color:#ffd60a; margin-top:2px; }' +
        '#sp-tools .spt-seg { display:inline-flex; padding:2px; border-radius:8px; background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.1); }' +
        '#sp-tools .spt-seg button { all:unset; cursor:pointer; padding:5px 12px; border-radius:6px; font-size:12px; color:rgba(255,255,255,0.65); transition:background .15s ease, color .15s ease; }' +
        '#sp-tools .spt-seg button.on { background:rgba(255,255,255,0.16); color:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.25); }' +
        '#sp-tools select, #sp-tools input[type=time], #sp-tools input[type=text], #sp-te select, #sp-te input[type=text], #sp-te input[type=number] {' +
        '  all:unset; box-sizing:border-box; padding:5px 9px; border-radius:7px; font-size:12px; background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.9); }' +
        '#sp-tools select:focus, #sp-tools input:focus, #sp-te select:focus, #sp-te input:focus { border-color:rgba(255,255,255,0.35); }' +
        '#sp-tools .spt-switch, #sp-te .spt-switch { all:unset; cursor:pointer; position:relative; width:32px; height:19px; border-radius:10px; background:rgba(255,255,255,0.14); flex-shrink:0; transition:background .2s ease; }' +
        '#sp-tools .spt-switch::after, #sp-te .spt-switch::after { content:""; position:absolute; top:2px; left:2px; width:15px; height:15px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,0.3); transition:transform .25s cubic-bezier(0.32,0.72,0,1); }' +
        '#sp-tools .spt-switch.on { background:#30d158; } #sp-tools .spt-switch.on::after { transform:translateX(13px); }' +
        '#sp-tools .spt-console { margin:0 2px; border-radius:10px; background:rgba(0,0,0,0.28); border:0.5px solid rgba(255,255,255,0.08); height:230px; overflow-y:auto; padding:6px 0;' +
        '  font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }' +
        '#sp-tools .spt-log { display:flex; gap:8px; padding:1px 10px; white-space:pre-wrap; word-break:break-word; color:rgba(255,255,255,0.8); }' +
        '#sp-tools .spt-log .t { color:rgba(255,255,255,0.35); flex-shrink:0; } #sp-tools .spt-log .p { color:rgba(255,255,255,0.55); flex-shrink:0; }' +
        '#sp-tools .spt-log.warn { color:#ffd60a; } #sp-tools .spt-log.error { color:#ff6961; }' +
        '#sp-tools .spt-drag { cursor:grab; color:rgba(255,255,255,0.35); touch-action:none; padding:4px; margin:-4px; }' +
        '#sp-tools .spt-drag:active { cursor:grabbing; }' +
        '#sp-tools .spt-sortable > .spt-row { position:relative; background:transparent; }' +
        '#sp-tools .spt-sortable > .spt-row.dragging { z-index:2; background:rgba(60,60,64,0.95); box-shadow:0 8px 24px rgba(0,0,0,0.4); border-radius:10px; }' +
        '#sp-tools .spt-sortable > .spt-row.settling { transition:transform .3s cubic-bezier(0.32,0.72,0,1); }' +
        // Theme editor sidebar
        '#sp-te { position:fixed; top:14px; right:14px; bottom:14px; width:min(360px,calc(100vw - 28px)); z-index:2147483645; display:flex; flex-direction:column;' +
        '  border-radius:16px; background:rgba(30,30,32,0.74); backdrop-filter:blur(36px) saturate(170%); -webkit-backdrop-filter:blur(36px) saturate(170%);' +
        '  border:0.5px solid rgba(255,255,255,0.14); box-shadow:0 24px 70px rgba(0,0,0,0.45); color:rgba(255,255,255,0.92);' +
        '  font:13px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif; transform:translateX(calc(100% + 20px)); transition:transform .36s cubic-bezier(0.32,0.72,0,1); }' +
        '#sp-te.in { transform:none; }' +
        '#sp-te .te-head { display:flex; align-items:center; gap:8px; padding:14px 14px 10px; border-bottom:0.5px solid rgba(255,255,255,0.09); }' +
        '#sp-te .te-head b { flex:1; font-size:14px; font-weight:600; }' +
        '#sp-te .te-close { all:unset; cursor:pointer; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border-radius:6px; color:rgba(255,255,255,0.6); }' +
        '#sp-te .te-close:hover { background:rgba(255,255,255,0.1); color:#fff; }' +
        '#sp-te .te-base { display:flex; align-items:center; gap:8px; padding:10px 14px; font-size:12px; color:rgba(255,255,255,0.55); }' +
        '#sp-te .te-base select { flex:1; }' +
        '#sp-te .te-vars { flex:1; overflow-y:auto; padding:4px 8px; }' +
        '#sp-te .te-var { display:grid; grid-template-columns:1fr auto; align-items:center; gap:4px 10px; padding:7px 6px; border-radius:8px; }' +
        '#sp-te .te-var:hover { background:rgba(255,255,255,0.04); }' +
        '#sp-te .te-var label { font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace; color:rgba(255,255,255,0.75); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }' +
        '#sp-te .te-var.changed label { color:#fff; } #sp-te .te-var.changed label::after { content:" \\2022"; color:#64d2ff; }' +
        '#sp-te .te-ctl { display:flex; align-items:center; gap:6px; }' +
        '#sp-te .te-ctl input[type=text] { width:120px; } #sp-te .te-ctl input[type=number] { width:58px; }' +
        '#sp-te .te-ctl input[type=range] { width:90px; accent-color:#fff; }' +
        '#sp-te .te-swatch { all:unset; cursor:pointer; width:24px; height:24px; border-radius:6px; box-shadow:inset 0 0 0 0.5px rgba(255,255,255,0.3); background-image:linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%); background-size:8px 8px; background-position:0 0,4px 4px; position:relative; overflow:hidden; }' +
        '#sp-te .te-swatch i { position:absolute; inset:0; }' +
        '#sp-te .te-foot { padding:12px 14px 14px; border-top:0.5px solid rgba(255,255,255,0.09); display:flex; flex-direction:column; gap:8px; }' +
        '#sp-te .te-foot .te-actions { display:flex; gap:8px; } #sp-te .te-foot .te-actions .spt-btn:last-child { margin-left:auto; }' +
        '#sp-te .spt-btn { all:unset; cursor:pointer; padding:6px 12px; border-radius:7px; font-size:12px; font-weight:500; background:rgba(255,255,255,0.09); border:0.5px solid rgba(255,255,255,0.12); text-align:center; }' +
        '#sp-te .spt-btn:hover { background:rgba(255,255,255,0.15); }' +
        '#sp-tools .spt-code { font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace; color:rgba(255,255,255,0.7); }' +
        '#sp-tools .spt-examples { margin:4px 0 0; padding:0; list-style:none; }' +
        '#sp-tools .spt-examples li { font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:rgba(255,255,255,0.55); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }' +
        '#sp-highlight { position:fixed; z-index:2147483646; pointer-events:none; border-radius:8px; box-shadow:0 0 0 2px #fff, 0 0 0 6px rgba(255,255,255,0.18), 0 10px 30px rgba(0,0,0,0.5);' +
        '  transition:opacity .3s ease; }' +
        '#sp-highlight b { position:absolute; left:0; top:-30px; white-space:nowrap; padding:4px 10px; border-radius:999px; font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;' +
        '  color:#111; background:rgba(255,255,255,0.95); }' +
        '@media (prefers-reduced-motion: reduce) { #sp-tools .spt-page { animation:none; } #sp-te { transition:opacity .15s ease; } }';

    function menuOpen() {
        return window.__st_isOpen ? window.__st_isOpen() : !!document.querySelector('#__st_overlay__.open');
    }

    // ── Tools tab ────────────────────────────────────────────────────────────
    var panel, view, toolsTab, stack = [];

    function mount() {
        panel = document.getElementById('__st_panel__');
        var tabs = panel && panel.querySelector('.st-tabs');
        if (!panel || !tabs) return setTimeout(mount, 200);

        var style = h('style', { id: 'sp-tools-style' });
        style.textContent = css;
        document.head.appendChild(style);

        toolsTab = h('button', { class: 'st-tab', 'data-tab': 'sp-tools', onclick: function () { openTools(); } }, [
            svg(ICON.widgets, 12), 'Tools',
        ]);
        var indicator = tabs.querySelector('.st-tab-indicator');
        tabs.insertBefore(toolsTab, indicator);
        tabs.querySelectorAll('.st-tab').forEach(function (tab) {
            if (tab !== toolsTab) tab.addEventListener('click', closeTools);
        });

        view = h('div', { id: 'sp-tools' });
        var list = document.getElementById('__st_list__');
        list.parentNode.insertBefore(view, list);

        // Esc steps back through Tools pages before closing the menu
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && panel.classList.contains('sp-tools-active') && stack.length > 1) {
                e.preventDefault(); e.stopImmediatePropagation();
                back();
            }
        }, true);

        hideDuplicateToasts();
    }

    function openTools(page) {
        if (window.__st_toggle && !menuOpen()) window.__st_toggle();
        panel.querySelectorAll('.st-tab').forEach(function (t) { t.classList.remove('active'); });
        toolsTab.classList.add('active');
        panel.classList.add('sp-tools-active');
        stack = ['home'];
        if (page && page !== 'home') stack.push(page);
        render();
    }

    function closeTools() {
        panel.classList.remove('sp-tools-active');
        toolsTab.classList.remove('active');
        stack = [];
        stopLive();
    }

    function navigate(page) { stack.push(page); render(); }
    function back() { stack.pop(); render(); }

    var liveStop = null;
    function stopLive() { if (liveStop) { liveStop(); liveStop = null; } }

    function render() {
        stopLive();
        var page = stack[stack.length - 1] || 'home';
        var content = PAGES[page]();
        var wrap = h('div', { class: 'spt-page' });
        if (page !== 'home') {
            wrap.appendChild(h('div', { class: 'spt-head' }, [
                h('button', { class: 'spt-back', onclick: back }, [svg(ICON.back, 14), 'Tools']),
            ]));
        }
        wrap.appendChild(content);
        view.replaceChildren(wrap);
        view.scrollTop = 0;
    }

    function pageHeader(title, lede) {
        return [h('div', { class: 'spt-title', style: 'padding:0 8px 4px' , text: title }), lede ? h('div', { class: 'spt-lede', text: lede }) : null];
    }

    var PAGES = {};

    PAGES.home = function () {
        var issues = runtime.all().filter(function (r) { return r.status === 'running' && runtime.health(r).level !== 'ok'; }).length;
        var items = [
            ['profiles', 'Profiles', 'Save sets of plugins and a theme, switch with one click'],
            ['health', 'Plugin Health', issues ? issues + (issues === 1 ? ' plugin needs' : ' plugins need') + ' attention' : 'CPU, timers, page reactions and errors per plugin'],
            ['conflicts', 'Conflicts', conflictSummary()],
            ['shortcuts', 'Keyboard Shortcuts', 'See and change every shortcut'],
            ['editor', 'Theme Editor', 'Edit a theme’s colours with live preview, save as .theme.css'],
            ['widgets', 'Widgets', 'Choose and reorder the tiles at the top'],
            ['appearance', 'Appearance', 'Switch light and dark themes automatically'],
            ['developer', 'Developer', 'Hot-reload plugins from a folder, see their console'],
        ];
        var card = h('div', { class: 'spt-card' });
        items.forEach(function (it) {
            card.appendChild(h('div', {
                class: 'spt-row link',
                onclick: function () { if (it[0] === 'editor') openThemeEditor(); else navigate(it[0]); },
            }, [
                h('div', { class: 'spt-ico' }, [svg(ICON[it[0]], 15)]),
                h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: it[1] }), h('div', { class: 'spt-sub', text: it[2] })]),
                h('div', { class: 'spt-trail' }, [(it[0] === 'health' && issues) || (it[0] === 'conflicts' && conflictCount()) ? h('span', { class: 'spt-dot warn' }) : null, svg(ICON.chevron, 13)]),
            ]));
        });
        return h('div', null, [card]);
    };

    // ── Profiles ─────────────────────────────────────────────────────────────
    var PROFILES_FILE = 'profiles.json';
    var PROFILE_UNDO = 'sp_profile_undo';
    var profileList = [];

    function loadProfiles() {
        return host.readJson(PROFILES_FILE, null).then(function (list) {
            if (Array.isArray(list)) { profileList = list; return list; }
            // First use: the current setup and a clean one
            return currentSetup().then(function (setup) {
                profileList = [
                    { name: 'My Setup', plugins: setup.plugins, theme: setup.theme },
                    { name: 'Minimal', plugins: [], theme: 'Default' },
                ];
                return host.writeJson(PROFILES_FILE, profileList).then(function () { return profileList; });
            });
        });
    }

    function saveProfiles() { return host.writeJson(PROFILES_FILE, profileList); }

    function currentSetup() {
        return host.scanMods().then(function (mods) {
            var enabled = function (n) { return mods.enabled === null || mods.enabled.indexOf(n) !== -1; };
            return {
                plugins: mods.plugins.filter(function (p) { return enabled(p.meta.name); }).map(function (p) { return p.meta.name; }),
                theme: localStorage.getItem('currentTheme') || 'Default',
                mods: mods,
            };
        });
    }

    // Writes the plugin set and theme, then reloads so plugins start cleanly
    function applySetup(setup, mods) {
        var themeMod = mods.themes.find(function (t) { return t.file === setup.theme; });
        var themeNames = mods.themes.map(function (t) { return t.meta.name; });
        var enabled = setup.plugins.filter(function (n) { return themeNames.indexOf(n) === -1; });
        if (themeMod) enabled.push(themeMod.meta.name);
        return host.writeJson('enabled_plugins.json', enabled.sort()).then(function () {
            localStorage.setItem('currentTheme', themeMod ? themeMod.file : 'Default');
            location.reload();
        });
    }

    function applyProfile(name) {
        var profile = profileList.find(function (p) { return p.name === name; });
        if (!profile) return Promise.reject(new Error('No profile named ' + name));
        return currentSetup().then(function (setup) {
            sessionStorage.setItem(PROFILE_UNDO, JSON.stringify({ name: name, previous: { plugins: setup.plugins, theme: setup.theme } }));
            return applySetup(profile, setup.mods);
        });
    }

    function offerProfileUndo() {
        var raw = sessionStorage.getItem(PROFILE_UNDO);
        if (!raw) return;
        sessionStorage.removeItem(PROFILE_UNDO);
        var info;
        try { info = JSON.parse(raw); } catch (e) { return; }
        runtime.toast({
            title: 'Switched to ' + info.name,
            action: { label: 'Undo', run: function () { host.scanMods().then(function (mods) { applySetup(info.previous, mods); }); } },
            duration: 6000,
        });
    }

    PAGES.profiles = function () {
        var root = h('div', null, pageHeader('Profiles', 'A profile is a set of plugins plus a theme. Switching reloads Stremio so plugins start cleanly.'));
        var card = h('div', { class: 'spt-card' });
        var nameInput = h('input', { type: 'text', placeholder: 'New profile name', style: 'flex:1' });
        var save = h('button', { class: 'spt-btn primary', text: 'Save current setup', onclick: function () {
            var name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            currentSetup().then(function (setup) {
                profileList = profileList.filter(function (p) { return p.name !== name; });
                profileList.push({ name: name, plugins: setup.plugins, theme: setup.theme });
                return saveProfiles();
            }).then(function () { runtime.toast({ title: 'Saved profile ' + name, duration: 2500 }); render(); });
        } });
        nameInput.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') save.click(); });
        root.appendChild(card);
        root.appendChild(h('div', { class: 'spt-row' }, [nameInput, save]));

        Promise.all([loadProfiles(), currentSetup()]).then(function (results) {
            var setup = results[1];
            var themeName = function (file) {
                var t = setup.mods.themes.find(function (m) { return m.file === file; });
                return t ? t.meta.name : 'Default theme';
            };
            var same = function (p) {
                return p.theme === setup.theme && p.plugins.slice().sort().join('|') === setup.plugins.slice().sort().join('|');
            };
            card.replaceChildren();
            profileList.forEach(function (p, i) {
                var active = same(p);
                card.appendChild(h('div', { class: 'spt-row' }, [
                    h('div', { class: 'spt-ico' }, [svg(ICON.profiles, 14)]),
                    h('div', { class: 'spt-main' }, [
                        h('div', { class: 'spt-name', text: p.name }),
                        h('div', { class: 'spt-sub', text: (p.plugins.length ? p.plugins.length + (p.plugins.length === 1 ? ' plugin' : ' plugins') : 'No plugins') + ' · ' + themeName(p.theme) }),
                    ]),
                    h('div', { class: 'spt-trail' }, [
                        active ? h('span', { text: 'Current' }) : h('button', { class: 'spt-btn primary', text: 'Switch', onclick: function () { applyProfile(p.name); } }),
                        h('button', { class: 'spt-btn', text: 'Update', title: 'Replace with the current setup', onclick: function () {
                            var before = Object.assign({}, p);
                            p.plugins = setup.plugins; p.theme = setup.theme;
                            saveProfiles().then(render);
                            runtime.toast({ title: 'Updated ' + p.name, action: { label: 'Undo', run: function () { profileList[i] = before; saveProfiles().then(render); } } });
                        } }),
                        h('button', { class: 'spt-btn', text: 'Delete', onclick: function () {
                            profileList.splice(i, 1);
                            saveProfiles().then(render);
                            runtime.toast({ title: 'Deleted ' + p.name, action: { label: 'Undo', run: function () { profileList.splice(i, 0, p); saveProfiles().then(render); } } });
                        } }),
                    ]),
                ]));
            });
        });
        return root;
    };

    // ── Plugin Health ────────────────────────────────────────────────────────
    function fmt(n, digits) { return (Math.round(n * Math.pow(10, digits || 0)) / Math.pow(10, digits || 0)).toString(); }

    PAGES.health = function () {
        var root = h('div', null, pageHeader('Plugin Health', 'Measured live while the page runs. Plugins are flagged when they poll faster than 10× a second, react to their own changes, or keep the CPU busy.'));
        var summary = h('div', { class: 'spt-lede' });
        var list = h('div', { class: 'spt-card' });
        root.append(summary, list);
        var updates = {};
        host.listUpdates().then(function (u) { updates = u || {}; draw(); });

        function permissionChips(rec) {
            var granted = host.permissions()[rec.name] || { allowed: [], denied: [] };
            var caps = rec.declared.slice();
            rec.undeclared.forEach(function (c) { if (caps.indexOf(c) === -1) caps.push(c); });
            return caps.map(function (cap) {
                var isDenied = granted.denied.indexOf(cap) !== -1;
                var undeclared = rec.declared.indexOf(cap) === -1;
                return h('span', {
                    class: 'spt-chip' + (isDenied ? ' denied' : '') + (undeclared ? ' undeclared' : ''),
                    title: undeclared ? 'Used without being declared' : isDenied ? 'Denied. Click to allow (applies after reload)' : 'Allowed. Click to deny (applies after reload)',
                    onclick: undeclared ? null : function () {
                        host.setPermission(rec.name, cap, isDenied).then(function () {
                            runtime.toast({ title: (isDenied ? 'Allowed ' : 'Denied ') + cap + ' for ' + rec.name, message: 'Takes effect after Stremio reloads.',
                                action: { label: 'Reload', run: function () { location.reload(); } } });
                            draw();
                        });
                    },
                }, [cap]);
            });
        }

        function draw() {
            var recs = runtime.all().filter(function (r) { return r.kind !== 'Theme'; });
            recs.sort(function (a, b) { return (b.status === 'running') - (a.status === 'running') || a.name.localeCompare(b.name); });
            var flagged = 0;
            list.replaceChildren();
            if (!recs.length) list.appendChild(h('div', { class: 'spt-row' }, [h('div', { class: 'spt-sub', text: 'No plugins are loaded.' })]));
            recs.forEach(function (rec) {
                var hl = runtime.health(rec);
                var running = rec.status === 'running';
                if (running && hl.level !== 'ok') flagged++;
                var file = rec.file && rec.file.replace(/^dev:/, '');
                var update = updates[file];
                var metrics = h('div', { class: 'spt-metrics' }, [
                    h('span', { text: 'CPU ' + fmt(hl.cpuPerSec, 1) + ' ms/s' }),
                    h('span', { text: hl.intervals + (hl.intervals === 1 ? ' timer' : ' timers') + (hl.fastestInterval !== null ? ' (fastest ' + (hl.fastestInterval >= 1000 ? fmt(hl.fastestInterval / 1000, 1) + ' s' : hl.fastestInterval + ' ms') + ')' : '') }),
                    h('span', { text: fmt(hl.observerPerSec, 1) + ' page reactions/s' }),
                    h('span', { text: hl.errors + (hl.errors === 1 ? ' error' : ' errors') }),
                    h('span', { text: 'start ' + rec.coldStartMs + ' ms' }),
                ]);
                list.appendChild(h('div', { class: 'spt-row', style: 'align-items:flex-start' }, [
                    h('span', { class: 'spt-dot ' + (running ? hl.level : 'off'), style: 'margin-top:5px' }),
                    h('div', { class: 'spt-main' }, [
                        h('div', { class: 'spt-name' }, [rec.name, rec.dev ? h('span', { class: 'spt-chip', style: 'margin-left:6px', text: 'dev' }) : null,
                            update ? h('span', { class: 'spt-chip', style: 'margin-left:6px', text: 'trial v' + update.to }) : null]),
                        running ? metrics : h('div', { class: 'spt-sub', text: 'Stopped' }),
                        running && hl.issues.length ? h('ul', { class: 'spt-issues' + (hl.level === 'bad' ? ' bad' : '') }, hl.issues.map(function (i) { return h('li', { text: i }); })) : null,
                        running && hl.notes.length ? h('ul', { class: 'spt-notes' }, hl.notes.map(function (i) { return h('li', { text: i }); })) : null,
                        h('div', { class: 'spt-metrics', style: 'gap:4px' }, permissionChips(rec)),
                    ]),
                    h('div', { class: 'spt-trail' }, [
                        update ? h('button', { class: 'spt-btn', text: 'Roll back', title: 'Restore v' + update.from, onclick: function () { host.rollback(file, 'Rolled back by you.').then(draw); } }) : null,
                        h('button', { class: 'spt-btn', text: running ? 'Stop' : 'Start', onclick: function () {
                            if (running) { runtime.teardown(rec.id); draw(); return; }
                            host.scanMods().then(function (mods) {
                                var mod = mods.plugins.find(function (m) { return m.file === file; });
                                if (mod) return host.loadPluginLive(mod, rec.dev);
                            }).then(draw);
                        } }),
                    ]),
                ]));
            });
            summary.textContent = flagged ? flagged + (flagged === 1 ? ' plugin needs' : ' plugins need') + ' attention.' : 'All running plugins look healthy.';
        }

        draw();
        var onTick = function () { draw(); };
        runtime.events.addEventListener('tick', onTick);
        liveStop = function () { runtime.events.removeEventListener('tick', onTick); };
        return root;
    };

    // ── Conflicts ────────────────────────────────────────────────────────────
    function pluginName(id) { var r = runtime.get(id); return r ? r.name : id; }
    function joinNames(names) { return names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }

    // Same element changed by several plugins, grouped by who is involved
    function elementConflicts() {
        var groups = {};
        runtime.conflicts().forEach(function (c) {
            var names = c.plugins.map(pluginName).sort();
            var key = names.join('|');
            (groups[key] = groups[key] || { names: names, items: [] }).items.push(c);
        });
        return Object.keys(groups).map(function (k) { return groups[k]; });
    }

    // Plugin sources, to attribute <style> tags created where the runtime can't follow
    var pluginSources = [];
    function refreshPluginSources() {
        return host.scanMods().then(function (mods) {
            pluginSources = mods.plugins.map(function (m) { return { name: m.meta.name, text: m.text }; });
        }).catch(function () {});
    }

    function guessStylePlugin(styleEl) {
        var css = styleEl.textContent || '';
        var selectors = (css.match(/[^{}]+(?=\{)/g) || []).map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 6 && x.charAt(0) !== '@'; }).slice(0, 5);
        var best = null, bestHits = 0;
        pluginSources.forEach(function (p) {
            var hits = selectors.filter(function (sel) { return p.text.indexOf(sel.split(',')[0].trim()) !== -1; }).length;
            if (hits > bestHits) { best = p.name; bestHits = hits; }
        });
        return best;
    }

    // Declarations for the same selector + property from different sources
    function styleConflicts() {
        var all = Array.prototype.slice.call(document.querySelectorAll('style, link[rel=stylesheet]'));
        var sources = [];
        var theme = document.getElementById('activeTheme');
        if (theme && theme.sheet) sources.push({ name: theme.dataset.plugin || 'Theme', theme: true, sheet: theme.sheet, order: all.indexOf(theme) });
        var tracked = runtime.pluginStyleSheets();
        tracked.forEach(function (s) {
            sources.push({ name: pluginName(s.plugin), theme: false, sheet: s.sheet, order: all.indexOf(s.element) });
        });
        // <style> tags nobody claimed (not the menu's, not ours): match them to a plugin by their selectors
        all.forEach(function (styleEl, order) {
            if (styleEl === theme || styleEl.tagName !== 'STYLE' || !styleEl.sheet) return;
            if (tracked.some(function (t) { return t.element === styleEl; })) return;
            if (/^(sp-|stremio-plus|__st_)/.test(styleEl.id) || /#__st_|#sp-|\.sp-|\.st-/.test(styleEl.textContent || '')) return;
            var name = guessStylePlugin(styleEl);
            if (name) sources.push({ name: name, theme: false, sheet: styleEl.sheet, order: order });
        });
        var decls = {};
        var collect = function (rules, source) {
            Array.prototype.forEach.call(rules, function (rule) {
                if (rule.selectorText && rule.style) {
                    for (var i = 0; i < rule.style.length; i++) {
                        var prop = rule.style.item(i);
                        var key = rule.selectorText + '|' + prop;
                        (decls[key] = decls[key] || []).push({ selector: rule.selectorText, prop: prop, value: rule.style.getPropertyValue(prop).trim(),
                            important: rule.style.getPropertyPriority(prop) === 'important', source: source });
                    }
                } else if (rule.cssRules) collect(rule.cssRules, source);
            });
        };
        sources.forEach(function (src) { try { collect(src.sheet.cssRules, src); } catch (e) { /* cross-origin sheet */ } });

        var pairs = {};
        Object.keys(decls).forEach(function (key) {
            var list = decls[key];
            var names = list.map(function (d) { return d.source.name; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
            if (names.length < 2) return;
            if (list.every(function (d) { return d.value === list[0].value; })) return;
            // The cascade winner: !important first, then the later stylesheet
            var winner = list.slice().sort(function (x, y) { return (y.important - x.important) || (y.source.order - x.source.order); })[0];
            list.forEach(function (d) {
                if (d.source.name === winner.source.name || d.value === winner.value) return;
                var pk = winner.source.name + '>' + d.source.name;
                var pair = pairs[pk] = pairs[pk] || { winner: winner.source.name, loser: d.source.name, themeWins: winner.source.theme, examples: [] };
                var example = d.selector + ' { ' + d.prop + ' }';
                if (pair.examples.indexOf(example) === -1) pair.examples.push(example);
            });
        });
        return Object.keys(pairs).map(function (k) { return pairs[k]; });
    }

    function conflictCount() {
        try { return elementConflicts().length + styleConflicts().length; } catch (e) { return 0; }
    }

    function conflictSummary() {
        var n = conflictCount();
        return n ? n + (n === 1 ? ' conflict' : ' conflicts') + ' between plugins and your theme' : 'Plugins and themes that change the same things';
    }

    // Briefly outlines an element on the page (the menu steps out of the way)
    function highlight(element, label) {
        if (window.__st_toggle && menuOpen()) window.__st_toggle();
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(function () {
            var r = element.getBoundingClientRect();
            var box = document.getElementById('sp-highlight') || h('div', { id: 'sp-highlight' });
            box.style.cssText = 'left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px;opacity:1';
            box.replaceChildren(h('b', { text: label }));
            document.body.appendChild(box);
            setTimeout(function () { box.style.opacity = '0'; }, 2600);
            setTimeout(function () { box.remove(); }, 3000);
        }, 450);
    }

    var KIND_WORDS = { class: 'classes', style: 'inline styles', content: 'contents', attributes: 'attributes', children: 'children', position: 'position', removed: 'removes it' };

    PAGES.conflicts = function () {
        if (!pluginSources.length) refreshPluginSources().then(function () { if (stack[stack.length - 1] === 'conflicts') render(); });
        var root = h('div', null, pageHeader('Conflicts', 'Found while you use Stremio: open a few pages to catch more. Two plugins changing the same element, or a theme overriding a plugin\u2019s styles, are common causes of glitches.'));
        var elements = elementConflicts();
        var styles = styleConflicts();

        root.appendChild(h('div', { class: 'spt-section', text: 'Page elements' }));
        var elCard = h('div', { class: 'spt-card' });
        if (!elements.length) elCard.appendChild(h('div', { class: 'spt-row' }, [h('div', { class: 'spt-sub', text: 'No element has been changed by more than one plugin so far.' })]));
        elements.forEach(function (g) {
            var kinds = {};
            g.items.forEach(function (c) { c.kinds.forEach(function (k) { kinds[k] = true; }); });
            var first = g.items[0];
            elCard.appendChild(h('div', { class: 'spt-row', style: 'align-items:flex-start' }, [
                h('span', { class: 'spt-dot warn', style: 'margin-top:5px' }),
                h('div', { class: 'spt-main' }, [
                    h('div', { class: 'spt-name', text: joinNames(g.names) }),
                    h('div', { class: 'spt-sub', text: 'Both change ' + g.items.length + (g.items.length === 1 ? ' element' : ' elements') + ' (' +
                        Object.keys(kinds).map(function (k) { return KIND_WORDS[k] || k; }).join(', ') + ')' }),
                    h('ul', { class: 'spt-examples' }, g.items.slice(0, 4).map(function (c) { return h('li', { text: c.label }); })),
                ]),
                h('div', { class: 'spt-trail' }, [h('button', { class: 'spt-btn', text: 'Show', onclick: function () { highlight(first.element, joinNames(g.names)); } })]),
            ]));
        });
        root.appendChild(elCard);

        root.appendChild(h('div', { class: 'spt-section', text: 'Styles' }));
        var cssCard = h('div', { class: 'spt-card' });
        if (!styles.length) cssCard.appendChild(h('div', { class: 'spt-row' }, [h('div', { class: 'spt-sub', text: 'No styles from your theme and plugins override each other.' })]));
        styles.forEach(function (p) {
            cssCard.appendChild(h('div', { class: 'spt-row', style: 'align-items:flex-start' }, [
                h('span', { class: 'spt-dot ' + (p.themeWins ? 'warn' : 'ok'), style: 'margin-top:5px' }),
                h('div', { class: 'spt-main' }, [
                    h('div', { class: 'spt-name', text: p.winner + ' overrides ' + p.loser }),
                    h('div', { class: 'spt-sub', text: p.examples.length + (p.examples.length === 1 ? ' style' : ' styles') + (p.themeWins ? ' the plugin sets are replaced by the theme' : ' replaced') }),
                    h('ul', { class: 'spt-examples' }, p.examples.slice(0, 4).map(function (e) { return h('li', { text: e }); })),
                ]),
            ]));
        });
        root.appendChild(cssCard);
        return root;
    };

    // ── Shortcuts ────────────────────────────────────────────────────────────
    PAGES.shortcuts = function () {
        var sc = commands.shortcuts;
        var root = h('div', null, pageHeader('Keyboard Shortcuts', 'Click a shortcut, then press the new keys. Backspace removes it, Esc cancels. Stremio’s own player keys can be moved too.'));
        var groups = {};
        sc.list().forEach(function (item) { (groups[item.cmd.group] = groups[item.cmd.group] || []).push(item); });
        ['App', 'Player', 'Navigation', 'Tools', 'Appearance'].concat(Object.keys(groups)).filter(function (g, i, a) { return groups[g] && a.indexOf(g) === i; }).forEach(function (group) {
            root.appendChild(h('div', { class: 'spt-section', text: group }));
            var card = h('div', { class: 'spt-card' });
            groups[group].forEach(function (item) {
                var note = h('div', { class: 'spt-note' });
                var key = h('button', { class: 'spt-key' + (item.combo ? '' : ' empty'), text: sc.display(item.combo) || 'Add', onclick: function () { record(item.cmd, key, note); } });
                card.appendChild(h('div', { class: 'spt-row' }, [
                    h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: item.cmd.title }), item.cmd.stremio ? h('div', { class: 'spt-sub', text: 'Stremio' }) : null, note]),
                    h('div', { class: 'spt-trail' }, [
                        !item.isDefault ? h('button', { class: 'spt-btn', text: 'Reset', onclick: function () { sc.reset(item.cmd.id); render(); } }) : null,
                        key,
                    ]),
                ]));
            });
            root.appendChild(card);
        });
        root.appendChild(h('div', { class: 'spt-section', text: 'Built into the menu' }));
        root.appendChild(h('div', { class: 'spt-card' }, [h('div', { class: 'spt-row' }, [
            h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Command palette' })]),
            h('span', { class: 'spt-key', style: 'cursor:default', text: 'Ctrl K' }),
        ])]));
        root.appendChild(h('div', { class: 'spt-row' }, [h('button', { class: 'spt-btn', text: 'Restore all defaults', onclick: function () {
            var before = sc.load();
            sc.reset();
            render();
            runtime.toast({ title: 'Shortcuts restored to defaults', action: { label: 'Undo', run: function () { sc.save(before); render(); } } });
        } })]));
        return root;
    };

    function record(cmd, key, note) {
        var sc = commands.shortcuts;
        sc.recording = true;
        key.classList.add('recording');
        key.textContent = 'Press keys…';
        var finish = function () {
            sc.recording = false;
            window.removeEventListener('keydown', onKey, true);
            key.removeEventListener('blur', cancel);
        };
        var cancel = function () { finish(); render(); };
        var onKey = function (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (['Shift', 'Meta', 'Control', 'Alt'].indexOf(e.key) !== -1) return;
            if (e.key === 'Escape' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) return cancel();
            if (e.key === 'Backspace' || e.key === 'Delete') { finish(); sc.set(cmd.id, ''); render(); return; }
            var combo = sc.comboFromEvent(e);
            if (!combo) return;
            finish();
            // Taking a shortcut away from another command removes it there
            var clash = sc.conflicts(combo, cmd.id);
            clash.forEach(function (c) { sc.set(c.id, ''); });
            sc.set(cmd.id, combo);
            render();
            if (clash.length) runtime.toast({ title: sc.display(combo) + ' moved from “' + clash[0].title + '”', duration: 3500 });
        };
        window.addEventListener('keydown', onKey, true);
        key.addEventListener('blur', cancel);
    }

    // ── Widgets ──────────────────────────────────────────────────────────────
    PAGES.widgets = function () {
        var widgets = window.__spWidgets;
        var root = h('div', null, pageHeader('Widgets', 'Up to three tiles show above the search. Drag to reorder.'));
        var list = h('div', { class: 'spt-card spt-sortable' });
        root.appendChild(list);

        function draw() {
            var layout = widgets.layout();
            var tiles = widgets.tiles();
            var ordered = layout.order.map(function (id) { return tiles.find(function (t) { return t.id === id; }); }).filter(Boolean);
            tiles.forEach(function (t) { if (ordered.indexOf(t) === -1) ordered.push(t); });
            var shown = ordered.filter(function (t) { return layout.hidden.indexOf(t.id) === -1; });
            list.replaceChildren();
            ordered.forEach(function (tile) {
                var on = layout.hidden.indexOf(tile.id) === -1;
                var visible = on && shown.indexOf(tile) < widgets.max;
                var sw = h('button', { class: 'spt-switch' + (on ? ' on' : ''), 'aria-label': 'Show ' + tile.title, onclick: function () {
                    var l = widgets.layout();
                    l.hidden = on ? l.hidden.concat([tile.id]) : l.hidden.filter(function (x) { return x !== tile.id; });
                    widgets.setLayout(l);
                    draw();
                } });
                var grip = h('span', { class: 'spt-drag', title: 'Drag to reorder' }, [svg(ICON.grip, 14)]);
                var row = h('div', { class: 'spt-row', 'data-id': tile.id }, [
                    grip,
                    h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: tile.title }), h('div', { class: 'spt-sub', text: on && !visible ? 'On, but only the first ' + widgets.max + ' fit' : tile.description })]),
                    sw,
                ]);
                sortable(row, grip, list, function (ids) {
                    var l = widgets.layout();
                    l.order = ids;
                    widgets.setLayout(l);
                    draw();
                });
                list.appendChild(row);
            });
        }
        draw();
        return root;
    };

    // Drag to reorder: the row follows the pointer 1:1, neighbours slide out of
    // the way, and on release it settles into its slot without overshoot
    function sortable(row, handle, list, onDrop) {
        handle.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            var rows = Array.from(list.children);
            var from = rows.indexOf(row);
            var heights = rows.map(function (r) { return r.getBoundingClientRect().height; });
            var startY = e.clientY;
            var to = from;
            row.classList.add('dragging');
            rows.forEach(function (r) { if (r !== row) r.classList.add('settling'); });

            var move = function (ev) {
                var dy = ev.clientY - startY;
                row.style.transform = 'translateY(' + dy + 'px)';
                // Target slot: where the dragged row's centre now sits
                var offset = dy, target = from;
                while (offset > heights[target] / 2 && target < rows.length - 1) { offset -= heights[target + 1]; target++; }
                while (offset < -heights[target] / 2 && target > 0) { offset += heights[target - 1]; target--; }
                to = target;
                rows.forEach(function (r, i) {
                    if (r === row) return;
                    var shift = 0;
                    if (from < to && i > from && i <= to) shift = -heights[from];
                    if (from > to && i < from && i >= to) shift = heights[from];
                    r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
                });
            };
            var up = function () {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                var settled = 0;
                for (var i = Math.min(from, to); i <= Math.max(from, to); i++) if (i !== from) settled += heights[i];
                row.classList.add('settling');
                row.style.transform = from === to ? '' : 'translateY(' + (to > from ? settled : -settled) + 'px)';
                setTimeout(function () {
                    var ids = rows.map(function (r) { return r.dataset.id; });
                    ids.splice(to, 0, ids.splice(from, 1)[0]);
                    onDrop(ids);
                }, from === to ? 0 : 260);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        });
    }

    // ── Appearance ───────────────────────────────────────────────────────────
    var APPEARANCE_KEY = 'sp_appearance';
    var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function appearanceSettings() {
        var current = localStorage.getItem('currentTheme') || 'Default';
        var defaults = { mode: 'off', light: current, dark: current, lightAt: '07:00', darkAt: '19:00' };
        try { return Object.assign(defaults, JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}')); } catch (e) { return defaults; }
    }

    function saveAppearance(settings) {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings));
        evaluateAppearance();
    }

    function minutes(hhmm) { var p = String(hhmm).split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }

    function desiredMode(settings) {
        if (settings.mode === 'system') return darkQuery.matches ? 'dark' : 'light';
        if (settings.mode === 'schedule') {
            var now = new Date(), m = now.getHours() * 60 + now.getMinutes();
            var light = minutes(settings.lightAt), dark = minutes(settings.darkAt);
            var isLight = light < dark ? m >= light && m < dark : m >= light || m < dark;
            return isLight ? 'light' : 'dark';
        }
        return null;
    }

    function useTheme(file) {
        return host.scanMods().then(function (mods) {
            var current = localStorage.getItem('currentTheme') || 'Default';
            if (current === file) return;
            var target = mods.themes.find(function (t) { return t.file === file; });
            var previous = mods.themes.find(function (t) { return t.file === current; });
            var work = Promise.resolve();
            if (previous) work = work.then(function () { return host.setEnabled(previous.meta.name, false, { silent: true }); });
            if (target) return work.then(function () { return host.setEnabled(target.meta.name, true, { applyTheme: true, silent: true }); });
            return work.then(function () { return host.applyThemeFile(null); });
        });
    }

    function evaluateAppearance() {
        var settings = appearanceSettings();
        var mode = desiredMode(settings);
        if (mode) document.documentElement.dataset.spAppearance = mode;
        else delete document.documentElement.dataset.spAppearance;
        if (mode) return useTheme(settings[mode]);
        return Promise.resolve();
    }

    function themeSelect(value, onChange, themes) {
        var select = h('select', { onchange: function () { onChange(select.value); } }, [h('option', { value: 'Default', text: 'Stremio default' })].concat(
            themes.map(function (t) { return h('option', { value: t.file, text: t.meta.name }); })));
        select.value = value;
        return select;
    }

    PAGES.appearance = function () {
        var root = h('div', null, pageHeader('Appearance', 'Use one theme by day and another by night. To switch at sunset, set macOS to Auto appearance and pick “Match macOS”.'));
        var settings = appearanceSettings();
        var body = h('div', { class: 'spt-card' });
        root.appendChild(body);
        host.scanMods().then(function (mods) {
            var update = function (patch) { Object.assign(settings, patch); saveAppearance(settings); draw(); };
            function draw() {
                var seg = h('div', { class: 'spt-seg' }, [['off', 'Off'], ['system', 'Match macOS'], ['schedule', 'Schedule']].map(function (m) {
                    return h('button', { class: settings.mode === m[0] ? 'on' : '', text: m[1], onclick: function () { update({ mode: m[0] }); } });
                }));
                var now = desiredMode(settings);
                var rows = [
                    h('div', { class: 'spt-row' }, [h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Switch automatically' }),
                        h('div', { class: 'spt-sub', text: now ? 'Now using the ' + now + ' theme' : 'Your theme stays as it is' })]), seg]),
                    h('div', { class: 'spt-row' }, [h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Light theme' })]),
                        themeSelect(settings.light, function (v) { update({ light: v }); }, mods.themes)]),
                    h('div', { class: 'spt-row' }, [h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Dark theme' })]),
                        themeSelect(settings.dark, function (v) { update({ dark: v }); }, mods.themes)]),
                ];
                if (settings.mode === 'schedule') {
                    var lightAt = h('input', { type: 'time', value: settings.lightAt, onchange: function () { update({ lightAt: lightAt.value }); } });
                    var darkAt = h('input', { type: 'time', value: settings.darkAt, onchange: function () { update({ darkAt: darkAt.value }); } });
                    rows.push(h('div', { class: 'spt-row' }, [h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Light from' })]), lightAt]));
                    rows.push(h('div', { class: 'spt-row' }, [h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Dark from' })]), darkAt]));
                }
                body.replaceChildren.apply(body, rows);
            }
            draw();
        });
        return root;
    };

    // ── Developer ────────────────────────────────────────────────────────────
    PAGES.developer = function () {
        var root = h('div', null, pageHeader('Developer', 'With dev mode on, every .plugin.js in the dev folder loads on top of your plugins and reloads when you save it. Timers, observers and listeners from the old version are stopped first.'));
        var on = host.devModeEnabled();
        var card = h('div', { class: 'spt-card' }, [
            h('div', { class: 'spt-row' }, [
                h('div', { class: 'spt-main' }, [h('div', { class: 'spt-name', text: 'Dev mode' }), h('div', { class: 'spt-sub', text: 'Watches stremio-plus/dev/' })]),
                h('button', { class: 'spt-switch' + (on ? ' on' : ''), onclick: function () { host.setDevMode(!on); render(); } }),
            ]),
            h('div', { class: 'spt-row' }, [
                h('button', { class: 'spt-btn', text: 'Open dev folder', onclick: function () { host.native('watchDir', 'dev').then(function () { return host.native('openFolder', 'dev'); }); } }),
                h('button', { class: 'spt-btn', text: 'Reload dev plugins', disabled: !on, onclick: function () { host.reloadDevPlugins(); } }),
            ]),
        ]);
        root.appendChild(card);

        var filter = h('select', null, [h('option', { value: '', text: 'All plugins' })].concat(runtime.all().map(function (r) { return h('option', { value: r.id, text: r.name }); })));
        var errorsOnly = false;
        var levelSeg = h('div', { class: 'spt-seg' }, [
            h('button', { class: 'on', text: 'All', onclick: function (e) { errorsOnly = false; levelSeg.children[0].className = 'on'; levelSeg.children[1].className = ''; draw(); } }),
            h('button', { text: 'Errors', onclick: function () { errorsOnly = true; levelSeg.children[0].className = ''; levelSeg.children[1].className = 'on'; draw(); } }),
        ]);
        var consoleBox = h('div', { class: 'spt-console' });
        filter.addEventListener('change', function () { draw(); });
        root.append(
            h('div', { class: 'spt-section', text: 'Console' }),
            h('div', { class: 'spt-row', style: 'padding-top:0' }, [filter, levelSeg, h('button', { class: 'spt-btn', style: 'margin-left:auto', text: 'Clear', onclick: function () { runtime.clearLogs(); } })]),
            consoleBox
        );

        function line(entry) {
            var rec = runtime.get(entry.plugin);
            var time = new Date(entry.t).toTimeString().slice(0, 8);
            return h('div', { class: 'spt-log ' + entry.level }, [h('span', { class: 't', text: time }), h('span', { class: 'p', text: rec ? rec.name : entry.plugin }), h('span', { text: entry.text })]);
        }
        function matches(entry) {
            return (!filter.value || entry.plugin === filter.value) && (!errorsOnly || entry.level === 'error' || entry.level === 'warn');
        }
        function draw() {
            var logs = runtime.logs().filter(matches);
            consoleBox.replaceChildren.apply(consoleBox, logs.length ? logs.map(line) : [h('div', { class: 'spt-log', style: 'color:rgba(255,255,255,0.4)', text: 'Nothing logged yet.' })]);
            consoleBox.scrollTop = consoleBox.scrollHeight;
        }
        draw();
        var onLog = function (e) {
            if (!e.detail) return draw();
            if (!matches(e.detail)) return;
            var atBottom = consoleBox.scrollTop + consoleBox.clientHeight >= consoleBox.scrollHeight - 8;
            if (consoleBox.firstChild && !consoleBox.firstChild.querySelector('.t')) consoleBox.replaceChildren();
            consoleBox.appendChild(line(e.detail));
            if (atBottom) consoleBox.scrollTop = consoleBox.scrollHeight;
        };
        runtime.events.addEventListener('log', onLog);
        liveStop = function () { runtime.events.removeEventListener('log', onLog); };
        return root;
    };

    // ── Theme editor (docked, so Stremio stays visible as the preview) ───────
    var STREMIO_VARS = ['--primary-background-color', '--secondary-background-color', '--primary-foreground-color', '--secondary-foreground-color',
        '--primary-accent-color', '--secondary-accent-color', '--tertiary-accent-color', '--overlay-color', '--modal-background-color', '--outer-glow'];

    function stripHeader(css) {
        return css.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, function (block) { return /@name/.test(block) ? '' : block; });
    }

    function themeVariables(css) {
        var vars = [];
        var re = /:root\s*\{([^}]*)\}/g, block;
        while ((block = re.exec(css))) {
            var decl = /(--[\w-]+)\s*:\s*([^;]+);/g, m;
            while ((m = decl.exec(block[1]))) {
                // A later definition wins, as it does in CSS
                var existing = vars.find(function (v) { return v.name === m[1]; });
                if (existing) existing.value = m[2].trim();
                else vars.push({ name: m[1], value: m[2].trim() });
            }
        }
        return vars;
    }

    function parseCssColor(value) {
        var probe = document.createElement('i');
        probe.style.color = '';
        probe.style.color = value;
        if (!probe.style.color) return null;
        document.body.appendChild(probe);
        var computed = getComputedStyle(probe).color;
        probe.remove();
        var m = computed.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
        return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    }

    function toHex(c) { return '#' + [c.r, c.g, c.b].map(function (n) { return Math.round(n).toString(16).padStart(2, '0'); }).join(''); }

    function openThemeEditor() {
        if (document.getElementById('sp-te')) return;
        if (window.__st_toggle && menuOpen()) window.__st_toggle();
        var live = h('style', { id: 'sp-theme-live' });
        document.head.appendChild(live);
        var overrides = {};
        var base = { file: localStorage.getItem('currentTheme') || 'Default', css: '', name: 'Stremio default' };

        var varsBox = h('div', { class: 'te-vars' });
        var baseSelect = h('select');
        var nameInput = h('input', { type: 'text', placeholder: 'Theme name', style: 'width:100%' });
        var editor = h('div', { id: 'sp-te', role: 'dialog', 'aria-label': 'Theme Editor' }, [
            h('div', { class: 'te-head' }, [svg(ICON.editor, 15), h('b', { text: 'Theme Editor' }),
                h('button', { class: 'te-close', title: 'Close (changes are kept until you reload)', onclick: close }, [svg(ICON.close, 14)])]),
            h('div', { class: 'te-base' }, ['Based on', baseSelect]),
            varsBox,
            h('div', { class: 'te-foot' }, [
                nameInput,
                h('div', { class: 'te-actions' }, [
                    h('button', { class: 'spt-btn', text: 'Revert', onclick: function () { overrides = {}; apply(); drawVars(); } }),
                    h('button', { class: 'spt-btn', text: 'Copy CSS', onclick: function () {
                        navigator.clipboard.writeText(buildCss()).then(function () { runtime.toast({ title: 'Theme CSS copied', duration: 2000 }); });
                    } }),
                    h('button', { class: 'spt-btn primary', text: 'Save theme', onclick: save }),
                ]),
            ]),
        ]);
        document.body.appendChild(editor);
        requestAnimationFrame(function () { editor.classList.add('in'); });
        nameInput.addEventListener('keydown', function (e) { e.stopPropagation(); });

        function apply() {
            var decls = Object.keys(overrides).map(function (k) { return '  ' + k + ': ' + overrides[k] + ' !important;'; }).join('\n');
            live.textContent = decls ? ':root {\n' + decls + '\n}' : '';
        }

        function buildCss() {
            var name = nameInput.value.trim() || 'My Theme';
            var header = '/**\n * @name ' + name + '\n * @description Made with the Stremio+ Theme Editor' + (base.file !== 'Default' ? ' from ' + base.name : '') +
                '\n * @version 1.0.0\n * @author You\n */\n\n';
            var body = base.css ? stripHeader(base.css).trim() + '\n\n' : '';
            var decls = Object.keys(overrides).map(function (k) { return '    ' + k + ': ' + overrides[k] + ';'; }).join('\n');
            return header + body + (decls ? '/* Theme Editor changes */\n:root {\n' + decls + '\n}\n' : '');
        }

        function save() {
            var name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            var file = host.safeName(name) + '.theme.css';
            host.native('writeText', 'themes/' + file, buildCss()).then(function (ok) {
                if (!ok) throw new Error('Could not write the theme');
                overrides = {};
                apply();
                return host.scanMods();
            }).then(function () {
                return useTheme(file);
            }).then(function () {
                runtime.toast({ title: 'Saved and applied ' + name, message: 'themes/' + file,
                    action: { label: 'Show file', run: function () { host.native('openFolder', 'themes'); } } });
                loadBase(file);
            }).catch(function (e) { runtime.toast({ title: 'Could not save the theme', message: String(e.message || e) }); });
        }

        function close() {
            editor.classList.remove('in');
            setTimeout(function () { editor.remove(); }, 380);
            if (Object.keys(overrides).length) {
                var kept = Object.assign({}, overrides);
                runtime.toast({ title: 'Unsaved theme changes stay until you reload', action: { label: 'Discard', run: function () { live.remove(); } } });
                overrides = kept;
            } else {
                live.remove();
            }
        }

        function drawVars() {
            var vars = base.file === 'Default'
                ? STREMIO_VARS.map(function (n) { return { name: n, value: getComputedStyle(document.documentElement).getPropertyValue(n).trim() }; }).filter(function (v) { return v.value; })
                : themeVariables(base.css);
            varsBox.replaceChildren();
            if (!vars.length) varsBox.appendChild(h('div', { class: 'spt-sub', style: 'padding:10px 6px', text: 'This theme has no :root variables to edit.' }));
            vars.forEach(function (v) {
                var value = overrides[v.name] !== undefined ? overrides[v.name] : v.value;
                var row = h('div', { class: 'te-var' + (overrides[v.name] !== undefined ? ' changed' : '') });
                var set = function (next) {
                    if (next === v.value) delete overrides[v.name]; else overrides[v.name] = next;
                    row.classList.toggle('changed', overrides[v.name] !== undefined);
                    apply();
                };
                var ctl = h('div', { class: 'te-ctl' });
                var color = parseCssColor(value);
                var length = String(value).match(/^(-?[\d.]+)(px|rem|em|%)$/);
                if (color && !/gradient|var\(/.test(value)) {
                    var swatch = h('button', { class: 'te-swatch', title: value }, [h('i', { style: 'background:' + value })]);
                    var text = h('input', { type: 'text', value: value });
                    var alpha = color.a;
                    var fromHex = function (hex) {
                        if (alpha >= 1) return hex;
                        var c = parseCssColor(hex);
                        return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + alpha + ')';
                    };
                    swatch.addEventListener('click', function () {
                        window.__spColorPicker.open(swatch, toHex(parseCssColor(text.value) || color), {
                            onInput: function (hex) { var v2 = fromHex(hex); text.value = v2; swatch.firstChild.style.background = v2; set(v2); },
                            onCommit: function (hex) { var v2 = fromHex(hex); text.value = v2; swatch.firstChild.style.background = v2; set(v2); },
                        });
                    });
                    text.addEventListener('keydown', function (e) { e.stopPropagation(); });
                    text.addEventListener('change', function () { swatch.firstChild.style.background = text.value; set(text.value.trim()); });
                    ctl.append(text, swatch);
                } else if (length) {
                    var unit = length[2];
                    var num = +length[1];
                    var max = unit === '%' ? 100 : unit === 'px' ? Math.max(64, num * 3) : Math.max(4, num * 3);
                    var range = h('input', { type: 'range', min: '0', max: String(max), step: unit === 'px' || unit === '%' ? '1' : '0.05', value: String(num) });
                    var number = h('input', { type: 'number', value: String(num), step: range.step });
                    range.addEventListener('input', function () { number.value = range.value; set(range.value + unit); });
                    number.addEventListener('keydown', function (e) { e.stopPropagation(); });
                    number.addEventListener('input', function () { range.value = number.value; set(number.value + unit); });
                    ctl.append(range, number, h('span', { class: 'spt-sub', style: 'margin:0', text: unit }));
                } else {
                    var input = h('input', { type: 'text', value: value });
                    input.addEventListener('keydown', function (e) { e.stopPropagation(); });
                    input.addEventListener('change', function () { set(input.value.trim()); });
                    ctl.appendChild(input);
                }
                row.append(h('label', { text: v.name, title: v.name }), ctl);
                varsBox.appendChild(row);
            });
        }

        function loadBase(file) {
            host.scanMods().then(function (mods) {
                baseSelect.replaceChildren.apply(baseSelect, [h('option', { value: 'Default', text: 'Stremio default' })].concat(
                    mods.themes.map(function (t) { return h('option', { value: t.file, text: t.meta.name }); })));
                var theme = mods.themes.find(function (t) { return t.file === file; });
                base = theme ? { file: theme.file, css: theme.text, name: theme.meta.name } : { file: 'Default', css: '', name: 'Stremio default' };
                baseSelect.value = base.file;
                if (!nameInput.value) nameInput.value = theme ? theme.meta.name + ' Custom' : 'My Theme';
                drawVars();
            });
        }
        baseSelect.addEventListener('change', function () {
            overrides = {};
            apply();
            // Preview the chosen base theme too
            useTheme(baseSelect.value).then(function () { loadBase(baseSelect.value); });
        });
        loadBase(base.file);
    }

    // ── Menu toasts: ours carry Undo, so drop the menu's duplicates ──────────
    function hideDuplicateToasts() {
        var watch = function () {
            var stack = document.getElementById('__st_toast_stack__');
            if (!stack) return setTimeout(watch, 500);
            new MutationObserver(function (records) {
                records.forEach(function (r) {
                    r.addedNodes.forEach(function (node) {
                        if (node.nodeType === 1 && /^\s*(Enabled|Disabled)( theme)? "/.test(node.textContent || '')) node.remove();
                    });
                });
            }).observe(stack, { childList: true });
        };
        watch();
    }

    // ── Commands ─────────────────────────────────────────────────────────────
    [['profiles', 'Profiles'], ['health', 'Plugin Health'], ['conflicts', 'Conflicts'], ['shortcuts', 'Keyboard Shortcuts'], ['widgets', 'Widgets'], ['appearance', 'Appearance'], ['developer', 'Developer Console']].forEach(function (p) {
        commands.register({ id: 'tools.' + p[0], title: 'Open ' + p[1], group: 'Tools', keywords: 'tools settings ' + p[0], keepOpen: true, run: function () { openTools(p[0]); } });
    });
    commands.register({ id: 'tools.theme-editor', title: 'Open Theme Editor', group: 'Tools', keywords: 'theme colours customise design', run: openThemeEditor });
    commands.register({ id: 'tools.save-profile', title: 'Save current setup as a profile', group: 'Profiles', keywords: 'profile preset', keepOpen: true, run: function () { openTools('profiles'); } });
    commands.register({ id: 'tools.dev-mode', title: 'Toggle dev mode', group: 'Tools', keywords: 'developer hot reload', run: function () {
        var on = !host.devModeEnabled();
        host.setDevMode(on);
        runtime.toast({ title: 'Dev mode ' + (on ? 'on' : 'off'), duration: 2000 });
    } });
    commands.register({ id: 'appearance.light', title: 'Use light theme', group: 'Appearance', keywords: 'day bright mode', run: function () {
        var s = appearanceSettings(); s.mode = 'off'; localStorage.setItem(APPEARANCE_KEY, JSON.stringify(s)); return useTheme(s.light);
    } });
    commands.register({ id: 'appearance.dark', title: 'Use dark theme', group: 'Appearance', keywords: 'night mode', run: function () {
        var s = appearanceSettings(); s.mode = 'off'; localStorage.setItem(APPEARANCE_KEY, JSON.stringify(s)); return useTheme(s.dark);
    } });
    commands.register({ id: 'appearance.system', title: 'Match macOS appearance', group: 'Appearance', keywords: 'system auto sunset', run: function () {
        var s = appearanceSettings(); s.mode = 'system'; saveAppearance(s);
    } });
    commands.addProvider(function () {
        return profileList.map(function (p) {
            return { id: 'profile.' + p.name, title: 'Switch to ' + p.name, group: 'Profiles', keywords: 'profile preset', run: function () { return applyProfile(p.name); } };
        });
    });

    window.__spTools = {
        open: openTools,
        openThemeEditor: openThemeEditor,
        profiles: { list: function () { return profileList; }, apply: applyProfile, reload: loadProfiles },
        appearance: { settings: appearanceSettings, save: saveAppearance },
    };

    mount();
    refreshPluginSources();
    loadProfiles().catch(function () {});
    offerProfileUndo();
    evaluateAppearance();
    darkQuery.addEventListener('change', evaluateAppearance);
    native.setInterval(function () { if (appearanceSettings().mode === 'schedule') evaluateAppearance(); }, 60000);
})();
