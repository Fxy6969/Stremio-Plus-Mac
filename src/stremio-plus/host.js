// Stremio+ host for the Qt shell: provides what Stremio Plus's Electron
// preload/main process did — the plugin API, plugin loading, the active theme
// and the __stElectronIPC__ commands used by the Stremio+ menu (panel.js).
// File access goes through the native `modBridge` WebChannel object.
(function () {
    if (window.__stremioPlusHost) return;
    window.__stremioPlusHost = true;

    var APP_META = { version: '26.0.0-mac', author: 'Fxy6969', github_url: 'https://github.com/Fxy6969/Stremio-Plus' };
    var PLUGIN_EXT = '.plugin.js';
    var THEME_EXT = '.theme.css';
    var PLUGIN_CONFIG_EXT = '.plugin.json';
    var BACKENDS = ['service', 'mpv', 'server', 'native'];

    var log = function (level, scope, message) {
        console[level]('[StremioPlus' + (scope ? ':' + scope : '') + '] ' + message);
    };

    // ── Native bridge ────────────────────────────────────────────────────────
    var bridgeReady = window.__stremioPlusChannel.then(function (objects) { return objects.modBridge; });

    // Wraps a modBridge slot so it returns a promise
    function native(method) {
        var args = Array.prototype.slice.call(arguments, 1);
        return bridgeReady.then(function (bridge) {
            return new Promise(function (resolve) { bridge[method].apply(bridge, args.concat([resolve])); });
        });
    }

    var fetchRequests = {};
    var nextFetchId = 1;
    bridgeReady.then(function (bridge) {
        bridge.fetchFinished.connect(function (id, ok, status, text) {
            var request = fetchRequests[id];
            delete fetchRequests[id];
            if (!request) return;
            if (ok) request.resolve(text);
            else request.reject(new Error('HTTP ' + status + ': ' + text));
        });
    });

    // HTTPS GET done natively, so mod downloads are not subject to CORS
    function fetchText(url) {
        return bridgeReady.then(function (bridge) {
            return new Promise(function (resolve, reject) {
                var id = nextFetchId++;
                fetchRequests[id] = { resolve: resolve, reject: reject };
                bridge.fetchText(id, url);
            });
        });
    }

    function readJson(relPath, fallback) {
        return native('readText', relPath).then(function (text) {
            if (text === null || !String(text).trim()) return fallback;
            try { return JSON.parse(text); } catch (e) { return fallback; }
        });
    }

    function writeJson(relPath, value) {
        return native('writeText', relPath, JSON.stringify(value, null, 2));
    }

    function safeName(name) {
        return String(name).replace(/[^a-zA-Z0-9\-_]/g, '-');
    }

    // ── Metadata (port of Stremio Plus utils/ExtractMetaData.ts) ─────────────
    function parseFields(header) {
        var fields = {};
        header.split('\n').forEach(function (rawLine) {
            var line = rawLine.trim().replace(/^\/\//, '').replace(/^\*/, '').trim();
            if (line.charAt(0) !== '@') return;
            var rest = line.slice(1);
            var spaceIdx = rest.search(/\s/);
            if (spaceIdx === -1) return;
            var key = rest.slice(0, spaceIdx).trim();
            (fields[key] = fields[key] || []).push(rest.slice(spaceIdx).trim());
        });
        return fields;
    }

    function parseSetting(raw) {
        var parts = raw.split('|').map(function (s) { return s.trim(); });
        if (parts.length < 4) return null;
        var kind = parts[1];
        if (['toggle', 'color', 'range', 'text', 'select'].indexOf(kind) === -1) return null;

        var setting = { key: parts[0], kind: kind, label: parts[2], default: parts[3], options: [] };
        if (kind === 'range' && parts.length >= 7) {
            setting.hint = parts[4] || undefined;
            setting.min = parseFloat(parts[5]);
            setting.max = parseFloat(parts[6]);
            if (parts[7] !== undefined) setting.step = parseFloat(parts[7]);
        } else if (kind === 'select' && parts.length >= 5) {
            setting.options = parts[4].split(',').map(function (s) { return s.trim(); });
        } else if (parts.length >= 5 && kind !== 'range' && kind !== 'select') {
            setting.hint = parts[4] || undefined;
        }
        ['min', 'max', 'step'].forEach(function (k) { if (isNaN(setting[k])) delete setting[k]; });
        return setting;
    }

    function extractMetadata(source, isTheme) {
        var open = isTheme ? '/* ==Theme==' : '// ==Plugin==';
        var close = isTheme ? '==/Theme== */' : '// ==/Plugin==';
        var header = null;

        var start = source.indexOf(open);
        var end = source.indexOf(close);
        if (start !== -1 && end !== -1 && end > start) {
            header = source.slice(start + open.length, end);
        } else {
            // Fallback: JSDoc-style block comment
            var bStart = source.indexOf('/*');
            var bEnd = source.indexOf('*/', bStart + 2);
            if (bStart !== -1 && bEnd !== -1) {
                var candidate = source.slice(bStart + 2, bEnd);
                if (candidate.indexOf('@name') !== -1) header = candidate;
            }
        }
        if (header === null) return null;

        var fields = parseFields(header);
        var get = function (k) { return fields[k] ? fields[k][0] : undefined; };
        var getAll = function (k) { return fields[k] || []; };

        return {
            name: get('name') || 'Unnamed',
            version: get('version') || '0.0.0',
            description: get('description') || '',
            author: get('author') || '',
            updateUrl: get('updateUrl') || get('update_url'),
            github: get('github'),
            permissions: getAll('permission').map(function (p) { return p.toLowerCase(); }),
            requires: getAll('require').map(function (v) {
                var idx = v.indexOf('>=');
                return idx !== -1 ? { name: v.slice(0, idx).trim(), minVersion: v.slice(idx + 2).trim() } : { name: v.trim() };
            }),
            settings: getAll('setting').map(parseSetting).filter(Boolean),
        };
    }

    function compareVersions(a, b) {
        var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var d = (pa[i] || 0) - (pb[i] || 0);
            if (d) return d > 0 ? 1 : -1;
        }
        return 0;
    }

    // ── Mod inventory ────────────────────────────────────────────────────────
    function scanMods() {
        return Promise.all([
            native('listFiles', 'plugins', PLUGIN_EXT),
            native('listFiles', 'themes', THEME_EXT),
            readJson('enabled_plugins.json', null),
            native('readText', 'applied_theme.txt'),
        ]).then(function (results) {
            var toMods = function (files, kind) {
                return dedupeByName(files.map(function (f) {
                    var meta = extractMetadata(f.text, kind === 'Theme');
                    return meta && { file: f.file, text: f.text, kind: kind, meta: meta };
                }).filter(Boolean), kind === 'Theme' ? THEME_EXT : PLUGIN_EXT);
            };
            return {
                plugins: sortByDependencies(toMods(results[0], 'Plugin')),
                themes: toMods(results[1], 'Theme'),
                // null means no enabled_plugins.json yet: everything counts as enabled
                enabled: Array.isArray(results[2]) ? results[2] : null,
                appliedTheme: (results[3] || '').trim() || null,
            };
        });
    }

    // Enabled state is keyed by name, so several files declaring the same @name
    // would all load and fight over the page. Keep one per name: the highest
    // @version, then the file name install_from_url would write.
    function dedupeByName(mods, ext) {
        var chosen = {};
        mods.forEach(function (m) {
            var current = chosen[m.meta.name];
            var canonical = safeName(m.meta.name) + ext;
            var cmp = current ? compareVersions(m.meta.version, current.meta.version) : 1;
            if (cmp > 0 || (cmp === 0 && m.file === canonical)) chosen[m.meta.name] = m;
        });
        var kept = mods.filter(function (m) { return chosen[m.meta.name] === m; });
        mods.forEach(function (m) {
            if (chosen[m.meta.name] !== m)
                log('warn', '', 'Ignoring ' + m.file + ': duplicate of "' + m.meta.name + '" (using ' + chosen[m.meta.name].file + ')');
        });
        return kept;
    }

    // @require dependencies load first; cycles are logged and broken
    function sortByDependencies(plugins) {
        var byName = {};
        plugins.forEach(function (p, i) { byName[p.meta.name] = i; });
        var visited = {}, visiting = {}, order = [];
        var visit = function (i) {
            if (visited[i]) return;
            if (visiting[i]) return log('warn', 'deps', 'Dependency cycle involving "' + plugins[i].meta.name + '"');
            visiting[i] = true;
            plugins[i].meta.requires.forEach(function (req) {
                if (byName[req.name] !== undefined) visit(byName[req.name]);
            });
            delete visiting[i];
            visited[i] = true;
            order.push(i);
        };
        plugins.forEach(function (_, i) { visit(i); });
        return order.map(function (i) { return plugins[i]; });
    }

    function isEnabled(mods, name) {
        return mods.enabled === null || mods.enabled.indexOf(name) !== -1;
    }

    function findMod(mods, name, kind, file) {
        var all = mods.plugins.concat(mods.themes);
        return all.find(function (m) { return file && m.file === file; })
            || all.find(function (m) { return m.meta.name === name && (!kind || m.kind === kind); });
    }

    // ── Plugin API (window.StremioEnhancedAPI) ───────────────────────────────
    var registeredSchemas = {};
    var settingsListeners = {};

    function pluginConfigPath(pluginBaseName) {
        return 'plugins/' + pluginBaseName + PLUGIN_CONFIG_EXT;
    }

    function showAlert(type, title, message, buttons) {
        buttons = buttons && buttons.length ? buttons : ['OK'];
        var text = (title ? title + '\n\n' : '') + (message || '');
        if (buttons.length === 1) { window.alert(text); return Promise.resolve(0); }
        return Promise.resolve(window.confirm(text + '\n\n[OK] ' + buttons[0] + '   [Cancel] ' + buttons[1]) ? 0 : 1);
    }

    window.StremioEnhancedAPI = {
        info: function (plugin, message) { log('info', plugin, message); },
        warn: function (plugin, message) { log('warn', plugin, message); },
        error: function (plugin, message) { log('error', plugin, message); },
        getSettings: function (plugin) { return readJson(pluginConfigPath(plugin), {}); },
        getSetting: function (plugin, key) {
            return readJson(pluginConfigPath(plugin), {}).then(function (config) {
                return config[key] !== undefined ? config[key] : null;
            });
        },
        saveSetting: function (plugin, key, value) {
            return readJson(pluginConfigPath(plugin), {}).then(function (config) {
                config[key] = value;
                return writeJson(pluginConfigPath(plugin), config).then(function () {
                    (settingsListeners[plugin] || []).forEach(function (cb) {
                        try { cb(config); } catch (e) { console.error(e); }
                    });
                    return true;
                });
            });
        },
        registerSettings: function (plugin, schema) {
            if (!Array.isArray(schema)) return Promise.reject(new Error('Invalid plugin options schema.'));
            registeredSchemas[plugin] = schema;
            return Promise.resolve(true);
        },
        getRegisteredSettings: function (plugin) { return Promise.resolve(registeredSchemas[plugin] || null); },
        clearRegisteredSettings: function (plugin) { delete registeredSchemas[plugin]; return Promise.resolve(true); },
        onSettingsSaved: function (plugin, callback) { settingsListeners[plugin] = [callback]; },
        showAlert: showAlert,
        showPrompt: function (_id, title, message, defaultValue) {
            return Promise.resolve(window.prompt((title ? title + '\n\n' : '') + (message || ''), defaultValue || ''));
        },
        applyTheme: function (themeFile) { return applyThemeFile(themeFile === 'Default' ? null : themeFile); },
    };

    // ── Plugins and themes on the page ───────────────────────────────────────
    var runtime = window.__spRuntime;
    var permissions = {};   // plugin name -> { allowed: [], denied: [] }, from permissions.json

    function pluginId(mod, dev) {
        return (dev ? 'dev:' : '') + mod.file.split(PLUGIN_EXT)[0];
    }

    // Plugins run inside a scope from runtime.js: timers, observers, network,
    // storage and console are per plugin, so they can be measured and stopped
    function loadPlugin(mod, savedSettings, dev) {
        var id = pluginId(mod, dev);
        var elementId = dev ? 'dev:' + mod.file : mod.file;
        if (document.getElementById(elementId)) return;
        var base = mod.file.split(PLUGIN_EXT)[0];
        var q = JSON.stringify(base);
        var granted = permissions[mod.meta.name] || {};
        runtime.register(id, {
            name: mod.meta.name, file: elementId, version: mod.meta.version, dev: !!dev, kind: mod.kind,
            declared: mod.meta.permissions || [], denied: (granted.denied || []).slice(),
        });

        var script = document.createElement('script');
        script.id = elementId;
        script.textContent =
            '(function() {\n' +
            '  const __sp = window.__spRuntime.scope(' + JSON.stringify(id) + ');\n' +
            '  const { setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame,\n' +
            '          MutationObserver, fetch, XMLHttpRequest, WebSocket, console, localStorage, sessionStorage } = __sp;\n' +
            '  const StremioEnhancedAPI = {\n' +
            '    logger: {\n' +
            '      info: (m) => console.info(m),\n' +
            '      warn: (m) => console.warn(m),\n' +
            '      error: (m) => console.error(m)\n' +
            '    },\n' +
            '    getSetting: (key) => window.StremioEnhancedAPI.getSetting(' + q + ', key),\n' +
            '    saveSetting: (key, value) => window.StremioEnhancedAPI.saveSetting(' + q + ', key, value),\n' +
            '    registerSettings: (schema) => window.StremioEnhancedAPI.registerSettings(' + q + ', schema),\n' +
            '    onSettingsSaved: (cb) => window.StremioEnhancedAPI.onSettingsSaved(' + q + ', cb),\n' +
            '    showAlert: window.StremioEnhancedAPI.showAlert,\n' +
            '    showPrompt: (title, message, def) => window.StremioEnhancedAPI.showPrompt(' + q + ', title, message, def)\n' +
            '  };\n' +
            '  const __stSaved__ = ' + JSON.stringify(savedSettings || {}) + ';\n' +
            '  const __stGet__ = (key, def, cast) => () => (__stSaved__[key] !== undefined && __stSaved__[key] !== null) ? cast(__stSaved__[key]) : def;\n' +
            '  const StremioSettings = { for() { return {\n' +
            '    toggle: (key, label, def) => __stGet__(key, def, (v) => String(v) === "true"),\n' +
            '    color: (key, label, def) => __stGet__(key, def, String),\n' +
            '    slider: (key, label, def) => __stGet__(key, def, Number),\n' +
            '    text: (key, label, def) => __stGet__(key, def, String),\n' +
            '    enum: (key, label, def) => __stGet__(key, def, String)\n' +
            '  }; } };\n' +
            '  __sp.enter();\n' +
            '  try {\n' + mod.text + '\n  } catch (err) {\n' +
            '    __sp.crashed(err);\n' +
            '    try {\n' +
            '      const wk = "sxp_errors_" + ' + q + ';\n' +
            '      const times = JSON.parse(window.localStorage.getItem(wk) || "[]").concat([Date.now()]).filter((t) => t > Date.now() - 604800000);\n' +
            '      window.localStorage.setItem(wk, JSON.stringify(times));\n' +
            '      window.localStorage.setItem("sxp_lastcrash_" + ' + q + ', String(Date.now()));\n' +
            '    } catch (_) {}\n' +
            '  } finally {\n' +
            '    __sp.exit();\n' +
            '  }\n' +
            '})();';

        document.body.appendChild(script);
        localStorage.setItem('sxp_coldstart_' + base, String((runtime.get(id) || {}).coldStartMs || 0));
        log('info', '', 'Plugin ' + elementId + ' loaded');
    }

    function loadPluginLive(mod, dev) {
        return readJson(pluginConfigPath(mod.file.split(PLUGIN_EXT)[0]), {}).then(function (config) {
            return ensurePermissions(mod).then(function () { loadPlugin(mod, config, dev); });
        });
    }

    // First run (or a newly declared permission): ask, remember the answer
    function ensurePermissions(mod, dev) {
        var declared = mod.meta.permissions || [];
        var known = permissions[mod.meta.name] || { allowed: [], denied: [] };
        var pending = declared.filter(function (c) { return known.allowed.indexOf(c) === -1 && known.denied.indexOf(c) === -1; });
        if (!pending.length || dev) return Promise.resolve();
        return runtime.askPermissions(mod.meta.name, pending).then(function (allow) {
            known[allow ? 'allowed' : 'denied'] = known[allow ? 'allowed' : 'denied'].concat(pending);
            permissions[mod.meta.name] = known;
            return writeJson('permissions.json', permissions);
        });
    }

    function setPermission(name, capability, allow) {
        var known = permissions[name] || { allowed: [], denied: [] };
        known.allowed = known.allowed.filter(function (c) { return c !== capability; });
        known.denied = known.denied.filter(function (c) { return c !== capability; });
        known[allow ? 'allowed' : 'denied'].push(capability);
        permissions[name] = known;
        return writeJson('permissions.json', permissions);
    }

    function setThemeStyle(name, css) {
        document.getElementById('activeTheme') && document.getElementById('activeTheme').remove();
        document.querySelectorAll('style[data-plugin]').forEach(function (e) { e.remove(); });
        if (css === null) return;
        var style = document.createElement('style');
        style.id = 'activeTheme';
        style.dataset.plugin = name;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function applyThemeFile(file) {
        if (!file) {
            setThemeStyle(null, null);
            localStorage.setItem('currentTheme', 'Default');
            return Promise.resolve();
        }
        return native('readText', 'themes/' + file).then(function (css) {
            if (css === null) return applyThemeFile(null);
            var meta = extractMetadata(css, true);
            setThemeStyle(meta ? meta.name : file, css);
            localStorage.setItem('currentTheme', file);
        });
    }

    // Startup: same order as the Electron preload's window "load" handler
    function startMods() {
        patchReactDom();
        if (!localStorage.getItem('enabledPlugins')) localStorage.setItem('enabledPlugins', '[]');

        Promise.all([scanMods(), readJson('permissions.json', {})]).then(function (results) {
            var mods = results[0];
            permissions = results[1] || {};
            var current = localStorage.getItem('currentTheme');
            if (current && current !== 'Default') {
                var theme = mods.themes.find(function (t) { return t.file === current; });
                if (theme) setThemeStyle(theme.meta.name, theme.text);
                else localStorage.setItem('currentTheme', 'Default');
            }

            var toLoad = mods.plugins.filter(function (p) { return isEnabled(mods, p.meta.name); });
            localStorage.setItem('enabledPlugins', JSON.stringify(toLoad.map(function (p) { return p.file; })));
            return Promise.all(toLoad.map(function (p) {
                return readJson(pluginConfigPath(p.file.split(PLUGIN_EXT)[0]), {});
            })).then(function (configs) {
                // Plugins that need a permission decision wait for it; the rest load right away
                return Promise.all(toLoad.map(function (p, i) {
                    return ensurePermissions(p).then(function () {
                        try { loadPlugin(p, configs[i]); } catch (e) { console.error(e); }
                    });
                }));
            });
        }).then(startUpdateTrials)
          .then(function () { if (devModeEnabled()) startDevMode(); })
          .catch(function (e) { log('error', '', 'Loading mods failed: ' + e); });
    }

    // ── Safe updates ─────────────────────────────────────────────────────────
    // An updated plugin runs on trial for one app session. If it keeps throwing
    // errors it is rolled back to the copy saved in backup/.
    var TRIAL_ERROR_LIMIT = 3;
    var SESSION_KEY = 'sp_session_id';
    var sessionId = sessionStorage.getItem(SESSION_KEY) || String(Date.now());
    sessionStorage.setItem(SESSION_KEY, sessionId);

    function startUpdateTrials() {
        return readJson('updates.json', {}).then(function (updates) {
            var changed = false;
            Object.keys(updates).forEach(function (file) {
                var entry = updates[file];
                if (entry.kind !== 'Plugin') { delete updates[file]; changed = true; return; }
                if (entry.trial && entry.trial !== sessionId) {
                    // Survived a whole session: keep the update
                    delete updates[file];
                    changed = true;
                    return;
                }
                if (!entry.trial) { entry.trial = sessionId; changed = true; }
                watchTrial(file, entry);
            });
            if (changed) return writeJson('updates.json', updates);
        });
    }

    function watchTrial(file, entry) {
        var id = file.split(PLUGIN_EXT)[0];
        var errors = (runtime.get(id) || { errors: [] }).errors.length;
        var check = function () {
            if (errors >= TRIAL_ERROR_LIMIT) {
                runtime.events.removeEventListener('plugin-error', onError);
                rollback(file, errors + ' errors after updating to v' + entry.to);
            }
        };
        var onError = function (e) { if (e.detail.id === id) { errors++; check(); } };
        runtime.events.addEventListener('plugin-error', onError);
        check();
    }

    function rollback(file, reason) {
        return readJson('updates.json', {}).then(function (updates) {
            var entry = updates[file];
            if (!entry) throw new Error('No saved copy of ' + file);
            return native('readText', entry.backup).then(function (old) {
                if (old === null) throw new Error('The saved copy of ' + file + ' is missing');
                return native('writeText', 'plugins/' + file, old).then(function () {
                    delete updates[file];
                    return writeJson('updates.json', updates);
                }).then(function () {
                    var id = file.split(PLUGIN_EXT)[0];
                    var wasRunning = (runtime.get(id) || {}).status === 'running';
                    runtime.teardown(id);
                    runtime.toast({
                        title: 'Rolled back \u201C' + entry.name + '\u201D to v' + entry.from,
                        message: reason || 'Restored the version you had before the update.',
                        duration: 8000,
                    });
                    if (wasRunning) {
                        var meta = extractMetadata(old, false);
                        if (meta) return loadPluginLive({ file: file, text: old, kind: 'Plugin', meta: meta });
                    }
                });
            });
        });
    }

    // ── Dev mode: plugins in dev/ load on top of the others and hot-reload on save
    var DEV_KEY = 'sp_dev_mode';
    var devTexts = {};
    var devWatching = false;

    function devModeEnabled() {
        return localStorage.getItem(DEV_KEY) === '1';
    }

    function syncDevPlugins(announce) {
        return native('listFiles', 'dev', PLUGIN_EXT).then(function (files) {
            var seen = {};
            files.forEach(function (f) {
                seen[f.file] = true;
                if (devTexts[f.file] === f.text) return;
                var meta = extractMetadata(f.text, false) || { name: f.file, version: '0.0.0', permissions: [], requires: [], settings: [] };
                var mod = { file: f.file, text: f.text, kind: 'Plugin', meta: meta };
                var reloading = devTexts[f.file] !== undefined;
                runtime.teardown(pluginId(mod, true));
                devTexts[f.file] = f.text;
                loadPlugin(mod, {}, true);
                if (announce) runtime.toast({ title: (reloading ? 'Reloaded ' : 'Loaded ') + meta.name, message: 'dev/' + f.file, duration: 1800 });
            });
            Object.keys(devTexts).forEach(function (file) {
                if (seen[file]) return;
                runtime.teardown('dev:' + file.split(PLUGIN_EXT)[0]);
                delete devTexts[file];
            });
        });
    }

    function startDevMode() {
        syncDevPlugins(false);
        if (devWatching) return;
        devWatching = true;
        bridgeReady.then(function (bridge) {
            bridge.dirChanged.connect(function (dir) {
                if (dir === 'dev' && devModeEnabled()) syncDevPlugins(true);
            });
            bridge.watchDir('dev');
        });
    }

    function setDevMode(on) {
        localStorage.setItem(DEV_KEY, on ? '1' : '0');
        if (on) return startDevMode();
        Object.keys(devTexts).forEach(function (file) { runtime.teardown('dev:' + file.split(PLUGIN_EXT)[0]); });
        devTexts = {};
    }

    // ── Video under the page ─────────────────────────────────────────────────
    // mpv draws natively underneath the web page. When playback starts, Stremio
    // makes the player and every element above it transparent with inline styles;
    // a theme with `background: … !important` (Modern Glass on body, for example)
    // beats those and hides the picture while the sound plays. Re-apply the same
    // transparency with !important while it is in effect, and undo it after.
    var TRANSPARENT_MARK = 'spTransparent';

    function inlineTransparent(el) {
        return /transparent/.test(el.style.background) || el.style.backgroundColor === 'transparent';
    }

    // Once the transparent page has been drawn, have the shell re-apply the view's
    // background; until then Chromium still treats the page as opaque (see
    // refreshBackground in main.qml)
    function refreshShellBackground() {
        // The new frame reaches the shell some time after it is drawn; refresh
        // again a little later in case the first one was too early
        [300, 1200].forEach(function (delay) {
            setTimeout(function () {
                if (!wasTransparent) return;
                window.__stremioPlusChannel.then(function (objects) { objects.shellBridge.refreshBackground(); });
            }, delay);
        });
    }

    var wasTransparent = false;

    function syncPlayerTransparency() {
        var playing = !!document.body && inlineTransparent(document.body);
        if (playing && !wasTransparent) refreshShellBackground();
        wasTransparent = playing;
        if (playing) {
            document.querySelectorAll('[style*="background"]').forEach(function (el) {
                if (!inlineTransparent(el) || el.dataset[TRANSPARENT_MARK]) return;
                el.dataset[TRANSPARENT_MARK] = '1';
                el.style.setProperty('background', 'transparent', 'important');
            });
            var root = document.documentElement;
            if (!root.dataset[TRANSPARENT_MARK]) {
                root.dataset[TRANSPARENT_MARK] = '1';
                root.style.setProperty('background', 'transparent', 'important');
            }
        } else {
            document.querySelectorAll('[data-sp-transparent]').forEach(function (el) {
                delete el.dataset[TRANSPARENT_MARK];
                if (inlineTransparent(el)) el.style.removeProperty('background');
            });
        }
    }

    // Blur (backdrop-filter) can't see the native video under the page, so glass
    // would only blur transparent pixels; while a video plays, glass becomes
    // plain translucent dark
    // :not(#_) adds ID-level weight, so these beat a theme's long !important selectors
    var WHILE_PLAYING = 'html[data-sp-transparent]:not(#_):not(#_)';
    var PLAYER_CSS = '' +
        WHILE_PLAYING + ' *, ' + WHILE_PLAYING + ' *::before, ' + WHILE_PLAYING + ' *::after {' +
        '  backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' +
        [ '[class*="control-bar-buttons-container"]', '[class*="side-drawer-button-layer"]', '[class*="seek-tooltip"]', '[class*="menu-layer"]' ]
            .map(function (sel) { return WHILE_PLAYING + ' ' + sel; }).join(', ') + ' {' +
        '  background-color: rgba(28, 28, 30, 0.82) !important; background-image: none !important; }';

    function watchPlayerTransparency() {
        var style = document.createElement('style');
        style.id = 'sp-player-style';
        style.textContent = PLAYER_CSS;
        document.head.appendChild(style);
        var observer = new MutationObserver(syncPlayerTransparency);
        observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
        syncPlayerTransparency();
    }

    function patchReactDom() {
        if (window._patchedReactDomPage) return;
        var originalRemoveChild = Node.prototype.removeChild;
        Node.prototype.removeChild = function (child) {
            if (location.href.indexOf('#/player') !== -1 && child && child.parentNode !== this) return child;
            return originalRemoveChild.call(this, child);
        };
        window._patchedReactDomPage = true;
    }

    var REVIEW_KEY = 'sp_review_updates';

    // ── Enabling and disabling ───────────────────────────────────────────────
    var undoSuppressed = {};   // name -> true while an Undo replays a toggle through the menu

    // options: live (start/stop plugins now), applyTheme (apply/remove theme CSS), silent (no Undo toast)
    function setEnabled(name, enabled, options) {
        options = options || {};
        return scanMods().then(function (mods) {
            var all = mods.plugins.concat(mods.themes).map(function (m) { return m.meta.name; });
            var current = mods.enabled === null ? all.slice() : mods.enabled.slice();
            var index = current.indexOf(name);
            var wasEnabled = index !== -1;
            if (enabled && index === -1) current.push(name);
            if (!enabled && index !== -1) current.splice(index, 1);
            current = current.filter(function (n) { return all.indexOf(n) !== -1; }).sort();
            return writeJson('enabled_plugins.json', current).then(function () {
                var mod = findMod(mods, name);
                if (!mod) return null;
                var work = Promise.resolve();
                if (options.live && mod.kind === 'Plugin') {
                    var id = pluginId(mod);
                    if (enabled) work = loadPluginLive(mod);
                    else runtime.teardown(id);
                } else if (options.applyTheme && mod.kind === 'Theme') {
                    if (enabled) work = applyThemeFile(mod.file);
                    else if (localStorage.getItem('currentTheme') === mod.file) work = applyThemeFile(null);
                }
                var quiet = options.silent || undoSuppressed[name] || wasEnabled === enabled;
                delete undoSuppressed[name];
                if (!quiet) showUndo(mod, enabled);
                return work.then(function () { return null; });
            });
        });
    }

    function showUndo(mod, enabled) {
        var verb = mod.kind === 'Theme' ? (enabled ? 'Applied ' : 'Removed ') : (enabled ? 'Enabled ' : 'Disabled ');
        runtime.toast({
            title: verb + mod.meta.name,
            message: mod.kind === 'Plugin' && !enabled ? 'Stopped. Reload to remove anything it added to the page.' : null,
            action: { label: 'Undo', run: function () { undoToggle(mod, enabled); } },
        });
    }

    // Replays the toggle through the menu when it is showing, so its state stays in step
    function undoToggle(mod, enabled) {
        var toggle = document.querySelector('.st-toggle[data-toggle="' + CSS.escape(mod.meta.name) + '"]');
        if (toggle && toggle.offsetParent !== null) {
            undoSuppressed[mod.meta.name] = true;
            toggle.click();
            return;
        }
        setEnabled(mod.meta.name, !enabled, { live: true, applyTheme: true, silent: true });
    }

    // ── Stremio+ menu commands (__stElectronIPC__) ───────────────────────────
    var commands = {
        list_plugins: function () {
            return scanMods().then(function (mods) {
                return mods.plugins.concat(mods.themes).map(function (m) {
                    return {
                        name: m.meta.name,
                        file: m.file,
                        version: m.meta.version,
                        author: m.meta.author,
                        description: m.meta.description,
                        enabled: isEnabled(mods, m.meta.name),
                        applied: m.kind === 'Theme' && mods.appliedTheme === m.meta.name,
                        kind: m.kind,
                        requires: m.meta.requires.map(function (r) { return r.name; }),
                        settings: m.meta.settings,
                        updateUrl: m.meta.updateUrl,
                        update_url: m.meta.updateUrl,
                        github: m.meta.github,
                        permissions: m.meta.permissions,
                    };
                });
            });
        },

        // From the menu's toggles: the menu applies themes itself, plugins are started/stopped here
        set_plugin_enabled: function (args) {
            return setEnabled(args.name, !!args.enabled, { live: true, applyTheme: false });
        },

        install_from_url: function (args) {
            var url = String(args.url || '');
            if (!url) return Promise.reject(new Error('URL is empty'));
            if (url.indexOf('https://') !== 0) return Promise.reject(new Error('Only HTTPS URLs are allowed'));
            var isTheme = /\.css(\?|#|$)/.test(url);
            return fetchText(url).then(function (source) {
                var meta = extractMetadata(source, isTheme);
                if (!meta) throw new Error('Could not parse plugin manifest');
                var file = safeName(meta.name) + (isTheme ? THEME_EXT : PLUGIN_EXT);
                var path = (isTheme ? 'themes/' : 'plugins/') + file;
                var write = function () {
                    return native('writeText', path, source).then(function (ok) {
                        if (!ok) throw new Error('Could not write ' + path);
                        return meta.name;
                    });
                };
                // Replacing an installed copy: keep it so the update can be rolled back
                return native('readText', path).then(function (old) {
                    if (old === null || old === source) return write();
                    var oldMeta = extractMetadata(old, isTheme) || { version: 'previous', permissions: [] };
                    var backup = 'backup/' + file + '.' + oldMeta.version + '.bak';
                    // Show what changed first, unless the user turned reviews off
                    var review = localStorage.getItem(REVIEW_KEY) === 'off' ? Promise.resolve(true) : runtime.reviewUpdate({
                        name: meta.name, kind: isTheme ? 'Theme' : 'Plugin', fromVersion: oldMeta.version, toVersion: meta.version,
                        oldText: old, newText: source, oldPermissions: oldMeta.permissions, newPermissions: meta.permissions,
                    });
                    return review.then(function (accepted) {
                        if (!accepted) throw new Error('Update skipped');
                        return native('writeText', backup, old);
                    })
                        .then(function () { return readJson('updates.json', {}); })
                        .then(function (updates) {
                            updates[file] = { kind: isTheme ? 'Theme' : 'Plugin', name: meta.name, from: oldMeta.version, to: meta.version, backup: backup, trial: null };
                            return writeJson('updates.json', updates);
                        })
                        .then(write);
                });
            });
        },

        get_settings: function (args) { return readJson('settings/' + safeName(args.name) + '.json', {}); },
        save_settings: function (args) {
            return writeJson('settings/' + safeName(args.name) + '.json', args.settings || {}).then(function () { return null; });
        },

        check_updates: function () {
            return scanMods().then(function (mods) {
                var withUrl = mods.plugins.concat(mods.themes).filter(function (m) { return m.meta.updateUrl; });
                return Promise.all(withUrl.map(function (m) {
                    return fetchText(m.meta.updateUrl).then(function (source) {
                        var remote = extractMetadata(source, m.kind === 'Theme');
                        return remote && compareVersions(remote.version, m.meta.version) > 0 ? m.meta.name : null;
                    }).catch(function () { return null; });
                })).then(function (names) { return names.filter(Boolean); });
            });
        },

        get_data_dir: function () { return native('dataDir'); },

        get_plugin_source: function (args) {
            return scanMods().then(function (mods) {
                var mod = findMod(mods, args.name, args.kind, args.file);
                if (!mod) throw new Error('File not found: ' + (args.file || args.name));
                return mod.text;
            });
        },

        open_folder: function (args) {
            return native('openFolder', args.kind === 'plugins' ? 'plugins' : args.kind === 'themes' ? 'themes' : '');
        },

        check_stremio_service: function () {
            // The server's root route sends no CORS headers; any response means it is up
            return fetch('http://127.0.0.1:11470/', { mode: 'no-cors', signal: AbortSignal.timeout(2000) })
                .then(function () { return true; })
                .catch(function () { return false; });
        },

        proxy_service: function (args) {
            var port = args.port || 11470;
            if ([11470, 11471].indexOf(port) === -1) return Promise.reject(new Error('Port ' + port + ' not allowed'));
            var path = String(args.path || '/');
            if (path.charAt(0) !== '/') path = '/' + path;
            if (path.indexOf('..') !== -1) return Promise.reject(new Error('Path traversal not allowed'));
            var method = String(args.method || 'GET').toUpperCase();
            var init = { method: method, signal: AbortSignal.timeout(10000) };
            if (args.body && (method === 'POST' || method === 'PUT')) {
                init.body = args.body;
                init.headers = { 'Content-Type': 'application/json' };
            }
            return fetch('http://127.0.0.1:' + port + path, init).then(function (r) {
                return r.text().then(function (text) {
                    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + text);
                    return text;
                });
            });
        },

        // This shell always plays through its built-in mpv; the choice is stored for the menu only
        get_playback_backend: function () {
            return native('readText', 'playback_backend.txt').then(function (v) {
                v = (v || '').trim();
                return BACKENDS.indexOf(v) !== -1 ? v : 'native';
            });
        },
        set_playback_backend: function (args) {
            if (BACKENDS.indexOf(args.backend) === -1) return Promise.reject(new Error('Unknown backend: ' + args.backend));
            return native('writeText', 'playback_backend.txt', args.backend).then(function () { return null; });
        },
        get_mpv_prefs: function () { return readJson('mpv_prefs.json', {}); },
        save_mpv_prefs: function (args) {
            return writeJson('mpv_prefs.json', {
                upscaleShader: args.upscaleShader !== undefined ? args.upscaleShader : args.upscale_shader,
                extraFlags: args.extraFlags !== undefined ? args.extraFlags : args.extra_flags,
            }).then(function () { return null; });
        },
        launch_mpv: function () {
            return Promise.reject(new Error('Not needed: this app plays through its built-in mpv'));
        },

        reload_app: function () { location.reload(); return Promise.resolve(null); },
    };

    // Accept both the Tauri-style names panel.js uses and the Electron channel names
    var ALIASES = {};
    Object.keys(commands).forEach(function (name) { ALIASES[name.replace(/_/g, '-')] = name; });

    window.__stElectronIPC__ = function (command, args) {
        var handler = commands[command] || commands[ALIASES[command]];
        if (!handler) return Promise.reject(new Error('Unknown command: ' + command));
        var norm = Object.assign({}, args || {});
        if ('pluginName' in norm) { norm.name = norm.pluginName; delete norm.pluginName; }
        try {
            return Promise.resolve(handler(norm));
        } catch (e) {
            return Promise.reject(e);
        }
    };

    // ── Boot ─────────────────────────────────────────────────────────────────
    window.__ST_META__ = APP_META;

    // The menu's built-in violet accents, as literal colours in its CSS. The
    // macOS skin is neutral, so they are turned into greys of the same lightness.
    function neutralizeAccents(source) {
        return source
            .replace(/hsla\(var\(--accent-h,\s*270\),\s*\d+%,\s*/g, 'hsla(0,0%,')
            .replace(/hsla?\(270(,|\s)\s*\d+%(,|\s)\s*(\d+%)/g, function (_, sep1, sep2, light) {
                return 'hsla(0' + sep1 + '0%' + sep2 + light;
            });
    }

    // The menu's colour picker callback is private to its closure; expose it so
    // color-picker.js can apply colours live while the user drags
    function exposeColorPicker(source) {
        return source.replace(
            'let _cpCallback = null;',
            'let _cpCallback = null;\n    window.__stCpick = { apply: (hex) => { if (_cpCallback) _cpCallback(hex); }, close: () => closeColorPicker() };'
        // The menu adds its "open" class two frames after opening; this is the real state
        ).replace('let isOpen=false;', 'let isOpen=false;\n    window.__st_isOpen = () => isOpen;');
    }

    // When a card expands, the menu scrolled until the card's bottom showed, measuring
    // from the whole panel instead of the list (so it overshot by the widgets, search and
    // tabs) and pushing tall cards' tops out of view. Reveal the settings, but keep the
    // card you clicked where you can see it.
    var EXPAND_SCROLL_OLD = /\/\/ Scroll the bottom of the settings panel into view after the transition starts[\s\S]*?\}, 80\);/;
    var EXPAND_SCROLL_NEW =
        '// Reveal the expanded settings once they have opened, without moving the card\'s top out of view\n' +
        '                    const revealCard = () => {\n' +
        '                        const listEl = document.getElementById(\'__st_list__\');\n' +
        '                        if (!listEl || !card.classList.contains(\'expanded\')) return;\n' +
        '                        const listRect = listEl.getBoundingClientRect();\n' +
        '                        const cardRect = card.getBoundingClientRect();\n' +
        '                        const top = cardRect.top - listRect.top + listEl.scrollTop;\n' +
        '                        const bottom = top + cardRect.height;\n' +
        '                        if (bottom <= listEl.scrollTop + listEl.clientHeight - 12) return;\n' +
        '                        const target = Math.min(bottom - listEl.clientHeight + 12, top - 8);\n' +
        '                        if (target > listEl.scrollTop) listEl.scrollTo({ top: target, behavior: \'smooth\' });\n' +
        '                    };\n' +
        '                    const settingsEl = card.querySelector(\'.st-settings-panel\');\n' +
        '                    let revealed = false;\n' +
        '                    const revealOnce = () => { if (!revealed) { revealed = true; revealCard(); } };\n' +
        '                    if (settingsEl) settingsEl.addEventListener(\'transitionend\', (e) => { if (e.propertyName === \'max-height\') revealOnce(); }, { once: true });\n' +
        '                    setTimeout(revealOnce, 480);';

    function fixExpandScroll(source) {
        if (!EXPAND_SCROLL_OLD.test(source)) {
            console.warn('[StremioPlus] menu expand-scroll code not found; leaving it as is');
            return source;
        }
        return source.replace(EXPAND_SCROLL_OLD, EXPAND_SCROLL_NEW);
    }

    function runScript(id, source) {
        if (!source || document.getElementById(id)) return;
        var script = document.createElement('script');
        script.id = id;
        script.textContent = source;
        document.body.appendChild(script);
    }

    // The menu runs as a classic script so its top-level declarations stay
    // global, like Electron's executeJavaScript(MENU_JS) did
    function startMenu() {
        if (!window.__stremioPlusMenuSource) return;
        runScript('stremio-plus-menu', fixExpandScroll(exposeColorPicker(neutralizeAccents(window.__stremioPlusMenuSource))));

        // Added after the menu's own <style> tags so the skin wins
        if (window.__stremioPlusSkin && !document.getElementById('stremio-plus-skin')) {
            var style = document.createElement('style');
            style.id = 'stremio-plus-skin';
            style.textContent = window.__stremioPlusSkin;
            document.head.appendChild(style);
        }
        runScript('stremio-plus-widgets', window.__stremioPlusWidgetsSource);
        runScript('stremio-plus-color-picker', window.__stremioPlusColorPickerSource);
        runScript('stremio-plus-commands', window.__stremioPlusCommandsSource);
        runScript('stremio-plus-tools', window.__stremioPlusToolsSource);
        runScript('stremio-plus-settings', window.__stremioPlusSettingsSource);
        runScript('stremio-plus-tv', window.__stremioPlusTvSource);
    }

    // ── Picture in picture ───────────────────────────────────────────────────
    // The shell shrinks the window into a small floating player (main.qml);
    // here the page's UI is hidden and replaced by a minimal hover overlay.
    // Plugins reach it through window.stremioPlusShell.pictureInPicture.
    var pip = (function () {
        var active = false, overlay = null, paused = false;
        var ICONS = {
            play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4c.6-.4.6-1.4 0-1.8l-10-6.4C8.9 4.3 8 4.8 8 5.6z"/></svg>',
            pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
            expand: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9.5 3.75h-3.75a2 2 0 0 0-2 2v12.5a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2V14.5M14 3.75h6.25V10M20 4l-8 8"/></svg>',
            close: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
        };
        var CSS = '' +
            'html.sp-pip body > *:not(#sp-pip) { visibility: hidden !important; }' +
            '#sp-pip { position: fixed; inset: 0; z-index: 2147483646; opacity: 0; cursor: grab; user-select: none;' +
            '  background: linear-gradient(rgba(0,0,0,.45), transparent 34%, transparent 66%, rgba(0,0,0,.45));' +
            '  transition: opacity .18s ease; font: 13px -apple-system, system-ui, sans-serif; }' +
            '#sp-pip:hover, #sp-pip.show { opacity: 1; }' +
            '#sp-pip button { position: absolute; display: grid; place-items: center; border: 0; padding: 0; color: #fff; cursor: default;' +
            '  background: rgba(40,40,42,.6); -webkit-backdrop-filter: blur(30px) saturate(170%); backdrop-filter: blur(30px) saturate(170%);' +
            '  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.18); transition: transform .1s ease, background .15s ease; }' +
            '#sp-pip button:hover { background: rgba(60,60,64,.72); }' +
            '#sp-pip button:active { transform: scale(.92); }' +
            '#sp-pip button:focus-visible { outline: 2px solid rgba(255,255,255,.85); outline-offset: 2px; }' +
            '#sp-pip button svg { width: 55%; height: 55%; }' +
            '#sp-pip .sp-pip-corner { top: 10px; width: 28px; height: 28px; border-radius: 50%; }' +
            '#sp-pip [data-act="close"] { left: 10px; }' +
            '#sp-pip [data-act="expand"] { right: 10px; }' +
            '#sp-pip [data-act="play"] { left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; }' +
            '#sp-pip [data-act="play"] svg { width: 46%; height: 46%; }';

        function shell() { return window.__stremioPlusChannel.then(function (o) { return o.shellBridge; }); }
        function onPlayer() { return /^#\/player\//.test(location.hash); }

        function togglePause() {
            // Stremio's own play/pause button keeps its state in sync
            var buttons = document.querySelectorAll('[class*="control-bar-buttons-container"] [class*="control-bar-button"]');
            var button = Array.prototype.find.call(buttons, function (b) { return b.title === 'Play' || b.title === 'Pause'; });
            if (button) button.click();
        }

        function renderPlay() {
            var b = overlay && overlay.querySelector('[data-act="play"]');
            if (b) { b.innerHTML = paused ? ICONS.play : ICONS.pause; b.title = paused ? 'Play' : 'Pause'; }
        }

        function build() {
            if (!document.getElementById('sp-pip-style')) {
                var style = document.createElement('style');
                style.id = 'sp-pip-style';
                style.textContent = CSS;
                document.head.appendChild(style);
            }
            overlay = document.createElement('div');
            overlay.id = 'sp-pip';
            [['close', 'sp-pip-corner', 'Close'], ['expand', 'sp-pip-corner', 'Back to Stremio'], ['play', '', '']].forEach(function (b) {
                var button = document.createElement('button');
                button.dataset.act = b[0];
                button.className = b[1];
                button.title = b[2];
                button.innerHTML = ICONS[b[0]] || '';
                overlay.appendChild(button);
            });
            overlay.addEventListener('click', function (e) {
                var act = e.target.closest('button') && e.target.closest('button').dataset.act;
                if (act === 'play') togglePause();
                else if (act === 'expand') exit();
                else if (act === 'close') { exit(); history.back(); }
            });
            overlay.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) exit(); });
            overlay.addEventListener('mousedown', function (e) {
                if (e.button === 0 && !e.target.closest('button')) shell().then(function (b) { b.startWindowMove(); });
            });
            document.body.appendChild(overlay);
            renderPlay();
            // Show the controls briefly so it's clear what the little window is
            overlay.classList.add('show');
            setTimeout(function () { if (overlay) overlay.classList.remove('show'); }, 1800);
        }

        function enter() {
            if (active || !onPlayer()) return Promise.resolve(false);
            active = true;
            document.documentElement.classList.add('sp-pip');
            build();
            return shell().then(function (b) { b.setPictureInPicture(true); return true; });
        }

        function exit() {
            if (!active) return Promise.resolve(false);
            active = false;
            document.documentElement.classList.remove('sp-pip');
            if (overlay) { overlay.remove(); overlay = null; }
            return shell().then(function (b) { b.setPictureInPicture(false); return false; });
        }

        // Track mpv's pause state from the shell's messages to the page
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.addEventListener('message', function (e) {
                var msg;
                try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
                var args = msg && msg.args;
                if (args && args[0] === 'mpv-prop-change' && args[1] && args[1].name === 'pause') {
                    paused = !!args[1].data;
                    renderPlay();
                }
            });
        }
        window.addEventListener('hashchange', function () { if (active && !onPlayer()) exit(); });
        window.addEventListener('keydown', function (e) { if (active && e.key === 'Escape') { e.stopPropagation(); exit(); } }, true);

        return {
            enter: enter,
            exit: exit,
            toggle: function () { return active ? exit() : enter(); },
            isActive: function () { return active; },
        };
    })();

    // tv.js adds tvMode
    window.stremioPlusShell = { pictureInPicture: pip };

    window.addEventListener('load', function () {
        watchPlayerTransparency();
        startMods();
        startMenu();
    });

    // For the menu extensions (commands.js, tools.js, widgets.js)
    window.__spHost = {
        native: native,
        readJson: readJson,
        writeJson: writeJson,
        fetchText: fetchText,
        scanMods: scanMods,
        extractMetadata: extractMetadata,
        safeName: safeName,
        setEnabled: setEnabled,
        applyThemeFile: applyThemeFile,
        rollback: rollback,
        listUpdates: function () { return readJson('updates.json', {}); },
        permissions: function () { return permissions; },
        setPermission: setPermission,
        devModeEnabled: devModeEnabled,
        setDevMode: setDevMode,
        reloadDevPlugins: function () { devTexts = {}; return syncDevPlugins(true); },
        loadPluginLive: loadPluginLive,
        pluginId: pluginId,
        reviewUpdates: function (on) {
            if (on === undefined) return localStorage.getItem(REVIEW_KEY) !== 'off';
            localStorage.setItem(REVIEW_KEY, on ? 'on' : 'off');
        },
    };
})();
