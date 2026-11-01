// The TV Mode player, in the style of Apple TV: Stremio's player controls give
// way to a title, a row of buttons and a large scrubber at the bottom, and
// panels for Episodes, Subtitles, Audio and Sources that slide up over the
// video. It shows on any remote press and hides while the video plays.
// tv.js hands it the remote with handle(name, value) while TV Mode is on in
// the player. Built on the focus engine from tv-home.js (window.__spTvKit).
(function () {
    if (window.__spTvPlayer || !window.__spTvKit) return;

    var kit = window.__spTvKit;
    var h = kit.h;
    var commands = window.__spCommands;
    var HIDE_AFTER = 4500;

    var ICONS = {
        episodes: '<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M7 20h10"/>',
        subtitles: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 13h4M13 13h4M7 16h7"/>',
        audio: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
        sources: '<path d="M4 7h16M4 12h16M4 17h10"/>',
        next: '<path fill="currentColor" stroke="none" d="M5 5.6v12.8c0 .8.9 1.3 1.6.9L16 13v5h2.5V6H16v5L6.6 4.7C5.9 4.3 5 4.8 5 5.6z"/>',
        play: '<path fill="currentColor" stroke="none" d="M7 4.9v14.2c0 .9 1 1.4 1.7.9l11-7.1c.7-.4.7-1.4 0-1.8l-11-7.1C8 3.5 7 4 7 4.9z"/>',
        pause: '<rect x="6" y="4.5" width="4.5" height="15" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1.4" fill="currentColor" stroke="none"/>',
        back10: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
        fwd10: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"/>',
    };
    function svg(name) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
    }
    function formatTime(s) {
        s = Math.max(0, Math.floor(s || 0));
        var hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
        return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
    }
    function languageName(code) {
        if (!code) return 'Unknown';
        try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code.length === 3 ? code.slice(0, 2) : code) || code; }
        catch (e) { return code; }
    }

    // ── Playback state, from mpv's property updates ──────────────────────────
    var state = { position: 0, duration: 0, paused: false, buffering: false, cached: 0, tracks: [], sid: null, aid: null, subScale: 1, subDelay: 0 };
    var info = { title: '', subtitle: '', meta: null, video: null, nextVideo: null, addonSubs: [] };

    function onShellMessage(e) {
        var msg;
        try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
        var args = msg && msg.args;
        if (!args || args[0] !== 'mpv-prop-change' || !args[1]) return;
        var name = args[1].name, data = args[1].data;
        switch (name) {
            case 'time-pos': if (typeof data === 'number') { state.position = data; renderBar(); } break;
            case 'duration': if (typeof data === 'number') { state.duration = data; renderBar(); } break;
            case 'pause': state.paused = !!data; renderPlayState(); break;
            case 'paused-for-cache': state.buffering = !!data; root && root.classList.toggle('buffering', state.buffering); break;
            case 'demuxer-cache-time': if (typeof data === 'number') { state.cached = data; renderBar(); } break;
            case 'track-list': state.tracks = Array.isArray(data) ? data : []; renderButtons(); break;
            case 'sid': state.sid = data; break;
            case 'aid': state.aid = data; break;
            case 'sub-scale': if (typeof data === 'number') state.subScale = data; break;
            case 'sub-delay': if (typeof data === 'number') state.subDelay = data; break;
        }
    }

    function loadInfo() {
        return kit.getState('player').then(function (s) {
            if (!s) return;
            // metaItem is { type, content } here (the title page nests it once more)
            var item = s.metaItem && s.metaItem.type ? s.metaItem : s.metaItem && s.metaItem.content;
            var meta = item && item.type === 'Ready' ? item.content : null;
            var videoId = s.selected && s.selected.streamRequest && s.selected.streamRequest.path && s.selected.streamRequest.path.id;
            var video = meta && videoId ? (meta.videos || []).find(function (v) { return v.id === videoId; }) : null;
            var stream = s.selected && s.selected.stream;
            var streamName = stream && (stream.title || stream.name || String(stream.description || '').split('\n')[0]);
            info.meta = meta;
            info.video = video;
            info.videoId = videoId;
            info.nextVideo = s.nextVideo || null;
            info.addonSubs = Array.isArray(s.subtitles) ? s.subtitles : [];
            info.title = meta ? meta.name : (s.title || streamName || 'Now Playing');
            info.subtitle = video ? kit.epLabel(video) + (video.title ? ' · ' + video.title : '') : (meta && meta.releaseInfo) || '';
            renderTitle();
            renderButtons();
        });
    }

    // ── Elements ─────────────────────────────────────────────────────────────
    var root, titleEl, subEl, buttonsStrip, bar, barFill, barCache, barKnob, timeNow, timeLeft, centerIcon, panelEl, panelHead, panelTrack;
    var buttons = {};

    function build() {
        root = h('div');
        root.id = 'sp-tvplayer';
        var shade = h('div', 'tvp-shade');
        centerIcon = h('div', 'tvp-center');
        var spinner = h('div', 'tvp-spinner');

        var bottom = h('div', 'tvp-bottom');
        titleEl = h('div', 'tvp-title');
        subEl = h('div', 'tvp-sub');
        buttonsStrip = h('div', 'tvp-buttons');
        bar = h('button', 'tvp-bar');
        bar.setAttribute('aria-label', 'Playback position');
        var track = h('div', 'tvp-bar-track');
        barCache = h('div', 'tvp-bar-cache');
        barFill = h('div', 'tvp-bar-fill');
        barKnob = h('div', 'tvp-bar-knob');
        track.append(barCache, barFill, barKnob);
        bar.appendChild(track);
        bar.addEventListener('click', function (e) {
            // Clicking the bar with a pointer jumps there; Select from the remote plays or pauses
            if (e.detail && state.duration) {
                var r = track.getBoundingClientRect();
                commands.player('seek-to', kit.clamp((e.clientX - r.left) / r.width, 0, 1) * state.duration);
            } else commands.player('play-pause');
        });
        var times = h('div', 'tvp-times');
        timeNow = h('span', null, '0:00');
        timeLeft = h('span', null, '-0:00');
        times.append(timeNow, timeLeft);
        bottom.append(titleEl, subEl, buttonsStrip, bar, times);

        panelEl = h('div', 'tvp-panel');
        panelHead = h('div', 'tvp-panel-head');
        var panelBody = h('div', 'tvp-panel-body');
        panelTrack = h('div', 'tvp-panel-track');
        panelBody.appendChild(panelTrack);
        panelEl.append(panelHead, panelBody);

        root.append(shade, centerIcon, spinner, bottom, panelEl);
        document.body.appendChild(root);
        root.addEventListener('mousemove', function () { showControls(false); });

        var style = h('style');
        style.id = 'sp-tvplayer-style';
        style.textContent = CSS;
        document.head.appendChild(style);

        controls.track = null;
        panel.track = panelTrack;
        renderButtons();
    }

    function renderTitle() {
        if (!root) return;
        titleEl.textContent = info.title;
        subEl.textContent = info.subtitle;
    }

    function renderBar() {
        if (!root) return;
        var d = state.duration || 0;
        var p = d ? kit.clamp(state.position / d, 0, 1) : 0;
        barFill.style.width = (p * 100) + '%';
        barKnob.style.left = (p * 100) + '%';
        barCache.style.width = (d ? kit.clamp(state.cached / d, 0, 1) * 100 : 0) + '%';
        timeNow.textContent = formatTime(state.position);
        timeLeft.textContent = d ? '-' + formatTime(d - state.position) : '';
    }

    function renderPlayState() {
        if (!root) return;
        root.classList.toggle('paused', state.paused);
        // While paused the centre shows what Select does next: play
        if (state.paused) { centerIcon.classList.remove('flash'); centerIcon.innerHTML = svg('play'); showControls(false); }
        else scheduleHide();
    }

    function flash(icon) {
        centerIcon.innerHTML = svg(icon);
        centerIcon.classList.remove('flash');
        void centerIcon.offsetWidth;
        centerIcon.classList.add('flash');
    }

    // Buttons: only the ones that apply to what's playing
    function renderButtons() {
        if (!root) return;
        var streams = window.__spTvStreams;
        var list = [];
        if (info.meta && (info.meta.videos || []).length > 1) list.push(['episodes', 'Episodes']);
        list.push(['subtitles', 'Subtitles']);
        if (state.tracks.filter(function (t) { return t.type === 'audio'; }).length > 1) list.push(['audio', 'Audio']);
        if (streams && streams.id === (info.meta && info.meta.id) && streams.streams.length > 1) list.push(['sources', 'Sources']);
        if (info.nextVideo) list.push(['next', 'Next Episode']);
        var key = list.map(function (x) { return x[0]; }).join();
        if (buttonsStrip.dataset.key === key) return;
        buttonsStrip.dataset.key = key;
        buttonsStrip.replaceChildren();
        buttons = {};
        var items = list.map(function (x) {
            var b = h('button', 'tvp-btn');
            b.innerHTML = svg(x[0]);
            b.appendChild(h('span', null, x[1]));
            b.addEventListener('click', function () { if (x[0] === 'next') playNext(); else openPanel(x[0]); });
            buttonsStrip.appendChild(b);
            buttons[x[0]] = b;
            return b;
        });
        // Moving up from the scrubber starts at the first button
        if (controls.cols.buttons === undefined) controls.cols.buttons = 0;
        controls.setRows([{ id: 'buttons', el: buttonsStrip, items: items, remember: true }, { id: 'bar', el: bar, items: [bar] }]);
        if (visible && !panelOpen) controls.focus();
    }

    function playNext() {
        var next = info.nextVideo;
        var link = next && next.deepLinks && (next.deepLinks.player || next.deepLinks.metaDetailsStreams);
        if (link) kit.go(link);
    }

    // ── Controls ─────────────────────────────────────────────────────────────
    var controls = new kit.Screen({});
    controls.rowIndex = 1;
    var visible = false, hideTimer = null;

    function showControls(focusBar) {
        if (!root) return;
        if (!visible) liftSubtitles(true);
        visible = true;
        root.classList.add('show');
        if (focusBar) { controls.rowIndex = Math.max(0, controls.rows.length - 1); }
        if (!panelOpen) { controls.active = true; controls.focus(); }
        scheduleHide();
    }
    function hideControls() {
        if (!root || panelOpen) return;
        visible = false;
        liftSubtitles(false);
        root.classList.remove('show');
        kit.setFocusEl(null);
    }
    // Subtitles move up above the controls while they show (mpv's default margin is 22)
    function liftSubtitles(up) { commands.mpv('mpv-set-prop', ['sub-margin-y', up ? 190 : 22]); }

    function scheduleHide() {
        clearTimeout(hideTimer);
        if (state.paused || panelOpen) return;
        hideTimer = setTimeout(hideControls, HIDE_AFTER);
    }

    function seek(seconds) {
        if (!state.duration && seconds < 0 && state.position <= 0) return;
        commands.player(seconds > 0 ? 'seek-forward' : 'seek-back', Math.abs(seconds));
        // Move the scrubber straight away; mpv's update follows
        state.position = kit.clamp(state.position + seconds, 0, state.duration || Infinity);
        renderBar();
        flash(seconds > 0 ? 'fwd10' : 'back10');
    }

    function togglePause() {
        commands.player('play-pause');
        flash(state.paused ? 'play' : 'pause');
    }

    // ── Panels ───────────────────────────────────────────────────────────────
    var panelOpen = null;
    var panel = new kit.Screen({
        // Panels are short: everything fits, so only scroll when a row would fall off the bottom
        anchor: function (i, s) {
            var row = s.rows[i];
            if (!row || !s.track) return 0;
            var bottom = s.rowTop(i) + row.el.offsetHeight;
            return Math.max(0, bottom - s.track.parentElement.clientHeight + 30);
        },
    });

    function pillRow(id, label, options) {
        var el = h('section', 'tvp-row');
        if (label) el.appendChild(h('h3', 'tvp-row-title', label));
        var strip = h('div', 'tvp-pills');
        var items = options.map(function (o) {
            var b = h('button', 'tvp-pill' + (o.on ? ' on' : ''), o.label);
            if (o.on) b.insertAdjacentHTML('afterbegin', '<span class="tvp-check">✓</span>');
            b.addEventListener('click', function () { o.run(); });
            strip.appendChild(b);
            return b;
        });
        el.appendChild(strip);
        return { id: id, el: el, strip: strip, items: items, remember: true };
    }

    function subtitleRows() {
        var subs = state.tracks.filter(function (t) { return t.type === 'sub'; });
        var current = state.sid;
        var rows = [];
        var first = [{ label: 'Off', on: !current || current === 'no' || current === false, run: function () { commands.mpv('mpv-set-prop', ['sid', 'no']); closeSoon(); } }];
        subs.forEach(function (t) {
            first.push({ label: (t.title || languageName(t.lang)) + (t.external ? '' : ''), on: t.selected || t.id === current,
                run: function () { commands.mpv('mpv-set-prop', ['sid', t.id]); closeSoon(); } });
        });
        rows.push(pillRow('subs-loaded', subs.length ? 'In this video' : null, first));
        // Add-on subtitles, one row per language
        var byLang = {};
        info.addonSubs.forEach(function (s) { (byLang[s.lang] = byLang[s.lang] || []).push(s); });
        var preferred = (navigator.language || 'en').slice(0, 2);
        Object.keys(byLang).sort(function (a, b) {
            var pa = languageName(a), pb = languageName(b);
            if (a.indexOf(preferred) === 0 || pa === languageName(preferred)) return -1;
            if (b.indexOf(preferred) === 0 || pb === languageName(preferred)) return 1;
            return pa.localeCompare(pb);
        }).slice(0, 14).forEach(function (lang) {
            rows.push(pillRow('subs-' + lang, languageName(lang), byLang[lang].slice(0, 8).map(function (s, i) {
                var label = (s.origin || 'Subtitles') + (byLang[lang].length > 1 ? ' ' + (i + 1) : '');
                return { label: label, run: function () { commands.mpv('mpv-command', ['sub-add', s.url, 'select', label, lang]); closeSoon(); } };
            })));
        });
        rows.push(pillRow('subs-style', 'Size and timing  ·  ' + Math.round(state.subScale * 100) + '%  ·  ' + (state.subDelay >= 0 ? '+' : '') + state.subDelay.toFixed(1) + ' s', [
            { label: 'Smaller', run: function () { commands.player('subs-smaller'); setTimeout(refreshPanel, 150); } },
            { label: 'Larger', run: function () { commands.player('subs-bigger'); setTimeout(refreshPanel, 150); } },
            { label: 'Earlier', run: function () { commands.player('subs-delay-down'); setTimeout(refreshPanel, 150); } },
            { label: 'Later', run: function () { commands.player('subs-delay-up'); setTimeout(refreshPanel, 150); } },
        ]));
        return rows;
    }

    function audioRows() {
        var tracks = state.tracks.filter(function (t) { return t.type === 'audio'; });
        return [pillRow('audio', null, tracks.map(function (t) {
            var label = [t.title, languageName(t.lang), t.codec ? t.codec.toUpperCase() : '', t['demux-channel-count'] ? t['demux-channel-count'] + ' ch' : '']
                .filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 3).join(' · ');
            return { label: label || 'Track ' + t.id, on: t.selected, run: function () { commands.mpv('mpv-set-prop', ['aid', t.id]); closeSoon(); } };
        }))];
    }

    function sourceRows() {
        var streams = (window.__spTvStreams && window.__spTvStreams.streams) || [];
        return streams.map(function (x, i) {
            var name = String(x.stream.name || x.addon || 'Source').split('\n').filter(Boolean).join(' · ');
            var desc = String(x.stream.description || x.stream.title || '').split('\n').filter(Boolean).slice(0, 2).join('  ·  ');
            var b = h('button', 'tvp-source');
            b.append(h('div', 'tvp-source-name', name), h('div', 'tvp-source-desc', desc || x.addon || ''));
            b.addEventListener('click', function () {
                var link = x.stream.deepLinks && x.stream.deepLinks.player;
                if (link) location.replace(location.href.split('#')[0] + link);
            });
            var row = h('div', 'tvp-source-row');
            row.appendChild(b);
            return { id: 'src' + i, el: row, items: [b] };
        });
    }

    function episodeRows() {
        var meta = info.meta;
        if (!meta) return [];
        var eps = kit.sortedEpisodes(meta);
        var seasons = Array.from(new Set(eps.map(function (v) { return v.season || 0; })));
        var season = info.video ? info.video.season || 0 : seasons[0];
        if (panel.season !== undefined && seasons.indexOf(panel.season) !== -1) season = panel.season;
        var rows = [];
        if (seasons.length > 1) {
            rows.push(pillRow('seasons', null, seasons.map(function (s) {
                return { label: s ? 'Season ' + s : 'Specials', on: s === season, run: function () { panel.season = s; panel.cols.episodes = 0; refreshPanel(); } };
            })));
            panel.cols.seasons = seasons.indexOf(season);
        }
        var el = h('section', 'tvp-row tvp-eps');
        var strip = h('div', 'tvp-strip');
        var list = eps.filter(function (v) { return (v.season || 0) === season; });
        var items = list.map(function (v) {
            var card = h('button', 'tvui-ep tvp-ep');
            var thumb = h('div', 'tvui-ep-thumb');
            var img = h('img');
            img.alt = ''; img.loading = 'lazy'; img.src = v.thumbnail || meta.background || '';
            img.addEventListener('error', function () { img.remove(); });
            thumb.appendChild(img);
            if (info.video && v.id === info.video.id) thumb.appendChild(h('div', 'tvp-now', 'Now Playing'));
            card.append(thumb, h('div', 'tvui-ep-kicker', kit.epLabel(v)), h('div', 'tvui-ep-title', v.title || v.name || 'Episode ' + v.episode));
            card.addEventListener('click', function () { kit.go(kit.episodeLink(meta, v)); });
            strip.appendChild(card);
            return card;
        });
        el.appendChild(strip);
        rows.push({ id: 'episodes', el: el, strip: strip, items: items, slide: true, remember: true });
        if (panel.cols.episodes === undefined && info.video) panel.cols.episodes = Math.max(0, list.indexOf(info.video));
        if (panel.rowIndex === undefined || !panel.rows.length) panel.rowIndex = rows.length - 1;
        return rows;
    }

    var PANELS = { episodes: ['Episodes', episodeRows], subtitles: ['Subtitles', subtitleRows], audio: ['Audio', audioRows], sources: ['Sources', sourceRows] };

    function openPanel(name) {
        panelOpen = name;
        panel.rows = []; panel.rowIndex = name === 'episodes' ? 99 : 0; panel.cols = {}; panel.season = undefined;
        clearTimeout(hideTimer);
        root.classList.add('panel-open', 'show');
        controls.active = false;
        panel.active = true;
        refreshPanel();
    }
    function refreshPanel() {
        if (!panelOpen) return;
        var def = PANELS[panelOpen];
        panelHead.textContent = def[0];
        var rows = def[1]();
        panelTrack.replaceChildren();
        rows.forEach(function (r) { panelTrack.appendChild(r.el); });
        if (!rows.length) panelTrack.appendChild(h('div', 'tvp-note', 'Nothing to choose here.'));
        panel.setRows(rows);
        if (rows.length) panel.focus();
    }
    function closePanel() {
        panelOpen = null;
        panel.active = false;
        root.classList.remove('panel-open');
        showControls(false);
    }
    // After choosing a track, close shortly so the change can be seen
    function closeSoon() { setTimeout(function () { if (panelOpen) refreshPanel(); }, 120); setTimeout(closePanel, 450); }

    // ── Remote ───────────────────────────────────────────────────────────────
    function handle(name, value) {
        if (!root) return;
        var direction = name === 'up' || name === 'down' || name === 'left' || name === 'right';
        if (direction && value === false) return;

        // Media keys and Control Center: act, and show where things are
        if (name === 'playPause' || name === 'play' || name === 'pause') { commands.player(name === 'playPause' ? 'play-pause' : name); return showControls(false); }
        if (name === 'skipForward') { seek(10); return showControls(true); }
        if (name === 'skipBackward') { seek(-10); return showControls(true); }
        if (name === 'seek') { commands.player('seek-to', value); return showControls(true); }
        if (name === 'next') return playNext();
        if (name === 'previous') { commands.player('seek-to', 0); return showControls(true); }

        if (panelOpen) {
            if (direction) { panel.move(name); }
            else if (name === 'select') { var f = kit.focused(); if (f) f.click(); }
            else if (name === 'back') closePanel();
            return;
        }
        if (!visible) {
            if (name === 'left') { seek(-10); return showControls(true); }
            if (name === 'right') { seek(10); return showControls(true); }
            if (name === 'select') { togglePause(); return showControls(true); }
            if (name === 'back') return commands.player('exit');
            return showControls(true);
        }
        scheduleHide();
        var onBar = controls.rows[controls.rowIndex] && controls.rows[controls.rowIndex].id === 'bar';
        if (name === 'back') return hideControls();
        if (onBar && (name === 'left' || name === 'right')) return seek(name === 'left' ? -10 : 10);
        if (onBar && name === 'select') return togglePause();
        if (onBar && name === 'down') return hideControls();
        if (direction) return controls.move(name);
        if (name === 'select') { var b = kit.focused(); if (b) b.click(); }
    }

    // ── Show / hide ──────────────────────────────────────────────────────────
    var shown = false, infoTimer = null;
    function show() {
        if (!root) build();
        if (!shown) {
            shown = true;
            document.documentElement.classList.add('sp-tvplayer-on');
            root.classList.add('on');
            panelOpen = null;
            root.classList.remove('panel-open');
            buttonsStrip.dataset.key = '';
        }
        // Stremio fills in the player's details (the show, its episodes) a
        // while after it opens; keep up with them
        loadInfo();
        clearInterval(infoTimer);
        infoTimer = setInterval(loadInfo, 2000);
        showControls(true);
    }
    function hide() {
        if (!shown) return;
        shown = false;
        clearTimeout(hideTimer);
        clearInterval(infoTimer);
        if (visible) liftSubtitles(false);
        visible = false;
        document.documentElement.classList.remove('sp-tvplayer-on');
        root.classList.remove('on', 'show', 'panel-open');
        kit.setFocusEl(null);
    }

    var CSS = '' +
        // Stremio's own player controls give way
        'html.sp-tvplayer-on [class*="player-container"] > :not([class*="video-container"]) { display: none !important; }' +
        'html.sp-tvplayer-on [class*="player-container"] { cursor: none !important; }' +
        '#sp-tvplayer { --tvp-ease: cubic-bezier(0.32,0.72,0,1); position: fixed; inset: 0; z-index: 2147482000; display: none; color: #fff;' +
        '  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; -webkit-font-smoothing: antialiased; pointer-events: none; }' +
        '#sp-tvplayer.on { display: block; }' +
        '#sp-tvplayer div, #sp-tvplayer section { overflow: visible; }' +
        '#sp-tvplayer .tvp-bar-track, #sp-tvplayer .tvui-ep-thumb, #sp-tvplayer .tvp-panel-body { overflow: hidden !important; }' +
        '#sp-tvplayer button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: default; outline: none; text-align: left; pointer-events: auto; }' +
        '.tvp-shade { position: absolute; inset: 0; opacity: 0; transition: opacity .4s ease;' +
        '  background: linear-gradient(0deg, rgba(0,0,0,.85) 0%, rgba(0,0,0,.45) 26%, transparent 48%), linear-gradient(180deg, rgba(0,0,0,.35), transparent 18%); }' +
        '#sp-tvplayer.show .tvp-shade { opacity: 1; }' +
        // Bottom: title, buttons, scrubber
        '.tvp-bottom { position: absolute; left: 80px; right: 80px; bottom: 54px; opacity: 0; transform: translateY(16px); transition: opacity .35s ease, transform .5s var(--tvp-ease); }' +
        '#sp-tvplayer.show .tvp-bottom { opacity: 1; transform: none; }' +
        '#sp-tvplayer.panel-open .tvp-bottom { opacity: 0; transform: translateY(16px); }' +
        '.tvp-title { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; text-shadow: 0 2px 16px rgba(0,0,0,.5); }' +
        '.tvp-sub { margin: 4px 0 18px; font-size: 18px; font-weight: 600; color: rgba(255,255,255,.75); min-height: 22px; }' +
        '.tvp-buttons { display: flex; gap: 10px; margin-bottom: 22px; }' +
        '.tvp-btn { display: inline-flex !important; align-items: center; gap: 8px; height: 44px; padding: 0 18px !important; border-radius: 22px; font-size: 16px; font-weight: 700;' +
        '  background: rgba(255,255,255,.14) !important; -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); transition: transform .25s var(--tvp-ease), background .2s ease, color .2s ease; }' +
        '.tvp-btn svg { width: 20px; height: 20px; }' +
        '#sp-tvplayer .tvp-btn.tvui-focus { background: #fff !important; color: #000 !important; transform: scale(1.08); }' +
        '.tvp-bar { display: block !important; width: 100%; padding: 12px 0 !important; }' +
        '.tvp-bar-track { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,.25); transition: height .2s ease; }' +
        '.tvp-bar.tvui-focus .tvp-bar-track { height: 10px; border-radius: 5px; }' +
        '.tvp-bar-cache { position: absolute; inset: 0 auto 0 0; background: rgba(255,255,255,.25); }' +
        '.tvp-bar-fill { position: absolute; inset: 0 auto 0 0; background: #fff; }' +
        '#sp-tvplayer .tvp-bar-track { overflow: visible !important; }' +
        '.tvp-bar-knob { position: absolute; top: 50%; width: 4px; height: 22px; margin: -11px 0 0 -2px; border-radius: 2px; background: #fff; opacity: 0; transition: opacity .2s ease; box-shadow: 0 0 10px rgba(0,0,0,.5); }' +
        '.tvp-bar.tvui-focus .tvp-bar-knob { opacity: 1; }' +
        '.tvp-times { display: flex; justify-content: space-between; margin-top: 4px; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: rgba(255,255,255,.75); }' +
        // Centre: play / pause / skip flashes, buffering
        '.tvp-center { position: absolute; left: 50%; top: 50%; width: 96px; height: 96px; margin: -48px; border-radius: 50%; display: grid; place-items: center;' +
        '  background: rgba(30,30,32,.5); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); opacity: 0; }' +
        '.tvp-center svg { width: 44px; height: 44px; }' +
        '.tvp-center.flash { animation: tvp-flash .7s ease both; }' +
        '#sp-tvplayer.paused:not(.panel-open) .tvp-center { opacity: 1; animation: none; }' +
        '.tvp-spinner { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; margin: -24px; border-radius: 50%; border: 4px solid rgba(255,255,255,.2); border-top-color: #fff;' +
        '  opacity: 0; animation: tvp-spin .9s linear infinite; transition: opacity .3s ease; }' +
        '#sp-tvplayer.buffering .tvp-spinner { opacity: 1; }' +
        // Panels slide up over the lower part of the video
        '.tvp-panel { position: absolute; left: 0; right: 0; bottom: 0; height: 52vh; display: flex; flex-direction: column; padding: 34px 0 0; pointer-events: auto;' +
        '  background: rgba(22,22,26,.8); -webkit-backdrop-filter: blur(40px) saturate(170%); backdrop-filter: blur(40px) saturate(170%);' +
        '  box-shadow: 0 -20px 60px rgba(0,0,0,.4); border-radius: 28px 28px 0 0; transform: translateY(105%); transition: transform .5s var(--tvp-ease); }' +
        '#sp-tvplayer.panel-open .tvp-panel { transform: none; }' +
        '.tvp-panel-head { padding: 0 80px 14px; font-size: 28px; font-weight: 800; letter-spacing: -0.02em; }' +
        '.tvp-panel-body { position: relative; flex: 1; }' +
        '.tvp-panel-track { padding: 10px 80px 40px; transition: transform .5s var(--tvp-ease); }' +
        '.tvp-row { padding-bottom: 18px; }' +
        '.tvp-row-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: rgba(255,255,255,.55); }' +
        '.tvp-pills { display: flex; flex-wrap: nowrap; gap: 10px; }' +
        '.tvp-pill { flex: none; display: inline-flex !important; align-items: center; gap: 8px; height: 46px; padding: 0 20px !important; border-radius: 23px; font-size: 17px; font-weight: 600;' +
        '  background: rgba(255,255,255,.1) !important; color: rgba(255,255,255,.85) !important; transition: transform .2s var(--tvp-ease), background .15s ease; }' +
        '.tvp-pill.on { color: #fff !important; background: rgba(255,255,255,.2) !important; }' +
        '.tvp-check { font-weight: 800; }' +
        '#sp-tvplayer .tvp-pill.tvui-focus { background: #fff !important; color: #000 !important; transform: scale(1.08); }' +
        '.tvp-strip { display: flex; gap: 22px; padding: 10px 0 10px; transition: transform .5s var(--tvp-ease); }' +
        '.tvp-ep { width: 300px; }' +
        '.tvp-now { position: absolute; left: 10px; bottom: 10px; z-index: 2; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 800; background: rgba(255,255,255,.9); color: #000; }' +
        '.tvp-source-row { padding: 3px 0; max-width: 900px; }' +
        '.tvp-source { display: block !important; width: 100%; padding: 14px 18px !important; border-radius: 14px; transition: transform .2s var(--tvp-ease), background .15s ease; }' +
        '.tvp-source-name { font-size: 18px; font-weight: 700; }' +
        '.tvp-source-desc { margin-top: 3px; font-size: 14px; color: rgba(255,255,255,.6); white-space: nowrap; overflow: hidden !important; text-overflow: ellipsis; }' +
        '#sp-tvplayer .tvp-source.tvui-focus { background: #fff; color: #000; transform: scale(1.02); }' +
        '#sp-tvplayer .tvp-source.tvui-focus .tvp-source-desc { color: rgba(0,0,0,.6); }' +
        '.tvp-note { padding: 10px 0; font-size: 18px; color: rgba(255,255,255,.6); }' +
        '@keyframes tvp-flash { 0% { opacity: 0; transform: scale(.85); } 25% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.1); } }' +
        '@keyframes tvp-spin { to { transform: rotate(360deg); } }' +
        '@media (prefers-reduced-motion: reduce) { #sp-tvplayer *, #sp-tvplayer { transition-duration: .01ms !important; animation-duration: .01ms !important; } }';

    if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', onShellMessage);

    window.__spTvPlayer = {
        show: show,
        hide: hide,
        handle: handle,
        isShown: function () { return shown; },
        element: function () { return root; },
    };
})();
