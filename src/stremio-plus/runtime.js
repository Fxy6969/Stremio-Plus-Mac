// Stremio+ plugin runtime. Every plugin runs with its own scope (timers,
// observers, animation frames, network, storage, console) so the app can:
//  - measure what each plugin costs (Plugin Health),
//  - stop everything a plugin started (live disable, hot reload),
//  - enforce permissions the user denied,
//  - attribute errors to the plugin that threw them (safe updates).
// Also provides the shared toast and permission prompt UI.
(function () {
    if (window.__spRuntime) return;

    var native = {
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
        setInterval: window.setInterval.bind(window),
        clearInterval: window.clearInterval.bind(window),
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        MutationObserver: window.MutationObserver,
        fetch: window.fetch.bind(window),
        XMLHttpRequest: window.XMLHttpRequest,
        WebSocket: window.WebSocket,
        addEventListener: EventTarget.prototype.addEventListener,
        removeEventListener: EventTarget.prototype.removeEventListener,
        console: window.console,
    };

    var HISTORY = 30;      // seconds of per-second samples kept per plugin
    var MAX_LOGS = 600;

    var plugins = new Map();   // id -> record
    var current = null;        // id of the plugin whose code is running right now
    var logs = [];
    var events = new EventTarget();

    function emit(type, detail) { events.dispatchEvent(new CustomEvent(type, { detail: detail })); }

    function getRecord(id) {
        var rec = plugins.get(id);
        if (!rec) {
            rec = {
                id: id, name: id, file: null, version: '', dev: false, status: 'stopped',
                declared: [], denied: [], undeclared: new Set(),
                timers: new Map(), rafs: new Set(), observers: new Set(), listeners: [],
                tick: { cpu: 0, obs: 0, raf: 0, net: 0, errors: 0 },
                history: [], errors: [], coldStartMs: 0, loadedAt: 0,
            };
            plugins.set(id, rec);
        }
        return rec;
    }

    // ── Accounting ───────────────────────────────────────────────────────────
    function noteError(rec, error) {
        var message = error && error.message ? error.message : String(error);
        rec.errors.push({ t: Date.now(), message: message });
        if (rec.errors.length > 50) rec.errors.shift();
        rec.tick.errors++;
        pushLog(rec.id, 'error', [error]);
        emit('plugin-error', { id: rec.id, message: message });
    }

    // Runs plugin code with timing and attribution; errors are recorded then rethrown
    function run(rec, fn, self, args) {
        var previous = current;
        current = rec.id;
        var t0 = performance.now();
        try {
            return typeof fn === 'function' ? fn.apply(self, args) : fn.handleEvent.apply(fn, args);
        } catch (e) {
            noteError(rec, e);
            throw e;
        } finally {
            rec.tick.cpu += performance.now() - t0;
            current = previous;
        }
    }

    native.setInterval(function () {
        plugins.forEach(function (rec) {
            if (rec.status !== 'running' && !rec.history.length) return;
            rec.history.push(rec.tick);
            if (rec.history.length > HISTORY) rec.history.shift();
            rec.tick = { cpu: 0, obs: 0, raf: 0, net: 0, errors: 0 };
        });
        emit('tick', null);
    }, 1000);

    // ── Logging ──────────────────────────────────────────────────────────────
    function format(arg) {
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }

    function pushLog(id, level, args) {
        var entry = { t: Date.now(), plugin: id, level: level, text: Array.prototype.map.call(args, format).join(' ') };
        logs.push(entry);
        if (logs.length > MAX_LOGS) logs.shift();
        emit('log', entry);
    }

    function scopedConsole(rec) {
        var c = {};
        ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
            c[level] = function () {
                pushLog(rec.id, level === 'log' ? 'info' : level, arguments);
                return native.console[level].apply(native.console, arguments);
            };
        });
        return Object.assign(Object.create(native.console), c);
    }

    // ── Permissions ──────────────────────────────────────────────────────────
    function denied(rec, capability) {
        return new DOMException('"' + rec.name + '" is not allowed to use ' + capability + '. You can change this in Stremio+ › Tools › Plugin Health.', 'NotAllowedError');
    }

    function useCapability(rec, capability) {
        if (rec.denied.indexOf(capability) !== -1) throw denied(rec, capability);
        if (rec.declared.indexOf(capability) === -1 && !rec.undeclared.has(capability)) {
            rec.undeclared.add(capability);
            emit('undeclared', { id: rec.id, capability: capability });
        }
    }

    function memoryStorage() {
        var data = new Map();
        return {
            get length() { return data.size; },
            key: function (i) { return Array.from(data.keys())[i] || null; },
            getItem: function (k) { return data.has(String(k)) ? data.get(String(k)) : null; },
            setItem: function (k, v) { data.set(String(k), String(v)); },
            removeItem: function (k) { data.delete(String(k)); },
            clear: function () { data.clear(); },
        };
    }

    function scopedStorage(rec, name) {
        var real;
        try { real = window[name]; } catch (e) { return memoryStorage(); }
        if (rec.denied.indexOf('storage') !== -1) return memoryStorage();
        return new Proxy(real, {
            get: function (target, prop) {
                useCapability(rec, 'storage');
                var value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            },
            set: function (target, prop, value) { useCapability(rec, 'storage'); target[prop] = value; return true; },
        });
    }

    // ── Plugin scope ─────────────────────────────────────────────────────────
    function scope(id) {
        var rec = getRecord(id);

        var ScopedObserver = function (callback) {
            var observer = new native.MutationObserver(function (mutations, obs) {
                rec.tick.obs++;
                run(rec, callback, obs, [mutations, obs]);
            });
            rec.observers.add(observer);
            return observer;
        };
        ScopedObserver.prototype = native.MutationObserver.prototype;

        var ScopedXHR = function () {
            var xhr = new native.XMLHttpRequest();
            var open = xhr.open;
            xhr.open = function () { useCapability(rec, 'network'); rec.tick.net++; return open.apply(xhr, arguments); };
            return xhr;
        };
        ScopedXHR.prototype = native.XMLHttpRequest.prototype;

        var ScopedWebSocket = function (url, protocols) {
            useCapability(rec, 'network');
            rec.tick.net++;
            return protocols === undefined ? new native.WebSocket(url) : new native.WebSocket(url, protocols);
        };
        ScopedWebSocket.prototype = native.WebSocket.prototype;

        return {
            enter: function () { rec.status = 'running'; rec.loadedAt = Date.now(); rec._t0 = performance.now(); rec._prev = current; current = rec.id; },
            exit: function () { rec.coldStartMs = Math.round(performance.now() - rec._t0); rec.tick.cpu += rec.coldStartMs; current = rec._prev; },
            crashed: function (e) { noteError(rec, e); },

            setTimeout: function (fn, ms) {
                if (typeof fn !== 'function') return native.setTimeout(fn, ms);
                var args = Array.prototype.slice.call(arguments, 2);
                var handle = native.setTimeout(function () { rec.timers.delete(handle); run(rec, fn, window, args); }, ms);
                rec.timers.set(handle, { type: 'timeout', ms: +ms || 0 });
                return handle;
            },
            clearTimeout: function (handle) { rec.timers.delete(handle); native.clearTimeout(handle); },
            setInterval: function (fn, ms) {
                if (typeof fn !== 'function') return native.setInterval(fn, ms);
                var args = Array.prototype.slice.call(arguments, 2);
                var handle = native.setInterval(function () { run(rec, fn, window, args); }, ms);
                rec.timers.set(handle, { type: 'interval', ms: Math.max(4, +ms || 0) });
                return handle;
            },
            clearInterval: function (handle) { rec.timers.delete(handle); native.clearInterval(handle); },
            requestAnimationFrame: function (fn) {
                var handle = native.requestAnimationFrame(function (t) {
                    rec.rafs.delete(handle);
                    rec.tick.raf++;
                    run(rec, fn, window, [t]);
                });
                rec.rafs.add(handle);
                return handle;
            },
            cancelAnimationFrame: function (handle) { rec.rafs.delete(handle); native.cancelAnimationFrame(handle); },
            MutationObserver: ScopedObserver,
            fetch: function () {
                try { useCapability(rec, 'network'); } catch (e) { return Promise.reject(e); }
                rec.tick.net++;
                return native.fetch.apply(null, arguments);
            },
            XMLHttpRequest: ScopedXHR,
            WebSocket: ScopedWebSocket,
            console: scopedConsole(rec),
            localStorage: scopedStorage(rec, 'localStorage'),
            sessionStorage: scopedStorage(rec, 'sessionStorage'),
        };
    }

    // Promise callbacks registered while a plugin runs also run as that plugin,
    // so work after fetch()/then() is measured and attributed too
    var nativeThen = Promise.prototype.then;
    Promise.prototype.then = function (onFulfilled, onRejected) {
        if (current === null) return nativeThen.call(this, onFulfilled, onRejected);
        var rec = plugins.get(current);
        return nativeThen.call(this,
            typeof onFulfilled === 'function' ? function (v) { return run(rec, onFulfilled, this, [v]); } : onFulfilled,
            typeof onRejected === 'function' ? function (e) { return run(rec, onRejected, this, [e]); } : onRejected);
    };

    // Listeners added while a plugin's code runs belong to that plugin
    var wrappedListeners = new WeakMap();
    function listenerKey(type, options) {
        return type + '|' + !!(options === true || (options && options.capture));
    }
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (current === null || !listener) return native.addEventListener.call(this, type, listener, options);
        var rec = plugins.get(current);
        var wrapped = function () { return run(rec, listener, this, arguments); };
        var byKey = wrappedListeners.get(listener) || new Map();
        byKey.set(listenerKey(type, options), wrapped);
        wrappedListeners.set(listener, byKey);
        rec.listeners.push({ target: this, type: type, listener: wrapped, options: options });
        return native.addEventListener.call(this, type, wrapped, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        var byKey = listener && wrappedListeners.get(listener);
        var wrapped = byKey && byKey.get(listenerKey(type, options));
        return native.removeEventListener.call(this, type, wrapped || listener, options);
    };

    // Stops everything a plugin started. Elements it added to the page stay.
    function teardown(id) {
        var rec = plugins.get(id);
        if (!rec) return;
        rec.timers.forEach(function (info, handle) {
            (info.type === 'interval' ? native.clearInterval : native.clearTimeout)(handle);
        });
        rec.timers.clear();
        rec.rafs.forEach(function (h) { native.cancelAnimationFrame(h); });
        rec.rafs.clear();
        rec.observers.forEach(function (o) { o.disconnect(); });
        rec.observers.clear();
        rec.listeners.forEach(function (l) { native.removeEventListener.call(l.target, l.type, l.listener, l.options); });
        rec.listeners = [];
        var script = rec.file && document.getElementById(rec.file);
        if (script) script.remove();
        rec.status = 'stopped';
        emit('teardown', { id: id });
    }

    // ── Health ───────────────────────────────────────────────────────────────
    function average(rec, key, seconds) {
        var recent = rec.history.slice(-seconds);
        if (!recent.length) return 0;
        return recent.reduce(function (sum, s) { return sum + s[key]; }, 0) / recent.length;
    }

    function health(rec) {
        var intervals = [];
        rec.timers.forEach(function (info) { if (info.type === 'interval') intervals.push(info.ms); });
        var fastest = intervals.length ? Math.min.apply(null, intervals) : null;
        var h = {
            cpuPerSec: average(rec, 'cpu', 5),
            observerPerSec: average(rec, 'obs', 5),
            framesPerSec: average(rec, 'raf', 5),
            requestsPerMin: average(rec, 'net', 30) * 60,
            timers: rec.timers.size,
            intervals: intervals.length,
            fastestInterval: fastest,
            observers: rec.observers.size,
            listeners: rec.listeners.length,
            errors: rec.errors.length,
            issues: [],
        };
        if (fastest !== null && fastest < 100) h.issues.push('Runs a timer every ' + fastest + ' ms');
        if (h.observerPerSec > 30) h.issues.push('Reacts to page changes ' + Math.round(h.observerPerSec) + '× a second, likely a feedback loop');
        if (h.cpuPerSec > 16) h.issues.push('Uses ' + Math.round(h.cpuPerSec) + ' ms of CPU every second');
        if (h.framesPerSec > 40) h.issues.push('Runs an animation loop on every frame');
        if (h.errors > 0) h.issues.push(h.errors + (h.errors === 1 ? ' error' : ' errors') + ' this session');
        // Undeclared use is shown as a note; it doesn't make a plugin unhealthy
        h.notes = Array.from(rec.undeclared).map(function (cap) { return 'Uses ' + cap + ' without declaring it'; });
        h.level = h.issues.length === 0 ? 'ok' : (fastest !== null && fastest < 100) || h.observerPerSec > 30 || h.cpuPerSec > 16 ? 'bad' : 'warn';
        return h;
    }

    // ── Shared UI: toasts and the permission prompt ──────────────────────────
    var uiCss = '' +
        '#sp-toasts { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:2147483647; display:flex; flex-direction:column; align-items:center; gap:8px; pointer-events:none; }' +
        '.sp-toast { pointer-events:auto; display:flex; align-items:center; gap:14px; min-width:280px; max-width:520px; padding:10px 10px 10px 16px; border-radius:14px;' +
        '  background:rgba(40,40,42,0.82); backdrop-filter:blur(30px) saturate(170%); -webkit-backdrop-filter:blur(30px) saturate(170%);' +
        '  border:0.5px solid rgba(255,255,255,0.14); box-shadow:0 12px 40px rgba(0,0,0,0.45); color:rgba(255,255,255,0.92);' +
        '  font:500 13px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif; opacity:0; transform:translateY(8px) scale(0.98);' +
        '  transition:opacity .2s ease, transform .32s cubic-bezier(0.32,0.72,0,1); }' +
        '.sp-toast.in { opacity:1; transform:none; }' +
        '.sp-toast-text { flex:1; min-width:0; }' +
        '.sp-toast-sub { display:block; font-weight:400; font-size:12px; color:rgba(255,255,255,0.55); margin-top:1px; }' +
        '.sp-toast button { all:unset; cursor:pointer; padding:6px 12px; border-radius:8px; font-weight:600; font-size:12.5px; background:rgba(255,255,255,0.12); color:#fff; }' +
        '.sp-toast button:hover { background:rgba(255,255,255,0.2); }' +
        '.sp-toast button:active { transform:scale(0.96); }' +
        '#sp-permission { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.35);' +
        '  opacity:0; transition:opacity .2s ease; font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif; }' +
        '#sp-permission.in { opacity:1; }' +
        '#sp-permission .sp-perm-card { width:min(340px,calc(100vw - 40px)); padding:22px 20px 16px; border-radius:16px; text-align:center; color:rgba(255,255,255,0.92);' +
        '  background:rgba(40,40,42,0.9); backdrop-filter:blur(36px) saturate(170%); -webkit-backdrop-filter:blur(36px) saturate(170%);' +
        '  border:0.5px solid rgba(255,255,255,0.14); box-shadow:0 24px 70px rgba(0,0,0,0.5); transform:scale(0.97); transition:transform .32s cubic-bezier(0.32,0.72,0,1); }' +
        '#sp-permission.in .sp-perm-card { transform:none; }' +
        '#sp-permission .sp-perm-icon { width:44px; height:44px; margin:0 auto 12px; border-radius:11px; display:flex; align-items:center; justify-content:center;' +
        '  background:rgba(255,255,255,0.1); border:0.5px solid rgba(255,255,255,0.16); font-weight:600; font-size:15px; }' +
        '#sp-permission h3 { margin:0 0 6px; font-size:14px; font-weight:600; letter-spacing:-0.01em; }' +
        '#sp-permission p { margin:0 0 12px; font-size:12px; color:rgba(255,255,255,0.6); line-height:1.45; }' +
        '#sp-permission ul { list-style:none; margin:0 0 16px; padding:0; text-align:left; }' +
        '#sp-permission li { display:flex; gap:10px; padding:8px 10px; border-radius:9px; background:rgba(255,255,255,0.05); margin-bottom:4px; font-size:12.5px; }' +
        '#sp-permission li b { font-weight:600; display:block; } #sp-permission li span { color:rgba(255,255,255,0.55); font-size:11.5px; }' +
        '#sp-permission .sp-perm-buttons { display:flex; gap:8px; }' +
        '#sp-permission button { all:unset; flex:1; cursor:pointer; padding:8px 0; border-radius:9px; font-size:13px; font-weight:500; text-align:center; background:rgba(255,255,255,0.1); }' +
        '#sp-permission button.primary { background:rgba(255,255,255,0.92); color:#111; font-weight:600; }' +
        '#sp-permission button:active { transform:scale(0.97); }' +
        '@media (prefers-reduced-motion: reduce) { .sp-toast, #sp-permission .sp-perm-card { transition:opacity .15s ease; transform:none !important; } }';

    function ensureUi() {
        if (document.getElementById('sp-runtime-ui')) return;
        var style = document.createElement('style');
        style.id = 'sp-runtime-ui';
        style.textContent = uiCss;
        document.head.appendChild(style);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    // toast({ title, message?, action?: { label, run }, duration? })
    function toast(options) {
        ensureUi();
        var stack = document.getElementById('sp-toasts');
        if (!stack) { stack = el('div'); stack.id = 'sp-toasts'; document.body.appendChild(stack); }
        var node = el('div', 'sp-toast');
        var text = el('div', 'sp-toast-text', options.title);
        if (options.message) text.appendChild(el('span', 'sp-toast-sub', options.message));
        node.appendChild(text);
        var timer = null;
        var dismiss = function () {
            native.clearTimeout(timer);
            node.classList.remove('in');
            native.setTimeout(function () { node.remove(); }, 250);
        };
        if (options.action) {
            var button = el('button', null, options.action.label);
            button.addEventListener('click', function () { dismiss(); options.action.run(); });
            node.appendChild(button);
        }
        stack.appendChild(node);
        native.requestAnimationFrame(function () { node.classList.add('in'); });
        var duration = options.duration || 5000;
        var start = function () { timer = native.setTimeout(dismiss, duration); };
        // Hovering keeps it open, so there is time to reach Undo
        node.addEventListener('mouseenter', function () { native.clearTimeout(timer); });
        node.addEventListener('mouseleave', start);
        start();
        return dismiss;
    }

    var PERMISSIONS = {
        network: ['Internet access', 'Load data from websites and services'],
        storage: ['Saved data', 'Read and write data stored in the app'],
        eval: ['Dynamic code', 'Run code it generates or downloads'],
        clipboard: ['Clipboard', 'Read and change what you have copied'],
        dom: ['Stremio pages', 'Change what Stremio shows'],
    };

    var promptQueue = Promise.resolve();
    // Resolves true (Allow) or false (Don't Allow)
    function askPermissions(name, capabilities) {
        promptQueue = promptQueue.then(function () {
            return new Promise(function (resolve) {
                ensureUi();
                var overlay = el('div');
                overlay.id = 'sp-permission';
                var card = el('div', 'sp-perm-card');
                card.setAttribute('role', 'dialog');
                card.setAttribute('aria-modal', 'true');
                var icon = el('div', 'sp-perm-icon', name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase());
                var list = el('ul');
                capabilities.forEach(function (cap) {
                    var info = PERMISSIONS[cap] || [cap, 'Requested by the plugin'];
                    var item = el('li');
                    var body = el('div');
                    body.append(el('b', null, info[0]), el('span', null, info[1]));
                    item.appendChild(body);
                    list.appendChild(item);
                });
                var deny = el('button', null, 'Don’t Allow');
                var allow = el('button', 'primary', 'Allow');
                var buttons = el('div', 'sp-perm-buttons');
                buttons.append(deny, allow);
                card.append(icon, el('h3', null, '“' + name + '” would like access to:'), list,
                    el('p', null, 'You can change this later in Stremio+ › Tools › Plugin Health.'), buttons);
                overlay.appendChild(card);
                document.body.appendChild(overlay);
                native.requestAnimationFrame(function () { overlay.classList.add('in'); });
                allow.focus();
                var close = function (result) {
                    overlay.classList.remove('in');
                    native.setTimeout(function () { overlay.remove(); }, 220);
                    resolve(result);
                };
                allow.addEventListener('click', function () { close(true); });
                deny.addEventListener('click', function () { close(false); });
                overlay.addEventListener('keydown', function (e) {
                    e.stopPropagation();
                    if (e.key === 'Escape') close(false);
                    if (e.key === 'Enter') close(true);
                });
            });
        });
        return promptQueue;
    }


    // ── Conflict tracking ────────────────────────────────────────────────────
    // While a plugin's code runs, record which page elements it changes. An
    // element changed by two plugins (or created by one, changed by another) is
    // a conflict. Container elements gaining children don't count.
    var touches = new WeakMap();     // element -> Map(pluginId -> Set(kind))
    var conflicted = [];             // [{ ref: WeakRef(element), plugins: Set, kinds: Set }]
    var conflictIndex = new WeakMap();
    var CONTAINERS = { HTML: 1, HEAD: 1, BODY: 1 };

    function touch(el, kind) {
        if (current === null || !el || el.nodeType !== 1) return;
        if (kind === 'children' && CONTAINERS[el.tagName]) return;
        var byPlugin = touches.get(el);
        if (!byPlugin) { byPlugin = new Map(); touches.set(el, byPlugin); }
        var kinds = byPlugin.get(current);
        if (!kinds) { kinds = new Set(); byPlugin.set(current, kinds); }
        kinds.add(kind);
        if (byPlugin.size < 2) return;
        var entry = conflictIndex.get(el);
        if (!entry) {
            entry = { ref: new WeakRef(el), plugins: new Set(), kinds: new Set() };
            conflictIndex.set(el, entry);
            conflicted.push(entry);
            if (conflicted.length > 200) conflicted.shift();
            emit('conflict', null);
        }
        byPlugin.forEach(function (k, id) { entry.plugins.add(id); k.forEach(function (x) { entry.kinds.add(x); }); });
    }

    function wrapMethod(proto, name, kindFor) {
        var original = proto[name];
        if (typeof original !== 'function') return;
        proto[name] = function () {
            if (current !== null) kindFor(this, arguments);
            return original.apply(this, arguments);
        };
    }

    function wrapSetter(proto, name, kind) {
        var desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc || !desc.set) return;
        Object.defineProperty(proto, name, Object.assign({}, desc, {
            set: function (v) { if (current !== null) touch(this, kind); return desc.set.call(this, v); },
        }));
    }

    ['setAttribute', 'removeAttribute', 'toggleAttribute'].forEach(function (m) {
        wrapMethod(Element.prototype, m, function (el, args) { touch(el, String(args[0]) === 'class' ? 'class' : String(args[0]) === 'style' ? 'style' : 'attributes'); });
    });
    wrapSetter(Element.prototype, 'className', 'class');
    wrapSetter(Element.prototype, 'innerHTML', 'content');
    wrapSetter(Element.prototype, 'outerHTML', 'content');
    wrapSetter(Node.prototype, 'textContent', 'content');
    var moved = function (node) { if (node && node.nodeType === 1 && node.isConnected) touch(node, 'position'); };
    wrapMethod(Node.prototype, 'appendChild', function (el, a) { moved(a[0]); touch(el, 'children'); });
    wrapMethod(Node.prototype, 'insertBefore', function (el, a) { moved(a[0]); touch(el, 'children'); });
    wrapMethod(Node.prototype, 'replaceChild', function (el, a) { touch(a[1], 'removed'); touch(el, 'children'); });
    wrapMethod(Node.prototype, 'removeChild', function (el, a) { touch(a[0], 'removed'); });
    wrapMethod(Element.prototype, 'remove', function (el) { touch(el, 'removed'); });
    ['append', 'prepend'].forEach(function (m) { wrapMethod(Element.prototype, m, function (el, a) { Array.prototype.forEach.call(a, moved); touch(el, 'children'); }); });
    ['before', 'after', 'replaceWith'].forEach(function (m) { wrapMethod(Element.prototype, m, function (el) { touch(el, 'position'); }); });

    // classList and style objects don't know their element; remember it when a plugin asks for them
    var owners = new WeakMap();
    var classListDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
    Object.defineProperty(Element.prototype, 'classList', Object.assign({}, classListDesc, {
        get: function () { var list = classListDesc.get.call(this); if (current !== null) owners.set(list, this); return list; },
    }));
    ['add', 'remove', 'toggle', 'replace'].forEach(function (m) {
        wrapMethod(DOMTokenList.prototype, m, function (list) { touch(owners.get(list), 'class'); });
    });
    // element.style: while a plugin runs, hand it a proxy that records writes
    // (style properties aren't patchable setters in every Chromium version)
    var styleDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
    var styleProxies = new WeakMap();
    Object.defineProperty(HTMLElement.prototype, 'style', Object.assign({}, styleDesc, {
        get: function () {
            var decl = styleDesc.get.call(this);
            if (current === null) return decl;
            var element = this;
            var proxy = styleProxies.get(decl);
            if (!proxy) {
                proxy = new Proxy(decl, {
                    get: function (target, prop) {
                        var value = target[prop];
                        if (typeof value !== 'function') return value;
                        if (prop === 'setProperty' || prop === 'removeProperty') {
                            return function () { touch(element, 'style'); return value.apply(target, arguments); };
                        }
                        return value.bind(target);
                    },
                    set: function (target, prop, value) { touch(element, 'style'); target[prop] = value; return true; },
                });
                styleProxies.set(decl, proxy);
            }
            return proxy;
        },
    }));

    // Elements a plugin creates count as its own; <style>/<link> ones are kept for CSS checks
    var styleSheets = [];   // [{ plugin, ref: WeakRef(element) }]
    var createElement = Document.prototype.createElement;
    Document.prototype.createElement = function (tag) {
        var el = createElement.apply(this, arguments);
        if (current !== null) {
            var byPlugin = new Map();
            byPlugin.set(current, new Set(['created']));
            touches.set(el, byPlugin);
            if (/^(style|link)$/i.test(tag)) styleSheets.push({ plugin: current, ref: new WeakRef(el) });
        }
        return el;
    };

    function describe(el) {
        var text = el.tagName.toLowerCase();
        if (el.id) text += '#' + el.id;
        var classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
        if (classes.length) text += '.' + classes.join('.');
        return text;
    }

    function listConflicts() {
        return conflicted.map(function (c) {
            var el = c.ref.deref();
            if (!el || !el.isConnected) return null;
            return { element: el, label: describe(el), plugins: Array.from(c.plugins), kinds: Array.from(c.kinds).filter(function (k) { return k !== 'created'; }), created: Array.from(c.kinds).indexOf('created') !== -1 };
        }).filter(Boolean);
    }

    function pluginStyleSheets() {
        return styleSheets.map(function (s) {
            var el = s.ref.deref();
            return el && el.isConnected && el.sheet ? { plugin: s.plugin, sheet: el.sheet, element: el } : null;
        }).filter(Boolean);
    }

    // ── Update review: line diff + sheet ────────────────────────────────────
    // Returns [{ op: ' ' | '+' | '-', text, a, b }] (a/b: old/new line numbers)
    function diffLines(oldText, newText) {
        var a = oldText.split('\n'), b = newText.split('\n');
        var start = 0;
        while (start < a.length && start < b.length && a[start] === b[start]) start++;
        var endA = a.length, endB = b.length;
        while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
        var ops = [];
        for (var i = 0; i < start; i++) ops.push({ op: ' ', text: a[i], a: i + 1, b: i + 1 });
        var n = endA - start, m = endB - start;
        if (n * m <= 4000000 && n < 65535 && m < 65535) {
            // Longest common subsequence over the changed middle only
            var w = m + 1, table = new Uint16Array((n + 1) * w);
            for (var x = n - 1; x >= 0; x--) {
                for (var y = m - 1; y >= 0; y--) {
                    table[x * w + y] = a[start + x] === b[start + y] ? table[(x + 1) * w + y + 1] + 1 : Math.max(table[(x + 1) * w + y], table[x * w + y + 1]);
                }
            }
            var x2 = 0, y2 = 0;
            while (x2 < n && y2 < m) {
                if (a[start + x2] === b[start + y2]) { ops.push({ op: ' ', text: a[start + x2], a: start + x2 + 1, b: start + y2 + 1 }); x2++; y2++; }
                else if (table[(x2 + 1) * w + y2] >= table[x2 * w + y2 + 1]) { ops.push({ op: '-', text: a[start + x2], a: start + x2 + 1 }); x2++; }
                else { ops.push({ op: '+', text: b[start + y2], b: start + y2 + 1 }); y2++; }
            }
            for (; x2 < n; x2++) ops.push({ op: '-', text: a[start + x2], a: start + x2 + 1 });
            for (; y2 < m; y2++) ops.push({ op: '+', text: b[start + y2], b: start + y2 + 1 });
        } else {
            for (var r = start; r < endA; r++) ops.push({ op: '-', text: a[r], a: r + 1 });
            for (var t = start; t < endB; t++) ops.push({ op: '+', text: b[t], b: t + 1 });
        }
        for (var k = 0; k < a.length - endA; k++) ops.push({ op: ' ', text: a[endA + k], a: endA + k + 1, b: endB + k + 1 });
        return ops;
    }

    var reviewCss = '' +
        '#sp-review { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.35);' +
        '  opacity:0; transition:opacity .2s ease; font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif; }' +
        '#sp-review.in { opacity:1; }' +
        '#sp-review .rv-card { width:min(860px,calc(100vw - 40px)); height:min(80vh,760px); display:flex; flex-direction:column; border-radius:16px; color:rgba(255,255,255,0.92);' +
        '  background:rgba(36,36,38,0.92); backdrop-filter:blur(36px) saturate(170%); -webkit-backdrop-filter:blur(36px) saturate(170%);' +
        '  border:0.5px solid rgba(255,255,255,0.14); box-shadow:0 24px 70px rgba(0,0,0,0.5); transform:scale(0.98); transition:transform .32s cubic-bezier(0.32,0.72,0,1); overflow:hidden; }' +
        '#sp-review.in .rv-card { transform:none; }' +
        '#sp-review .rv-head { padding:18px 20px 12px; border-bottom:0.5px solid rgba(255,255,255,0.09); }' +
        '#sp-review h3 { margin:0; font-size:15px; font-weight:600; letter-spacing:-0.01em; }' +
        '#sp-review .rv-meta { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:6px; font-size:12.5px; color:rgba(255,255,255,0.55); }' +
        '#sp-review .rv-meta b { color:rgba(255,255,255,0.85); font-weight:600; }' +
        '#sp-review .rv-add { color:#30d158; } #sp-review .rv-del { color:#ff6961; }' +
        '#sp-review .rv-warn { margin-top:10px; padding:8px 10px; border-radius:8px; font-size:12.5px; background:rgba(255,214,10,0.1); color:#ffd60a; }' +
        '#sp-review .rv-diff { flex:1; overflow:auto; font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; padding:6px 0; }' +
        '#sp-review .rv-line { display:grid; grid-template-columns:44px 44px 16px 1fr; white-space:pre-wrap; word-break:break-word; padding:0 12px 0 0; }' +
        '#sp-review .rv-line span { color:rgba(255,255,255,0.3); text-align:right; padding-right:8px; user-select:none; }' +
        '#sp-review .rv-line.add { background:rgba(48,209,88,0.12); } #sp-review .rv-line.del { background:rgba(255,69,58,0.13); }' +
        '#sp-review .rv-line.add i { color:#30d158; } #sp-review .rv-line.del i { color:#ff6961; } #sp-review .rv-line i { font-style:normal; }' +
        '#sp-review .rv-gap { padding:4px 0 4px 104px; color:rgba(255,255,255,0.35); background:rgba(255,255,255,0.03); font-size:11px; }' +
        '#sp-review .rv-foot { display:flex; align-items:center; gap:8px; padding:12px 16px; border-top:0.5px solid rgba(255,255,255,0.09); font-size:12px; color:rgba(255,255,255,0.45); }' +
        '#sp-review .rv-foot span { flex:1; }' +
        '#sp-review button { all:unset; cursor:pointer; padding:7px 16px; border-radius:8px; font-size:13px; font-weight:500; background:rgba(255,255,255,0.1); }' +
        '#sp-review button.primary { background:rgba(255,255,255,0.92); color:#111; font-weight:600; }' +
        '#sp-review button:active { transform:scale(0.97); }';

    // Resolves true (Install) or false (Skip)
    function reviewUpdate(info) {
        promptQueue = promptQueue.then(function () {
            return new Promise(function (resolve) {
                ensureUi();
                if (!document.getElementById('sp-review-style')) {
                    var style = el('style'); style.id = 'sp-review-style'; style.textContent = reviewCss; document.head.appendChild(style);
                }
                var ops = diffLines(info.oldText, info.newText);
                var added = ops.filter(function (o) { return o.op === '+'; }).length;
                var removed = ops.filter(function (o) { return o.op === '-'; }).length;
                var newPerms = (info.newPermissions || []).filter(function (p) { return (info.oldPermissions || []).indexOf(p) === -1; });

                var diff = el('div', 'rv-diff');
                var CONTEXT = 3;
                var show = ops.map(function (o, i) {
                    if (o.op !== ' ') return true;
                    for (var d = -CONTEXT; d <= CONTEXT; d++) { var n = ops[i + d]; if (n && n.op !== ' ') return true; }
                    return false;
                });
                var hidden = 0;
                var flushGap = function () { if (hidden) { diff.appendChild(el('div', 'rv-gap', '⋯ ' + hidden + ' unchanged line' + (hidden === 1 ? '' : 's'))); hidden = 0; } };
                ops.forEach(function (o, i) {
                    if (!show[i]) { hidden++; return; }
                    flushGap();
                    var row = el('div', 'rv-line' + (o.op === '+' ? ' add' : o.op === '-' ? ' del' : ''));
                    row.append(el('span', null, o.a || ''), el('span', null, o.b || ''), el('i', null, o.op === ' ' ? '' : o.op), document.createTextNode(o.text || ' '));
                    diff.appendChild(row);
                });
                flushGap();
                if (!added && !removed) diff.appendChild(el('div', 'rv-gap', 'No changes in the file.'));

                var head = el('div', 'rv-head');
                head.appendChild(el('h3', null, 'Update “' + info.name + '”?'));
                var meta = el('div', 'rv-meta');
                var ver = el('div');
                ver.append('Version ', el('b', null, info.fromVersion), ' → ', el('b', null, info.toVersion));
                var counts = el('div');
                counts.append(el('span', 'rv-add', '+' + added), ' ', el('span', 'rv-del', '−' + removed), ' lines');
                meta.append(ver, counts, el('div', null, info.kind === 'Theme' ? 'Theme' : 'Plugin'));
                head.appendChild(meta);
                if (newPerms.length) head.appendChild(el('div', 'rv-warn', 'This version also asks for: ' + newPerms.join(', ') + '. You’ll be asked to allow it when it runs.'));

                var skip = el('button', null, 'Skip');
                var install = el('button', 'primary', 'Install Update');
                var foot = el('div', 'rv-foot');
                foot.append(el('span', null, info.kind === 'Theme' ? 'Your current version is kept as a backup.' : 'Your current version is kept, and restored automatically if the update keeps failing.'), skip, install);

                var overlay = el('div');
                overlay.id = 'sp-review';
                var card = el('div', 'rv-card');
                card.setAttribute('role', 'dialog');
                card.setAttribute('aria-modal', 'true');
                card.append(head, diff, foot);
                overlay.appendChild(card);
                document.body.appendChild(overlay);
                native.requestAnimationFrame(function () { overlay.classList.add('in'); });
                install.focus();
                var close = function (result) {
                    overlay.classList.remove('in');
                    native.setTimeout(function () { overlay.remove(); }, 220);
                    resolve(result);
                };
                skip.addEventListener('click', function () { close(false); });
                install.addEventListener('click', function () { close(true); });
                overlay.addEventListener('keydown', function (e) {
                    e.stopPropagation();
                    if (e.key === 'Escape') close(false);
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close(true);
                });
            });
        });
        return promptQueue;
    }

    window.__spRuntime = {
        native: native,
        events: events,
        scope: scope,
        register: function (id, info) { return Object.assign(getRecord(id), info); },
        get: function (id) { return plugins.get(id); },
        all: function () { return Array.from(plugins.values()); },
        teardown: teardown,
        health: health,
        logs: function () { return logs.slice(); },
        clearLogs: function () { logs.length = 0; emit('log', null); },
        toast: toast,
        askPermissions: askPermissions,
        permissionInfo: PERMISSIONS,
        conflicts: listConflicts,
        pluginStyleSheets: pluginStyleSheets,
        reviewUpdate: reviewUpdate,
        diffLines: diffLines,
    };
})();
