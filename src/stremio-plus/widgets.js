// Stremio+ widgets: a row of tiles at the top of the menu (Continue Watching,
// Featured, Trending Series). Data comes from the Stremio core and Cinemeta,
// and is refreshed each time the menu opens.
(function () {
    if (window.__stremioPlusWidgets) return;
    window.__stremioPlusWidgets = true;

    var CINEMETA = 'https://v3-cinemeta.strem.io/catalog/';
    var CATALOG_TTL = 30 * 60 * 1000;
    var FEATURED_INTERVAL = 7000;

    var catalogCache = {};
    var featuredTimer = null;

    var css = '' +
        '#sp-widgets { display:grid; grid-template-columns:1fr 1.25fr 1fr; gap:10px; padding:12px 12px 0; flex-shrink:0; }' +
        '#sp-widgets .spw-tile { position:relative; height:184px; border-radius:12px; overflow:hidden; background:rgba(255,255,255,0.06);' +
        '  border:0.5px solid rgba(255,255,255,0.1); padding:12px 12px 10px; display:flex; flex-direction:column; color:rgba(255,255,255,0.92); }' +
        '#sp-widgets .spw-head { display:flex; align-items:center; justify-content:space-between; font-size:13px; font-weight:600; letter-spacing:-0.01em; margin-bottom:6px; flex-shrink:0; }' +
        '#sp-widgets .spw-head svg { opacity:0.55; }' +
        '#sp-widgets .spw-row { display:flex; align-items:center; gap:9px; padding:3px 4px; margin:0 -4px; flex-shrink:0; border-radius:8px; cursor:pointer; min-width:0; }' +
        '#sp-widgets .spw-row:hover { background:rgba(255,255,255,0.07); }' +
        '#sp-widgets .spw-thumb { width:27px; height:40px; border-radius:5px; object-fit:cover; background:rgba(255,255,255,0.08); flex-shrink:0; }' +
        '#sp-widgets .spw-text { flex:1; min-width:0; }' +
        '#sp-widgets .spw-title { font-size:12.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
        '#sp-widgets .spw-sub { font-size:11px; color:rgba(255,255,255,0.5); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
        '#sp-widgets .spw-bar { height:3px; border-radius:2px; background:rgba(255,255,255,0.12); margin-top:5px; overflow:hidden; }' +
        '#sp-widgets .spw-bar > i { display:block; height:100%; background:rgba(255,255,255,0.85); border-radius:2px; }' +
        '#sp-widgets .spw-play { width:24px; height:24px; border-radius:50%; background:rgba(255,255,255,0.14); display:flex; align-items:center; justify-content:center; flex-shrink:0; }' +
        '#sp-widgets .spw-row:hover .spw-play { background:rgba(255,255,255,0.24); }' +
        '#sp-widgets .spw-rating { font-size:12px; font-weight:500; font-variant-numeric:tabular-nums; color:rgba(255,255,255,0.75); flex-shrink:0; }' +
        '#sp-widgets .spw-empty { flex:1; display:flex; align-items:center; justify-content:center; text-align:center; font-size:12px; color:rgba(255,255,255,0.4); padding:0 10px; }' +
        '#sp-widgets .spw-featured { padding:0; cursor:pointer; }' +
        '#sp-widgets .spw-featured .spw-bg { position:absolute; inset:0; background-size:cover; background-position:center; transition:opacity .6s ease; }' +
        '#sp-widgets .spw-featured::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,0.78) 100%); }' +
        '#sp-widgets .spw-featured .spw-info { position:absolute; left:12px; right:12px; bottom:10px; z-index:1; }' +
        '#sp-widgets .spw-featured .spw-label { position:absolute; top:10px; left:12px; z-index:1; font-size:11px; font-weight:600; letter-spacing:0.02em;' +
        '  padding:3px 8px; border-radius:999px; background:rgba(0,0,0,0.35); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); }' +
        '#sp-widgets .spw-featured .spw-name { font-size:16px; font-weight:600; letter-spacing:-0.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
        '#sp-widgets .spw-featured .spw-logo { max-height:38px; max-width:70%; object-fit:contain; object-position:left bottom; display:block; margin-bottom:4px; }' +
        '#sp-widgets .spw-dots { position:absolute; top:14px; right:12px; z-index:1; display:flex; gap:4px; }' +
        '#sp-widgets .spw-dots i { width:5px; height:5px; border-radius:50%; background:rgba(255,255,255,0.35); }' +
        '#sp-widgets .spw-dots i.on { background:#fff; }' +
        '#sp-widgets .spw-more { margin-top:auto; display:flex; align-items:center; justify-content:space-between; padding:6px 4px 0; border-top:0.5px solid rgba(255,255,255,0.08);' +
        '  font-size:12px; color:rgba(255,255,255,0.55); cursor:pointer; flex-shrink:0; }' +
        '#sp-widgets .spw-more:hover { color:rgba(255,255,255,0.9); }' +
        '#sp-widgets .spw-row:active, #sp-widgets .spw-more:active { transform:scale(0.98); transition:transform 80ms ease-out; }' +
        '#sp-widgets .spw-featured:active { transform:scale(0.99); transition:transform 80ms ease-out; }' +
        '#sp-widgets .spw-featured .spw-bg { transition:opacity .7s ease; }' +
        // Steps aside while a list below is scrolled, like a large title collapsing
        '#sp-widgets { max-height:240px; overflow:hidden; transition:max-height .34s cubic-bezier(0.32,0.72,0,1), opacity .22s ease, padding-top .34s cubic-bezier(0.32,0.72,0,1); }' +
        '#sp-widgets.sp-aside { max-height:0; opacity:0; padding-top:0; pointer-events:none; }' +
        '@media (max-height: 720px) { #sp-widgets { display:none; } }' +
        '@media (prefers-reduced-motion: reduce) { #sp-widgets, #sp-widgets * { transition:none !important; } }';

    var ICONS = {
        play: '<svg width="9" height="10" viewBox="0 0 9 10"><path d="M1 1.2v7.6a.6.6 0 0 0 .9.5l6.3-3.8a.6.6 0 0 0 0-1L1.9.7A.6.6 0 0 0 1 1.2z" fill="#fff"/></svg>',
        clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        trend: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    };

    // Small element builder; text always goes through textContent
    function h(tag, className, children) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        (children || []).forEach(function (c) {
            if (c == null) return;
            el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return el;
    }

    function img(className, src) {
        var el = h('img', className);
        el.loading = 'lazy';
        el.alt = '';
        if (src) el.src = src;
        return el;
    }

    function icon(name) {
        var span = h('span');
        span.innerHTML = ICONS[name];
        return span.firstChild;
    }

    function webLink(link) {
        if (!link) return null;
        return link.indexOf('stremio:///') === 0 ? '#/' + link.slice('stremio:///'.length) : link;
    }

    function open(link) {
        link = webLink(link);
        if (!link) return;
        if (window.__st_toggle && (window.__st_isOpen ? window.__st_isOpen() : isOpen())) window.__st_toggle();
        location.hash = link.replace(/^#/, '');
    }

    function detailLink(type, id) {
        return '#/detail/' + encodeURIComponent(type) + '/' + encodeURIComponent(id);
    }

    function isOpen() {
        var overlay = document.getElementById('__st_overlay__');
        return !!overlay && overlay.classList.contains('open');
    }

    function fetchCatalog(type) {
        var cached = catalogCache[type];
        if (cached && Date.now() - cached.at < CATALOG_TTL) return Promise.resolve(cached.metas);
        return fetch(CINEMETA + type + '/top.json')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var metas = (data.metas || []).filter(function (m) { return m && m.id && m.name; });
                catalogCache[type] = { at: Date.now(), metas: metas };
                return metas;
            });
    }

    function continueWatching() {
        if (!window.core || typeof window.core.getState !== 'function') return Promise.resolve([]);
        return Promise.resolve(window.core.getState('continue_watching_preview'))
            .then(function (state) { return (state && state.items) || []; })
            .catch(function () { return []; });
    }

    // ── Tiles ────────────────────────────────────────────────────────────────
    function header(title, iconName) {
        return h('div', 'spw-head', [title, icon(iconName)]);
    }

    function renderContinue(tile, items) {
        tile.replaceChildren(header('Continue Watching', 'clock'));
        if (!items.length) {
            tile.appendChild(h('div', 'spw-empty', ['Nothing in progress yet.']));
            tile.appendChild(footerLink('Browse Discover', '#/discover'));
            return;
        }
        items.slice(0, 3).forEach(function (item) {
            var progress = typeof item.progress === 'number' ? item.progress : 0;
            var percent = Math.max(0, Math.min(100, progress <= 1 ? progress * 100 : progress));
            var links = item.deepLinks || {};
            var bar = null;
            if (percent > 0) {
                bar = h('div', 'spw-bar', [h('i')]);
                bar.firstChild.style.width = percent.toFixed(0) + '%';
            }
            var play = h('div', 'spw-play');
            play.innerHTML = ICONS.play;
            var row = h('div', 'spw-row', [
                img('spw-thumb', item.poster),
                h('div', 'spw-text', [
                    h('div', 'spw-title', [item.name || 'Untitled']),
                    h('div', 'spw-sub', [percent > 0 ? Math.round(percent) + '% watched' : (item.type === 'series' ? 'Series' : 'Movie')]),
                    bar,
                ]),
                play,
            ]);
            row.title = item.name || '';
            row.addEventListener('click', function () {
                open(percent > 0 && links.player ? links.player : (links.metaDetailsVideos || links.metaDetailsStreams || detailLink(item.type, item._id)));
            });
            tile.appendChild(row);
        });
        if (items.length < 3) tile.appendChild(footerLink('Open Library', '#/library'));
    }

    function footerLink(label, link) {
        var a = h('div', 'spw-more', [label, h('span', null, ['›'])]);
        a.addEventListener('click', function () { open(link); });
        return a;
    }

    function renderFeatured(tile, metas) {
        clearInterval(featuredTimer);
        var picks = metas.filter(function (m) { return m.background; }).slice(0, 6);
        if (!picks.length) {
            tile.replaceChildren(h('div', 'spw-empty', ['Featured titles are unavailable right now.']));
            return;
        }
        var index = 0;
        var layers = [h('div', 'spw-bg'), h('div', 'spw-bg')];
        var front = 0;
        var info = h('div', 'spw-info');
        var dots = h('div', 'spw-dots', picks.map(function () { return h('i'); }));
        tile.replaceChildren(layers[0], layers[1], h('div', 'spw-label', ['Featured']), dots, info);
        layers[1].style.opacity = '0';

        function show(i) {
            var m = picks[i];
            var url = 'url("' + String(m.background).replace(/"/g, '%22') + '")';
            var next = layers[1 - front];
            // Fade in only once the image is decoded, so it never flashes empty
            var pre = new Image();
            pre.onload = pre.onerror = function () {
                next.style.backgroundImage = url;
                next.style.opacity = '1';
                layers[front].style.opacity = '0';
                front = 1 - front;
            };
            pre.src = m.background;
            var sub = [m.releaseInfo, m.imdbRating ? '★ ' + m.imdbRating : null, (m.genres || [])[0]].filter(Boolean).join(' · ');
            info.replaceChildren(
                m.logo ? img('spw-logo', m.logo) : h('div', 'spw-name', [m.name]),
                h('div', 'spw-sub', [sub])
            );
            if (m.logo) info.firstChild.addEventListener('error', function () { info.firstChild.replaceWith(h('div', 'spw-name', [m.name])); });
            Array.prototype.forEach.call(dots.children, function (d, j) { d.className = j === i ? 'on' : ''; });
            tile.title = m.name;
        }

        show(index);
        tile.onclick = function () { open(detailLink('movie', picks[index].id)); };
        featuredTimer = setInterval(function () {
            if (!isOpen()) return clearInterval(featuredTimer);
            index = (index + 1) % picks.length;
            show(index);
        }, FEATURED_INTERVAL);
    }

    function renderTrending(tile, metas) {
        tile.replaceChildren(header('Trending Series', 'trend'));
        if (!metas.length) {
            tile.appendChild(h('div', 'spw-empty', ['Trending series are unavailable right now.']));
            return;
        }
        metas.slice(0, 3).forEach(function (m) {
            var row = h('div', 'spw-row', [
                img('spw-thumb', m.poster),
                h('div', 'spw-text', [
                    h('div', 'spw-title', [m.name]),
                    h('div', 'spw-sub', [[m.releaseInfo, (m.genres || [])[0]].filter(Boolean).join(' · ')]),
                ]),
                m.imdbRating ? h('div', 'spw-rating', ['★ ' + m.imdbRating]) : null,
            ]);
            row.addEventListener('click', function () { open(detailLink('series', m.id)); });
            tile.appendChild(row);
        });
    }

    // Generic list tile: header, up to three rows, optional footer link
    function renderList(tile, title, iconName, rows, emptyText, footer) {
        tile.replaceChildren(header(title, iconName));
        if (!rows.length) {
            tile.appendChild(h('div', 'spw-empty', [emptyText]));
            if (footer) tile.appendChild(footerLink(footer[0], footer[1]));
            return;
        }
        rows.slice(0, 3).forEach(function (r) {
            var row = h('div', 'spw-row', [
                img('spw-thumb', r.poster),
                h('div', 'spw-text', [h('div', 'spw-title', [r.title]), h('div', 'spw-sub', [r.sub || ''])]),
                r.right ? h('div', 'spw-rating', [r.right]) : null,
            ]);
            row.title = r.title;
            row.addEventListener('click', function () { open(r.link); });
            tile.appendChild(row);
        });
        if (footer && rows.length < 3) tile.appendChild(footerLink(footer[0], footer[1]));
    }

    // Loads one of Stremio's models and waits briefly for its state to fill in
    function loadModel(model, action, ready) {
        if (!window.core || !window.core.getState) return Promise.resolve(null);
        try { if (action) window.core.dispatch(action, model); } catch (e) {}
        var tries = 0;
        return new Promise(function (resolve) {
            var poll = function () {
                Promise.resolve(window.core.getState(model)).then(function (state) {
                    if ((state && ready(state)) || ++tries > 8) resolve(state);
                    else setTimeout(poll, 200);
                }).catch(function () { resolve(null); });
            };
            poll();
        });
    }

    var metaCache = {};
    function seriesMeta(id) {
        if (metaCache[id]) return Promise.resolve(metaCache[id]);
        return fetch('https://v3-cinemeta.strem.io/meta/series/' + encodeURIComponent(id) + '.json')
            .then(function (r) { return r.json(); })
            .then(function (d) { metaCache[id] = d.meta || {}; return metaCache[id]; })
            .catch(function () { return {}; });
    }

    function episodeLabel(videoId) {
        var parts = String(videoId).split(':');
        return parts.length >= 3 ? 'S' + parts[1] + ' \u00B7 E' + parts[2] : '';
    }

    // New episodes of shows in your library (Stremio's notifications)
    function renderUpNext(tile) {
        return Promise.resolve(window.core && window.core.getState ? window.core.getState('ctx') : null).then(function (ctx) {
            var items = (ctx && ctx.notifications && ctx.notifications.items) || {};
            var latest = Object.keys(items).map(function (metaId) {
                var eps = items[metaId].slice().sort(function (a, b) { return new Date(b.videoReleased) - new Date(a.videoReleased); });
                return eps[0] && { metaId: metaId, videoId: eps[0].videoId, released: eps[0].videoReleased, count: eps.length };
            }).filter(Boolean).sort(function (a, b) { return new Date(b.released) - new Date(a.released); }).slice(0, 3);
            return Promise.all(latest.map(function (n) {
                return seriesMeta(n.metaId).then(function (meta) {
                    return { title: meta.name || n.metaId, poster: meta.poster, sub: episodeLabel(n.videoId) + (n.count > 1 ? ' \u00B7 ' + n.count + ' new' : ' \u00B7 new'),
                        link: '#/detail/series/' + encodeURIComponent(n.metaId) + '/' + encodeURIComponent(n.videoId) };
                });
            }));
        }).then(function (rows) {
            renderList(tile, 'Up Next', 'trend', rows, 'No new episodes for the shows you follow.', ['Open Calendar', '#/calendar']);
        });
    }

    function renderCalendar(tile) {
        var onCalendar = location.hash.indexOf('#/calendar') === 0;
        var action = onCalendar ? null : { action: 'Load', args: { model: 'Calendar', args: null } };
        return loadModel('calendar', action, function (s) { return Array.isArray(s.items) && s.items.length > 0; }).then(function (state) {
            var today = new Date(); today.setHours(0, 0, 0, 0);
            var rows = [];
            ((state && state.items) || []).forEach(function (day) {
                var date = new Date(day.date.year, day.date.month - 1, day.date.day);
                if (date < today) return;
                (day.items || []).forEach(function (it) {
                    var when = date.getTime() === today.getTime() ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
                    rows.push({ title: it.name, poster: it.poster, sub: when + (it.season ? ' \u00B7 S' + it.season + 'E' + it.episode : ''),
                        link: webLink((it.deepLinks || {}).metaDetailsStreams) || detailLink('series', it.id) });
                });
            });
            renderList(tile, 'This Month', 'clock', rows, 'Nothing from your library airs this month.', ['Open Calendar', '#/calendar']);
        });
    }

    function renderNewInLibrary(tile) {
        var onLibrary = location.hash.indexOf('#/library') === 0;
        var action = onLibrary ? null : { action: 'Load', args: { model: 'LibraryWithFilters', args: { request: { type: null } } } };
        return loadModel('library', action, function (s) { return Array.isArray(s.catalog) && s.catalog.length > 0; }).then(function (state) {
            var items = ((state && state.catalog) || []).slice().sort(function (a, b) { return new Date(b._ctime) - new Date(a._ctime); });
            var rows = items.slice(0, 3).map(function (it) {
                var added = it._ctime ? new Date(it._ctime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                var links = it.deepLinks || {};
                return { title: it.name, poster: it.poster, sub: (it.type === 'series' ? 'Series' : 'Movie') + (added ? ' \u00B7 added ' + added : ''),
                    link: webLink(links.metaDetailsVideos || links.metaDetailsStreams) || detailLink(it.type, it._id) };
            });
            renderList(tile, 'Recently Added', 'clock', rows, 'Titles you add to your library show up here.', ['Browse Discover', '#/discover']);
        });
    }

    function renderTrendingMovies(tile) {
        return fetchCatalog('movie').then(function (metas) {
            renderList(tile, 'Popular Movies', 'trend', metas.slice(6, 9).map(function (m) {
                return { title: m.name, poster: m.poster, sub: [m.releaseInfo, (m.genres || [])[0]].filter(Boolean).join(' \u00B7 '),
                    right: m.imdbRating ? '\u2605 ' + m.imdbRating : null, link: detailLink('movie', m.id) };
            }), 'Popular movies are unavailable right now.');
        });
    }

    // ── Tile registry and layout ─────────────────────────────────────────────
    var LAYOUT_KEY = 'sp_widgets_layout';
    var MAX_TILES = 3;
    var TILES = [
        { id: 'continue', title: 'Continue Watching', description: 'What you were watching, with resume', render: function (t) { return continueWatching().then(function (items) { renderContinue(t, items); }); } },
        { id: 'featured', title: 'Featured', description: 'Rotating featured movies', wide: true, className: 'spw-featured',
          render: function (t) { return fetchCatalog('movie').then(function (m) { renderFeatured(t, m); }, function () { renderFeatured(t, []); }); } },
        { id: 'trending', title: 'Trending Series', description: 'Most popular series right now', render: function (t) { return fetchCatalog('series').then(function (m) { renderTrending(t, m); }, function () { renderTrending(t, []); }); } },
        { id: 'upnext', title: 'Up Next', description: 'New episodes of shows you follow', render: renderUpNext },
        { id: 'calendar', title: 'This Month', description: 'Upcoming episodes from your library', render: renderCalendar },
        { id: 'recent', title: 'Recently Added', description: 'Latest titles in your library', render: renderNewInLibrary },
        { id: 'movies', title: 'Popular Movies', description: 'Popular movies right now', render: renderTrendingMovies },
    ];

    function layout() {
        var saved;
        try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch (e) { saved = null; }
        if (!saved || !Array.isArray(saved.order)) saved = { order: ['continue', 'featured', 'trending'], hidden: ['upnext', 'calendar', 'recent', 'movies'] };
        var hidden = (saved.hidden || []).filter(function (id, i, a) { return a.indexOf(id) === i; });
        // Tiles added in later versions start hidden at the end
        TILES.forEach(function (t) {
            if (saved.order.indexOf(t.id) !== -1) return;
            saved.order.push(t.id);
            if (hidden.indexOf(t.id) === -1) hidden.push(t.id);
        });
        return { order: saved.order.slice(), hidden: hidden };
    }

    function visibleTiles() {
        var l = layout();
        return l.order.filter(function (id) { return l.hidden.indexOf(id) === -1; })
            .map(function (id) { return TILES.find(function (t) { return t.id === id; }); })
            .filter(Boolean).slice(0, MAX_TILES);
    }

    var row = null;

    function mount(panel) {
        var style = h('style');
        style.id = 'sp-widgets-style';
        style.textContent = css;
        document.head.appendChild(style);
        row = h('div');
        row.id = 'sp-widgets';
        panel.insertBefore(row, panel.firstChild);
    }

    function refresh() {
        clearInterval(featuredTimer);
        var tiles = visibleTiles();
        row.style.display = tiles.length ? '' : 'none';
        row.style.gridTemplateColumns = tiles.map(function (t) { return t.wide ? '1.25fr' : '1fr'; }).join(' ');
        row.replaceChildren.apply(row, tiles.map(function (t) {
            var el = h('div', 'spw-tile' + (t.className ? ' ' + t.className : ''));
            Promise.resolve(t.render(el)).catch(function () {
                el.replaceChildren(h('div', 'spw-empty', [t.title + ' is unavailable right now.']));
            });
            return el;
        }));
    }

    function start() {
        var overlay = document.getElementById('__st_overlay__');
        var panel = document.getElementById('__st_panel__');
        if (!overlay || !panel) return setTimeout(start, 200);

        mount(panel);

        // Scrolling any list in the menu collapses the row; back at the top it returns
        var COLLAPSE_AT = 24;
        panel.addEventListener('scroll', function (e) {
            var list = e.target;
            if (!list || list === panel || list.id === 'sp-results' || list.id === 'sp-tools') return;
            var aside = row.classList.contains('sp-aside');
            if (!aside && list.scrollTop > COLLAPSE_AT) {
                // Only when there is enough below to stay scrolled once the list grows
                if (list.scrollHeight - list.clientHeight > row.offsetHeight + COLLAPSE_AT) row.classList.add('sp-aside');
            } else if (aside && list.scrollTop <= 0) {
                row.classList.remove('sp-aside');
            }
        }, true);
        // Only the overlay's class is watched, so this costs nothing while the menu is closed
        var wasOpen = false;
        new MutationObserver(function () {
            var nowOpen = isOpen();
            if (nowOpen && !wasOpen) { row.classList.remove('sp-aside'); refresh(); }
            if (!nowOpen) clearInterval(featuredTimer);
            wasOpen = nowOpen;
        }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
        if (isOpen()) refresh();
    }

    window.__spWidgets = {
        max: MAX_TILES,
        tiles: function () { return TILES.map(function (t) { return { id: t.id, title: t.title, description: t.description }; }); },
        layout: layout,
        setLayout: function (l) {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order: l.order, hidden: l.hidden }));
            if (row) refresh();
        },
    };

    start();
})();
