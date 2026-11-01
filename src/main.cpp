#include <clocale>

#define APP_TITLE "Stremio Plus"

#include "systemtray.h"

#include "main.h"
#include "stremioprocess.h"
#include "mpv.h"
#include "screensaver.h"
#include "modbridge.h"
#include "remotecontrol.h"

#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QDebug>
#include <QtGui/QSurfaceFormat>
#include <QtQuick/QQuickWindow>
#include <QtWebEngineQuick/QtWebEngineQuick>

static QString readResource(const char *path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        qWarning() << "Could not read resource" << path;
        return QString();
    }
    return QString::fromUtf8(file.readAll());
}

void InitializeParameters(QQmlApplicationEngine *engine, MainApp &app)
{
    QQmlContext *ctx = engine->rootContext();
    SystemTray *systemTray = new SystemTray();

    ctx->setContextProperty("applicationDirPath", QGuiApplication::applicationDirPath());
    ctx->setContextProperty("appTitle", QString(APP_TITLE));

    // Scripts injected into the web UI at document creation: the QWebChannel
    // client, the window.chrome.webview shim that Stremio Web v5 expects, and
    // the Stremio+ host (plugin API, plugin/theme loading, menu commands)
    QString injected;
    for (const char *path : {":/qtwebchannel/qwebchannel.js", ":/shell-bridge.js", ":/stremio-plus/runtime.js", ":/stremio-plus/host.js"})
        injected += readResource(path) + "\n;\n";

    // The Stremio+ menu, its macOS skin and the widgets are started by host.js
    // once the page has loaded; they are passed along as strings
    const QList<QPair<const char *, const char *>> deferred = {
        {"__stremioPlusMenuSource", ":/stremio-plus/panel.js"},
        {"__stremioPlusSkin", ":/stremio-plus/skin.css"},
        {"__stremioPlusWidgetsSource", ":/stremio-plus/widgets.js"},
        {"__stremioPlusColorPickerSource", ":/stremio-plus/color-picker.js"},
        {"__stremioPlusCommandsSource", ":/stremio-plus/commands.js"},
        {"__stremioPlusToolsSource", ":/stremio-plus/tools.js"},
        {"__stremioPlusSettingsSource", ":/stremio-plus/settings.js"},
        {"__stremioPlusTvHomeSource", ":/stremio-plus/tv-home.js"},
        {"__stremioPlusTvSource", ":/stremio-plus/tv.js"},
    };
    for (const auto &[name, path] : deferred) {
        const QByteArray json = QJsonDocument(QJsonArray{readResource(path)}).toJson(QJsonDocument::Compact);
        injected += QStringLiteral("window.%1 = %2;\n").arg(name, QString::fromUtf8(json.mid(1, json.size() - 2)));
    }
    ctx->setContextProperty("injectedScripts", injected);

    // Same data folder as the Stremio Plus Electron app, unless --data-dir=<path> is given
    QString dataDir = QDir(QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation)).filePath("stremio-plus");
    for (const QString &arg : app.arguments()) {
        if (arg.startsWith("--data-dir="))
            dataDir = QDir::cleanPath(arg.mid(QStringLiteral("--data-dir=").size()));
    }
    qInfo() << "Stremio+ data directory:" << dataDir;

    // --profile=<name> keeps a separate browser profile (login, localStorage), e.g. for testing
    QString profileName = "StremioPlus";
    for (const QString &arg : app.arguments()) {
        if (arg.startsWith("--profile="))
            profileName = arg.mid(QStringLiteral("--profile=").size());
    }
    ctx->setContextProperty("webProfileName", profileName);
    ctx->setContextProperty("modBridge", new ModBridge(dataDir, &app));
    ctx->setContextProperty("remoteControl", new RemoteControl(&app));

    // Set access to an object of class properties in QML context
    ctx->setContextProperty("systemTray", systemTray);

#ifdef QT_DEBUG
    ctx->setContextProperty("debug", true);
#else
    ctx->setContextProperty("debug", false);
#endif
}

int main(int argc, char **argv)
{
    // Media keys and Now Playing belong to the app's player (src/remotecontrol.mm),
    // not to whatever the page is playing (a trailer, for example)
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--autoplay-policy=no-user-gesture-required --disable-features=HardwareMediaKeyHandling,MediaSessionService");
#ifdef _WIN32
    // Default to ANGLE (DirectX), because that seems to eliminate so many issues on Windows
    // Also, according to the docs here: https://wiki.qt.io/Qt_5_on_Windows_ANGLE_and_OpenGL, ANGLE is also preferrable
    // We do not need advanced OpenGL features but we need more universal support

    QApplication::setAttribute(Qt::AA_UseOpenGLES);
    auto winVer = QSysInfo::windowsVersion();
    if (winVer <= QSysInfo::WV_WINDOWS8 && winVer != QSysInfo::WV_None)
    {
        qputenv("NODE_SKIP_PLATFORM_CHECK", "1");
    }
    if (winVer <= QSysInfo::WV_WINDOWS7 && winVer != QSysInfo::WV_None)
    {
        qputenv("QT_ANGLE_PLATFORM", "d3d9");
    }
#endif

    // mpv draws through OpenGL, so force the OpenGL scene graph backend
    // instead of Qt 6's default (Metal on macOS)
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    // macOS only gives a legacy 2.1 context by default; mpv's VideoToolbox
    // hardware decoding and modern scalers need a 3.2+ core profile
    QSurfaceFormat format = QSurfaceFormat::defaultFormat();
    format.setVersion(3, 2);
    format.setProfile(QSurfaceFormat::CoreProfile);
    QSurfaceFormat::setDefaultFormat(format);
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QtWebEngineQuick::initialize();

    QApplication::setApplicationName("Stremio Plus");
    QApplication::setApplicationVersion(STREMIO_SHELL_VERSION);
    QApplication::setOrganizationName("Stremio Plus");
    QApplication::setOrganizationDomain("fxy6969.com");

    MainApp app(argc, argv);

    app.setWindowIcon(QIcon(":/images/stremio_window.png"));

    // Qt sets the locale in the QGuiApplication constructor, but libmpv
    // requires the LC_NUMERIC category to be set to "C", so change it back.
    std::setlocale(LC_NUMERIC, "C");

    static QQmlApplicationEngine *engine = new QQmlApplicationEngine();

    qmlRegisterType<Process>("com.stremio.process", 1, 0, "Process");
    qmlRegisterType<ScreenSaver>("com.stremio.screensaver", 1, 0, "ScreenSaver");
    qmlRegisterType<MpvObject>("com.stremio.libmpv", 1, 0, "MpvObject");

    InitializeParameters(engine, app);

    engine->load(QUrl(QStringLiteral("qrc:/main.qml")));

    QObject::connect(&app, SIGNAL(receivedMessage(QVariant, QVariant)), engine->rootObjects().value(0),
                     SLOT(onAppMessageReceived(QVariant, QVariant)));
    int ret = app.exec();
    delete engine;
    engine = nullptr;
    return ret;
}
