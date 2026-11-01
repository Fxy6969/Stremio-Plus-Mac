// The TV Mode screens, in the style of the Apple TV app: a tab bar at the top
// (Search, Home, Movies, Series, My Stuff), a billboard with the highlighted
// title, rows of landscape cards, title pages with the trailer behind them, and
// a sources panel. tv.js shows this while TV Mode is on the Board or a title's
// page and hands it the remote: move(direction), select(), back(), key(event).
// tv-player.js builds the player on the same focus engine (window.__spTvKit).
(function () {
    if (window.__spTvHome) return;

    var CINEMETA = 'https://v3-cinemeta.strem.io/';
    var METAHUB = 'https://images.metahub.space/';
    var GENRES = {
        movie: ['Action', 'Comedy', 'Drama', 'Thriller', 'Sci-Fi', 'Animation', 'Horror', 'Romance', 'Documentary'],
        series: ['Drama', 'Comedy', 'Crime', 'Sci-Fi', 'Animation', 'Reality-TV', 'Documentary', 'Mystery'],
    };

    var ICONS = {
        search: '<circle cx="10.75" cy="10.75" r="6.25"/><path d="m15.4 15.4 4.6 4.6"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
        exit: '<path d="M14 5h4a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 19h-4M10 8l-4 4 4 4M6 12h9"/>',
        play: '<path fill="currentColor" stroke="none" d="M7 4.9v14.2c0 .9 1 1.4 1.7.9l11-7.1c.7-.4.7-1.4 0-1.8l-11-7.1C8 3.5 7 4 7 4.9z"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10 9.5v5l4-2.5z"/>',
        back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    };
    var TABS = [
        { id: 'search', icon: 'search', label: 'Search' },
        { id: 'home', label: 'Home' },
        { id: 'movie', label: 'Movies' },
        { id: 'series', label: 'Series' },
        { id: 'library', label: 'My Stuff' },
        { id: 'settings', icon: 'settings', label: 'Settings' },
        { id: 'exit', icon: 'exit', label: 'Exit TV Mode' },
    ];
    var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
    var DIGITS = '1234567890'.split('');

    // ── Helpers ──────────────────────────────────────────────────────────────
    function h(tag, cls, text) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }
    function svg(name) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
    }
    function button(cls, label, icon) {
        var b = h('button', cls);
        if (icon) b.innerHTML = svg(icon);
        if (label != null) b.appendChild(h('span', null, label));
        return b;
    }
    function getState(name) {
        return Promise.resolve(window.core && window.core.getState ? window.core.getState(name) : null).catch(function () { return null; });
    }
    function webLink(link) { return link && link.indexOf('stremio:///') === 0 ? '#/' + link.slice(11) : link; }
    function go(link) { if (link) location.hash = link.replace(/^#/, ''); }
    function pointerActive() { return !document.documentElement.classList.contains('sp-tv-idle'); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function coreAction(action, args) {
        if (window.core && window.core.dispatch) window.core.dispatch({ action: 'Ctx', args: { action: action, args: args } });
    }

    // ── Focus engine ─────────────────────────────────────────────────────────
    // A screen is rows of focusable items. Rows remember their position; a
    // sliding row moves so the focused card leads; the track scrolls so the
    // focused row sits where the screen's anchor() says.
    var focusedEl = null;
    function setFocusEl(el) {
        if (focusedEl === el) return;
        if (focusedEl) focusedEl.classList.remove('tvui-focus');
        focusedEl = el;
        if (el) { el.classList.add('tvui-focus'); el.focus({ preventScroll: true }); }
    }

    function Screen(options) {
        this.track = options.track || null;
        this.anchor = options.anchor || function () { return 0; };
        this.onFocus = options.onFocus || function () {};
        this.hidePast = !!options.hidePast;
        this.rows = [];
        this.rowIndex = 0;
        this.cols = {};
    }
    Screen.prototype.rowTop = function (i) {
        var row = this.rows[i];
        return row && this.track ? row.el.getBoundingClientRect().top - this.track.getBoundingClientRect().top : 0;
    };
    Screen.prototype.setRows = function (rows) {
        var id = this.rows[this.rowIndex] && this.rows[this.rowIndex].id;
        this.rows = rows.filter(function (r) { return r.items.length; });
        var again = this.rows.findIndex(function (r) { return r.id === id; });
        if (again >= 0) this.rowIndex = again;
        this.rowIndex = clamp(this.rowIndex, 0, Math.max(0, this.rows.length - 1));
        var self = this;
        this.rows.forEach(function (row) {
            row.items.forEach(function (item, col) {
                if (item.__hoverBound) return;
                item.__hoverBound = true;
                item.addEventListener('mouseenter', function () {
                    if (!pointerActive() || !self.active) return;
                    var r = self.rows.indexOf(row);
                    if (r < 0) return;
                    self.rowIndex = r;
                    self.cols[row.id] = row.items.indexOf(item);
                    self.focus(true);
                });
            });
        });
    };
    Screen.prototype.item = function () {
        var row = this.rows[this.rowIndex];
        if (!row) return null;
        var col = clamp(this.cols[row.id] || 0, 0, row.items.length - 1);
        this.cols[row.id] = col;
        return row.items[col];
    };
    Screen.prototype.focus = function (fromPointer) {
        var el = this.item();
        setFocusEl(el);
        this.layout(fromPointer);
        if (el) this.onFocus(el, this.rows[this.rowIndex], this);
    };
    Screen.prototype.move = function (dir) {
        var row = this.rows[this.rowIndex];
        if (!row) return false;
        var col = this.cols[row.id] || 0;
        if (dir === 'left' || dir === 'right') {
            var next = col + (dir === 'right' ? 1 : -1);
            if (next < 0 || next >= row.items.length) return false;
            this.cols[row.id] = next;
        } else {
            var ni = this.rowIndex + (dir === 'down' ? 1 : -1);
            if (ni < 0 || ni >= this.rows.length) return false;
            var target = this.rows[ni];
            if (!target.remember || this.cols[target.id] === undefined) {
                // The item straight above or below
                var from = row.items[col].getBoundingClientRect();
                var cx = from.left + from.width / 2, best = 0, bestDist = Infinity;
                target.items.forEach(function (el, i) {
                    var r = el.getBoundingClientRect();
                    var d = Math.abs(r.left + r.width / 2 - cx);
                    if (d < bestDist) { bestDist = d; best = i; }
                });
                if (target.slide && this.cols[target.id] === undefined) best = 0;
                this.cols[target.id] = best;
            }
            this.rowIndex = ni;
        }
        this.focus();
        return true;
    };
    Screen.prototype.layout = function (fromPointer) {
        var self = this;
        this.rows.forEach(function (row, i) {
            if (row.el) {
                row.el.classList.toggle('active', i === self.rowIndex);
                if (self.hidePast && !row.fixed) row.el.classList.toggle('past', i < self.rowIndex);
            }
            if (!row.slide || fromPointer) return;
            var col = self.cols[row.id] || 0;
            var first = row.items[0], target = row.items[col], last = row.items[row.items.length - 1];
            var shift = target.offsetLeft - first.offsetLeft;
            var room = row.strip.parentElement.getBoundingClientRect().width - 60;
            shift = clamp(shift, 0, Math.max(0, last.offsetLeft + last.offsetWidth - first.offsetLeft - room));
            row.strip.style.transform = 'translateX(' + (-shift) + 'px)';
            row.items.forEach(function (card) { card.classList.toggle('gone', card.offsetLeft - first.offsetLeft < shift - 4); });
        });
        if (this.track) this.track.style.transform = 'translateY(' + (-Math.max(0, this.anchor(this.rowIndex, this))) + 'px)';
    };

    // ── Titles ───────────────────────────────────────────────────────────────
    function linksOf(m, category) {
        return (m.links || []).filter(function (l) { return l.category === category; }).map(function (l) { return l.name; });
    }
    function title(m, extra) {
        var id = m.id || m._id;
        var imdb = /^tt\d+$/.test(id);
        return Object.assign({
            id: id, type: m.type, name: m.name,
            background: m.background || (imdb ? METAHUB + 'background/medium/' + id + '/img' : m.poster),
            poster: m.poster || (imdb ? METAHUB + 'poster/medium/' + id + '/img' : null),
            logo: m.logo || (imdb ? METAHUB + 'logo/medium/' + id + '/img' : null),
            description: m.description || '',
            year: m.releaseInfo || (m.released ? String(m.released).slice(0, 4) : ''),
            runtime: m.runtime || '',
            genres: linksOf(m, 'Genres').concat(m.genres || []).slice(0, 2),
            rating: linksOf(m, 'imdb')[0] || m.imdbRating || '',
            progress: 0,
            link: '#/detail/' + m.type + '/' + encodeURIComponent(id),
        }, extra || {});
    }

    var fetched = {};
    function fetchMetas(url) {
        if (!fetched[url]) {
            fetched[url] = fetch(url).then(function (r) { return r.json(); })
                .then(function (d) { return (d.metas || []).map(function (m) { return title(m); }); })
                .catch(function () { delete fetched[url]; return []; });
        }
        return fetched[url];
    }

    function continueWatching() {
        return getState('continue_watching_preview').then(function (s) {
            return ((s && s.items) || []).map(function (item) {
                var st = item.state || {};
                var links = item.deepLinks || {};
                return title(item, {
                    progress: st.duration ? Math.min(1, st.timeOffset / st.duration) : 0,
                    link: webLink(links.player || links.metaDetailsVideos || links.metaDetailsStreams) || '#/detail/' + item.type + '/' + item._id,
                });
            });
        });
    }

    // ── Browse data ──────────────────────────────────────────────────────────
    function homeRows() {
        return Promise.all([continueWatching(), getState('board')]).then(function (r) {
            var rows = [], loading = false;
            if (r[0].length) rows.push({ id: 'continue', title: 'Continue Watching', items: r[0] });
            ((r[1] && r[1].catalogs) || []).forEach(function (c, i) {
                var content = c.content;
                if (!content || content.type !== 'Ready') { loading = loading || !content || content.type === 'Loading'; return; }
                var items = (content.content || []).slice(0, 24).map(function (m) { return title(m); });
                var kind = c.type === 'movie' ? 'Movies' : c.type === 'series' ? 'Series' : c.type ? c.type.charAt(0).toUpperCase() + c.type.slice(1) : '';
                if (items.length) rows.push({ id: 'board-' + i + '-' + c.id, title: c.name + (kind ? ' ' + kind : ''), items: items });
            });
            return { rows: rows, loading: loading };
        });
    }
    function typeRows(type) {
        var defs = [{ id: 'popular', title: 'Popular', url: CINEMETA + 'catalog/' + type + '/top.json' },
            { id: 'rated', title: 'Top Rated', url: CINEMETA + 'catalog/' + type + '/imdbRating.json' }]
            .concat(GENRES[type].map(function (g) { return { id: 'genre-' + g, title: g, url: CINEMETA + 'catalog/' + type + '/top/genre=' + encodeURIComponent(g) + '.json' }; }));
        return Promise.all(defs.map(function (d) { return fetchMetas(d.url); })).then(function (lists) {
            return { rows: defs.map(function (d, i) { return { id: d.id, title: d.title, items: lists[i].slice(0, 30) }; }) };
        });
    }
    function libraryRows() {
        return Promise.all([continueWatching(), getState('library')]).then(function (r) {
            var saved = ((r[1] && r[1].catalog) || []).filter(function (i) { return !i.removed && !i.temp; })
                .sort(function (a, b) { return String(b._mtime).localeCompare(String(a._mtime)); })
                .map(function (i) { return title(i); });
            var rows = [];
            if (r[0].length) rows.push({ id: 'continue', title: 'Continue Watching', items: r[0] });
            rows.push({ id: 'lib-movies', title: 'Movies', items: saved.filter(function (i) { return i.type === 'movie'; }) });
            rows.push({ id: 'lib-series', title: 'Series', items: saved.filter(function (i) { return i.type === 'series'; }) });
            rows.push({ id: 'lib-other', title: 'Other', items: saved.filter(function (i) { return i.type !== 'movie' && i.type !== 'series'; }) });
            return { rows: rows.filter(function (x) { return x.items.length; }), empty: 'Titles you add to your Library appear here. Sign in to Stremio to keep them on all your devices.' };
        });
    }
    var query = '';
    function searchRows() {
        var q = query.trim();
        if (q.length < 2) return Promise.resolve({ rows: [], empty: '' });
        var extra = 'search=' + encodeURIComponent(q);
        return Promise.all(['movie', 'series'].map(function (type) {
            return fetch(CINEMETA + 'catalog/' + type + '/top/' + extra + '.json').then(function (r) { return r.json(); })
                .then(function (d) { return (d.metas || []).map(function (m) { return title(m); }); }).catch(function () { return []; });
        })).then(function (r) {
            // Top Results: the best of both kinds, then each kind
            var top = [];
            for (var i = 0; i < 6; i++) { if (r[0][i]) top.push(r[0][i]); if (r[1][i]) top.push(r[1][i]); }
            return {
                rows: [{ id: 'top', title: 'Top Results', items: top.slice(0, 8) }, { id: 'movies', title: 'Movies', items: r[0] }, { id: 'series', title: 'Series', items: r[1] }]
                    .filter(function (x) { return x.items.length; }),
                empty: 'No results for “' + q + '”.',
            };
        });
    }

    // ── Elements ─────────────────────────────────────────────────────────────
    var root, backA, backB, frontLayer, trailerBox, tabsBar, browseEl, billboard, rowsBox, browseTrack, emptyNote;
    var detailEl, detailTrack, sheetEl, sheetTrack, sheetHead, backButton;

    function makeCard(t) {
        var card = h('button', 'tvui-card');
        card.setAttribute('aria-label', t.name);
        var art = h('div', 'tvui-card-art');
        var images = [t.background, t.poster].filter(Boolean);
        if (images.length) {
            var bg = h('img', 'tvui-card-bg');
            bg.alt = ''; bg.loading = 'lazy'; bg.src = images.shift();
            bg.addEventListener('error', function () { if (images.length) bg.src = images.shift(); else bg.remove(); });
            art.appendChild(bg);
        }
        if (t.logo) {
            var logo = h('img', 'tvui-card-logo');
            logo.alt = ''; logo.loading = 'lazy'; logo.src = t.logo;
            logo.addEventListener('error', function () { logo.replaceWith(h('div', 'tvui-card-name', t.name)); });
            art.appendChild(logo);
        } else art.appendChild(h('div', 'tvui-card-name', t.name));
        if (t.progress > 0) {
            var bar = h('div', 'tvui-card-progress');
            bar.style.setProperty('--p', Math.round(t.progress * 100) + '%');
            art.appendChild(bar);
        }
        card.appendChild(art);
        card.__title = t;
        card.addEventListener('click', function () { go(t.link); });
        return card;
    }

    function cardRow(id, label, items) {
        var el = h('section', 'tvui-row');
        if (label) el.appendChild(h('h2', 'tvui-row-title', label));
        var strip = h('div', 'tvui-strip');
        var cards = items.map(function (t) { var c = makeCard(t); strip.appendChild(c); return c; });
        el.appendChild(strip);
        return { id: id, el: el, strip: strip, items: cards, data: items, slide: true, remember: true };
    }

    function build() {
        root = h('div');
        root.id = 'sp-tvui';

        var backdrop = h('div', 'tvui-backdrop');
        backA = h('img'); backB = h('img'); backA.alt = backB.alt = '';
        trailerBox = h('div', 'tvui-trailer');
        backdrop.append(backA, backB, trailerBox, h('div', 'tvui-shade'));
        frontLayer = backA;

        // Tab bar
        tabsBar = h('nav', 'tvui-tabs');
        var tabsInner = h('div', 'tvui-tabs-inner');
        TABS.forEach(function (t) {
            var b = button('tvui-tab' + (t.icon ? ' icon' : ''), t.icon ? null : t.label, t.icon);
            if (t.icon) b.setAttribute('aria-label', t.label);
            b.dataset.tab = t.id;
            b.addEventListener('click', function () { chooseTab(t.id, true); });
            tabsInner.appendChild(b);
        });
        tabsBar.appendChild(tabsInner);

        // Browse
        browseEl = h('div', 'tvui-browse');
        billboard = h('section', 'tvui-billboard');
        rowsBox = h('div', 'tvui-rows');
        browseTrack = h('div', 'tvui-track');
        emptyNote = h('div', 'tvui-empty');
        rowsBox.append(browseTrack, emptyNote);
        browseEl.append(billboard, rowsBox);

        // Title page
        detailEl = h('div', 'tvui-detail');
        detailTrack = h('div', 'tvui-dtrack');
        detailEl.appendChild(detailTrack);

        // Sources panel
        sheetEl = h('div', 'tvui-sheet');
        var panel = h('div', 'tvui-sheet-panel');
        sheetHead = h('div', 'tvui-sheet-head');
        var listBox = h('div', 'tvui-sheet-list');
        sheetTrack = h('div', 'tvui-sheet-track');
        listBox.appendChild(sheetTrack);
        panel.append(sheetHead, listBox);
        sheetEl.appendChild(panel);
        sheetEl.addEventListener('click', function (e) { if (e.target === sheetEl) history.back(); });

        backButton = button('tvui-backbtn', null, 'back');
        backButton.setAttribute('aria-label', 'Back');
        backButton.addEventListener('click', function () { history.back(); });

        root.append(backdrop, browseEl, detailEl, tabsBar, backButton, sheetEl);
        document.body.appendChild(root);

        var style = h('style');
        style.id = 'sp-tvui-style';
        style.textContent = CSS;
        document.head.appendChild(style);

        browse.track = browseTrack;
        detail.track = detailTrack;
        sheet.track = sheetTrack;
    }

    // ── Backdrop ─────────────────────────────────────────────────────────────
    var backdropUrl = null;
    function setBackdrop(url) {
        url = url ? String(url).replace('/background/medium/', '/background/large/') : '';
        if (url === backdropUrl) return;
        backdropUrl = url;
        if (!url) { backA.classList.remove('on'); backB.classList.remove('on'); return; }
        var next = frontLayer === backA ? backB : backA;
        next.onload = function () { if (backdropUrl !== url) return; next.classList.add('on'); frontLayer.classList.remove('on'); frontLayer = next; };
        next.onerror = function () { if (backdropUrl === url) frontLayer.classList.remove('on'); };
        next.src = url;
    }

    // Muted trailer behind a title page, faded in once it plays
    var trailer = null;
    function startTrailer(ytId) {
        stopTrailer();
        if (!ytId || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var frame = h('iframe');
        frame.allow = 'autoplay; encrypted-media';
        frame.tabIndex = -1;
        frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(ytId) +
            '?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
        var onMessage = function (e) {
            if (e.source !== frame.contentWindow) return;
            var data;
            try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
            var state = data && data.info && data.info.playerState;
            // Wait out YouTube's title overlay before showing it
            if (state === 1) setTimeout(function () { if (trailer && trailer.frame === frame) trailerBox.classList.add('on'); }, 2000);
            if (state === 0) trailerBox.classList.remove('on');
        };
        window.addEventListener('message', onMessage);
        frame.addEventListener('load', function () {
            if (frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
        });
        trailerBox.appendChild(frame);
        trailer = { frame: frame, onMessage: onMessage };
    }
    function stopTrailer() {
        if (!trailer) return;
        window.removeEventListener('message', trailer.onMessage);
        trailer.frame.remove();
        trailer = null;
        trailerBox.classList.remove('on');
    }

    // ── Browse screen ────────────────────────────────────────────────────────
    var view = 'home';
    var viewMemory = {};
    var renderToken = 0;
    var searchHead = null, searchField = null;
    var tabTimer = null;

    var browse = new Screen({
        hidePast: true,
        // Row 0 is the tab bar (not in the track); rows below scroll up to
        // where the first content row sits. In Search the keyboard stays until
        // the results are reached.
        anchor: function (i, s) {
            if (i <= 1) return 0;
            if (view === 'search') {
                var firstResult = s.rows.findIndex(function (r) { return !r.fixed && !r.keys; });
                if (firstResult < 0 || i < firstResult) return 0;
            }
            return s.rowTop(i) - s.rowTop(1);
        },
        onFocus: function (el, row) {
            root.classList.toggle('tvui-tabs-hidden', !row.fixed);
            if (searchHead) searchHead.classList.toggle('past', view === 'search' && !row.fixed && !row.keys);
            if (!row.fixed) browse.cols.tabs = TABS.findIndex(function (t) { return t.id === view; });
            if (row.fixed) {
                var tab = el.dataset.tab;
                // Focusing a tab shows it, as on Apple TV
                if (tab && tab !== 'settings' && tab !== 'exit') { clearTimeout(tabTimer); tabTimer = setTimeout(function () { chooseTab(tab, false); }, 300); }
                return;
            }
            if (el.__title) scheduleBillboard(el.__title);
        },
    });

    function tabsRow() {
        return { id: 'tabs', el: tabsBar, items: Array.prototype.slice.call(tabsBar.querySelectorAll('.tvui-tab')), fixed: true, remember: true };
    }

    function chooseTab(id, selected) {
        if (id === 'exit') { if (window.stremioPlusShell && window.stremioPlusShell.tvMode) window.stremioPlusShell.tvMode.exit(); return; }
        if (id === 'settings') { if (selected) go('#/settings'); return; }
        if (view !== id) {
            viewMemory[view] = { rowIndex: browse.rowIndex, cols: browse.cols };
            view = id;
            var memory = viewMemory[id] || { rowIndex: 0, cols: {} };
            browse.cols = memory.cols;
            browse.cols.tabs = TABS.findIndex(function (t) { return t.id === id; });
            renderBrowse(true);
        }
        // Choosing a tab with the remote goes down into it
        if (selected && browse.rows.length > 1) { browse.rowIndex = 1; browse.focus(); }
    }

    function renderBrowse(reset) {
        var token = ++renderToken;
        root.dataset.view = view;
        // Moving up into the tab bar lands on the current tab
        if (browse.rowIndex !== 0) browse.cols.tabs = TABS.findIndex(function (t) { return t.id === view; });
        tabsBar.querySelectorAll('.tvui-tab').forEach(function (b) { b.classList.toggle('current', b.dataset.tab === view); });
        if (reset) emptyNote.textContent = '';
        if (view === 'search') { clearBillboard(); setBackdrop(null); }
        if (reset) {
            if (view === 'search') setBrowseRows([], true);
            else { browseTrack.replaceChildren(); browse.rows = browse.rows.length ? [tabsRow()] : []; }
        }
        var load = view === 'home' ? homeRows() : view === 'movie' || view === 'series' ? typeRows(view) : view === 'library' ? libraryRows() : searchRows();
        load.then(function (result) {
            if (token !== renderToken) return;
            setBrowseRows(result.rows, false);
            if (!result.rows.length && !result.loading && view !== 'search') { clearBillboard(); setBackdrop(null); }
            emptyNote.textContent = result.rows.length ? '' : (result.loading ? '' : result.empty || '');
            // Stremio fills the Board a moment after it opens
            if (result.loading && view === 'home') setTimeout(function () { if (token === renderToken && shown && mode === 'browse') renderBrowse(false); }, 900);
            if (shown && mode === 'browse') browse.focus();
        });
    }

    // Search: the query, then one line of letters and one of digits (Apple TV)
    function keyRows() {
        if (!searchHead) {
            searchHead = h('div', 'tvui-search-head');
            searchField = h('div', 'tvui-search-field');
            searchHead.appendChild(searchField);
        }
        renderQuery();
        return [
            { id: 'keys-letters', keys: LETTERS.concat(['space', 'delete']) },
            { id: 'keys-digits', keys: DIGITS.concat(['clear']) },
        ].map(function (line) {
            var el = h('div', 'tvui-row tvui-keys');
            var strip = h('div', 'tvui-strip');
            var items = line.keys.map(function (k) {
                var label = k === 'space' ? 'Space' : k === 'delete' ? '⌫' : k === 'clear' ? 'Clear' : k;
                var b = h('button', 'tvui-key' + (k.length > 1 ? ' wide' : ''), label);
                if (k === 'delete') b.setAttribute('aria-label', 'Delete');
                b.addEventListener('click', function () { typeKey(k); });
                strip.appendChild(b);
                return b;
            });
            el.appendChild(strip);
            return { id: line.id, el: el, strip: strip, items: items, keys: true };
        });
    }
    function renderQuery() {
        if (!searchField) return;
        searchField.textContent = query || 'Movies and series';
        searchField.classList.toggle('placeholder', !query);
    }
    function typeKey(k) {
        if (k === 'space') query += ' ';
        else if (k === 'delete') query = query.slice(0, -1);
        else if (k === 'clear') query = '';
        else query += k;
        searchChanged();
    }
    var searchTimer = null;
    function searchChanged() {
        renderQuery();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { if (view === 'search') renderBrowse(false); }, 450);
    }

    var keyRowsCache = null;
    function setBrowseRows(data, keysOnly) {
        browseTrack.replaceChildren();
        var rows = [tabsRow()];
        if (view === 'search') {
            if (!keyRowsCache) keyRowsCache = keyRows();
            renderQuery();
            browseTrack.appendChild(searchHead);
            keyRowsCache.forEach(function (r) { browseTrack.appendChild(r.el); rows.push(r); });
        }
        if (!keysOnly) data.forEach(function (d) {
            var r = cardRow(d.id, d.title, d.items);
            browseTrack.appendChild(r.el);
            rows.push(r);
        });
        if (view === 'search') browseTrack.appendChild(emptyNote); else rowsBox.appendChild(emptyNote);
        emptyNote.classList.toggle('inline', view === 'search');
        browse.setRows(rows);
    }

    // ── Billboard ────────────────────────────────────────────────────────────
    var billboardTimer = null, billboardFor = null;
    function scheduleBillboard(t) {
        clearTimeout(billboardTimer);
        billboardTimer = setTimeout(function () { showBillboard(t); }, 160);
    }
    function clearBillboard() {
        billboardFor = null;
        clearTimeout(billboardTimer);
        Array.prototype.forEach.call(billboard.children, function (old) { old.classList.remove('in'); setTimeout(function () { old.remove(); }, 350); });
    }
    function metaLine(t) {
        var meta = h('div', 'tvui-meta');
        if (t.rating) { var r = h('span', 'tvui-rating'); r.append(h('b', null, 'IMDb'), document.createTextNode(' ' + t.rating)); meta.appendChild(r); }
        [t.year, t.runtime, t.genres.join(' · '), t.type === 'series' ? 'Series' : t.type === 'movie' ? 'Movie' : '']
            .filter(Boolean).forEach(function (x) { meta.appendChild(h('span', null, x)); });
        return meta;
    }
    function titleArt(t, cls) {
        if (!t.logo) return h('h1', cls + '-title', t.name);
        var logo = h('img', cls + '-logo');
        logo.alt = t.name; logo.src = t.logo;
        logo.addEventListener('error', function () { logo.replaceWith(h('h1', cls + '-title', t.name)); });
        return logo;
    }
    function showBillboard(t) {
        if (!t || billboardFor === t || view === 'search' || mode !== 'browse') return;
        billboardFor = t;
        setBackdrop(t.background);
        var content = h('div', 'tvui-bb-content');
        content.appendChild(titleArt(t, 'tvui-bb'));
        content.appendChild(metaLine(t));
        if (t.description) content.appendChild(h('p', 'tvui-bb-desc', t.description));
        if (t.progress > 0) {
            var p = h('div', 'tvui-bb-progress');
            p.style.setProperty('--p', Math.round(t.progress * 100) + '%');
            content.appendChild(p);
        }
        // Fade out every earlier billboard (moving quickly can leave several)
        Array.prototype.forEach.call(billboard.children, function (old) {
            if (old.dataset.leaving) return;
            old.dataset.leaving = '1';
            old.classList.remove('in');
            setTimeout(function () { old.remove(); }, 350);
        });
        billboard.appendChild(content);
        requestAnimationFrame(function () { requestAnimationFrame(function () { if (content.isConnected) content.classList.add('in'); }); });
    }

    // ── Title page ───────────────────────────────────────────────────────────
    var detailKey = null, detailToken = 0, currentMeta = null, currentTrailerId = null;
    var seasonTimer = null, shownSeason = null, episodesRow = null;
    var detail = new Screen({
        // The actions sit in the hero; rows below scroll up to a third of the way down
        anchor: function (i, s) { return i === 0 ? 0 : s.rowTop(i) - window.innerHeight * 0.3; },
        onFocus: function (el, row) {
            if (row.id === 'seasons' && el.dataset.season !== String(shownSeason)) {
                clearTimeout(seasonTimer);
                seasonTimer = setTimeout(function () { showSeason(Number(el.dataset.season)); }, 250);
            }
        },
    });

    function parseRoute() {
        var m = /^#\/detail\/([^/?]+)\/([^/?]+)(?:\/([^/?]+))?/.exec(location.hash);
        return m ? { type: m[1], id: decodeURIComponent(m[2]), videoId: m[3] ? decodeURIComponent(m[3]) : null } : null;
    }

    function loadDetails(r, attempt) {
        return getState('meta_details').then(function (state) {
            var item = state && state.metaItem && state.metaItem.content;
            if (item && item.type === 'Ready' && item.content && item.content.id === r.id) return { meta: item.content, library: state.libraryItem && !state.libraryItem.removed ? state.libraryItem : null };
            if ((attempt || 0) > 40) return null;
            return new Promise(function (res) { setTimeout(res, 250); }).then(function () { return loadDetails(r, (attempt || 0) + 1); });
        });
    }

    function sortedEpisodes(meta) {
        return (meta.videos || []).slice().sort(function (a, b) { return (a.season || 9999) - (b.season || 9999) || (a.episode || 0) - (b.episode || 0); });
    }
    function released(v) { return !v.released || new Date(v.released) <= new Date(); }
    function progressOf(v) {
        if (typeof v.progress !== 'number' || v.progress <= 0) return 0;
        return Math.min(1, v.progress > 1 ? v.progress / 100 : v.progress);
    }
    function epLabel(v) { return v.season ? 'S' + v.season + ' E' + v.episode : 'E' + v.episode; }
    function nextUp(meta, library) {
        var eps = sortedEpisodes(meta).filter(function (v) { return v.season !== 0; });
        if (!eps.length) return null;
        var lastId = library && library.state && library.state.video_id;
        var i = lastId ? eps.findIndex(function (v) { return v.id === lastId; }) : -1;
        if (i < 0) for (var k = eps.length - 1; k >= 0; k--) if (eps[k].watched || progressOf(eps[k])) { i = k; break; }
        if (i < 0) return { video: eps.find(released) || eps[0], label: 'Play' };
        var cur = eps[i];
        if (!cur.watched && progressOf(cur) > 0 && progressOf(cur) < 0.92) return { video: cur, label: 'Resume ' + epLabel(cur) };
        var next = eps.slice(i + 1).find(released);
        return next ? { video: next, label: 'Play ' + epLabel(next) } : { video: cur, label: 'Play Again' };
    }
    function episodeLink(meta, v) {
        return (v.deepLinks && v.deepLinks.metaDetailsStreams) || '#/detail/' + meta.type + '/' + encodeURIComponent(meta.id) + '/' + encodeURIComponent(v.id);
    }

    function renderDetail(r) {
        var token = ++detailToken;
        var key = r.type + '/' + r.id;
        if (detailKey !== key) {
            detailKey = key;
            detail.rowIndex = 0; detail.cols = {}; detail.rows = [];
            detailTrack.replaceChildren(h('div', 'tvui-loading'));
            stopTrailer();
            currentTrailerId = null;
            setBackdrop(null);
        }
        loadDetails(r).then(function (data) {
            if (token !== detailToken || !data) return;
            currentMeta = data.meta;
            buildDetail(data);
            if (shown && mode === 'detail' && !sheetOpen) detail.focus();
        });
    }

    function buildDetail(data) {
        var meta = data.meta, t = title(meta);
        setBackdrop(t.background);
        detailTrack.replaceChildren();
        var rows = [];

        var hero = h('section', 'tvui-hero');
        var content = h('div', 'tvui-hero-content');
        content.appendChild(titleArt(t, 'tvui-hero'));
        content.appendChild(metaLine(t));
        if (meta.description) content.appendChild(h('p', 'tvui-hero-desc', meta.description));

        var actions = h('div', 'tvui-actions');
        var isSeries = meta.type !== 'movie' && (meta.videos || []).length > 0;
        var up = isSeries ? nextUp(meta, data.library) : null;
        var resumeMovie = !isSeries && data.library && data.library.state && data.library.state.timeOffset > 0;
        var play = button('tvui-btn primary', up ? up.label : resumeMovie ? 'Resume' : 'Play', 'play');
        play.addEventListener('click', function () {
            if (up) go(episodeLink(meta, up.video));
            else go('#/detail/' + meta.type + '/' + encodeURIComponent(meta.id) + '/' + encodeURIComponent(meta.id));
        });
        var inList = !!(meta.inLibrary || data.library);
        var list = button('tvui-btn round', null, inList ? 'check' : 'plus');
        list.setAttribute('aria-label', inList ? 'Remove from Library' : 'Add to Library');
        list.addEventListener('click', function () {
            if (inList) coreAction('RemoveFromLibrary', meta.id);
            else coreAction('AddToLibrary', { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, background: meta.background, logo: meta.logo, posterShape: meta.posterShape || 'poster', links: [], trailerStreams: [], behaviorHints: {} });
            inList = !inList;
            list.innerHTML = svg(inList ? 'check' : 'plus');
            list.setAttribute('aria-label', inList ? 'Remove from Library' : 'Add to Library');
        });
        var items = [play, list];
        var trailerStream = (meta.trailerStreams || [])[0];
        if (trailerStream && trailerStream.deepLinks && trailerStream.deepLinks.player) {
            var tr = button('tvui-btn', 'Trailer', 'film');
            tr.addEventListener('click', function () { go(trailerStream.deepLinks.player); });
            items.push(tr);
        }
        items.forEach(function (b) { actions.appendChild(b); });
        content.appendChild(actions);
        var cast = linksOf(meta, 'Cast').concat(meta.cast || []);
        if (cast.length) {
            var c = h('p', 'tvui-hero-cast');
            c.append(h('b', null, 'Starring '), document.createTextNode(Array.from(new Set(cast)).slice(0, 4).join(', ')));
            content.appendChild(c);
        }
        hero.appendChild(content);
        detailTrack.appendChild(hero);
        rows.push({ id: 'actions', el: hero, items: items });

        if (isSeries) {
            var eps = sortedEpisodes(meta);
            var seasons = Array.from(new Set(eps.map(function (v) { return v.season || 0; })));
            var seasonsEl = h('section', 'tvui-row tvui-seasons');
            seasonsEl.appendChild(h('h2', 'tvui-row-title', 'Episodes'));
            var seasonStrip = h('div', 'tvui-strip tvui-pills');
            var seasonButtons = seasons.map(function (s) {
                var b = h('button', 'tvui-pill', s ? 'Season ' + s : 'Specials');
                b.dataset.season = s;
                b.addEventListener('click', function () { showSeason(s); });
                seasonStrip.appendChild(b);
                return b;
            });
            seasonsEl.appendChild(seasonStrip);
            detailTrack.appendChild(seasonsEl);
            if (seasons.length > 1) rows.push({ id: 'seasons', el: seasonsEl, strip: seasonStrip, items: seasonButtons, remember: true });

            episodesRow = { id: 'episodes', el: h('section', 'tvui-row tvui-episodes'), strip: h('div', 'tvui-strip'), items: [], slide: true, remember: true };
            episodesRow.el.appendChild(episodesRow.strip);
            detailTrack.appendChild(episodesRow.el);
            rows.push(episodesRow);
            var startSeason = up && up.video ? up.video.season || 0 : seasons[0];
            if (detail.cols.seasons === undefined) detail.cols.seasons = Math.max(0, seasons.indexOf(startSeason));
            var season = seasons[detail.cols.seasons] !== undefined ? seasons[detail.cols.seasons] : startSeason;
            fillSeason(meta, season, season === startSeason && up && up.video, true);
        }

        var about = h('section', 'tvui-about');
        about.appendChild(h('h2', 'tvui-row-title', 'About'));
        var grid = h('div', 'tvui-about-grid');
        [['Genres', linksOf(meta, 'Genres').concat(meta.genres || [])], ['Starring', cast],
            [meta.type === 'movie' ? 'Directed by' : 'Created by', linksOf(meta, 'Directors').concat(meta.director || [])],
            ['Written by', linksOf(meta, 'Writers').concat(meta.writer || [])]]
            .map(function (x) { return [x[0], Array.from(new Set(x[1]))]; }).filter(function (x) { return x[1].length; })
            .forEach(function (x) {
                var cell = h('div');
                cell.append(h('div', 'tvui-about-label', x[0]), h('div', 'tvui-about-value', x[1].slice(0, 6).join(', ')));
                grid.appendChild(cell);
            });
        about.appendChild(grid);
        detailTrack.appendChild(about);

        detail.setRows(rows);
        currentTrailerId = (meta.trailerStreams || []).map(function (s) { return s.ytId; }).filter(Boolean)[0] || null;
        if (!sheetOpen && !trailer) startTrailer(currentTrailerId);
    }

    function fillSeason(meta, season, focusVideo, keepCol) {
        shownSeason = season;
        var eps = sortedEpisodes(meta).filter(function (v) { return (v.season || 0) === season; });
        episodesRow.strip.replaceChildren();
        episodesRow.items = eps.map(function (v) {
            var card = h('button', 'tvui-ep');
            var thumb = h('div', 'tvui-ep-thumb');
            var img = h('img');
            img.alt = ''; img.loading = 'lazy'; img.src = v.thumbnail || meta.background || '';
            img.addEventListener('error', function () { img.remove(); });
            thumb.appendChild(img);
            var p = progressOf(v);
            if (p > 0 && !v.watched) { var bar = h('div', 'tvui-card-progress'); bar.style.setProperty('--p', Math.round(p * 100) + '%'); thumb.appendChild(bar); }
            if (v.watched) thumb.appendChild(h('div', 'tvui-ep-watched', '✓'));
            card.appendChild(thumb);
            card.appendChild(h('div', 'tvui-ep-kicker', epLabel(v) + (v.released ? ' · ' + new Date(v.released).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')));
            card.appendChild(h('div', 'tvui-ep-title', v.title || v.name || 'Episode ' + v.episode));
            if (v.overview || v.description) card.appendChild(h('div', 'tvui-ep-desc', v.overview || v.description));
            if (!released(v)) card.classList.add('upcoming');
            card.addEventListener('click', function () { go(episodeLink(meta, v)); });
            episodesRow.strip.appendChild(card);
            return card;
        });
        var i = focusVideo ? eps.indexOf(focusVideo) : -1;
        if (!keepCol || detail.cols.episodes === undefined || i >= 0) detail.cols.episodes = Math.max(0, i);
        episodesRow.strip.style.transform = '';
        if (detail.rows.length) { detail.setRows(detail.rows); detail.layout(); }
    }
    function showSeason(season) {
        if (!currentMeta || season === shownSeason) return;
        fillSeason(currentMeta, season, null, false);
        if (shown && mode === 'detail' && !sheetOpen) detail.focus();
    }

    // ── Sources panel ────────────────────────────────────────────────────────
    var sheetOpen = false, sheetToken = 0, sheetKey = null;
    var sheet = new Screen({
        anchor: function (i, s) { return s.rowTop(i) - sheetTrack.parentElement.clientHeight * 0.35; },
    });

    function streamLines(s, addon) {
        var name = String(s.name || addon || 'Source').split('\n').filter(Boolean);
        var desc = String(s.description || s.title || '').split('\n').filter(Boolean);
        return { name: name.join(' · '), desc: desc.slice(0, 3) };
    }

    function renderSheet(r) {
        var token = ++sheetToken;
        var key = r.type + '/' + r.id + '/' + r.videoId;
        if (sheetKey !== key) { sheetKey = key; sheet.rowIndex = 0; sheet.cols = {}; sheet.rows = []; sheetTrack.replaceChildren(h('div', 'tvui-sheet-note', 'Looking for sources…')); sheetHead.replaceChildren(h('div', 'tvui-sheet-title', 'Choose a Source')); }
        var started = Date.now();
        var poll = function () {
            getState('meta_details').then(function (state) {
                if (token !== sheetToken) return;
                var meta = state && state.metaItem && state.metaItem.content && state.metaItem.content.content;
                if (!meta || meta.id !== r.id) { if (Date.now() - started < 15000) setTimeout(poll, 300); return; }
                var video = (meta.videos || []).find(function (v) { return v.id === r.videoId; });
                sheetHead.replaceChildren(h('div', 'tvui-sheet-title', 'Choose a Source'),
                    h('div', 'tvui-sheet-sub', video ? meta.name + ' · ' + epLabel(video) + (video.title ? ' · ' + video.title : '') : meta.name));
                var groups = (state && state.streams) || [];
                var loading = groups.some(function (g) { return g.content && g.content.type === 'Loading'; });
                var streams = [];
                groups.forEach(function (g) {
                    if (!g.content || g.content.type !== 'Ready') return;
                    var addon = g.addon && g.addon.manifest && g.addon.manifest.name;
                    (g.content.content || []).forEach(function (s) { streams.push({ stream: s, addon: addon }); });
                });
                // The player's Sources panel offers these too
                window.__spTvStreams = { id: r.id, type: r.type, videoId: r.videoId, streams: streams };
                var rows = streams.map(function (x, i) {
                    var lines = streamLines(x.stream, x.addon);
                    var item = h('button', 'tvui-source');
                    var text = h('div', 'tvui-source-text');
                    text.appendChild(h('div', 'tvui-source-name', lines.name));
                    if (x.addon && lines.name.indexOf(x.addon) !== 0) text.appendChild(h('div', 'tvui-source-addon', x.addon));
                    lines.desc.forEach(function (d) { text.appendChild(h('div', 'tvui-source-desc', d)); });
                    item.append(h('div', 'tvui-source-badge', (x.addon || '?').slice(0, 2).toUpperCase()), text);
                    item.addEventListener('click', function () { if (x.stream.deepLinks && x.stream.deepLinks.player) go(x.stream.deepLinks.player); });
                    var row = h('div', 'tvui-source-row');
                    row.appendChild(item);
                    return { id: 's' + i, el: row, items: [item] };
                });
                sheetTrack.replaceChildren();
                rows.forEach(function (x) { sheetTrack.appendChild(x.el); });
                if (loading) sheetTrack.appendChild(h('div', 'tvui-sheet-note', 'Looking for more sources…'));
                else if (!rows.length) sheetTrack.appendChild(h('div', 'tvui-sheet-note', 'No sources found. Install a streaming add-on in Settings → Add-ons.'));
                sheet.setRows(rows);
                if (shown && sheetOpen && rows.length) sheet.focus();
                if (loading && Date.now() - started < 30000) setTimeout(poll, 700);
            });
        };
        poll();
    }

    // ── Modes ────────────────────────────────────────────────────────────────
    var shown = false;
    var mode = null;          // 'browse' or 'detail'
    var sheetOpen = false;

    function screen() { return sheetOpen ? sheet : mode === 'detail' ? detail : browse; }

    function sync() {
        if (!shown) return;
        var r = parseRoute();
        var nextMode = r ? 'detail' : 'browse';
        var wasSheet = sheetOpen;
        sheetOpen = !!(r && r.videoId);
        root.classList.toggle('tvui-sheet-open', sheetOpen);
        if (nextMode !== mode) {
            mode = nextMode;
            root.classList.toggle('mode-detail', mode === 'detail');
            root.classList.toggle('mode-browse', mode === 'browse');
            if (mode === 'browse') { stopTrailer(); detailKey = null; billboardFor = null; backdropUrl = null; }
        }
        browse.active = mode === 'browse';
        detail.active = mode === 'detail' && !sheetOpen;
        sheet.active = sheetOpen;
        if (mode === 'browse') {
            renderBrowse(!browse.rows.length);
            var f = browse.item();
            if (f && f.__title) showBillboard(f.__title);
        } else {
            renderDetail(r);
            if (sheetOpen) { stopTrailer(); renderSheet(r); }
            else if (wasSheet) { sheetKey = null; if (currentTrailerId && !trailer) startTrailer(currentTrailerId); }
        }
        screen().focus();
    }

    function show() {
        if (!root) build();
        if (!shown) {
            shown = true;
            document.documentElement.classList.add('sp-tvui-on');
            root.classList.add('on');
            mode = null;
        }
        // A title page's own trailer (Cinematic Details) would play unseen
        document.querySelectorAll('.cd-trailer').forEach(function (f) { f.remove(); });
        sync();
    }
    function hide() {
        if (!shown) return;
        shown = false;
        stopTrailer();
        document.documentElement.classList.remove('sp-tvui-on');
        root.classList.remove('on');
        setFocusEl(null);
    }

    // ── Remote ───────────────────────────────────────────────────────────────
    function move(dir) {
        var s = screen();
        if (!s.rows.length) return;
        s.move(dir);
    }
    function select() { if (focusedEl) focusedEl.click(); }

    // Returns true when handled; otherwise tv.js goes back (or offers to leave)
    function back() {
        if (sheetOpen || mode === 'detail') return false;
        if (browse.rowIndex > 0) { browse.rowIndex = 0; browse.cols.tabs = TABS.findIndex(function (t) { return t.id === view; }); browse.focus(); return true; }
        if (view !== 'home') { browse.cols.tabs = 1; chooseTab('home', false); browse.focus(); return true; }
        return false;
    }

    // Typing goes into Search
    function key(e) {
        if (!shown || mode !== 'browse' || e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.key.length === 1 && /[\w ]/.test(e.key)) {
            if (view !== 'search') { browse.cols.tabs = 0; chooseTab('search', false); browse.rowIndex = 1; }
            query += e.key.toLowerCase();
            searchChanged();
            browse.focus();
            return true;
        }
        if (e.key === 'Backspace' && view === 'search' && query) { query = query.slice(0, -1); searchChanged(); return true; }
        return false;
    }

    var CSS = '' +
        '#sp-tvui { --tvui-gutter: 88px; --tvui-rows-top: 56vh; --tvui-card-w: 300px; --tvui-ease: cubic-bezier(0.32,0.72,0,1);' +
        '  position: fixed; inset: 0; z-index: 2147482000; display: none; overflow: hidden; background: #0a0a0c; color: #fff;' +
        '  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }' +
        '#sp-tvui.on { display: block; animation: tvui-in .5s ease both; }' +
        'html.sp-tvui-on [class*="routes-container"] { visibility: hidden; }' +
        // Stremio's styles clip divs; ours mostly must not
        '#sp-tvui div, #sp-tvui section, #sp-tvui nav { overflow: visible; }' +
        '#sp-tvui .tvui-card-art, #sp-tvui .tvui-ep-thumb, #sp-tvui .tvui-card-progress, #sp-tvui .tvui-bb-progress, #sp-tvui .tvui-sheet-list, #sp-tvui .tvui-backdrop, #sp-tvui .tvui-trailer { overflow: hidden !important; }' +
        '#sp-tvui button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: default; outline: none; text-align: left; }' +
        // Backdrop
        '.tvui-backdrop { position: absolute; inset: 0; }' +
        '.tvui-backdrop img, .tvui-trailer { position: absolute; top: 0; right: 0; width: 80%; height: 82%; object-fit: cover; object-position: center 20%; opacity: 0; transition: opacity .8s ease; }' +
        '.tvui-backdrop img.on { opacity: 1; }' +
        '#sp-tvui.mode-detail .tvui-backdrop img, #sp-tvui.mode-detail .tvui-trailer { width: 100%; height: 100%; }' +
        '.tvui-trailer iframe { position: absolute; top: 50%; left: 50%; width: max(100%, 177.78vh); height: max(100%, 56.25vw); transform: translate(-50%, -50%) scale(1.2); border: 0; pointer-events: none; }' +
        '.tvui-trailer.on { opacity: 1; }' +
        '#sp-tvui[data-view="search"].mode-browse .tvui-backdrop img { opacity: 0 !important; }' +
        '.tvui-shade { position: absolute; inset: 0; background:' +
        '  linear-gradient(90deg, #0a0a0c 18%, rgba(10,10,12,.85) 32%, rgba(10,10,12,.3) 56%, transparent 72%),' +
        '  linear-gradient(0deg, #0a0a0c 26%, rgba(10,10,12,.8) 42%, transparent 72%), linear-gradient(180deg, rgba(10,10,12,.7), transparent 22%); }' +
        '#sp-tvui.mode-detail .tvui-shade { background: linear-gradient(90deg, rgba(10,10,12,.9) 0%, rgba(10,10,12,.55) 38%, transparent 66%),' +
        '  linear-gradient(0deg, #0a0a0c 4%, rgba(10,10,12,.6) 28%, transparent 55%); }' +
        // Tab bar: centred glass bar, hidden once you move into the content
        '.tvui-tabs { position: absolute; top: 0; left: 0; right: 0; z-index: 6; display: flex; justify-content: center; padding-top: 30px;' +
        '  transition: transform .45s var(--tvui-ease), opacity .3s ease; }' +
        '#sp-tvui.tvui-tabs-hidden .tvui-tabs, #sp-tvui.mode-detail .tvui-tabs { transform: translateY(-120%); opacity: 0; pointer-events: none; }' +
        '.tvui-tabs-inner { display: flex; align-items: center; gap: 4px; padding: 6px; border-radius: 34px;' +
        '  background: rgba(40,40,44,.55); -webkit-backdrop-filter: blur(30px) saturate(170%); backdrop-filter: blur(30px) saturate(170%);' +
        '  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.14), 0 10px 30px rgba(0,0,0,.35); }' +
        '.tvui-tab { display: inline-flex !important; align-items: center; justify-content: center; height: 46px; padding: 0 22px !important; border-radius: 23px; font-size: 19px; font-weight: 600;' +
        '  color: rgba(255,255,255,.62) !important; transition: background .2s ease, color .2s ease, transform .25s var(--tvui-ease); }' +
        '.tvui-tab.icon { width: 46px; padding: 0 !important; }' +
        '.tvui-tab svg { width: 22px; height: 22px; }' +
        '#sp-tvui .tvui-tab.current { color: #fff !important; background: rgba(255,255,255,.14); }' +
        '#sp-tvui .tvui-tab.tvui-focus { background: #fff; color: #000 !important; transform: scale(1.06); box-shadow: 0 8px 22px rgba(0,0,0,.35); }' +
        // Browse
        '.tvui-browse, .tvui-detail { position: absolute; inset: 0; transition: opacity .35s ease; }' +
        '#sp-tvui.mode-detail .tvui-browse, #sp-tvui.mode-browse .tvui-detail { opacity: 0; pointer-events: none; visibility: hidden; }' +
        '.tvui-billboard { position: absolute; left: var(--tvui-gutter); top: 0; width: min(46%, 640px); height: calc(var(--tvui-rows-top) - 24px); }' +
        '#sp-tvui[data-view="search"] .tvui-billboard { display: none; }' +
        '.tvui-bb-content { position: absolute; left: 0; right: 0; bottom: 0; opacity: 0; transform: translateY(10px); transition: opacity .18s ease, transform .5s var(--tvui-ease); }' +
        '.tvui-bb-content.in { opacity: 1; transform: none; transition: opacity .4s ease .12s, transform .5s var(--tvui-ease) .12s; }' +
        '.tvui-bb-logo, .tvui-hero-logo { display: block; max-width: 420px; max-height: 140px; object-fit: contain; object-position: left bottom; margin-bottom: 18px; filter: drop-shadow(0 4px 20px rgba(0,0,0,.5)); }' +
        '.tvui-hero-logo { max-width: 520px; max-height: 180px; }' +
        '.tvui-bb-title, .tvui-hero-title { margin: 0 0 16px; font-size: 52px; font-weight: 800; line-height: 1.02; letter-spacing: -0.02em; }' +
        '.tvui-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin-bottom: 12px; font-size: 17px; font-weight: 600; color: rgba(255,255,255,.75); }' +
        '.tvui-rating b { display: inline-block; padding: 1px 6px; margin-right: 4px; border-radius: 4px; background: #f5c518; color: #000; font-size: 13px; font-weight: 800; }' +
        '.tvui-bb-desc { margin: 0; font-size: 18px; line-height: 1.45; color: rgba(255,255,255,.82); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }' +
        '.tvui-bb-progress { width: 220px; height: 4px; margin-top: 16px; border-radius: 2px; background: rgba(255,255,255,.25); position: relative; }' +
        '.tvui-bb-progress::after, .tvui-card-progress::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--p); background: #fff; }' +
        '.tvui-rows { position: absolute; left: 0; right: 0; top: var(--tvui-rows-top); bottom: 0; }' +
        '#sp-tvui[data-view="search"] .tvui-rows { top: 128px; }' +
        '.tvui-track, .tvui-dtrack, .tvui-sheet-track { transition: transform .55s var(--tvui-ease); }' +
        // The strip starts 28px early so a lifted card isn't clipped at its edge
        '.tvui-row { padding: 0 0 26px calc(var(--tvui-gutter) - 28px); transition: opacity .4s ease; }' +
        '.tvui-row.past, .tvui-search-head.past { opacity: 0; pointer-events: none; }' +
        '.tvui-row-title { margin: 0 0 12px 28px; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; color: rgba(255,255,255,.6); transition: color .2s ease; }' +
        '.tvui-row.active .tvui-row-title { color: #fff; }' +
        '.tvui-strip { display: flex; gap: 22px; padding: 10px 0 16px 28px; transition: transform .5s var(--tvui-ease); }' +
        // Cards
        '.tvui-card { flex: none; width: var(--tvui-card-w); transition: transform .35s var(--tvui-ease), opacity .3s ease; }' +
        '.tvui-card.gone, .tvui-ep.gone { opacity: 0; }' +
        '.tvui-card-art { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; background: #1c1c20; box-shadow: 0 6px 18px rgba(0,0,0,.35); }' +
        '.tvui-card-bg, .tvui-ep-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 25%; }' +
        '.tvui-card-art::before { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(0deg, rgba(0,0,0,.7) 0%, rgba(0,0,0,.15) 45%, transparent 60%); }' +
        '.tvui-card-logo, .tvui-card-name, .tvui-card-progress { z-index: 2; }' +
        '.tvui-card-logo { position: absolute; left: 14px; bottom: 14px; max-width: 62%; max-height: 38%; object-fit: contain; object-position: left bottom; filter: drop-shadow(0 2px 8px rgba(0,0,0,.6)); }' +
        '.tvui-card-name { position: absolute; left: 14px; right: 14px; bottom: 12px; font-size: 18px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 8px rgba(0,0,0,.7);' +
        '  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }' +
        '.tvui-card-progress { position: absolute; left: 14px; right: 14px; bottom: 8px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.3); }' +
        '.tvui-card:has(.tvui-card-progress) .tvui-card-logo, .tvui-card:has(.tvui-card-progress) .tvui-card-name { bottom: 20px; }' +
        // Focus: lift, white ring, shine
        '.tvui-card.tvui-focus, .tvui-ep.tvui-focus { transform: scale(1.1); z-index: 2; }' +
        '.tvui-card.tvui-focus .tvui-card-art, .tvui-ep.tvui-focus .tvui-ep-thumb { box-shadow: 0 22px 46px rgba(0,0,0,.6); }' +
        '.tvui-card.tvui-focus .tvui-card-art::after, .tvui-ep.tvui-focus .tvui-ep-thumb::after { content: ""; position: absolute; inset: 0; z-index: 3; border-radius: inherit;' +
        '  box-shadow: inset 0 0 0 3px rgba(255,255,255,.95); background: linear-gradient(160deg, rgba(255,255,255,.18), transparent 38%); }' +
        '.tvui-empty { position: absolute; left: var(--tvui-gutter); top: 20px; max-width: 560px; font-size: 20px; line-height: 1.45; color: rgba(255,255,255,.55); }' +
        '.tvui-empty.inline { position: static; margin: 20px 0 0 var(--tvui-gutter); }' +
        // Search: the query and a single line of letters
        '.tvui-search-head { padding: 0 var(--tvui-gutter) 18px; transition: opacity .3s ease; }' +
        '.tvui-search-field { font-size: 46px; font-weight: 700; letter-spacing: -0.02em; min-height: 56px; }' +
        '.tvui-search-field::after { content: ""; display: inline-block; width: 3px; height: 40px; margin-left: 4px; vertical-align: -6px; background: #fff; animation: tvui-caret 1.1s steps(1) infinite; }' +
        '.tvui-search-field.placeholder { color: rgba(255,255,255,.35); }' +
        '.tvui-keys { padding-bottom: 2px; }' +
        '.tvui-keys .tvui-strip { gap: 2px; padding: 4px 0 4px 28px; }' +
        '.tvui-key { width: 38px; height: 50px; border-radius: 10px; text-align: center !important; font-size: 22px; font-weight: 600; color: rgba(255,255,255,.6) !important; transition: transform .2s var(--tvui-ease), background .15s ease; }' +
        '.tvui-key.wide { width: 84px; font-size: 17px; }' +
        '#sp-tvui .tvui-key.tvui-focus { background: #fff; color: #000 !important; transform: scale(1.2); box-shadow: 0 8px 22px rgba(0,0,0,.5); z-index: 2; }' +
        '#sp-tvui[data-view="search"] .tvui-track > .tvui-row:not(.tvui-keys) { margin-top: 18px; }' +
        // Title page
        '.tvui-hero { position: relative; height: 88vh; }' +
        '.tvui-hero-content { position: absolute; left: var(--tvui-gutter); bottom: 4vh; width: min(52%, 720px); }' +
        '.tvui-hero-desc { margin: 0 0 22px; font-size: 19px; line-height: 1.45; color: rgba(255,255,255,.85); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }' +
        '.tvui-hero-cast { margin: 18px 0 0; font-size: 15px; color: rgba(255,255,255,.6); }' +
        '.tvui-hero-cast b { color: rgba(255,255,255,.85); font-weight: 600; }' +
        '.tvui-actions { display: flex; align-items: center; gap: 14px; }' +
        '.tvui-btn { display: inline-flex !important; align-items: center; gap: 10px; height: 56px; padding: 0 28px !important; border-radius: 14px; font-size: 19px; font-weight: 700;' +
        '  background: rgba(255,255,255,.16) !important; -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); transition: transform .25s var(--tvui-ease), background .2s ease, color .2s ease; }' +
        '.tvui-btn svg { width: 22px; height: 22px; }' +
        '.tvui-btn.round { width: 56px; padding: 0 !important; justify-content: center; border-radius: 50%; }' +
        '#sp-tvui .tvui-btn.tvui-focus { background: #fff !important; color: #000 !important; transform: scale(1.08); box-shadow: 0 14px 30px rgba(0,0,0,.45); }' +
        '.tvui-pills { gap: 10px; }' +
        '.tvui-pill { height: 42px; padding: 0 20px !important; border-radius: 21px; font-size: 17px; font-weight: 600; color: rgba(255,255,255,.65) !important; background: rgba(255,255,255,.08) !important; transition: transform .2s var(--tvui-ease), background .15s ease; }' +
        '#sp-tvui .tvui-pill.tvui-focus { background: #fff !important; color: #000 !important; transform: scale(1.08); }' +
        '.tvui-ep { flex: none; width: 340px; transition: transform .35s var(--tvui-ease), opacity .3s ease; transform-origin: center top; }' +
        '.tvui-ep.upcoming { opacity: .5; }' +
        '.tvui-ep-thumb { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; background: #1c1c20; margin-bottom: 12px; }' +
        '.tvui-ep-watched { position: absolute; top: 10px; right: 10px; z-index: 2; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 14px; background: rgba(0,0,0,.6); }' +
        '.tvui-ep-kicker { font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: rgba(255,255,255,.55); margin-bottom: 4px; }' +
        '.tvui-ep-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; white-space: nowrap; overflow: hidden !important; text-overflow: ellipsis; }' +
        '.tvui-ep-desc { font-size: 14px; line-height: 1.4; color: rgba(255,255,255,.6); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden !important; }' +
        '.tvui-about { padding: 30px var(--tvui-gutter) 80px; }' +
        '.tvui-about .tvui-row-title { margin-left: 0; color: #fff; }' +
        '.tvui-about-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px 40px; max-width: 1100px; }' +
        '.tvui-about-label { font-size: 13px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: rgba(255,255,255,.5); margin-bottom: 4px; }' +
        '.tvui-about-value { font-size: 16px; line-height: 1.45; }' +
        '.tvui-loading { position: absolute; left: 50%; top: 50vh; width: 36px; height: 36px; margin: -18px; border-radius: 50%; border: 3px solid rgba(255,255,255,.2); border-top-color: #fff; animation: tvui-spin .9s linear infinite; }' +
        '.tvui-backbtn { position: absolute; top: 28px; left: 28px; z-index: 7; width: 46px; height: 46px; border-radius: 50%; display: grid !important; place-items: center;' +
        '  background: rgba(40,40,44,.55) !important; -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); opacity: .85; transition: opacity .3s ease; }' +
        '.tvui-backbtn svg { width: 22px; height: 22px; }' +
        'html.sp-tv-idle .tvui-backbtn { opacity: 0 !important; }' +
        '#sp-tvui.mode-browse .tvui-backbtn { display: none !important; }' +
        // Sources panel
        '.tvui-sheet { position: absolute; inset: 0; z-index: 8; background: rgba(0,0,0,.45); opacity: 0; pointer-events: none; transition: opacity .35s ease; }' +
        '#sp-tvui.tvui-sheet-open .tvui-sheet { opacity: 1; pointer-events: auto; }' +
        '.tvui-sheet-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(46%, 640px); display: flex; flex-direction: column; padding: 56px 0 0;' +
        '  background: rgba(28,28,32,.82); -webkit-backdrop-filter: blur(40px) saturate(170%); backdrop-filter: blur(40px) saturate(170%);' +
        '  box-shadow: -20px 0 60px rgba(0,0,0,.45); transform: translateX(100%); transition: transform .5s var(--tvui-ease); }' +
        '#sp-tvui.tvui-sheet-open .tvui-sheet-panel { transform: none; }' +
        '.tvui-sheet-head { padding: 0 48px 22px; }' +
        '.tvui-sheet-title { font-size: 32px; font-weight: 800; letter-spacing: -0.02em; }' +
        '.tvui-sheet-sub { margin-top: 6px; font-size: 16px; color: rgba(255,255,255,.6); }' +
        '.tvui-sheet-list { position: relative; flex: 1; }' +
        '.tvui-sheet-track { padding: 10px 36px 50vh; }' +
        '.tvui-source-row { padding: 4px 0; }' +
        '.tvui-source { display: flex !important; gap: 16px; width: 100%; padding: 16px 18px !important; border-radius: 16px; transition: transform .25s var(--tvui-ease), background .15s ease; }' +
        '.tvui-source-badge { flex: none; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 15px; font-weight: 800; background: rgba(255,255,255,.12); }' +
        '.tvui-source-text { min-width: 0; }' +
        '.tvui-source-name { font-size: 19px; font-weight: 700; margin-bottom: 3px; }' +
        '.tvui-source-addon { font-size: 13px; font-weight: 600; color: rgba(255,255,255,.55); margin-bottom: 3px; }' +
        '.tvui-source-desc { font-size: 14px; line-height: 1.35; color: rgba(255,255,255,.65); white-space: nowrap; overflow: hidden !important; text-overflow: ellipsis; }' +
        '#sp-tvui .tvui-source.tvui-focus { background: #fff; color: #000; transform: scale(1.03); box-shadow: 0 12px 30px rgba(0,0,0,.35); }' +
        '#sp-tvui .tvui-source.tvui-focus .tvui-source-desc, #sp-tvui .tvui-source.tvui-focus .tvui-source-addon { color: rgba(0,0,0,.6); }' +
        '#sp-tvui .tvui-source.tvui-focus .tvui-source-badge { background: rgba(0,0,0,.1); }' +
        '.tvui-sheet-note { padding: 20px 18px; font-size: 18px; line-height: 1.45; color: rgba(255,255,255,.6); }' +
        '@keyframes tvui-in { from { opacity: 0; } }' +
        '@keyframes tvui-caret { 50% { opacity: 0; } }' +
        '@keyframes tvui-spin { to { transform: rotate(360deg); } }' +
        '@media (prefers-reduced-motion: reduce) { #sp-tvui *, #sp-tvui { transition-duration: .01ms !important; animation: none !important; } }';

    // Shared with tv-player.js
    window.__spTvKit = {
        Screen: Screen, h: h, button: button, setFocusEl: setFocusEl, getState: getState, go: go, clamp: clamp,
        epLabel: epLabel, sortedEpisodes: sortedEpisodes, progressOf: progressOf, released: released, episodeLink: episodeLink,
        focused: function () { return focusedEl; },
    };

    window.__spTvHome = {
        show: show,
        hide: hide,
        sync: sync,
        isShown: function () { return shown; },
        element: function () { return root; },
        move: move,
        select: select,
        back: back,
        key: key,
        focus: function () { if (shown) screen().focus(); },
        view: function (id) { browse.cols.tabs = TABS.findIndex(function (t) { return t.id === id; }); chooseTab(id, true); },
        // Entering TV Mode: Home, focus on the first row
        reset: function () {
            if (view !== 'home') { viewMemory[view] = { rowIndex: browse.rowIndex, cols: browse.cols }; view = 'home'; browse.cols = {}; browse.rows = []; }
            browse.rowIndex = 1;
        },
    };
})();
