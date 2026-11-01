// Streamlines the menu's Settings tab for the macOS app: removes controls that
// do nothing here (accent colours, glass/grain/card styles the skin replaces,
// Discord, the playback-backend picker, the crash simulator), rewords what
// stays, adds an accurate status row, a Playback section and links to Tools.
// panel.js stays unchanged; this rearranges its Settings markup in place.
(function () {
    if (window.__spSettings) return;
    window.__spSettings = true;

    var runtime = window.__spRuntime;
    var host = window.__spHost;

    var css = '' +
        // The Settings column is a flex box; without this the dashboard gets squashed.
        // Colours are set explicitly: inherited text colour is dark in some themes
        '#sp-set-status { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr); gap:10px; padding:14px 20px 4px; flex-shrink:0 !important; color:rgba(255,255,255,0.92); }' +
        '#sp-set-status .ss-card { padding:14px 16px; border-radius:14px; background:rgba(255,255,255,0.05); border:0.5px solid rgba(255,255,255,0.08); min-width:0; }' +
        '#sp-set-status .link { cursor:pointer; transition:background .15s ease, transform .1s ease; }' +
        '#sp-set-status .link:hover { background:rgba(255,255,255,0.08); }' +
        '#sp-set-status .link:active { transform:scale(0.985); }' +
        '#sp-set-status .ss-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; }' +
        '#sp-set-status .ss-title { font-size:12px; font-weight:600; color:rgba(255,255,255,0.55); }' +
        '#sp-set-status .ss-aside { font-size:11.5px; color:rgba(255,255,255,0.4); font-variant-numeric:tabular-nums; }' +
        // Plugins donut
        '#sp-set-status .ss-donut-wrap { display:flex; align-items:center; gap:18px; }' +
        '#sp-set-status .ss-donut { position:relative; width:104px; height:104px; flex:none; }' +
        '#sp-set-status .ss-donut svg { width:100%; height:100%; transform:rotate(-90deg); overflow:visible; }' +
        '#sp-set-status .ss-donut circle { fill:none; stroke-width:11; transition:stroke-dasharray .6s cubic-bezier(.32,.72,0,1), stroke-dashoffset .6s cubic-bezier(.32,.72,0,1); }' +
        '#sp-set-status .ss-donut-center { position:absolute; inset:0; display:grid; place-content:center; text-align:center; }' +
        '#sp-set-status .ss-big { font-size:26px; font-weight:700; letter-spacing:-0.02em; line-height:1; color:#fff; font-variant-numeric:tabular-nums; }' +
        '#sp-set-status .ss-small { margin-top:3px; font-size:11px; color:rgba(255,255,255,0.5); }' +
        '#sp-set-status .ss-legend { display:grid; gap:7px; flex:1; min-width:0; font-size:12.5px; }' +
        '#sp-set-status .ss-legend-row { display:flex; align-items:center; gap:8px; color:rgba(255,255,255,0.8); }' +
        '#sp-set-status .ss-legend-row b { margin-left:auto; font-weight:600; color:#fff; font-variant-numeric:tabular-nums; }' +
        '#sp-set-status .ss-legend-row.zero { opacity:.45; }' +
        // Activity bars
        '#sp-set-status .ss-bars { display:grid; gap:9px; }' +
        '#sp-set-status .ss-bar-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(60px,1.1fr) 58px; gap:10px; align-items:center; font-size:12.5px; }' +
        '#sp-set-status .ss-bar-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:rgba(255,255,255,0.85); }' +
        '#sp-set-status .ss-bar { height:6px; border-radius:3px; background:rgba(255,255,255,0.08); overflow:hidden; }' +
        '#sp-set-status .ss-bar > span { display:block; height:100%; border-radius:3px; transition:width .5s cubic-bezier(.32,.72,0,1), background .3s ease; }' +
        '#sp-set-status .ss-bar-value { text-align:right; color:rgba(255,255,255,0.5); font-variant-numeric:tabular-nums; }' +
        '#sp-set-status .ss-empty { font-size:12.5px; color:rgba(255,255,255,0.45); padding:8px 0; }' +
        // Small tiles
        '#sp-set-status .ss-tiles { grid-column:1 / -1; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }' +
        '#sp-set-status .ss-tile { padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.05); border:0.5px solid rgba(255,255,255,0.08); min-width:0; }' +
        '#sp-set-status .ss-label { font-size:11px; color:rgba(255,255,255,0.5); }' +
        '#sp-set-status .ss-value { margin-top:3px; font-size:14px; font-weight:600; letter-spacing:-0.01em; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }' +
        '#sp-set-status .ss-value i, #sp-set-status .ss-legend-row i { display:inline-block; width:8px; height:8px; border-radius:50%; flex:none; }' +
        '#sp-set-status .ss-value i { margin-right:6px; vertical-align:1px; }' +
        '@media (prefers-reduced-motion: reduce) { #sp-set-status .ss-donut circle, #sp-set-status .ss-bar > span { transition:none; } }' +
        // Hover fill extends past the row edges, so labels stay aligned with other rows
        '#__st_about_wrap__ .sp-set-row.sp-link { cursor:pointer; border-radius:8px; }' +
        '#__st_about_wrap__ .sp-set-row.sp-link:hover { background:rgba(255,255,255,0.05); box-shadow:-8px 0 0 rgba(255,255,255,0.05), 8px 0 0 rgba(255,255,255,0.05); }' +
        // The install-from-URL bar belongs to Store, Themes and Plugins
        '#__st_panel__:has(.st-tab[data-tab="about"].active) .st-url-row { display:none !important; }' +
        // "Open about folder" / "Open activity folder" aren't real folders
        '#__st_panel__:has(.st-tab[data-tab="about"].active) #__st_folder__, #__st_panel__:has(.st-tab[data-tab="activity"].active) #__st_folder__ { display:none !important; }' +
        '#__st_about_wrap__ .sp-chevron { color:rgba(255,255,255,0.35); margin-left:6px; }' +
        '#__st_about_wrap__ .sp-inline-btn { all:unset; cursor:pointer; margin-left:8px; padding:3px 9px; border-radius:6px; font-size:11.5px; background:rgba(255,255,255,0.08); border:0.5px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.85); }' +
        '#__st_about_wrap__ .sp-inline-btn:hover { background:rgba(255,255,255,0.14); }' +
        '#__st_about_wrap__ .sp-reset-note { font-size:11.5px; color:rgba(255,255,255,0.45); margin:6px 0 0; line-height:1.45; }';

    function $(id) { return document.getElementById(id); }
    function rowOf(el) { return el && el.closest('.sp-set-row'); }
    function sectionOf(el) { return el && el.closest('.sp-set-section'); }
    // The menu's own CSS forces display with !important, so this has to as well
    function hide(el) { if (el) el.style.setProperty('display', 'none', 'important'); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function section(title) {
        var s = el('div', 'sp-set-section');
        s.appendChild(el('div', 'sp-set-section-title', title));
        return s;
    }

    function infoRow(label, aside) {
        var row = el('div', 'sp-set-row');
        var value = el('span', 'sp-set-row-aside', aside);
        row.append(el('span', 'sp-set-row-label', label), value);
        return { row: row, value: value };
    }

    function linkRow(label, aside, onClick) {
        var row = el('div', 'sp-set-row sp-link');
        row.setAttribute('role', 'button');
        var right = el('span', 'sp-set-row-aside', aside || '');
        right.appendChild(el('span', 'sp-chevron', '›'));
        row.append(el('span', 'sp-set-row-label', label), right);
        row.addEventListener('click', onClick);
        return row;
    }

    function relabel(control, label, aside) {
        var row = rowOf(control);
        if (!row) return;
        var l = row.querySelector('.sp-set-row-label');
        if (l && label) l.textContent = label;
        var a = row.querySelector('.sp-set-row-aside');
        if (a && aside !== undefined) a.textContent = aside;
        else if (!a && aside) {
            var ctrl = row.querySelector('.sp-set-row-ctrl');
            if (ctrl) ctrl.appendChild(el('span', 'sp-set-row-aside', aside));
            else row.querySelector('.sp-set-seg').after(el('span', 'sp-set-row-aside', aside));
        }
    }

    function retitle(sec, title) {
        var t = sec && sec.querySelector('.sp-set-section-title');
        if (t) t.textContent = title;
    }

    function openTools(page) {
        if (window.__spTools) window.__spTools.open(page);
    }

    // ── Status dashboard: real numbers from the runtime ──────────────────────
    var COLORS = { ok: '#30d158', warn: '#ffd60a', bad: '#ff453a', off: 'rgba(255,255,255,0.16)' };
    var SEGMENTS = [['ok', 'Healthy'], ['warn', 'Needs attention'], ['bad', 'Problem'], ['off', 'Off']];
    var RADIUS = 46, CIRCUMFERENCE = 2 * Math.PI * RADIUS;
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var dash = {};         // live parts of the dashboard, updated in place
    var totalPlugins = 0;  // from the files on disk; the runtime only knows loaded ones

    function svgEl(tag, attrs) {
        var node = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        return node;
    }

    function dot(color) { var i = el('i'); i.style.background = color; return i; }

    function card(title, page) {
        var c = el('div', 'ss-card' + (page ? ' link' : ''));
        var head = el('div', 'ss-head');
        var aside = el('span', 'ss-aside');
        head.append(el('span', 'ss-title', title), aside);
        c.appendChild(head);
        if (page) c.addEventListener('click', function () { openTools(page); });
        return { card: c, aside: aside };
    }

    function statusRow() {
        var row = el('div');
        row.id = 'sp-set-status';

        // Plugins: a donut of healthy / needs attention / problem / off
        var plugins = card('Plugins', 'health');
        var wrap = el('div', 'ss-donut-wrap');
        var donut = el('div', 'ss-donut');
        var svg = svgEl('svg', { viewBox: '0 0 104 104' });
        svg.appendChild(svgEl('circle', { cx: 52, cy: 52, r: RADIUS, stroke: 'rgba(255,255,255,0.06)' }));
        dash.arcs = {};
        SEGMENTS.forEach(function (seg) {
            var arc = svgEl('circle', { cx: 52, cy: 52, r: RADIUS, stroke: COLORS[seg[0]], 'stroke-dasharray': '0 ' + CIRCUMFERENCE });
            dash.arcs[seg[0]] = arc;
            svg.appendChild(arc);
        });
        var center = el('div', 'ss-donut-center');
        dash.big = el('div', 'ss-big', '—');
        dash.small = el('div', 'ss-small', 'running');
        center.append(dash.big, dash.small);
        donut.append(svg, center);
        var legend = el('div', 'ss-legend');
        dash.legend = {};
        SEGMENTS.forEach(function (seg) {
            var r = el('div', 'ss-legend-row');
            var count = el('b', null, '0');
            r.append(dot(COLORS[seg[0]]), el('span', null, seg[1]), count);
            dash.legend[seg[0]] = { row: r, count: count };
            legend.appendChild(r);
        });
        wrap.append(donut, legend);
        plugins.card.appendChild(wrap);
        dash.pluginsAside = plugins.aside;

        // Activity: which plugins cost the most CPU right now
        var activity = card('Activity', 'health');
        dash.bars = el('div', 'ss-bars');
        activity.card.appendChild(dash.bars);
        dash.activityAside = activity.aside;

        var tiles = el('div', 'ss-tiles');
        [['theme', 'Theme', null], ['conflicts', 'Conflicts', 'conflicts'], ['errors', 'Errors this session', 'health'], ['startup', 'Startup time', 'health']].forEach(function (t) {
            var tile = el('div', 'ss-tile' + (t[2] ? ' link' : ''));
            var value = el('div', 'ss-value', '—');
            tile.append(el('div', 'ss-label', t[1]), value);
            if (t[2]) tile.addEventListener('click', function () { openTools(t[2]); });
            dash[t[0]] = value;
            tiles.appendChild(tile);
        });

        row.append(plugins.card, activity.card, tiles);
        return row;
    }

    function formatMs(ms) { return ms < 10 ? ms.toFixed(1) + ' ms' : Math.round(ms) + ' ms'; }

    // withFiles: also re-read plugin/theme files (when the tab opens, not every second)
    function refreshStatus(withFiles) {
        if (!dash.arcs) return;
        if (withFiles) host.scanMods().then(function (mods) {
            totalPlugins = mods.plugins.length;
            var current = localStorage.getItem('currentTheme');
            var theme = mods.themes.find(function (t) { return t.file === current; });
            dash.theme.textContent = theme ? theme.meta.name : 'Stremio default';
            refreshStatus(false);
        });

        var running = runtime.all().filter(function (r) { return r.kind !== 'Theme' && r.status === 'running'; });
        var healths = running.map(function (r) { return { rec: r, h: runtime.health(r) }; });
        var counts = { ok: 0, warn: 0, bad: 0, off: Math.max(0, totalPlugins - running.length) };
        healths.forEach(function (x) { counts[x.h.level] = (counts[x.h.level] || 0) + 1; });

        // Donut: one arc per state, a small gap between arcs
        var total = counts.ok + counts.warn + counts.bad + counts.off;
        var shown = SEGMENTS.filter(function (seg) { return counts[seg[0]] > 0; }).length;
        var gap = shown > 1 ? 3 : 0;
        var offset = 0;
        SEGMENTS.forEach(function (seg) {
            var len = total ? CIRCUMFERENCE * counts[seg[0]] / total : 0;
            var visible = Math.max(0, len - gap);
            dash.arcs[seg[0]].setAttribute('stroke-dasharray', visible + ' ' + (CIRCUMFERENCE - visible));
            dash.arcs[seg[0]].setAttribute('stroke-dashoffset', String(-offset));
            offset += len;
            dash.legend[seg[0]].count.textContent = counts[seg[0]];
            dash.legend[seg[0]].row.classList.toggle('zero', counts[seg[0]] === 0);
        });
        dash.big.textContent = running.length;
        dash.small.textContent = 'of ' + (totalPlugins || running.length) + ' on';
        var attention = counts.warn + counts.bad;
        dash.pluginsAside.textContent = attention ? attention + ' to check ›' : 'Details ›';

        // Activity bars, busiest first
        var busiest = healths.slice().sort(function (a, b) { return b.h.cpuPerSec - a.h.cpuPerSec; }).slice(0, 5);
        var max = Math.max(4, busiest.length ? busiest[0].h.cpuPerSec : 0);
        var totalCpu = healths.reduce(function (sum, x) { return sum + x.h.cpuPerSec; }, 0);
        dash.activityAside.textContent = formatMs(totalCpu) + '/s total';
        if (!busiest.length) {
            dash.bars.replaceChildren(el('div', 'ss-empty', 'No plugins are running'));
        } else {
            // Reuse rows so the bars animate between updates
            while (dash.bars.children.length > busiest.length || (dash.bars.firstChild && !dash.bars.firstChild.classList.contains('ss-bar-row'))) dash.bars.lastChild.remove();
            busiest.forEach(function (x, i) {
                var r = dash.bars.children[i];
                if (!r) {
                    r = el('div', 'ss-bar-row');
                    var track = el('div', 'ss-bar');
                    track.appendChild(el('span'));
                    r.append(el('span', 'ss-bar-name'), track, el('span', 'ss-bar-value'));
                    dash.bars.appendChild(r);
                }
                r.children[0].textContent = x.rec.name;
                r.children[0].title = x.rec.name;
                var fill = r.children[1].firstChild;
                fill.style.width = Math.max(2, x.h.cpuPerSec / max * 100) + '%';
                fill.style.background = COLORS[x.h.level] || COLORS.ok;
                r.children[2].textContent = formatMs(x.h.cpuPerSec) + '/s';
            });
        }

        var conflicts = runtime.conflicts().length;
        dash.conflicts.replaceChildren(dot(conflicts ? COLORS.warn : COLORS.ok), document.createTextNode(conflicts ? conflicts + ' found' : 'None found'));
        var errors = healths.reduce(function (sum, x) { return sum + x.h.errors; }, 0);
        dash.errors.replaceChildren(dot(errors ? COLORS.bad : COLORS.ok), document.createTextNode(errors ? String(errors) : 'None'));
        dash.startup.textContent = formatMs(running.reduce(function (sum, r) { return sum + (r.coldStartMs || 0); }, 0));
    }

    // ── Playback: this app always uses its built-in mpv ──────────────────────
    function playbackSection() {
        var s = section('Playback');
        s.appendChild(infoRow('Player', 'Built-in mpv · hardware decoding').row);
        var server = infoRow('Streaming server', 'Checking…');
        s.appendChild(server.row);
        var check = function () {
            window.__stElectronIPC__('check_stremio_service').then(function (up) {
                server.value.textContent = up ? 'Running on this Mac' : 'Not running';
            });
        };
        check();
        s.addEventListener('mouseenter', check);
        return s;
    }

    function toolsSection() {
        var s = section('More settings');
        s.append(
            linkRow('Keyboard shortcuts', 'View and change', function () { openTools('shortcuts'); }),
            linkRow('Light & dark themes', 'Switch automatically', function () { openTools('appearance'); }),
            linkRow('Profiles', 'Sets of plugins and a theme', function () { openTools('profiles'); }),
            linkRow('Widgets', 'Tiles above the search', function () { openTools('widgets'); }),
            linkRow('Theme Editor', 'Edit colours, save as a theme', function () { if (window.__spTools) window.__spTools.openThemeEditor(); })
        );
        return s;
    }

    function restructure() {
        var wrap = $('__st_about_wrap__');
        if (!wrap || wrap.dataset.spArranged) return;
        wrap.dataset.spArranged = '1';

        var style = el('style');
        style.id = 'sp-settings-style';
        style.textContent = css;
        document.head.appendChild(style);

        // Status: replace the stats grid ("sandboxed / no net access" isn't true in this app)
        var stats = wrap.querySelector('.sp-set-stats');
        if (stats) { stats.after(statusRow()); hide(stats); }

        // Appearance: drop what the macOS skin overrides anyway
        var appearance = sectionOf($('__st_compact_toggle__'));
        hide(rowOf($('__st_accent_swatches__')));
        hide(rowOf($('__st_glass_seg__')));
        hide(rowOf($('__st_grain_toggle__')));
        relabel($('__st_compact_toggle__'), 'Compact rows', 'Hide descriptions, smaller icons');
        relabel($('__st_optimized_toggle__'), 'Reduce transparency', 'Solid background instead of blur');

        // Layout → Lists
        var layout = sectionOf($('__st_view_seg__'));
        retitle(layout, 'Lists');
        relabel($('__st_view_seg__'), 'Show plugins as');
        hide(rowOf($('__st_card_seg__')));
        relabel($('__st_devmode_toggle__'), 'Developer tab', 'CSS editor and plugin wizard');
        relabel($('__st_show_activity_toggle__'), 'Activity tab', 'Log of recent changes');

        // Actions: conflicts go to Tools; crash simulator and reset leave this list
        var actions = sectionOf($('__st_check_updates__'));
        hide($('__st_simulate_crash__'));
        var conflictBtn = $('__st_conflict_btn__');
        if (conflictBtn) {
            conflictBtn.lastChild.textContent = ' Find conflicts';
            conflictBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); e.preventDefault(); openTools('conflicts'); }, true);
        }
        var updatesBtn = $('__st_check_updates__');
        if (updatesBtn) updatesBtn.lastChild.textContent = ' Check for plugin updates';
        var exportBtn = $('__st_exportconfig_btn__');
        if (exportBtn) exportBtn.lastChild.textContent = ' Export setup';
        var resetBtn = $('__st_clearcache_btn__');

        // Discord isn't available in this app; the backend picker doesn't apply (always mpv)
        hide(sectionOf(Array.prototype.find.call(wrap.querySelectorAll('.sp-set-section-title'), function (t) { return /discord/i.test(t.textContent); })));
        var backend = $('__st_backend_section__');
        hide(backend);

        // Diagnostics → Storage: keep the data folder (with Open), the rest lives in Plugin Health
        var diag = sectionOf($('__st_diag_plugins__'));
        retitle(diag, 'Storage');
        ['__st_diag_plugins__', '__st_diag_themes__', '__st_diag_loadtime__', '__st_livereload_toggle__'].forEach(function (id) { hide(rowOf($(id))); });
        relabel($('__st_diag_updates__'), 'Plugin updates');
        var dataDir = $('__st_datadir__');
        if (dataDir) {
            relabel(dataDir, 'Data folder');
            var open = el('button', 'sp-inline-btn', 'Open');
            open.addEventListener('click', function (e) { e.stopPropagation(); host.native('openFolder', ''); });
            dataDir.after(open);
        }

        // Static shortcut list → the editor
        var shortcuts = sectionOf(Array.prototype.find.call(wrap.querySelectorAll('.sp-set-section-title'), function (t) { return /keyboard shortcuts/i.test(t.textContent); }));
        hide(shortcuts);

        // About: say what this app is
        var about = sectionOf(Array.prototype.find.call(wrap.querySelectorAll('.sp-set-section-title'), function (t) { return /^about$/i.test(t.textContent.trim()); }));
        if (about) {
            var mac = infoRow('Mac app', 'Qt 6 shell with built-in mpv');
            about.querySelector('.sp-set-row').before(mac.row);
        }

        // New order: Appearance, Lists, Actions, Playback, More settings, Storage, About, Reset
        var reset = section('Reset');
        if (resetBtn) {
            resetBtn.lastChild.textContent = ' Reset menu preferences…';
            reset.append(resetBtn, el('p', 'sp-reset-note', 'Clears this menu’s own preferences, notes and measurements, then reloads. Your plugins, themes and their settings stay.'));
        }
        var order = [appearance, layout, actions, playbackSection(), toolsSection(), diag, about, reset];
        var anchor = $('sp-set-status') || wrap.firstChild;
        order.filter(Boolean).forEach(function (s) { anchor.after(s); anchor = s; });

        refreshStatus(true);
    }

    function start() {
        var wrap = $('__st_about_wrap__');
        var tab = document.querySelector('.st-tab[data-tab="about"]');
        if (!wrap || !tab || !host || !runtime) return setTimeout(start, 200);
        restructure();
        tab.addEventListener('click', function () { refreshStatus(true); });
        runtime.events.addEventListener('tick', function () {
            if (wrap.offsetParent !== null) refreshStatus(false);
        });
    }

    start();
})();
