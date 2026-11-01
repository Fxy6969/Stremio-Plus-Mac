// Exposes a WebView2-style window.chrome.webview API backed by Qt WebChannel.
// Stremio Web v5 only enables its desktop shell mode (native mpv player,
// streaming server URL, window events) when this API exists at load time.
(function () {
    if (window.__stremioPlusShell) return;
    window.__stremioPlusShell = true;

    var listeners = [];
    var pending = [];
    var bridge = null;
    var resolveChannel;

    // Other injected scripts (stremio-plus-host.js) share this channel
    Object.defineProperty(window, '__stremioPlusChannel', {
        value: new Promise(function (resolve) { resolveChannel = resolve; }),
    });

    function dispatch(data) {
        var event = { data: data };
        listeners.slice().forEach(function (listener) {
            try { listener(event); } catch (e) { console.error('[StremioPlus] shell listener failed', e); }
        });
    }

    var webview = {
        postMessage: function (message) {
            message = typeof message === 'string' ? message : JSON.stringify(message);
            if (bridge) bridge.postMessage(message);
            else pending.push(message);
        },
        addEventListener: function (type, listener) {
            if (type === 'message' && listeners.indexOf(listener) === -1) listeners.push(listener);
        },
        removeEventListener: function (type, listener) {
            var index = listeners.indexOf(listener);
            if (index !== -1) listeners.splice(index, 1);
        },
    };

    window.chrome = window.chrome || {};
    window.chrome.webview = webview;

    function connect() {
        if (!(window.qt && window.qt.webChannelTransport)) return setTimeout(connect, 5);

        var transport = window.qt.webChannelTransport;
        new QWebChannel(transport, function (channel) {
            bridge = channel.objects.shellBridge;
            bridge.message.connect(dispatch);
            pending.splice(0).forEach(function (message) { bridge.postMessage(message); });
            resolveChannel(channel.objects);
        });

        // Stremio Web resets qt.webChannelTransport.onmessage for legacy shells,
        // which would cut off our channel. Keep the QWebChannel handler in place.
        var handler = transport.onmessage;
        try {
            Object.defineProperty(transport, 'onmessage', {
                configurable: true,
                get: function () { return handler; },
                set: function () {},
            });
        } catch (e) {
            console.error('[StremioPlus] could not protect webChannelTransport', e);
        }
    }

    connect();
})();
