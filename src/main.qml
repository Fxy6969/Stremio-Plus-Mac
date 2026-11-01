import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Dialogs
import QtCore
import QtWebEngine
import QtWebChannel
import com.stremio.process 1.0
import com.stremio.screensaver 1.0
import com.stremio.libmpv 1.0

ApplicationWindow {
    id: root
    visible: true

    minimumWidth: 1000
    minimumHeight: 650

    readonly property int initialWidth: Math.max(root.minimumWidth, Math.min(1600, Screen.desktopAvailableWidth * 0.8))
    readonly property int initialHeight: Math.max(root.minimumHeight, Math.min(1000, Screen.desktopAvailableHeight * 0.8))

    width: root.initialWidth
    height: root.initialHeight

    property bool quitting: false

    color: "#0c0b11";
    title: appTitle

    property var previousVisibility: Window.Windowed
    property bool wasFullScreen: false

    function setFullScreen(fullscreen) {
        if (fullscreen) {
            root.visibility = Window.FullScreen;
            root.wasFullScreen = true;
        } else {
            root.visibility = root.previousVisibility;
            root.wasFullScreen = false;
        }
    }

    function showWindow() {
            if (root.wasFullScreen) {
                root.visibility = Window.FullScreen;
            } else {
                root.visibility = root.previousVisibility;
            }
            root.raise();
            root.requestActivate();
    }

    // ── Picture in picture ────────────────────────────────────────────────
    // Video plays natively (mpv) rather than in a <video> element, so the
    // browser's picture-in-picture can't be used. Instead the window itself
    // becomes a small frameless player that floats above other windows in a
    // corner of the screen; host.js hides the page's UI while it is active.
    property bool pictureInPicture: false
    property rect pipSavedGeometry
    property bool pipWasFullScreen: false
    readonly property int pipWidth: 480

    function setPictureInPicture(on) {
        if (on === root.pictureInPicture) return;
        root.pictureInPicture = on;
        if (on) {
            root.pipWasFullScreen = root.visibility === Window.FullScreen;
            if (root.pipWasFullScreen) {
                // Leaving full screen is animated on macOS; resize once it's done
                root.showNormal();
                pipEnterTimer.restart();
            } else {
                enterPictureInPicture();
            }
        } else {
            pipEnterTimer.stop();
            root.flags = Qt.Window;
            root.minimumWidth = 1000;
            root.minimumHeight = 650;
            root.x = root.pipSavedGeometry.x;
            root.y = root.pipSavedGeometry.y;
            root.width = root.pipSavedGeometry.width;
            root.height = root.pipSavedGeometry.height;
            if (root.pipWasFullScreen) root.visibility = Window.FullScreen;
            root.raise();
            root.requestActivate();
        }
    }

    function enterPictureInPicture() {
        if (!root.pictureInPicture) return;
        root.pipSavedGeometry = Qt.rect(root.x, root.y, root.width, root.height);
        var aspect = Number(mpv.getProperty("video-params/aspect")) || 16 / 9;
        var w = root.pipWidth, h = Math.round(w / Math.min(Math.max(aspect, 1), 2.4));
        root.flags = Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint;
        root.minimumWidth = 200;
        root.minimumHeight = 112;
        root.width = w;
        root.height = h;
        root.x = root.screen.virtualX + root.screen.width - w - 24;
        root.y = root.screen.virtualY + root.screen.height - h - 96;
    }

    Timer {
        id: pipEnterTimer
        interval: 800
        onTriggered: root.enterPictureInPicture()
    }

    function updatePreviousVisibility() {
        if (root.visible && root.visibility != Window.FullScreen && root.visibility != Window.Minimized) {
            root.previousVisibility = root.visibility;
        }
    }

    // Transport
    QtObject {
        id: transport
        readonly property string shellVersion: Qt.application.version
        property string serverAddress: "http://127.0.0.1:11470" // will be set to something else if server inits on another port

        readonly property bool isFullscreen: root.visibility === Window.FullScreen // just to send the initial state

        signal event(var ev, var args)
        function handleEvent(ev, args) {
            if (ev === "quit") quitApp()
            if (ev === "app-ready") transport.flushQueue()
            if (ev === "mpv-command" && args && args[0] !== "run") mpv.command(args)
            if (ev === "mpv-set-prop") {
                // The video output must stay "libmpv" so frames render inside the window
                if (args[0] === "vo") return;
                mpv.setProperty(args[0], args[1]);
                if (args[0] === "pause") {
                    shouldDisableScreensaver(!args[1]);
                }
            }
            if (ev === "mpv-observe-prop") mpv.observeProperty(args)
            if (ev === "control-event") wakeupEvent()
            if (ev === "wakeup") wakeupEvent()
            if (ev === "set-window-mode") onWindowMode(args)
            if (ev === "open-external") Qt.openUrlExternally(args)
            if (ev === "win-focus" && !root.visible) {
                showWindow();
            }
            if (ev === "win-set-visibility") {
                if (args.hasOwnProperty('fullscreen')) {
                    setFullScreen(args.fullscreen);
                }
            }
            if (ev === "screensaver-toggle") shouldDisableScreensaver(args.disabled)
            if (ev === "file-close") fileDialog.close()
            if (ev === "file-open") {
                fileDialog.request = args || {}
                fileDialog.title = fileDialog.request.title || "Please choose"
                fileDialog.nameFilters = fileDialog.request.nameFilters || []
                fileDialog.fileMode = fileDialog.request.selectMultiple ? FileDialog.OpenFiles : FileDialog.OpenFile
                fileDialog.open()
            }
        }

        // events that we want to wait for the app to initialize
        property variant queued: []
        function queueEvent() {
            if (transport.queued) transport.queued.push(arguments)
            else transport.event.apply(transport, arguments)
        }
        function flushQueue() {
            if (transport.queued) transport.queued.forEach(function(args) { transport.event.apply(transport, args) })
            transport.queued = null;
        }
    }

    // Stremio Web v5 talks to desktop shells through a WebView2-style
    // window.chrome.webview API (see shell-bridge.js). This object is the
    // native end of that API: it receives the JSON messages the web UI posts
    // and sends transport events back in the same format.
    QtObject {
        id: shellBridge
        WebChannel.id: "shellBridge"

        readonly property int typeSignal: 1
        readonly property int typeInit: 3
        readonly property int typeInvokeMethod: 6

        signal message(string data)

        function postMessage(raw) {
            var msg;
            try { msg = JSON.parse(raw) } catch (e) { return console.error("shellBridge: bad message", raw) }

            if (msg.type === typeInit) {
                sendInit();
                transport.flushQueue();
            } else if (msg.type === typeInvokeMethod && msg.args && msg.args.length) {
                transport.handleEvent(msg.args[0], msg.args[1]);
            }
        }

        function sendInit() {
            // Same shape as a QWebChannel init: [index, name, notifySignal, value]
            var props = [
                ["shellVersion", transport.shellVersion],
                ["streamingServerUrl", transport.serverAddress],
                ["gpuVideoProcessing", "false"],
                ["nativeAssSubtitles", "true"],
                ["cacheDirectoryPicker", "false"],
                ["nativeInterfaceScale", "false"]
            ].map(function(p, i) { return [i, p[0], 0, p[1]] });
            message(JSON.stringify({ id: 0, type: typeInit, data: { transport: { properties: props } } }));
        }

        // Called by host.js when the page turns transparent for playback.
        // Chromium keeps treating a page whose root background was opaque as
        // opaque after it turns transparent: it stops clearing, so the video
        // underneath stays hidden and old frames (tooltips, the loading logo)
        // pile up. Setting the view's background again makes it re-check.
        // Picture in picture (see setPictureInPicture); returns the new state
        function setPictureInPicture(on) {
            root.setPictureInPicture(!!on);
            return root.pictureInPicture;
        }

        // Dragging the frameless picture-in-picture window from the page
        function startWindowMove() {
            root.startSystemMove();
        }

        function refreshBackground() {
            webView.backgroundColor = "black"
            webView.backgroundColor = "transparent"
        }
    }

    Connections {
        target: transport
        function onEvent(ev, args) {
            shellBridge.message(JSON.stringify({ id: 0, type: shellBridge.typeSignal, args: [ev, args] }));
        }
    }


    // Utilities
    function onWindowMode(mode) {
        shouldDisableScreensaver(mode === "player")
    }

    function wakeupEvent() {
        shouldDisableScreensaver(true)
        timerScreensaver.restart()
    }

    function shouldDisableScreensaver(condition) {
        if (condition === screenSaver.disabled) return;
        condition ? screenSaver.disable() : screenSaver.enable();
        screenSaver.disabled = condition;
    }

    function isPlayerPlaying() {
        return root.visible && typeof(mpv.getProperty("path"))==="string" && !mpv.getProperty("pause")
    }

    // Received external message
    function onAppMessageReceived(instance, message) {
        message = message.toString(); // cause it may be QUrl
        showWindow();
        if (message !== "SHOW") {
                onAppOpenMedia(message);
        }
    }

    // May be called from a message (from another app instance) or when app is initialized with an arg
    function onAppOpenMedia(message) {
        var url = (message.indexOf('://') > -1 || message.indexOf('magnet:') === 0) ? message : 'file://'+message;
        transport.queueEvent("open-media", url)
    }

    function quitApp() {
        root.quitting = true;
        webView.destroy();
        systemTray.hideIconTray();
        streamingServer.kill();
        streamingServer.waitForFinished(1500);
        Qt.quit();
    }

    /* With help Connections object
     * set connections with System tray class
     * */
    Connections {
        target: systemTray

        function onSignalIconMenuAboutToShow() {
            systemTray.updateIsOnTop((root.flags & Qt.WindowStaysOnTopHint) === Qt.WindowStaysOnTopHint);
	        systemTray.updateVisibleAction(root.visible);
        }

        function onSignalShow() {
            if(root.visible) {
                root.hide();
            } else {
                showWindow();
            }
        }

        function onSignalAlwaysOnTop() {
            root.raise()
            if (root.flags & Qt.WindowStaysOnTopHint) {
                root.flags &= ~Qt.WindowStaysOnTopHint;
            } else {
                root.flags |= Qt.WindowStaysOnTopHint;
            }
        }

        // The signal - close the application by ignoring the check-box
        function onSignalQuit() {
            quitApp();
        }

        // Minimize / maximize the window by clicking on the default system tray
        function onSignalIconActivated() {
           showWindow();
       }
    }

    // Screen saver - enable & disable
    ScreenSaver {
        id: screenSaver
        property bool disabled: false // track last state so we don't call it multiple times
    }
    // This is needed so that 300s after the remote control has been used, we can re-enable the screensaver
    // (if the player is not playing)
    Timer {
        id: timerScreensaver
        interval: 300000
        running: false
        onTriggered: function () { shouldDisableScreensaver(isPlayerPlaying()) }
    }

    //
    // Streaming server
    //
    Process {
        id: streamingServer
        property string errMessage:
            "Error while starting streaming server. Please try to restart stremio. If it happens again please contact the Stremio support team for assistance"
        property int errors: 0
        property bool fastReload: false

        onStarted: function() { stayAliveStreamingServer.stop() }
        onFinished: function(code, status) {
            // status -> QProcess::CrashExit is 1
            if (!streamingServer.fastReload && errors < 5 && (code !== 0 || status !== 0) && !root.quitting) {
                transport.queueEvent("server-crash", {"code": code, "log": streamingServer.getErrBuff()});

                errors++
                showStreamingServerErr(code)
            }

            if (streamingServer.fastReload) {
                console.log("Streaming server: performing fast re-load")
                streamingServer.fastReload = false
                root.launchServer()
            } else {
                stayAliveStreamingServer.start()
            }
        }
        onAddressReady: function (address) {
            transport.serverAddress = address.trim()
            transport.event("server-address", transport.serverAddress)
        }
        onErrorThrown: function (error) {
            if (root.quitting) return; // inhibits errors during quitting
            if (streamingServer.fastReload && error == 1) return; // inhibit errors during fast reload mode;
                                                                  // we'll unset that after we've restarted the server
            transport.queueEvent("server-crash", {"code": error, "log": streamingServer.getErrBuff()});
            showStreamingServerErr(error)
       }
    }
    function showStreamingServerErr(code) {
        errorDialog.text = streamingServer.errMessage
        errorDialog.detailedText = 'Stremio streaming server has thrown an error \nQProcess::ProcessError code: '
            + code + '\n\n'
            + streamingServer.getErrBuff();
        errorDialog.open()
    }
    function launchServer() {
        // print applicationDirPath like this:
        console.log("Application dir path: "+applicationDirPath)
        var node_executable = applicationDirPath + "/node"
        if (Qt.platform.os === "windows") node_executable = applicationDirPath + "/node.exe"
        streamingServer.start(node_executable,
            [applicationDirPath +"/server.js"].concat(Qt.application.arguments.slice(1)),
            "EngineFS server started at "
        )
    }
    // TimerStreamingServer
    Timer {
        id: stayAliveStreamingServer
        interval: 10000
        running: false
        onTriggered: function () { root.launchServer() }
    }

    //
    // Player
    //
    MpvObject {
        id: mpv
        anchors.fill: parent
        onMpvEvent: function(ev, args) { transport.event(ev, args) }
    }

    //
    // Main UI (via WebEngineView)
    //
    function getWebUrl() {
        var args = Qt.application.arguments

        var webuiArg = "--webui-url="
        for (var i=0; i!=args.length; i++) {
            if (args[i].indexOf(webuiArg) === 0) return args[i].slice(webuiArg.length)
        }

        return "https://web.stremio.com/"
    }

    Timer {
        id: retryTimer
        interval: 1000
        running: false
        onTriggered: function () {
            webView.tries++
            // we want to revert to the mainUrl in case the URL we were at was the one that caused the crash
            webView.url = webView.mainUrl;
        }
    }

    function hideSplash() {
        splashScreen.visible = false
        pulseOpacity.running = false
        removeSplashTimer.running = false
    }

    // We want to remove the splash after a minute
    Timer {
        id: removeSplashTimer
        interval: 90000
        running: true
        repeat: false
        onTriggered: function () {
            webView.backgroundColor = "transparent"
            hideSplash()
        }
    }

    // A disk-backed profile, so the Stremio login, localStorage (active theme,
    // plugin state) and cache survive restarts
    WebEngineProfilePrototype {
        id: webProfilePrototype
        storageName: webProfileName
        persistentCookiesPolicy: WebEngineProfile.ForcePersistentCookies
        httpCacheType: WebEngineProfile.DiskHttpCache
        // for more info, see
        // https://github.com/adobe/chromium/blob/master/net/disk_cache/backend_impl.cc - AdjustMaxCacheSize
        httpCacheMaximumSize: 209715200 // 200 MB
    }

    WebEngineView {
        id: webView;

        focus: true

        readonly property string mainUrl: getWebUrl()

        anchors.fill: parent
        backgroundColor: "transparent";
        property int tries: 0

        readonly property int maxTries: 20

        settings.playbackRequiresUserGesture: false
        settings.javascriptCanAccessClipboard: true
        settings.javascriptCanPaste: true

        Component.onCompleted: function() {
            console.log("Loading web UI from URL: "+webView.mainUrl)

            // Assigned here rather than bound: the prototype only has an
            // instance once it has completed
            webView.profile = webProfilePrototype.instance()

            webView.profile.httpUserAgent = webView.profile.httpUserAgent+' StremioShell/'+Qt.application.version

            // Injected at document creation, before any of the web UI's scripts run
            var script = WebEngine.script()
            script.name = "stremio-plus-shell"
            script.sourceCode = injectedScripts
            script.injectionPoint = WebEngineScript.DocumentCreation
            script.worldId = WebEngineScript.MainWorld
            script.runsOnSubFrames = false
            webView.userScripts.insert(script)

            webView.url = webView.mainUrl
        }

        onLoadingChanged: function(loadRequest) {
            // hack for webEngineView changing it's background color on crashes
            webView.backgroundColor = "transparent"

            var successfullyLoaded = loadRequest.status == WebEngineLoadingInfo.LoadSucceededStatus
            if (successfullyLoaded || webView.tries > 0) {
                // show the webview if the loading is failing
                // can fail because of many reasons, including captive portals
                hideSplash()
            }

            if (successfullyLoaded) webView.tries = 0

            var shouldRetry = loadRequest.status == WebEngineLoadingInfo.LoadFailedStatus ||
                    loadRequest.status == WebEngineLoadingInfo.LoadStoppedStatus
            if ( shouldRetry && webView.tries < webView.maxTries) {
                retryTimer.restart()
            }
        }

        onRenderProcessTerminated: function(terminationStatus, exitCode) {
            console.log("render process terminated with code "+exitCode+" and status: "+terminationStatus)

            // hack for webEngineView changing it's background color on crashes
            webView.backgroundColor = "black"

            retryTimer.restart()

            // send an event for the crash, but since the web UI is not working, reset the queue and queue it
            transport.queued = []
            transport.queueEvent("render-process-terminated", { exitCode: exitCode, terminationStatus: terminationStatus, url: webView.url })

        }

        // In the app, we use open-external IPC signal, but make sure this works anyway
        property string hoveredUrl: ""
        onLinkHovered: function(url) { webView.hoveredUrl = url }
        onNewWindowRequested: function(req) { if (req.userInitiated) Qt.openUrlExternally(req.requestedUrl) }

        onFullScreenRequested: function(req) {
            setFullScreen(req.toggleOn);
            req.accept();
        }

        // Only show the context menu inside editable fields
        onContextMenuRequested: function(request) {
            request.accepted = !request.isContentEditable;
        }

        onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID) {
            if (debug || message.indexOf("[StremioPlus") === 0)
                console.log("[web] " + message + " (" + sourceID + ":" + lineNumber + ")")
        }

        DropArea {
            anchors.fill: parent
            onDropped: function(drop){
                transport.event("dragdrop", drop.urls.map(function(u) { return u.toString() }))
            }
        }
        webChannel: wChannel
    }

    WebChannel {
        id: wChannel
        registeredObjects: [shellBridge]
        Component.onCompleted: registerObject("modBridge", modBridge)
    }

    //
    // Splash screen
    // Must be over the UI
    //
    Rectangle {
        id: splashScreen;
        color: "#0c0b11";
        anchors.fill: parent;
        Image {
            id: splashLogo
            source: "qrc:///images/stremio.png"
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter

            SequentialAnimation {
                id: pulseOpacity
                running: true
                NumberAnimation { target: splashLogo; property: "opacity"; to: 1.0; duration: 600;
                    easing.type: Easing.Linear; }
                NumberAnimation { target: splashLogo; property: "opacity"; to: 0.3; duration: 600;
                    easing.type: Easing.Linear; }
                loops: Animation.Infinite
            }
        }
    }

    //
    // Err dialog
    //
    MessageDialog {
        id: errorDialog
        title: "Stremio Plus - Application Error"
        buttons: MessageDialog.Ok
    }

    FileDialog {
      id: fileDialog
      currentFolder: StandardPaths.writableLocation(StandardPaths.HomeLocation)
      property var request: ({})

      function describe(files) {
        var req = fileDialog.request
        return {
          files: files,
          title: fileDialog.title,
          selectExisting: req.selectExisting !== undefined ? req.selectExisting : true,
          selectFolder: !!req.selectFolder,
          selectMultiple: !!req.selectMultiple,
          nameFilters: fileDialog.nameFilters,
          selectedNameFilter: req.selectedNameFilter || "",
          data: req.data || null
        }
      }

      onAccepted: {
        var fileProtocol = "file://"
        var files = fileDialog.selectedFiles.map(function(u) { return u.toString() })
          // Ignore network drives and alike
          .filter(function(fileUrl) { return fileUrl.startsWith(fileProtocol) })
          // Send actual path and not file protocol URL
          .map(function(fileUrl) { return decodeURIComponent(fileUrl.substring(fileProtocol.length)) })
        transport.event("file-selected", describe(files))
      }
      onRejected: {
        var info = describe([])
        delete info.files
        transport.event("file-rejected", info)
      }
    }

    //
    // Binding window -> app events
    //
    onWindowStateChanged: function(state) {
        updatePreviousVisibility();
        transport.event("win-state-changed", { state: state })
    }

    onVisibilityChanged: {
        var enabledAlwaysOnTop = root.visible && root.visibility != Window.FullScreen;
        systemTray.alwaysOnTopEnabled(enabledAlwaysOnTop);
        if (!enabledAlwaysOnTop) {
            root.flags &= ~Qt.WindowStaysOnTopHint;
        }

        updatePreviousVisibility();
        transport.event("win-visibility-changed", { visible: root.visible, visibility: root.visibility,
                            isFullscreen: root.visibility === Window.FullScreen })
    }

    property int appState: Qt.application.state;
    onAppStateChanged: {
        transport.event("app-state-changed", { state: appState })

        // WARNING: CAVEAT: this works when you've focused ANOTHER app and then get back to this one
        if (Qt.platform.os === "osx" && appState === Qt.ApplicationActive && !root.visible) {
            root.show()
        }
    }

    onClosing: function(event){
        event.accepted = false
        root.hide()
    }

    //
    // On complete handler
    //
    Component.onCompleted: function() {
        console.log('Stremio Plus shell version: '+Qt.application.version)

        // Kind of hacky way to ensure there are no Qt bindings going on; otherwise when we go to fullscreen
        // Qt tries to restore original window size
        root.height = root.initialHeight
        root.width = root.initialWidth

        // Start streaming server
        var args = Qt.application.arguments
        if (args.indexOf("--no-streaming-server") > -1)
            console.log("Skipping launch of streaming server");
        else
            launchServer();

        // Handle file opens
        var lastArg = args[1]; // not actually last, but we want to be consistent with what happens when we open
                               // a second instance (main.cpp)
        if (args.length > 1 && !lastArg.match('^--')) onAppOpenMedia(lastArg)
    }
}
