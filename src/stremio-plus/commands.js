// Stremio+ commands: a registry of actions (window.__spCommands), Raycast-style
// results in the menu's search (natural-language suggestion, commands, movies &
// series), and the keyboard shortcut runtime configured by the Shortcuts editor.
(function () {
    if (window.__spCommands) return;

    var host = window.__spHost;
    var runtime = window.__spRuntime;
    var CINEMETA = 'https://v3-cinemeta.strem.io/';
    var SHORTCUTS_KEY = 'sp_shortcuts';
    var RECENT_KEY = 'sp_cmd_recent';
    var IS_MAC = /Mac/.test(navigator.platform);

    // ── Registry ─────────────────────────────────────────────────────────────
    // { id, title, group, keywords?, subtitle?, shortcut? (default combo), when?(), run(), keepOpen?,
    //   stremio?: true (one of Stremio's own shortcuts; rebinding remaps it) }
    var registry = new Map();
    var providers = [];   // functions returning dynamic commands (plugins, profiles, resume …)

    function register(cmd) { registry.set(cmd.id, cmd); }
    function addProvider(fn) { providers.push(fn); }

    function allCommands() {
        var list = Array.from(registry.values());
        providers.forEach(function (fn) {
            try { list = list.concat(fn() || []); } catch (e) { console.error(e); }
        });
        return list.filter(function (c) { return !c.when || c.when(); });
    }

    function isMenuOpen() {
        if (window.__st_isOpen) return window.__st_isOpen();
        var overlay = document.getElementById('__st_overlay__');
        return !!overlay && overlay.classList.contains('open');
    }

    function closeMenu() { if (isMenuOpen() && window.__st_toggle) window.__st_toggle(); }

    function remember(id) {
        try {
            var recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(function (r) { return r !== id; });
            recent.unshift(id);
            localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 20)));
        } catch (e) {}
    }

    function recentRank(id) {
        try { var i = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').indexOf(id); return i === -1 ? 0 : 20 - i; }
        catch (e) { return 0; }
    }

    function execute(cmd) {
        remember(cmd.id);
        if (!cmd.keepOpen) closeMenu();
        // Player shortcuts are ignored while a text field has focus, so act after the menu has closed
        setTimeout(function () {
            try { Promise.resolve(cmd.run()).catch(function (e) { runtime.toast({ title: cmd.title + ' failed', message: String(e.message || e) }); }); }
            catch (e) { runtime.toast({ title: cmd.title + ' failed', message: String(e.message || e) }); }
        }, cmd.keepOpen ? 0 : 60);
    }

    // ── Helpers for actions ──────────────────────────────────────────────────
    var synthetic = new WeakSet();

    // Fires one of Stremio's own keyboard shortcuts
    function pressKey(key, code, keyCode, shiftKey) {
        var event = new KeyboardEvent('keydown', { key: key, code: code, keyCode: keyCode, which: keyCode, shiftKey: !!shiftKey, bubbles: true, cancelable: true });
        synthetic.add(event);
        // Stremio ignores shortcuts while a text field (like the menu's search) has focus
        if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
        document.dispatchEvent(event);
    }

    // Talks to the built-in mpv player directly (same messages the player uses)
    function mpv(method, args) {
        if (!window.chrome || !window.chrome.webview) throw new Error('The player is not available');
        window.chrome.webview.postMessage(JSON.stringify({ id: 0, type: 6, args: [method, args] }));
    }

    function inPlayer() { return location.hash.indexOf('#/player') === 0; }
    function go(hash) { location.hash = hash.replace(/^#/, ''); }

    // ── Built-in commands ────────────────────────────────────────────────────
    var NAV = [['Board', '#/', 'home'], ['Discover', '#/discover', 'browse'], ['Library', '#/library', 'saved'],
        ['Calendar', '#/calendar', 'schedule episodes'], ['Add-ons', '#/addons', 'addons'], ['Settings', '#/settings', 'preferences']];
    NAV.forEach(function (n) {
        register({ id: 'nav.' + n[0].toLowerCase(), title: 'Go to ' + n[0], group: 'Navigation', keywords: n[2], run: function () { go(n[1]); } });
    });

    register({ id: 'app.menu', title: 'Show or hide Stremio+', group: 'App', keywords: 'menu panel', shortcut: 'Shift+Space', keepOpen: true, run: function () { if (window.__st_toggle) window.__st_toggle(); } });
    register({ id: 'app.reload', title: 'Reload Stremio', group: 'App', keywords: 'refresh restart', shortcut: 'Mod+R', run: function () { location.reload(); } });
    register({ id: 'app.plugins-folder', title: 'Open plugins folder', group: 'App', keywords: 'finder files', run: function () { return host.native('openFolder', 'plugins'); } });
    register({ id: 'app.themes-folder', title: 'Open themes folder', group: 'App', keywords: 'finder files', run: function () { return host.native('openFolder', 'themes'); } });
    register({ id: 'app.data-folder', title: 'Open Stremio+ data folder', group: 'App', keywords: 'finder files settings', run: function () { return host.native('openFolder', ''); } });
    register({ id: 'app.fullscreen', title: 'Toggle full screen', group: 'App', keywords: 'fullscreen window', shortcut: 'F', stremio: true, run: function () { pressKey('f', 'KeyF', 70); } });

    var PLAYER = [
        ['play-pause', 'Play or pause', 'Space', [' ', 'Space', 32], 'resume stop'],
        ['seek-forward', 'Skip forward', 'ArrowRight', ['ArrowRight', 'ArrowRight', 39], 'seek ahead'],
        ['seek-back', 'Skip back', 'ArrowLeft', ['ArrowLeft', 'ArrowLeft', 37], 'seek rewind'],
        ['volume-up', 'Volume up', 'ArrowUp', ['ArrowUp', 'ArrowUp', 38], 'louder'],
        ['volume-down', 'Volume down', 'ArrowDown', ['ArrowDown', 'ArrowDown', 40], 'quieter'],
        ['mute', 'Mute or unmute', 'M', ['m', 'KeyM', 77], 'silence sound'],
        ['subs-bigger', 'Subtitles bigger', '=', ['=', 'Equal', 187], 'larger captions size'],
        ['subs-smaller', 'Subtitles smaller', '-', ['-', 'Minus', 189], 'captions size'],
        ['subs-toggle', 'Turn subtitles on or off', 'C', ['c', 'KeyC', 67], 'captions hide show'],
        ['subs-delay-up', 'Subtitles later', 'H', ['h', 'KeyH', 72], 'delay sync'],
        ['subs-delay-down', 'Subtitles earlier', 'G', ['g', 'KeyG', 71], 'delay sync'],
        ['speed-up', 'Faster playback', ']', [']', 'BracketRight', 221], 'speed'],
        ['speed-down', 'Slower playback', '[', ['[', 'BracketLeft', 219], 'speed'],
        ['audio-menu', 'Show audio tracks', 'A', ['a', 'KeyA', 65], 'language dub'],
        ['subs-menu', 'Show subtitle tracks', 'S', ['s', 'KeyS', 83], 'captions language'],
        ['next-episode', 'Play next episode', 'Shift+N', ['N', 'KeyN', 78, true], 'skip'],
        ['exit', 'Exit player', 'Escape', ['Escape', 'Escape', 27], 'close back'],
    ];
    PLAYER.forEach(function (p) {
        register({
            id: 'player.' + p[0], title: p[1], group: 'Player', keywords: p[4], shortcut: p[2], stremio: true, when: inPlayer,
            run: function () { pressKey(p[3][0], p[3][1], p[3][2], p[3][3]); },
        });
    });
    register({ id: 'player.audio-next', title: 'Switch audio track', group: 'Player', keywords: 'language dub cycle', shortcut: 'Shift+A', when: inPlayer, run: function () { mpv('mpv-command', ['cycle', 'aid']); } });
    register({ id: 'player.subs-next', title: 'Switch subtitle track', group: 'Player', keywords: 'captions language cycle', shortcut: 'Shift+S', when: inPlayer, run: function () { mpv('mpv-command', ['cycle', 'sid']); } });
    register({
        id: 'player.screenshot', title: 'Save a screenshot', group: 'Player', keywords: 'capture frame picture', shortcut: 'Mod+Shift+S', when: inPlayer,
        run: function () {
            mpv('mpv-set-prop', ['screenshot-directory', '~~desktop/']);
            mpv('mpv-command', ['screenshot', 'video']);
            runtime.toast({ title: 'Screenshot saved to Desktop', duration: 2000 });
        },
    });

    // Plugins and themes: Enable/Disable/Apply/Remove, from the last scan
    var modCache = { plugins: [], themes: [], enabled: null };
    function refreshMods() {
        return host.scanMods().then(function (mods) { modCache = mods; }).catch(function () {});
    }
    addProvider(function () {
        var enabled = function (name) { return modCache.enabled === null || modCache.enabled.indexOf(name) !== -1; };
        var current = localStorage.getItem('currentTheme');
        return modCache.plugins.map(function (m) {
            var on = enabled(m.meta.name);
            return {
                id: 'plugin.' + m.file, title: (on ? 'Disable ' : 'Enable ') + m.meta.name, group: 'Plugins', keywords: 'plugin toggle turn ' + (on ? 'off' : 'on'),
                subtitle: m.meta.description, mod: m,
                run: function () { return host.setEnabled(m.meta.name, !on, { live: true, applyTheme: true }); },
            };
        }).concat(modCache.themes.map(function (m) {
            var applied = current === m.file;
            return {
                id: 'theme.' + m.file, title: (applied ? 'Remove theme ' : 'Apply theme ') + m.meta.name, group: 'Themes', keywords: 'theme look toggle',
                subtitle: m.meta.description, mod: m,
                run: function () { return host.setEnabled(m.meta.name, !applied, { live: true, applyTheme: true }); },
            };
        }));
    });

    // Continue watching, for "Resume …"
    var watching = [];
    function refreshWatching() {
        if (!window.core || !window.core.getState) return Promise.resolve();
        return Promise.resolve(window.core.getState('continue_watching_preview'))
            .then(function (s) { watching = (s && s.items) || []; }).catch(function () {});
    }
    function webLink(link) { return link && link.indexOf('stremio:///') === 0 ? '#/' + link.slice(11) : link; }
    function resumeLink(item) {
        var links = item.deepLinks || {};
        return webLink(item.progress > 0 && links.player ? links.player : links.metaDetailsVideos || links.metaDetailsStreams) || '#/detail/' + item.type + '/' + item._id;
    }
    addProvider(function () {
        return watching.slice(0, 8).map(function (item) {
            return { id: 'resume.' + item._id, title: 'Resume ' + item.name, group: 'Continue Watching', keywords: 'continue watch play', run: function () { go(resumeLink(item)); } };
        });
    });

    // ── Fuzzy matching ───────────────────────────────────────────────────────
    function normalize(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim(); }

    function score(query, cmd) {
        var q = normalize(query);
        var title = normalize(cmd.title);
        var hay = title + ' ' + normalize(cmd.keywords) + ' ' + normalize(cmd.group);
        if (!q) return 0;
        var s = 0;
        if (title.indexOf(q) === 0) s = 100;
        else if ((' ' + title).indexOf(' ' + q) !== -1) s = 80;
        else if (title.indexOf(q) !== -1) s = 60;
        else {
            // every query word appears in the title, keywords or group
            var words = q.split(' ');
            if (words.every(function (w) { return hay.indexOf(w) !== -1; })) s = 40;
        }
        return s ? s + recentRank(cmd.id) : 0;
    }

    function search(query) {
        var scored = allCommands()
            .map(function (c) { return { cmd: c, score: score(query, c) }; })
            .filter(function (r) { return r.score > 0; })
            .sort(function (a, b) { return b.score - a.score; });
        return scored.slice(0, 6).map(function (r) { return r.cmd; });
    }

    function bestMatch(name, items, getName) {
        var q = normalize(name);
        var best = null, bestScore = 0;
        items.forEach(function (item) {
            var n = normalize(getName(item));
            var s = n === q ? 100 : n.indexOf(q) === 0 ? 80 : n.indexOf(q) !== -1 ? 60 : q.split(' ').every(function (w) { return n.indexOf(w) !== -1; }) ? 40 : 0;
            if (s > bestScore) { best = item; bestScore = s; }
        });
        return best;
    }

    // ── Natural language ─────────────────────────────────────────────────────
    // Each rule turns a phrase into one suggested action shown at the top of the results
    function suggestion(id, title) {
        var cmd = registry.get(id);
        if (!cmd) return null;
        var available = !cmd.when || cmd.when();
        return Object.assign({}, cmd, {
            title: title || cmd.title, natural: true, when: null,
            subtitle: available ? cmd.subtitle : 'Works while a video is playing',
            run: available ? cmd.run : function () { runtime.toast({ title: cmd.title + ' works while a video is playing', duration: 2500 }); },
        });
    }

    var RULES = [
        [/^(make )?(the )?(subs?|subtitles?|captions?)( text)? (bigger|larger|up|increase)/, function () { return suggestion('player.subs-bigger'); }],
        [/^(make )?(the )?(subs?|subtitles?|captions?)( text)? (smaller|down|decrease)/, function () { return suggestion('player.subs-smaller'); }],
        [/^(subs?|subtitles?|captions?) (off|on|toggle|hide|show)|^(hide|show|turn (off|on)) (the )?(subs?|subtitles?|captions?)/, function () { return suggestion('player.subs-toggle'); }],
        [/^(next|switch|change|other) (subs?|subtitles?|captions?)/, function () { return suggestion('player.subs-next'); }],
        [/^(next|switch|change|other) (audio|language|dub)|^(audio|language) (track )?(switch|change|next)/, function () { return suggestion('player.audio-next'); }],
        [/^(louder|volume up|turn (it )?up)/, function () { return suggestion('player.volume-up'); }],
        [/^(quieter|volume down|turn (it )?down)/, function () { return suggestion('player.volume-down'); }],
        [/^(mute|unmute|silence)/, function () { return suggestion('player.mute'); }],
        [/^(pause|play|resume)$/, function () { return suggestion('player.play-pause'); }],
        [/^(faster|speed up)/, function () { return suggestion('player.speed-up'); }],
        [/^(slower|slow down)/, function () { return suggestion('player.speed-down'); }],
        [/^(next episode|skip episode)/, function () { return suggestion('player.next-episode'); }],
        [/^(full ?screen|maximi[sz]e)/, function () { return suggestion('app.fullscreen'); }],
        [/^(reload|refresh|restart)( stremio| the app)?$/, function () { return suggestion('app.reload'); }],
        [/^open (the )?plugins?( folder)?/, function () { return suggestion('app.plugins-folder'); }],
        [/^open (the )?themes?( folder)?/, function () { return suggestion('app.themes-folder'); }],
        [/^(go to |open |show )(the )?(board|home|discover|library|calendar|add ?ons|settings)$/, function (m) {
            var key = m[3].replace(/\s/g, '').replace('home', 'board').replace('addons', 'add-ons');
            return suggestion('nav.' + key);
        }],
        [/^(dark|night) (theme|mode)|^(use|switch to|go) dark/, function () { return suggestion('appearance.dark'); }],
        [/^(light|day) (theme|mode)|^(use|switch to|go) light/, function () { return suggestion('appearance.light'); }],
        [/^(follow|match|use) (the )?(system|mac ?os|mac) (appearance|theme)?/, function () { return suggestion('appearance.system'); }],
        [/^(resume|continue|keep watching) (.+)/, function (m) {
            var item = bestMatch(m[2], watching, function (i) { return i.name; });
            if (item) return { id: 'resume.' + item._id, title: 'Resume ' + item.name, group: 'Suggestion', natural: true, run: function () { go(resumeLink(item)); } };
            return findTitle(m[2]);
        }],
        [/^(play|watch|open|find|search( for)?) (.+)/, function (m) { return findTitle(m[3] || m[2]); }],
        [/^(enable|turn on|activate|start) (.+)/, function (m) { return toggleByName(m[2], true); }],
        [/^(disable|turn off|deactivate|stop) (.+)/, function (m) { return toggleByName(m[2], false); }],
        [/^(apply|use) (the )?(.+?)( theme)?$/, function (m) { return themeByName(m[3]); }],
        [/^(switch to |use |load )?(the )?(.+?) profile$|^profile (.+)/, function (m) { return profileByName(m[3] || m[4]); }],
    ];

    function findTitle(name) {
        return {
            id: 'find.' + name, title: 'Open “' + name + '”', subtitle: 'Best match from movies & series', group: 'Suggestion', natural: true,
            run: function () {
                return titleSearch(name).then(function (results) {
                    if (results.length) go('#/detail/' + results[0].type + '/' + results[0].id);
                    else go('#/search?search=' + encodeURIComponent(name));
                });
            },
        };
    }

    function toggleByName(name, on) {
        var mod = bestMatch(name, modCache.plugins.concat(modCache.themes), function (m) { return m.meta.name; });
        if (!mod) return null;
        return { id: 'nl.toggle.' + mod.file, title: (on ? 'Enable ' : 'Disable ') + mod.meta.name, group: 'Suggestion', natural: true,
            run: function () { return host.setEnabled(mod.meta.name, on, { live: true, applyTheme: true }); } };
    }

    function themeByName(name) {
        var mod = bestMatch(name, modCache.themes, function (m) { return m.meta.name; });
        if (!mod) return null;
        return { id: 'nl.theme.' + mod.file, title: 'Apply theme ' + mod.meta.name, group: 'Suggestion', natural: true,
            run: function () { return host.setEnabled(mod.meta.name, true, { live: true, applyTheme: true }); } };
    }

    function profileByName(name) {
        var tools = window.__spTools;
        if (!tools) return null;
        var profile = bestMatch(name, tools.profiles.list(), function (p) { return p.name; });
        if (!profile) return null;
        return { id: 'nl.profile.' + profile.name, title: 'Switch to the ' + profile.name + ' profile', group: 'Suggestion', natural: true,
            run: function () { return tools.profiles.apply(profile.name); } };
    }

    function understand(query) {
        var q = normalize(query);
        for (var i = 0; i < RULES.length; i++) {
            var m = q.match(RULES[i][0]);
            if (!m) continue;
            try {
                var result = RULES[i][1](m);
                if (result) return result;
            } catch (e) {
                console.error('[StremioPlus] command rule failed', e);
            }
        }
        return null;
    }

    // ── Movies & series (Cinemeta) ───────────────────────────────────────────
    var titleCache = {};
    var titleController = null;
    function titleSearch(query) {
        if (titleCache[query]) return Promise.resolve(titleCache[query]);
        if (titleController) titleController.abort();
        titleController = new AbortController();
        var signal = titleController.signal;
        var get = function (type) {
            return fetch(CINEMETA + 'catalog/' + type + '/top/search=' + encodeURIComponent(query) + '.json', { signal: signal })
                .then(function (r) { return r.json(); })
                .then(function (d) { return (d.metas || []).map(function (m) { m.type = m.type || type; return m; }); })
                .catch(function (e) { if (e.name === 'AbortError') throw e; return []; });
        };
        return Promise.all([get('movie'), get('series')]).then(function (lists) {
            var merged = [];
            for (var i = 0; merged.length < 4 && (i < lists[0].length || i < lists[1].length); i++) {
                if (lists[0][i]) merged.push(lists[0][i]);
                if (lists[1][i] && merged.length < 4) merged.push(lists[1][i]);
            }
            titleCache[query] = merged;
            return merged;
        });
    }

    // ── Results UI ───────────────────────────────────────────────────────────
    var css = '' +
        '#sp-results { flex-shrink:0; max-height:min(46vh,420px); overflow-y:auto; padding:6px 8px; border-bottom:0.5px solid rgba(255,255,255,0.09); }' +
        '#sp-results[hidden] { display:none; }' +
        '#__st_panel__.sp-searching #sp-widgets { display:none; }' +
        // Our results cover the query; the menu's own palette and empty list would repeat it
        '#__st_panel__.sp-searching #__st_inline_pal__ { display:none !important; }' +
        '#__st_panel__.sp-searching #__st_list__ > .st-empty { display:none !important; }' +
        '#sp-results .spr-group { display:flex; align-items:center; justify-content:space-between; padding:8px 12px 4px; font-size:11.5px; font-weight:500; color:rgba(255,255,255,0.45); }' +
        '#sp-results .spr-row { display:flex; align-items:center; gap:12px; padding:7px 12px; border-radius:9px; cursor:pointer; color:rgba(255,255,255,0.92); min-height:22px; }' +
        '#sp-results .spr-row.active { background:rgba(255,255,255,0.1); }' +
        '#sp-results .spr-row:active { transform:scale(0.99); }' +
        '#sp-results .spr-icon { width:22px; height:22px; border-radius:6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.09); color:rgba(255,255,255,0.75); }' +
        '#sp-results .spr-thumb { width:22px; height:32px; border-radius:4px; object-fit:cover; background:rgba(255,255,255,0.08); flex-shrink:0; }' +
        '#sp-results .spr-title { font-size:13.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
        '#sp-results .spr-sub { font-size:12.5px; color:rgba(255,255,255,0.45); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex-shrink:1; }' +
        '#sp-results .spr-right { margin-left:auto; display:flex; align-items:center; gap:6px; flex-shrink:0; font-size:12px; color:rgba(255,255,255,0.4); }' +
        '#sp-results .spr-kbd { font-size:10.5px; padding:1px 6px; border-radius:5px; background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.14); color:rgba(255,255,255,0.6); }' +
        '#sp-results .spr-natural .spr-icon { background:rgba(255,255,255,0.92); color:#111; }' +
        '#sp-results .spr-empty { padding:6px 12px 8px; font-size:12.5px; color:rgba(255,255,255,0.4); }' +
        '#sp-results .spr-peek { all:unset; cursor:pointer; width:24px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:6px; color:rgba(255,255,255,0.6); opacity:0; }' +
        '#sp-results .spr-row:hover .spr-peek, #sp-results .spr-row.active .spr-peek { opacity:1; }' +
        '#sp-results .spr-peek:hover { background:rgba(255,255,255,0.12); color:#fff; }' +
        // Clipboard suggestion
        '#sp-clip { flex-shrink:0; display:flex; align-items:center; gap:12px; margin:8px 8px 0; padding:9px 12px; border-radius:10px; cursor:pointer; color:rgba(255,255,255,0.92);' +
        '  background:rgba(255,255,255,0.07); border:0.5px solid rgba(255,255,255,0.1); }' +
        '#sp-clip[hidden], #__st_panel__.sp-searching #sp-clip { display:none; }' +
        '#sp-clip:hover { background:rgba(255,255,255,0.11); } #sp-clip:active { transform:scale(0.99); }' +
        '#sp-clip .spr-icon { background:rgba(255,255,255,0.92); color:#111; }' +
        '#sp-clip .clip-text { flex:1; min-width:0; } #sp-clip .clip-title { font-size:13.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
        '#sp-clip .clip-sub { font-size:12px; color:rgba(255,255,255,0.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
        '#sp-clip .clip-x { all:unset; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:6px; color:rgba(255,255,255,0.5); }' +
        '#sp-clip .clip-x:hover { background:rgba(255,255,255,0.12); color:#fff; }' +
        // Quick Look
        '#sp-ql { position:fixed; z-index:2147483647; left:50%; top:50%; width:min(540px,calc(100vw - 40px)); max-height:min(86vh,720px); display:flex; flex-direction:column; overflow:hidden;' +
        '  border-radius:16px; background:rgba(30,30,32,0.9); backdrop-filter:blur(36px) saturate(170%); -webkit-backdrop-filter:blur(36px) saturate(170%);' +
        '  border:0.5px solid rgba(255,255,255,0.16); box-shadow:0 30px 90px rgba(0,0,0,0.6); color:rgba(255,255,255,0.92); font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;' +
        '  opacity:0; transform:translate(-50%,-50%) scale(0.96); transition:opacity .18s ease, transform .3s cubic-bezier(0.32,0.72,0,1); }' +
        '#sp-ql.in { opacity:1; transform:translate(-50%,-50%); }' +
        '#sp-ql .ql-hero { position:relative; height:250px; flex-shrink:0; background:#111 center/cover no-repeat; }' +
        '#sp-ql .ql-hero::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg,rgba(30,30,32,0) 35%,rgba(30,30,32,0.95) 100%); }' +
        '#sp-ql .ql-logo { position:absolute; left:20px; bottom:14px; z-index:1; max-width:60%; max-height:70px; object-fit:contain; object-position:left bottom; }' +
        '#sp-ql .ql-name { position:absolute; left:20px; right:20px; bottom:14px; z-index:1; font-size:24px; font-weight:700; letter-spacing:-0.02em; line-height:1.1; }' +
        '#sp-ql .ql-body { padding:12px 20px 4px; overflow-y:auto; }' +
        '#sp-ql .ql-meta { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:12.5px; color:rgba(255,255,255,0.6); }' +
        '#sp-ql .ql-desc { margin:10px 0 0; font-size:13px; line-height:1.5; color:rgba(255,255,255,0.82); }' +
        '#sp-ql .ql-people { margin-top:10px; font-size:12px; line-height:1.5; color:rgba(255,255,255,0.55); }' +
        '#sp-ql .ql-people b { color:rgba(255,255,255,0.8); font-weight:500; }' +
        '#sp-ql .ql-actions { display:flex; gap:8px; padding:14px 20px 16px; }' +
        '#sp-ql .ql-actions button { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:500; background:rgba(255,255,255,0.1); }' +
        '#sp-ql .ql-actions button:hover { background:rgba(255,255,255,0.16); }' +
        '#sp-ql .ql-actions button.primary { background:rgba(255,255,255,0.92); color:#111; font-weight:600; }' +
        '#sp-ql .ql-actions button:active { transform:scale(0.97); }' +
        '#sp-ql .ql-actions .ql-hint { margin-left:auto; align-self:center; font-size:11.5px; color:rgba(255,255,255,0.4); }' +
        '@media (prefers-reduced-motion: reduce) { #sp-ql { transition:opacity .15s ease; transform:translate(-50%,-50%) !important; } }';

    var ICONS = {
        Suggestion: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
        Player: '<polygon points="7 4 19 12 7 20 7 4"/>',
        Navigation: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        App: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
        Plugins: '<path d="M20.2 12.2a6 6 0 0 0-8.5-8.5L5 10.5V19h8.5z"/><path d="M16 8 2 22"/>',
        Themes: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
        Tools: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8z"/>',
        Profiles: '<path d="M4 6h16M4 12h16M4 18h10"/>',
        Appearance: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/>',
        'Continue Watching': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        Clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
    };

    function icon(group) {
        var span = document.createElement('span');
        span.className = 'spr-icon';
        span.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[group] || ICONS.App) + '</svg>';
        return span;
    }

    function text(tag, className, value) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = value;
        return el;
    }

    var box = null;
    var rows = [];          // [{ el, run }]
    var active = 0;
    var lastQuery = '';
    var titleTimer = null;
    var navigated = false;   // arrowed into the results since typing; Space then means Quick Look

    function setActive(i) {
        if (!rows.length) return;
        active = (i + rows.length) % rows.length;
        rows.forEach(function (r, j) { r.el.classList.toggle('active', j === active); });
        rows[active].el.scrollIntoView({ block: 'nearest' });
        // Quick Look follows the selection, like Finder
        if (quickLook.isOpen() && rows[active].meta) quickLook.open(rows[active].meta);
    }

    function addRow(container, opts) {
        var row = document.createElement('div');
        row.className = 'spr-row' + (opts.natural ? ' spr-natural' : '');
        row.append(opts.leading, text('span', 'spr-title', opts.title));
        if (opts.subtitle) row.appendChild(text('span', 'spr-sub', opts.subtitle));
        var right = document.createElement('span');
        right.className = 'spr-right';
        if (opts.label) right.appendChild(document.createTextNode(opts.label));
        if (opts.kbd) right.appendChild(text('span', 'spr-kbd', opts.kbd));
        row.appendChild(right);
        var index = rows.length;
        if (opts.meta) {
            var peek = text('button', 'spr-peek', '');
            peek.title = 'Quick Look (\u2318Y)';
            peek.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
            peek.addEventListener('click', function (e) { e.stopPropagation(); setActive(index); quickLook.open(opts.meta); });
            right.appendChild(peek);
        }
        row.addEventListener('mousemove', function () { if (active !== index) setActive(index); });
        row.addEventListener('click', opts.run);
        container.appendChild(row);
        rows.push({ el: row, run: opts.run, meta: opts.meta || null });
    }

    function render(query, titles) {
        var frag = document.createDocumentFragment();
        rows = [];
        var natural = understand(query);
        if (natural) {
            frag.appendChild(text('div', 'spr-group', 'Suggestion'));
            addRow(frag, { leading: icon('Suggestion'), title: natural.title, subtitle: natural.subtitle, natural: true, kbd: '↵', run: function () { execute(natural); } });
        }
        // The suggestion already covers the same action; don't list it twice
        var commands = search(query).filter(function (c) { return !natural || (c.id !== natural.id && c.title !== natural.title); });
        if (commands.length) {
            frag.appendChild(text('div', 'spr-group', 'Commands'));
            commands.forEach(function (c) {
                addRow(frag, {
                    leading: icon(c.group), title: c.title, subtitle: c.group,
                    kbd: shortcuts.display(shortcuts.bindingFor(c)) || null,
                    run: function () { execute(c); },
                });
            });
        }
        var titleGroup = text('div', 'spr-group', '');
        titleGroup.append(text('span', null, 'Movies & Series'), text('span', 'spr-kbd', '⌘↵ Search Stremio'));
        frag.appendChild(titleGroup);
        if (titles === null) frag.appendChild(text('div', 'spr-empty', 'Searching…'));
        else if (!titles.length) frag.appendChild(text('div', 'spr-empty', 'No titles match “' + query + '”.'));
        else titles.forEach(function (m) {
            var thumb = document.createElement('img');
            thumb.className = 'spr-thumb';
            thumb.alt = '';
            if (m.poster) thumb.src = m.poster;
            addRow(frag, {
                leading: thumb, title: m.name, subtitle: m.releaseInfo || '', label: m.type === 'series' ? 'Series' : 'Movie', meta: m,
                run: function () { closeMenu(); go('#/detail/' + m.type + '/' + m.id); },
            });
        });
        box.replaceChildren(frag);
        box.hidden = false;
        setActive(0);
    }

    function setSearching(on) {
        var panel = document.getElementById('__st_panel__');
        if (panel) panel.classList.toggle('sp-searching', on);
    }

    function update(value) {
        var query = value.trim();
        clearTimeout(titleTimer);
        if (!query || query.charAt(0) === '>') {
            lastQuery = '';
            box.hidden = true;
            rows = [];
            setSearching(false);
            return;
        }
        lastQuery = query;
        setSearching(true);
        // Commands render instantly; titles follow after a short typing pause
        var cached = titleCache[query];
        render(query, query.length < 2 ? [] : cached || null);
        if (query.length < 2 || cached) return;
        titleTimer = setTimeout(function () {
            titleSearch(query).then(function (results) {
                if (query === lastQuery) {
                    var keep = active;
                    render(query, results);
                    setActive(Math.min(keep, rows.length - 1));
                }
            }).catch(function () {});
        }, 140);
    }

    function mount() {
        var input = document.getElementById('__st_search__');
        var row = document.getElementById('__st_search_row__');
        var overlay = document.getElementById('__st_overlay__');
        if (!input || !row || !overlay) return setTimeout(mount, 200);

        var style = document.createElement('style');
        style.id = 'sp-commands-style';
        style.textContent = css;
        document.head.appendChild(style);

        box = document.createElement('div');
        box.id = 'sp-results';
        box.hidden = true;
        row.after(box);
        clip.mount(row);

        input.placeholder = 'Search commands, movies, plugins… or type what you want';
        input.addEventListener('input', function () { navigated = false; update(input.value); });
        // Our results take the arrow keys and Return while they are showing
        input.addEventListener('keydown', function (e) {
            if (!input.value.trim() && e.key === 'Enter' && clip.current) {
                e.preventDefault(); e.stopImmediatePropagation();
                clip.run();
                return;
            }
            if (box.hidden || !rows.length) return;
            var row = rows[active];
            if (quickLook.isOpen()) {
                if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); quickLook.close(); return; }
                if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); quickLook.close(); row.run(); return; }
            }
            var cmdY = e.key.toLowerCase() === 'y' && (e.metaKey || e.ctrlKey);
            if ((row && row.meta && e.key === ' ' && navigated) || cmdY) {
                // ⌘Y previews the selected title, or the first one when a command is selected
                var target = row && row.meta ? active : rows.findIndex(function (r) { return r.meta; });
                if (target === -1) return;
                e.preventDefault(); e.stopImmediatePropagation();
                if (quickLook.isOpen()) { quickLook.close(); return; }
                if (target !== active) setActive(target);
                quickLook.open(rows[target].meta);
                return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault(); e.stopImmediatePropagation();
                closeMenu();
                go('#/search?search=' + encodeURIComponent(lastQuery));
            } else if (e.key === 'Enter') {
                e.preventDefault(); e.stopImmediatePropagation();
                rows[active].run();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); e.stopImmediatePropagation();
                navigated = true;
                setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
            }
        }, true);

        var wasOpen = false;
        new MutationObserver(function () {
            var open = isMenuOpen();
            if (open && !wasOpen) { refreshMods(); refreshWatching(); clip.check(); }
            if (!open) { box.hidden = true; rows = []; lastQuery = ''; setSearching(false); quickLook.close(); clip.hide(); }
            wasOpen = open;
        }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
        refreshMods();
        refreshWatching();
    }

    // ── Library actions (same messages Stremio's own buttons send) ───────────
    function metaPreview(m) {
        var p = { id: m.id, type: m.type, name: m.name, posterShape: 'poster', links: [], trailerStreams: [], behaviorHints: {} };
        ['poster', 'background', 'logo', 'description', 'releaseInfo', 'runtime', 'released'].forEach(function (k) { if (m[k]) p[k] = m[k]; });
        return p;
    }
    function coreAction(action, args) {
        if (!window.core || !window.core.dispatch) throw new Error('Stremio is still loading');
        window.core.dispatch({ action: 'Ctx', args: { action: action, args: args } });
    }
    function inLibrary(id) {
        return Promise.resolve(window.core && window.core.getState ? window.core.getState('library') : null)
            .then(function (lib) { return !!(lib && lib.catalog && lib.catalog.some(function (i) { return i._id === id; })); })
            .catch(function () { return false; });
    }

    // ── Quick Look ───────────────────────────────────────────────────────────
    var metaCache = {};
    function fullMeta(m) {
        var key = m.type + '/' + m.id;
        if (metaCache[key]) return Promise.resolve(metaCache[key]);
        return fetch(CINEMETA + 'meta/' + key + '.json').then(function (r) { return r.json(); })
            .then(function (d) { metaCache[key] = Object.assign({}, m, d.meta || {}); return metaCache[key]; })
            .catch(function () { return m; });
    }

    var quickLook = (function () {
        var card = null, shownId = null;

        function close() {
            if (!card) return;
            var el = card;
            card = null; shownId = null;
            el.classList.remove('in');
            setTimeout(function () { el.remove(); }, 220);
        }

        function button(label, cls, onClick) {
            var b = text('button', cls || '', label);
            b.addEventListener('click', function (e) { e.stopPropagation(); onClick(b); });
            return b;
        }

        function render(meta) {
            var hero = document.createElement('div');
            hero.className = 'ql-hero';
            if (meta.background || meta.poster) hero.style.backgroundImage = 'url("' + String(meta.background || meta.poster).replace(/"/g, '%22') + '")';
            if (meta.logo) {
                var logo = document.createElement('img');
                logo.className = 'ql-logo';
                logo.alt = meta.name;
                logo.src = meta.logo;
                logo.addEventListener('error', function () { logo.replaceWith(text('div', 'ql-name', meta.name)); });
                hero.appendChild(logo);
            } else hero.appendChild(text('div', 'ql-name', meta.name));

            var info = document.createElement('div');
            info.className = 'ql-meta';
            [meta.releaseInfo, meta.runtime, (meta.genres || []).slice(0, 3).join(', '), meta.imdbRating ? '\u2605 ' + meta.imdbRating : null, meta.type === 'series' ? 'Series' : 'Movie']
                .filter(Boolean).forEach(function (t) { info.appendChild(text('span', null, t)); });
            var body = document.createElement('div');
            body.className = 'ql-body';
            body.appendChild(info);
            if (meta.description) body.appendChild(text('p', 'ql-desc', meta.description));
            var people = document.createElement('div');
            people.className = 'ql-people';
            var line = function (label, list) {
                if (!list || !list.length) return;
                var d = document.createElement('div');
                d.append(text('b', null, label + ' '), document.createTextNode(list.slice(0, 6).join(', ')));
                people.appendChild(d);
            };
            line('Starring', meta.cast);
            line(meta.type === 'series' ? 'Created by' : 'Directed by', meta.director || meta.writer);
            body.appendChild(people);

            var actions = document.createElement('div');
            actions.className = 'ql-actions';
            var preview = metaPreview(meta);
            var libraryButton = button('Add to Library', '', function (b) {
                var adding = b.dataset.state !== 'in';
                try {
                    coreAction(adding ? 'AddToLibrary' : 'RemoveFromLibrary', adding ? preview : meta.id);
                    b.dataset.state = adding ? 'in' : '';
                    b.textContent = adding ? '\u2713 In Library' : 'Add to Library';
                    runtime.toast({ title: (adding ? 'Added ' : 'Removed ') + meta.name + (adding ? ' to' : ' from') + ' your Library', duration: 4000,
                        action: { label: 'Undo', run: function () { coreAction(adding ? 'RemoveFromLibrary' : 'AddToLibrary', adding ? meta.id : preview); b.click(); } } });
                } catch (e) { runtime.toast({ title: String(e.message || e) }); }
            });
            inLibrary(meta.id).then(function (yes) { if (yes) { libraryButton.dataset.state = 'in'; libraryButton.textContent = '\u2713 In Library'; } });
            var watchedButton = button('Mark as Watched', '', function (b) {
                var marking = b.dataset.state !== 'watched';
                try {
                    coreAction('MetaItemMarkAsWatched', { meta_item: preview, is_watched: marking });
                    b.dataset.state = marking ? 'watched' : '';
                    b.textContent = marking ? '\u2713 Watched' : 'Mark as Watched';
                    runtime.toast({ title: meta.name + (marking ? ' marked as watched' : ' marked as unwatched'), duration: 4000,
                        action: { label: 'Undo', run: function () { b.click(); } } });
                } catch (e) { runtime.toast({ title: String(e.message || e) }); }
            });
            actions.append(
                button('Open', 'primary', function () { close(); closeMenu(); go('#/detail/' + meta.type + '/' + meta.id); }),
                libraryButton, watchedButton,
                text('span', 'ql-hint', '\u2191\u2193 next \u00B7 esc close'));

            card.replaceChildren(hero, body, actions);
        }

        function open(m) {
            if (!m) return;
            var key = m.type + '/' + m.id;
            if (card && shownId === key) return;
            shownId = key;
            if (!card) {
                card = document.createElement('div');
                card.id = 'sp-ql';
                card.setAttribute('role', 'dialog');
                card.setAttribute('aria-label', 'Quick Look');
                document.body.appendChild(card);
                requestAnimationFrame(function () { if (card) card.classList.add('in'); });
                // Clicking anywhere else closes it
                setTimeout(function () {
                    document.addEventListener('pointerdown', function outside(e) {
                        if (!card) return document.removeEventListener('pointerdown', outside, true);
                        if (!card.contains(e.target) && !(e.target.closest && e.target.closest('.spr-peek'))) { close(); document.removeEventListener('pointerdown', outside, true); }
                    }, true);
                }, 0);
            }
            render(m);   // what the search already knows, instantly
            fullMeta(m).then(function (full) { if (card && shownId === key) render(full); });
        }

        // Esc closes Quick Look first, wherever focus is, and returns to the search
        window.addEventListener('keydown', function (e) {
            if (!card || e.key !== 'Escape') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
            var input = document.getElementById('__st_search__');
            if (input) input.focus();
        }, true);

        return { open: open, close: close, isOpen: function () { return !!card; } };
    })();

    // ── Clipboard suggestion ─────────────────────────────────────────────────
    var BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    function base32ToHex(s) {
        var bits = '', hex = '';
        s.toUpperCase().split('').forEach(function (c) { var v = BASE32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); });
        for (var i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
        return hex;
    }

    function classifyClipboard(raw) {
        var t = String(raw || '').trim();
        if (!t || t.length > 4000 || /\s/.test(t)) return null;
        if (/^magnet:\?/i.test(t)) {
            var params = new URLSearchParams(t.slice(8));
            var xt = params.getAll('xt').find(function (x) { return /^urn:btih:/i.test(x); });
            if (!xt) return null;
            var hash = xt.replace(/^urn:btih:/i, '');
            if (hash.length === 32) hash = base32ToHex(hash);
            if (!/^[0-9a-f]{40}$/i.test(hash)) return null;
            var name = params.get('dn') || 'Magnet link';
            return { title: 'Play \u201C' + name + '\u201D', subtitle: 'Magnet link on your clipboard',
                stream: { infoHash: hash.toLowerCase(), sources: params.getAll('tr').map(function (tr) { return 'tracker:' + tr; }).concat(['dht:' + hash.toLowerCase()]), name: 'Clipboard', title: name } };
        }
        var video = t.match(/^https?:\/\/[^\s]+?\/([^\/?#]+\.(mp4|mkv|webm|avi|mov|m4v|m3u8|mpd|ts))(\?[^\s]*)?$/i);
        if (video) {
            return { title: 'Play ' + decodeURIComponent(video[1]), subtitle: 'Stream link on your clipboard', stream: { url: t, name: 'Clipboard', title: decodeURIComponent(video[1]) } };
        }
        var imdb = t.match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d+)/i);
        if (imdb) return { title: 'Open IMDb title in Stremio', subtitle: imdb[1] + ' from your clipboard', imdb: imdb[1] };
        if (/^stremio:\/\//i.test(t)) return { title: 'Open Stremio link', subtitle: t, link: '#/' + t.replace(/^stremio:\/\/\/?/i, '') };
        var web = t.match(/^https:\/\/web\.stremio\.com\/(#\/.*)$/i);
        if (web) return { title: 'Open Stremio link', subtitle: t, link: web[1] };
        return null;
    }

    var clip = (function () {
        var SEEN = 'sp_clip_seen';
        var el = null;
        var current = null;

        function seen(text) { return sessionStorage.getItem(SEEN) === text; }
        function hide() { if (el) el.hidden = true; api.current = current = null; }

        function run() {
            var item = current;
            if (!item) return;
            sessionStorage.setItem(SEEN, item.raw);
            hide();
            closeMenu();
            if (item.stream) {
                return Promise.resolve(window.core.encodeStream(item.stream)).then(function (encoded) { go('#/player/' + encodeURIComponent(encoded)); })
                    .catch(function (e) { runtime.toast({ title: 'Could not play that link', message: String(e.message || e) }); });
            }
            if (item.imdb) {
                // Movie or series: ask Cinemeta which one exists
                return fetch(CINEMETA + 'meta/movie/' + item.imdb + '.json').then(function (r) { return r.json(); }).then(function (d) {
                    go('#/detail/' + (d && d.meta && d.meta.name ? 'movie' : 'series') + '/' + item.imdb);
                }).catch(function () { go('#/detail/series/' + item.imdb); });
            }
            go(item.link);
        }

        function mount(searchRow) {
            el = document.createElement('div');
            el.id = 'sp-clip';
            el.hidden = true;
            el.setAttribute('role', 'button');
            var dismiss = text('button', 'clip-x', '');
            dismiss.title = 'Not now';
            dismiss.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
            dismiss.addEventListener('click', function (e) { e.stopPropagation(); if (current) sessionStorage.setItem(SEEN, current.raw); hide(); });
            el.addEventListener('click', run);
            el.append(icon('Clipboard'), text('div', 'clip-text', ''), text('span', 'spr-kbd', '\u21B5'), dismiss);
            searchRow.after(el);
        }

        function check() {
            if (!el) return;
            host.native('clipboardText').then(function (raw) {
                var item = classifyClipboard(raw);
                if (!item || seen(String(raw).trim())) return hide();
                item.raw = String(raw).trim();
                api.current = current = item;
                var textBox = el.querySelector('.clip-text');
                textBox.replaceChildren(text('div', 'clip-title', item.title), text('div', 'clip-sub', item.subtitle));
                el.hidden = false;
            }).catch(hide);
        }

        var api = { mount: mount, check: check, hide: hide, run: run, current: null, classify: classifyClipboard };
        return api;
    })();

    // ── Shortcuts ────────────────────────────────────────────────────────────
    var CODE_NAMES = { Space: 'Space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/',
        Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
        ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };

    function comboFromEvent(e) {
        var key;
        if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
        else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
        else if (/^F\d+$/.test(e.code)) key = e.code;
        else key = CODE_NAMES[e.code];
        if (!key) return null;
        var parts = [];
        if (IS_MAC ? e.metaKey : e.ctrlKey) parts.push('Mod');
        if (IS_MAC && e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        parts.push(key);
        return parts.join('+');
    }

    var SYMBOLS = { Mod: IS_MAC ? '⌘' : 'Ctrl+', Ctrl: '⌃', Alt: IS_MAC ? '⌥' : 'Alt+', Shift: '⇧',
        ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: '↵', Backspace: '⌫', Space: 'Space' };

    var shortcuts = {
        load: function () { try { return JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || '{}'); } catch (e) { return {}; } },
        save: function (map) { localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(map)); },
        // Custom binding if set ('' means removed), otherwise the default
        bindingFor: function (cmd) {
            var custom = shortcuts.load();
            return Object.prototype.hasOwnProperty.call(custom, cmd.id) ? custom[cmd.id] : cmd.shortcut || '';
        },
        set: function (id, combo) { var map = shortcuts.load(); map[id] = combo; shortcuts.save(map); },
        reset: function (id) { var map = shortcuts.load(); if (id) delete map[id]; else map = {}; shortcuts.save(map); },
        display: function (combo) {
            if (!combo) return '';
            return combo.split('+').map(function (p) { return SYMBOLS[p] || p; }).join(IS_MAC ? '' : '');
        },
        comboFromEvent: comboFromEvent,
        // Every registered command (dynamic ones excluded) with its current binding
        list: function () {
            return Array.from(registry.values()).map(function (c) { return { cmd: c, combo: shortcuts.bindingFor(c), isDefault: shortcuts.bindingFor(c) === (c.shortcut || '') }; });
        },
        conflicts: function (combo, exceptId) {
            if (!combo) return [];
            return Array.from(registry.values()).filter(function (c) { return c.id !== exceptId && shortcuts.bindingFor(c) === combo; });
        },
        recording: false,
    };

    function typingTarget(target) {
        return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    }

    window.addEventListener('keydown', function (e) {
        if (synthetic.has(e) || e.isComposing || shortcuts.recording) return;
        var combo = comboFromEvent(e);
        if (!combo) return;
        var typing = typingTarget(e.target);
        var plain = combo.indexOf('+') === -1 || /^Shift\+.$/.test(combo) || combo === 'Shift+Space';
        var bound = Array.from(registry.values()).filter(function (c) { return shortcuts.bindingFor(c) === combo; });

        for (var i = 0; i < bound.length; i++) {
            var cmd = bound[i];
            if (cmd.when && !cmd.when()) continue;
            if (typing && plain) return;
            // Stremio's own shortcut still on its original key: let Stremio handle it
            if (cmd.stremio && combo === cmd.shortcut) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            remember(cmd.id);
            cmd.run();
            return;
        }
        // A Stremio shortcut that was moved to another key no longer fires on its old one
        if (!typing) {
            var moved = Array.from(registry.values()).some(function (c) {
                return c.stremio && c.shortcut === combo && shortcuts.bindingFor(c) !== combo && (!c.when || c.when());
            });
            if (moved) { e.preventDefault(); e.stopImmediatePropagation(); }
        }
    }, true);

    window.__spCommands = {
        register: register,
        addProvider: addProvider,
        all: allCommands,
        search: search,
        understand: understand,
        execute: execute,
        shortcuts: shortcuts,
        pressKey: pressKey,
        mpv: mpv,
        refresh: function () { return Promise.all([refreshMods(), refreshWatching()]); },
        titleSearch: titleSearch,
        quickLook: quickLook,
        clipboard: clip,
    };

    mount();
})();
