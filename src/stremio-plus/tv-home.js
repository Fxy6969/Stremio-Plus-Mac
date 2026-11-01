// The TV Mode browsing screens, in the style of streaming apps on Apple TV
// (Netflix, Disney+): a billboard with the highlighted title's artwork and
// details, rows of landscape cards that slide sideways, and a side menu that
// opens with labels when you move into it. Views: Home, Movies, Series, My Stuff
// and Search (with an on-screen keyboard for remotes). Opening a title goes to
// its normal page. tv.js shows this while TV Mode is on the Board and hands it
// the remote: move(direction), select(), back(), key(event).
(function () {
    if (window.__spTvHome) return;

    var CINEMETA = 'https://v3-cinemeta.strem.io/';
    var METAHUB = 'https://images.metahub.space/';
    var GENRES = {
        movie: ['Action', 'Comedy', 'Drama', 'Thriller', 'Sci-Fi', 'Animation', 'Horror', 'Romance', 'Documentary'],
        series: ['Drama', 'Comedy', 'Crime', 'Sci-Fi', 'Animation', 'Reality-TV', 'Documentary', 'Mystery'],
    };
    var KEYBOARD = ['abcdefghij', 'klmnopqrst', 'uvwxyz1234', '567890'];

    var ICONS = {
        search: '<circle cx="10.75" cy="10.75" r="6.25"/><path d="m15.4 15.4 4.6 4.6"/>',
        home: '<path d="M4.5 10.2 12 4l7.5 6.2V19a1 1 0 0 1-1 1H15v-5.5H9V20H5.5a1 1 0 0 1-1-1z"/>',
        movie: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17M8 5l2 4.5M13 5l2 4.5"/>',
        series: '<rect x="3.5" y="5.5" width="17" height="11.5" rx="2.5"/><path d="M8.5 20h7M12 17v3"/>',
        library: '<path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V5.5a1 1 0 0 1 1-1z"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
        exit: '<path d="M14 5h4a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 19h-4M10 8l-4 4 4 4M6 12h9"/>',
    };
    var VIEWS = [
        { id: 'search', label: 'Search' },
        { id: 'home', label: 'Home' },
        { id: 'movie', label: 'Movies' },
        { id: 'series', label: 'Series' },
        { id: 'library', label: 'My Stuff' },
        { id: 'settings', label: 'Settings', link: '#/settings' },
        { id: 'exit', label: 'Exit TV Mode' },
    ];

    function h(tag, cls, text) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }
    function svg(name) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
    }
    function getState(name) {
        return Promise.resolve(window.core && window.core.getState ? window.core.getState(name) : null).catch(function () { return null; });
    }

    // ── Titles: one shape for catalog items, library items and Continue Watching
    function linksOf(m, category) {
        return (m.links || []).filter(function (l) { return l.category === category; }).map(function (l) { return l.name; });
    }
    function webLink(link) { return link && link.indexOf('stremio:///') === 0 ? '#/' + link.slice(11) : link; }

    function title(m, extra) {
        var id = m.id || m._id;
        var imdb = /^tt\d+$/.test(id);
        var t = {
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
        };
        return Object.assign(t, extra || {});
    }

    var fetched = {};
    function catalog(type, extra) {
        var url = CINEMETA + 'catalog/' + type + '/top' + (extra ? '/' + extra : '') + '.json';
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

    // ── Views: each returns rows of { id, title, items } ─────────────────────
    function homeRows() {
        return Promise.all([continueWatching(), getState('board')]).then(function (r) {
            var rows = [];
            if (r[0].length) rows.push({ id: 'continue', title: 'Continue Watching', items: r[0] });
            var board = r[1];
            var loading = false;
            ((board && board.catalogs) || []).forEach(function (c, i) {
                var content = c.content;
                if (!content || content.type !== 'Ready') { loading = loading || !content || content.type === 'Loading'; return; }
                var items = (content.content || []).slice(0, 24).map(function (m) { return title(m); });
                if (!items.length) return;
                var label = c.name + (c.type ? ' ' + (c.type === 'movie' ? 'Movies' : c.type === 'series' ? 'Series' : c.type.charAt(0).toUpperCase() + c.type.slice(1)) : '');
                rows.push({ id: 'board-' + i + '-' + c.id, title: label, items: items });
            });
            return { rows: rows, loading: loading };
        });
    }

    function typeRows(type) {
        var defs = [{ id: 'popular', title: 'Popular', extra: '' }, { id: 'rated', title: 'Top Rated', extra: null }]
            .concat(GENRES[type].map(function (g) { return { id: 'genre-' + g, title: g, extra: 'genre=' + encodeURIComponent(g) }; }));
        return Promise.all(defs.map(function (d) {
            if (d.extra === null) {
                var url = CINEMETA + 'catalog/' + type + '/imdbRating.json';
                if (!fetched[url]) fetched[url] = fetch(url).then(function (r) { return r.json(); }).then(function (x) { return (x.metas || []).map(function (m) { return title(m); }); }).catch(function () { delete fetched[url]; return []; });
                return fetched[url];
            }
            return catalog(type, d.extra);
        })).then(function (lists) {
            return { rows: defs.map(function (d, i) { return { id: d.id, title: d.title, items: lists[i].slice(0, 30) }; }).filter(function (r) { return r.items.length; }) };
        });
    }

    function libraryRows() {
        return Promise.all([continueWatching(), getState('library')]).then(function (r) {
            var saved = ((r[1] && r[1].catalog) || []).filter(function (i) { return !i.removed && !i.temp; })
                .sort(function (a, b) { return String(b._mtime).localeCompare(String(a._mtime)); })
                .map(function (i) { return title(i); });
            var rows = [];
            if (r[0].length) rows.push({ id: 'continue', title: 'Continue Watching', items: r[0] });
            var movies = saved.filter(function (i) { return i.type === 'movie'; });
            var series = saved.filter(function (i) { return i.type === 'series'; });
            var other = saved.filter(function (i) { return i.type !== 'movie' && i.type !== 'series'; });
            if (movies.length) rows.push({ id: 'lib-movies', title: 'Movies', items: movies });
            if (series.length) rows.push({ id: 'lib-series', title: 'Series', items: series });
            if (other.length) rows.push({ id: 'lib-other', title: 'Other', items: other });
            return { rows: rows, empty: 'Titles you add to your Library appear here. Sign in to Stremio to keep them on all your devices.' };
        });
    }

    var query = '';
    function searchRows() {
        var q = query.trim();
        if (q.length < 2) return Promise.resolve({ rows: [], empty: 'Find movies and series by title.' });
        var extra = 'search=' + encodeURIComponent(q);
        var get = function (type) {
            return fetch(CINEMETA + 'catalog/' + type + '/top/' + extra + '.json').then(function (r) { return r.json(); })
                .then(function (d) { return (d.metas || []).map(function (m) { return title(m); }); }).catch(function () { return []; });
        };
        return Promise.all([get('movie'), get('series')]).then(function (r) {
            var rows = [];
            if (r[0].length) rows.push({ id: 'search-movies', title: 'Movies', items: r[0] });
            if (r[1].length) rows.push({ id: 'search-series', title: 'Series', items: r[1] });
            return { rows: rows, empty: 'No results for “' + q + '”.' };
        });
    }

    // ── DOM ──────────────────────────────────────────────────────────────────
    var root, backA, backB, frontLayer, billboard, rowsBox, track, emptyNote, rail, railItems = {};
    var searchField;

    function build() {
        root = h('div');
        root.id = 'sp-tvui';

        var backdrop = h('div', 'tvui-backdrop');
        backA = h('img'); backB = h('img');
        backA.alt = backB.alt = '';
        backdrop.append(backA, backB, h('div', 'tvui-shade'));
        frontLayer = backA;

        billboard = h('section', 'tvui-billboard');

        rowsBox = h('div', 'tvui-rows');
        track = h('div', 'tvui-track');
        emptyNote = h('div', 'tvui-empty');
        rowsBox.append(track, emptyNote);

        rail = h('nav', 'tvui-rail');
        var railList = h('div', 'tvui-rail-list');
        VIEWS.forEach(function (v) {
            var b = h('button', 'tvui-rail-item');
            b.innerHTML = svg(v.id === 'movie' ? 'movie' : v.id);
            b.appendChild(h('span', 'tvui-rail-label', v.label));
            b.dataset.view = v.id;
            b.addEventListener('click', function () { chooseView(v.id); });
            b.addEventListener('mouseenter', function () { if (pointerActive()) focusRail(VIEWS.indexOf(v)); });
            railItems[v.id] = b;
            (v.id === 'settings' || v.id === 'exit' ? railFoot : railList).appendChild(b);
        });
        rail.append(railList, railFoot);

        root.append(backdrop, billboard, rowsBox, rail);
        document.body.appendChild(root);

        var style = h('style');
        style.id = 'sp-tvui-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
    var railFoot = h('div', 'tvui-rail-foot');

    // ── State ────────────────────────────────────────────────────────────────
    var shown = false;
    var view = 'home';
    var zone = 'content';     // 'content' or 'rail'
    var railIndex = 1;
    var rows = [];            // [{ id, el, strip, items: [element], data }]
    var rowIndex = 0;
    var cols = {};            // remembered position per row id
    var viewMemory = {};      // rowIndex / cols per view, so Back returns to the same card
    var renderToken = 0;
    var loaded = false;       // the current view has its rows
    var billboardTimer = null;

    function pointerActive() { return !document.documentElement.classList.contains('sp-tv-idle'); }

    function chooseView(id) {
        var v = VIEWS.find(function (x) { return x.id === id; });
        if (!v) return;
        if (v.id === 'exit') { if (window.stremioPlusShell && window.stremioPlusShell.tvMode) window.stremioPlusShell.tvMode.exit(); return; }
        if (v.link) { location.hash = v.link.slice(1); return; }
        if (view !== id) {
            viewMemory[view] = { rowIndex: rowIndex, cols: cols };
            view = id;
            var memory = viewMemory[id] || { rowIndex: 0, cols: {} };
            rowIndex = memory.rowIndex; cols = memory.cols;
            render(true);
        }
        zone = 'content';
        applyFocus();
    }

    function render(resetTrack) {
        var token = ++renderToken;
        if (resetTrack) loaded = false;
        root.dataset.view = view;
        Object.keys(railItems).forEach(function (k) { railItems[k].classList.toggle('current', k === view); });
        root.classList.toggle('tvui-has-billboard', view !== 'search');
        if (resetTrack) { track.replaceChildren(); emptyNote.textContent = ''; }
        var load = view === 'home' ? homeRows() : view === 'movie' || view === 'series' ? typeRows(view) : view === 'library' ? libraryRows() : searchRows();
        if (view === 'search') buildSearchRows();
        load.then(function (result) {
            if (token !== renderToken) return;
            setRows(result.rows);
            loaded = !result.loading || result.rows.length > 0;
            // In Search the note goes under the keyboard
            if (view === 'search') track.appendChild(emptyNote); else rowsBox.appendChild(emptyNote);
            emptyNote.classList.toggle('inline', view === 'search');
            if (!result.rows.length && !result.loading) clearBillboard();
            emptyNote.textContent = result.rows.length ? '' : (result.loading ? '' : result.empty || 'Nothing here yet.');
            // Stremio fills the Board a moment after it opens
            if (result.loading && view === 'home') setTimeout(function () { if (token === renderToken && shown) render(false); }, 900);
            if (shown) applyFocus();
        });
    }

    // Search: the field and keyboard are rows too, above the results
    var keyboardRows = null;
    function buildSearchRows() {
        if (keyboardRows) return;
        searchField = h('div', 'tvui-search-field');
        keyboardRows = KEYBOARD.map(function (line, i) {
            return { id: 'kb-' + i, keys: line.split('') };
        }).concat([{ id: 'kb-actions', keys: ['space', 'delete', 'clear'] }]);
    }

    function setRows(data) {
        var focusedRowId = rows[rowIndex] && rows[rowIndex].id;
        track.replaceChildren();
        rows = [];
        if (view === 'search') {
            var head = h('div', 'tvui-search-head');
            searchField.textContent = query || 'Search';
            searchField.classList.toggle('placeholder', !query);
            head.appendChild(searchField);
            track.appendChild(head);
            keyboardRows.forEach(function (kr) {
                var el = h('div', 'tvui-row tvui-kb-row');
                var strip = h('div', 'tvui-strip');
                var items = kr.keys.map(function (k) {
                    var b = h('button', 'tvui-key' + (k.length > 1 ? ' wide' : ''), k === 'space' ? 'Space' : k === 'delete' ? 'Delete' : k === 'clear' ? 'Clear' : k.toUpperCase());
                    b.addEventListener('click', function () { typeKey(k); });
                    strip.appendChild(b);
                    return b;
                });
                el.appendChild(strip);
                track.appendChild(el);
                rows.push({ id: kr.id, el: el, strip: strip, items: items, keyboard: true });
            });
        }
        data.forEach(function (row) {
            var el = h('section', 'tvui-row');
            el.appendChild(h('h2', 'tvui-row-title', row.title));
            var strip = h('div', 'tvui-strip');
            var items = row.items.map(function (t) {
                var card = makeCard(t);
                strip.appendChild(card);
                return card;
            });
            el.appendChild(strip);
            track.appendChild(el);
            rows.push({ id: row.id, el: el, strip: strip, items: items, data: row.items });
        });
        // Keep the focus on the same row after a refresh
        var again = rows.findIndex(function (r) { return r.id === focusedRowId; });
        if (again >= 0) rowIndex = again;
        rowIndex = Math.max(0, Math.min(rowIndex, rows.length - 1));
    }

    function makeCard(t) {
        var card = h('button', 'tvui-card');
        card.setAttribute('aria-label', t.name);
        var art = h('div', 'tvui-card-art');
        // Backdrop, else the poster (not every title has a backdrop)
        var images = [t.background, t.poster].filter(Boolean);
        if (images.length) {
            var bg = h('img', 'tvui-card-bg');
            bg.alt = '';
            bg.loading = 'lazy';
            bg.src = images.shift();
            bg.addEventListener('error', function () { if (images.length) bg.src = images.shift(); else bg.remove(); });
            art.appendChild(bg);
        }
        if (t.logo) {
            var logo = h('img', 'tvui-card-logo');
            logo.alt = '';
            logo.loading = 'lazy';
            logo.src = t.logo;
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
        card.addEventListener('click', function () { open(t); });
        card.addEventListener('mouseenter', function () {
            if (!pointerActive()) return;
            var r = rows.findIndex(function (row) { return row.items.indexOf(card) !== -1; });
            if (r < 0) return;
            rowIndex = r; cols[rows[r].id] = rows[r].items.indexOf(card); zone = 'content';
            applyFocus(true);
        });
        return card;
    }

    function open(t) {
        location.hash = t.link.slice(1);
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
        if (searchField) {
            searchField.textContent = query || 'Search';
            searchField.classList.toggle('placeholder', !query);
        }
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { if (view === 'search') render(false); }, 450);
    }

    // ── Focus ────────────────────────────────────────────────────────────────
    var focusedEl = null;
    function setFocusEl(el) {
        if (focusedEl === el) return;
        if (focusedEl) focusedEl.classList.remove('tvui-focus');
        focusedEl = el;
        if (el) { el.classList.add('tvui-focus'); el.focus({ preventScroll: true }); }
    }

    function applyFocus(fromPointer) {
        if (!shown) return;
        root.classList.toggle('tvui-rail-open', zone === 'rail');
        if (zone === 'rail') {
            setFocusEl(railItems[VIEWS[railIndex].id]);
            return;
        }
        var row = rows[rowIndex];
        if (!row && !loaded) return;   // rows still loading; focus them when they arrive
        if (!row) { zone = 'rail'; railIndex = VIEWS.findIndex(function (v) { return v.id === view; }); return applyFocus(); }
        var col = Math.max(0, Math.min(cols[row.id] || 0, row.items.length - 1));
        cols[row.id] = col;
        setFocusEl(row.items[col]);
        layout(fromPointer);
        if (row.data) scheduleBillboard(row.data[col]);
    }

    // The focused row sits at a fixed line; its cards slide so the focus is first
    function layout(fromPointer) {
        rows.forEach(function (row, i) {
            row.el.classList.toggle('past', i < rowIndex);
            row.el.classList.toggle('active', i === rowIndex);
            if (row.keyboard) return;
            var col = cols[row.id] || 0;
            var first = row.items[0];
            var target = row.items[col];
            if (!first || !target || fromPointer) return;
            var shift = target.offsetLeft - first.offsetLeft;
            // Don't slide past the end: keep the last cards filling the row
            var last = row.items[row.items.length - 1];
            var maxShift = Math.max(0, last.offsetLeft + last.offsetWidth - first.offsetLeft - (rowsBox.clientWidth - first.offsetLeft - 40));
            shift = Math.min(shift, maxShift);
            row.strip.style.transform = 'translateX(' + (-shift) + 'px)';
            row.items.forEach(function (card) { card.classList.toggle('gone', card.offsetLeft - first.offsetLeft < shift - 4); });
        });
        var active = rows[rowIndex];
        // Measured against the track itself (offsetTop can count from the wrong ancestor)
        var y = active ? active.el.getBoundingClientRect().top - track.getBoundingClientRect().top : 0;
        // In Search the field and keyboard stay put until the results are reached
        if (view === 'search' && active && active.keyboard) y = 0;
        track.style.transform = 'translateY(' + (-y) + 'px)';
    }

    function scheduleBillboard(t) {
        clearTimeout(billboardTimer);
        billboardTimer = setTimeout(function () { showBillboard(t); }, 160);
    }

    var billboardFor = null;
    function clearBillboard() {
        billboardFor = null;
        clearTimeout(billboardTimer);
        backA.classList.remove('on'); backB.classList.remove('on');
        Array.prototype.forEach.call(billboard.children, function (old) { old.classList.remove('in'); setTimeout(function () { old.remove(); }, 350); });
    }
    function showBillboard(t) {
        if (!t || billboardFor === t || view === 'search') return;
        billboardFor = t;
        // Cross-fade the backdrop
        var next = frontLayer === backA ? backB : backA;
        next.onload = function () { next.classList.add('on'); frontLayer.classList.remove('on'); frontLayer = next; };
        next.onerror = function () { frontLayer.classList.remove('on'); };
        next.src = String(t.background || '').replace('/background/medium/', '/background/large/');

        var content = h('div', 'tvui-bb-content');
        if (t.logo) {
            var logo = h('img', 'tvui-bb-logo');
            logo.alt = t.name;
            logo.src = t.logo;
            logo.addEventListener('error', function () { logo.replaceWith(h('h1', 'tvui-bb-title', t.name)); });
            content.appendChild(logo);
        } else content.appendChild(h('h1', 'tvui-bb-title', t.name));
        var meta = h('div', 'tvui-bb-meta');
        if (t.rating) { var r = h('span', 'tvui-bb-rating'); r.append(h('b', null, 'IMDb'), document.createTextNode(' ' + t.rating)); meta.appendChild(r); }
        [t.year, t.runtime, t.genres.join(' · '), t.type === 'series' ? 'Series' : t.type === 'movie' ? 'Movie' : '']
            .filter(Boolean).forEach(function (x) { meta.appendChild(h('span', null, x)); });
        content.appendChild(meta);
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

    // ── Remote ───────────────────────────────────────────────────────────────
    function move(dir) {
        if (zone === 'rail') {
            if (dir === 'up') railIndex = Math.max(0, railIndex - 1);
            else if (dir === 'down') railIndex = Math.min(VIEWS.length - 1, railIndex + 1);
            else if (dir === 'right' && rows.length) zone = 'content';
            return applyFocus();
        }
        var row = rows[rowIndex];
        if (!row) return;
        var col = cols[row.id] || 0;
        if (dir === 'left') {
            if (col === 0) { zone = 'rail'; railIndex = VIEWS.findIndex(function (v) { return v.id === view; }); }
            else cols[row.id] = col - 1;
        } else if (dir === 'right') {
            cols[row.id] = Math.min(row.items.length - 1, col + 1);
        } else {
            var nextIndex = rowIndex + (dir === 'down' ? 1 : -1);
            if (nextIndex < 0 || nextIndex >= rows.length) return;
            var from = row.items[col].getBoundingClientRect();
            var next = rows[nextIndex];
            // Keyboard rows: go to the key straight above or below
            if (row.keyboard || next.keyboard) {
                var best = 0, bestDist = Infinity;
                next.items.forEach(function (el, i) {
                    var r = el.getBoundingClientRect();
                    var d = Math.abs(r.left + r.width / 2 - (from.left + from.width / 2));
                    if (d < bestDist) { bestDist = d; best = i; }
                });
                if (!next.keyboard && cols[next.id] === undefined) best = 0;
                if (next.keyboard || cols[next.id] === undefined) cols[next.id] = best;
            }
            rowIndex = nextIndex;
        }
        applyFocus();
    }

    function select() {
        if (focusedEl) focusedEl.click();
    }

    // Returns true when handled; otherwise TV Mode offers to leave
    function back() {
        if (zone === 'content') {
            zone = 'rail';
            railIndex = VIEWS.findIndex(function (v) { return v.id === view; });
            applyFocus();
            return true;
        }
        if (view !== 'home') { chooseView('home'); return true; }
        return false;
    }

    // Typing on a keyboard goes into Search
    function key(e) {
        if (!shown || e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.key.length === 1 && /[\w ]/.test(e.key)) {
            if (view !== 'search') { chooseView('search'); }
            query += e.key.toLowerCase();
            searchChanged();
            return true;
        }
        if (e.key === 'Backspace' && view === 'search' && query) {
            query = query.slice(0, -1);
            searchChanged();
            return true;
        }
        return false;
    }

    // ── Show / hide ──────────────────────────────────────────────────────────
    function show() {
        if (!root) build();
        if (shown) return;
        shown = true;
        document.documentElement.classList.add('sp-tvui-on');
        root.classList.add('on');
        render(!rows.length);
        applyFocus();
    }

    function hide() {
        if (!shown) return;
        shown = false;
        document.documentElement.classList.remove('sp-tvui-on');
        root.classList.remove('on');
        setFocusEl(null);
    }

    var CSS = '' +
        '#sp-tvui { --tvui-rail: 96px; --tvui-gutter: 132px; --tvui-rows-top: 54vh; --tvui-card-w: 300px; --tvui-ease: cubic-bezier(0.32,0.72,0,1);' +
        '  position: fixed; inset: 0; z-index: 2147482000; display: none; overflow: hidden; background: #0a0a0c; color: #fff;' +
        '  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }' +
        '#sp-tvui.on { display: block; animation: tvui-in .5s ease both; }' +
        'html.sp-tvui-on [class*="routes-container"] { visibility: hidden; }' +
        // Stremio's styles clip divs; these must not, or slid cards disappear
        '#sp-tvui .tvui-track, #sp-tvui .tvui-row, #sp-tvui .tvui-strip, #sp-tvui .tvui-card, #sp-tvui .tvui-billboard, #sp-tvui .tvui-bb-content, #sp-tvui .tvui-rail, #sp-tvui .tvui-rail-list { overflow: visible !important; }' +
        '#sp-tvui button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: default; outline: none; }' +
        // Backdrop: the highlighted title, faded into the page
        '.tvui-backdrop { position: absolute; inset: 0; }' +
        '.tvui-backdrop img { position: absolute; top: 0; right: 0; width: 78%; height: 78%; object-fit: cover; object-position: center 20%; opacity: 0; transition: opacity .7s ease; }' +
        '.tvui-backdrop img.on { opacity: 1; }' +
        '#sp-tvui[data-view="search"] .tvui-backdrop img { opacity: 0 !important; }' +
        '.tvui-shade { position: absolute; inset: 0; background:' +
        '  linear-gradient(90deg, #0a0a0c 22%, rgba(10,10,12,.86) 34%, rgba(10,10,12,.35) 56%, transparent 72%),' +
        '  linear-gradient(0deg, #0a0a0c 24%, rgba(10,10,12,.8) 40%, transparent 72%); }' +
        // Billboard
        '.tvui-billboard { position: absolute; left: var(--tvui-gutter); top: 0; width: min(46%, 640px); height: calc(var(--tvui-rows-top) - 24px); }' +
        '#sp-tvui:not(.tvui-has-billboard) .tvui-billboard { display: none; }' +
        '.tvui-bb-content { position: absolute; left: 0; right: 0; bottom: 0; opacity: 0; transform: translateY(10px); transition: opacity .18s ease, transform .5s var(--tvui-ease); }' +
        '.tvui-bb-content.in { transition: opacity .4s ease .12s, transform .5s var(--tvui-ease) .12s; }' +
        '.tvui-bb-content.in { opacity: 1; transform: none; }' +
        '.tvui-bb-logo { display: block; max-width: 420px; max-height: 140px; object-fit: contain; object-position: left bottom; margin-bottom: 18px; filter: drop-shadow(0 4px 20px rgba(0,0,0,.5)); }' +
        '.tvui-bb-title { margin: 0 0 16px; font-size: 52px; font-weight: 800; line-height: 1.02; letter-spacing: -0.02em; }' +
        '.tvui-bb-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin-bottom: 12px; font-size: 17px; font-weight: 600; color: rgba(255,255,255,.75); }' +
        '.tvui-bb-rating b { display: inline-block; padding: 1px 6px; margin-right: 4px; border-radius: 4px; background: #f5c518; color: #000; font-size: 13px; font-weight: 800; }' +
        '.tvui-bb-desc { margin: 0; font-size: 18px; line-height: 1.45; color: rgba(255,255,255,.82); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }' +
        '.tvui-bb-progress { width: 220px; height: 4px; margin-top: 16px; border-radius: 2px; background: rgba(255,255,255,.25); position: relative; overflow: hidden; }' +
        '.tvui-bb-progress::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--p); background: #fff; }' +
        // Rows
        '.tvui-rows { position: absolute; left: 0; right: 0; top: var(--tvui-rows-top); bottom: 0; }' +
        '#sp-tvui:not(.tvui-has-billboard) .tvui-rows { top: 72px; }' +
        '.tvui-track { transition: transform .55s var(--tvui-ease); }' +
        // The strip starts 28px early so a lifted card isn't clipped at its edge
        '.tvui-row { padding: 0 0 26px calc(var(--tvui-gutter) - 28px); transition: opacity .4s ease; }' +
        '.tvui-row.past { opacity: 0; pointer-events: none; }' +
        '.tvui-row-title { margin: 0 0 12px 28px; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; color: rgba(255,255,255,.9); }' +
        '.tvui-strip { display: flex; gap: 22px; padding: 10px 0 16px 28px; transition: transform .5s var(--tvui-ease); will-change: transform; }' +
        '.tvui-row:not(.active) .tvui-row-title { color: rgba(255,255,255,.6); }' +
        // Cards
        '.tvui-card { flex: none; width: var(--tvui-card-w); transition: transform .35s var(--tvui-ease), opacity .3s ease; }' +
        '.tvui-card.gone { opacity: 0; }' +
        '.tvui-card-art { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #1c1c20 center / cover no-repeat;' +
        '  box-shadow: 0 6px 18px rgba(0,0,0,.35); }' +
        '.tvui-card-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 25%; }' +
        '.tvui-card-art::before { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(0deg, rgba(0,0,0,.7) 0%, rgba(0,0,0,.15) 45%, transparent 60%); }' +
        '.tvui-card-logo, .tvui-card-name, .tvui-card-progress { z-index: 2; }' +
        '.tvui-card-logo { position: absolute; left: 14px; bottom: 14px; max-width: 62%; max-height: 38%; object-fit: contain; object-position: left bottom; filter: drop-shadow(0 2px 8px rgba(0,0,0,.6)); }' +
        '.tvui-card-name { position: absolute; left: 14px; right: 14px; bottom: 12px; font-size: 18px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 8px rgba(0,0,0,.7);' +
        '  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }' +
        '.tvui-card-progress { position: absolute; left: 14px; right: 14px; bottom: 8px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.3); overflow: hidden; }' +
        '.tvui-card-progress::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--p); background: #fff; }' +
        '.tvui-card:has(.tvui-card-progress) .tvui-card-logo, .tvui-card:has(.tvui-card-progress) .tvui-card-name { bottom: 20px; }' +
        // Focus: the card lifts, a white ring and a soft shine
        '.tvui-card.tvui-focus { transform: scale(1.1); z-index: 2; }' +
        '.tvui-card.tvui-focus .tvui-card-art { box-shadow: 0 22px 46px rgba(0,0,0,.6); }' +
        '.tvui-card.tvui-focus .tvui-card-art::after { content: ""; position: absolute; inset: 0; z-index: 3; border-radius: inherit;' +
        '  box-shadow: inset 0 0 0 3px rgba(255,255,255,.95); background: linear-gradient(160deg, rgba(255,255,255,.18), transparent 38%); }' +
        '.tvui-empty.inline { position: static; margin: 28px 0 0 var(--tvui-gutter); }' +
        '.tvui-empty { position: absolute; left: var(--tvui-gutter); top: 20px; max-width: 560px; font-size: 20px; line-height: 1.45; color: rgba(255,255,255,.55); }' +
        // Search
        '.tvui-search-head { padding: 0 0 22px var(--tvui-gutter); }' +
        '.tvui-search-field { display: inline-flex; align-items: center; min-width: 520px; height: 64px; padding: 0 24px; border-radius: 16px; background: rgba(255,255,255,.08);' +
        '  font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }' +
        '.tvui-search-field::after { content: ""; width: 2px; height: 32px; margin-left: 3px; background: #fff; animation: tvui-caret 1.1s steps(1) infinite; }' +
        '.tvui-search-field.placeholder { color: rgba(255,255,255,.4); }' +
        '.tvui-search-field.placeholder::before { content: none; }' +
        '.tvui-kb-row { padding-bottom: 6px; }' +
        '.tvui-kb-row .tvui-strip { gap: 8px; padding: 4px 0; }' +
        '.tvui-key { width: 54px; height: 50px; border-radius: 10px; font-size: 21px; font-weight: 600; color: rgba(255,255,255,.75) !important; transition: transform .2s var(--tvui-ease), background .15s ease; }' +
        '.tvui-key.wide { width: 120px; font-size: 17px; }' +
        '#sp-tvui .tvui-key.tvui-focus { background: #fff !important; color: #000 !important; transform: scale(1.12); box-shadow: 0 8px 22px rgba(0,0,0,.5); }' +
        '#sp-tvui[data-view="search"] .tvui-track > .tvui-row:not(.tvui-kb-row) { margin-top: 18px; }' +
        // Side menu: icons, opening with labels when focused
        '.tvui-rail { position: absolute; left: 0; top: 0; bottom: 0; z-index: 5; width: var(--tvui-rail); padding: 56px 0 40px; box-sizing: border-box;' +
        '  display: flex; flex-direction: column; justify-content: space-between; background: linear-gradient(90deg, rgba(10,10,12,.85), rgba(10,10,12,0));' +
        '  transition: width .45s var(--tvui-ease), background .45s ease; }' +
        '#sp-tvui.tvui-rail-open .tvui-rail { width: 340px; background: linear-gradient(90deg, rgba(10,10,12,.98) 0%, rgba(10,10,12,.92) 62%, rgba(10,10,12,0) 100%); }' +
        '.tvui-rail-list, .tvui-rail-foot { display: flex; flex-direction: column; gap: 6px; }' +
        '.tvui-rail-list { margin-top: auto; margin-bottom: auto; }' +
        '.tvui-rail-item { display: flex; align-items: center; gap: 20px; height: 54px; margin: 0 14px; padding: 0 20px; border-radius: 27px; white-space: nowrap;' +
        '  color: rgba(255,255,255,.55) !important; transition: background .2s ease, color .2s ease, transform .25s var(--tvui-ease); }' +
        '.tvui-rail-item svg { width: 26px; height: 26px; flex: none; }' +
        '.tvui-rail-label { font-size: 20px; font-weight: 600; opacity: 0; transition: opacity .25s ease; }' +
        '#sp-tvui.tvui-rail-open .tvui-rail-label { opacity: 1; }' +
        '.tvui-rail-item.current { color: #fff !important; }' +
        '#sp-tvui:not(.tvui-rail-open) .tvui-rail-item.current svg { filter: drop-shadow(0 0 10px rgba(255,255,255,.35)); }' +
        '#sp-tvui .tvui-rail-item.tvui-focus { background: #fff; color: #000 !important; transform: scale(1.04); }' +
        '#sp-tvui.tvui-rail-open .tvui-rows, #sp-tvui.tvui-rail-open .tvui-billboard { opacity: .45; }' +
        '.tvui-rows, .tvui-billboard { transition: opacity .4s ease; }' +
        '@keyframes tvui-in { from { opacity: 0; } }' +
        '@keyframes tvui-caret { 50% { opacity: 0; } }' +
        '@media (prefers-reduced-motion: reduce) { #sp-tvui *, #sp-tvui { transition-duration: .01ms !important; animation: none !important; } }';

    window.__spTvHome = {
        show: show,
        hide: hide,
        isShown: function () { return shown; },
        element: function () { return root; },
        move: move,
        select: select,
        back: back,
        key: key,
        focus: function () { applyFocus(); },
        // Back to Home, focus on the content (entering TV Mode)
        reset: function () {
            if (root && view !== 'home') { viewMemory[view] = { rowIndex: rowIndex, cols: cols }; view = 'home'; rowIndex = 0; cols = {}; if (shown) render(true); }
            zone = 'content';
        },
        view: chooseView,
    };
})();
