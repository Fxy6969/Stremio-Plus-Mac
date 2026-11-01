#include "modbridge.h"

#include <QtCore/QDir>
#include <QtCore/QFileSystemWatcher>
#include <QtCore/QTimer>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QSaveFile>
#include <QtCore/QUrl>
#include <QtCore/QVariantMap>
#include <QtGui/QClipboard>
#include <QtGui/QDesktopServices>
#include <QtGui/QGuiApplication>
#include <QtNetwork/QNetworkAccessManager>
#include <QtNetwork/QNetworkReply>
#include <QtNetwork/QNetworkRequest>

ModBridge::ModBridge(const QString &dataDir, QObject *parent)
    : QObject(parent), m_dataDir(QDir(dataDir).absolutePath()), m_network(new QNetworkAccessManager(this))
{
    for (const char *subdir : {"plugins", "themes", "settings"})
        QDir().mkpath(QDir(m_dataDir).filePath(subdir));
}

QString ModBridge::dataDir() const
{
    return m_dataDir;
}

QString ModBridge::resolve(const QString &relPath) const
{
    if (relPath.isEmpty() || QDir::isAbsolutePath(relPath))
        return QString();

    const QString path = QDir::cleanPath(QDir(m_dataDir).filePath(relPath));
    if (path != m_dataDir && !path.startsWith(m_dataDir + "/"))
        return QString();
    return path;
}

QVariantList ModBridge::listFiles(const QString &subdir, const QString &suffix) const
{
    QVariantList result;
    const QString dirPath = resolve(subdir);
    if (dirPath.isEmpty())
        return result;

    const QFileInfoList entries = QDir(dirPath).entryInfoList(QDir::Files, QDir::Name);
    for (const QFileInfo &info : entries) {
        if (!suffix.isEmpty() && !info.fileName().endsWith(suffix))
            continue;
        QFile file(info.absoluteFilePath());
        if (!file.open(QIODevice::ReadOnly))
            continue;
        QVariantMap entry;
        entry["file"] = info.fileName();
        entry["text"] = QString::fromUtf8(file.readAll());
        result.append(entry);
    }
    return result;
}

QVariant ModBridge::readText(const QString &relPath) const
{
    QFile file(resolve(relPath));
    if (file.fileName().isEmpty() || !file.open(QIODevice::ReadOnly))
        return QVariant::fromValue(nullptr);
    return QString::fromUtf8(file.readAll());
}

bool ModBridge::writeText(const QString &relPath, const QString &text)
{
    const QString path = resolve(relPath);
    if (path.isEmpty())
        return false;

    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly))
        return false;
    file.write(text.toUtf8());
    return file.commit();
}

bool ModBridge::removeFile(const QString &relPath)
{
    const QString path = resolve(relPath);
    return !path.isEmpty() && QFileInfo(path).isFile() && QFile::remove(path);
}

bool ModBridge::openFolder(const QString &relPath)
{
    const QString path = relPath.isEmpty() ? m_dataDir : resolve(relPath);
    if (path.isEmpty())
        return false;
    QDir().mkpath(path);
    return QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

void ModBridge::fetchText(int requestId, const QString &url)
{
    const QUrl target(url);
    if (target.scheme() != "https") {
        emit fetchFinished(requestId, false, 0, "Only HTTPS URLs are allowed");
        return;
    }

    QNetworkRequest request(target);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setTransferTimeout(20000);

    QNetworkReply *reply = m_network->get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, requestId]() {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool ok = reply->error() == QNetworkReply::NoError && status >= 200 && status < 300;
        const QString text = ok ? QString::fromUtf8(reply->readAll()) : reply->errorString();
        reply->deleteLater();
        emit fetchFinished(requestId, ok, status, text);
    });
}

bool ModBridge::watchDir(const QString &relDir)
{
    const QString path = resolve(relDir);
    if (path.isEmpty())
        return false;
    QDir().mkpath(path);

    if (!m_watcher) {
        m_watcher = new QFileSystemWatcher(this);
        auto changed = [this](const QString &changedPath) {
            // A watched directory reports itself; a watched file reports its folder
            const bool isDir = m_watcher->directories().contains(changedPath);
            const QString dir = isDir ? changedPath : QFileInfo(changedPath).absolutePath();
            // Editors often save in several steps (write, rename); report once they settle
            if (QTimer *timer = m_debounce.value(QDir(m_dataDir).relativeFilePath(dir)))
                timer->start();
        };
        connect(m_watcher, &QFileSystemWatcher::directoryChanged, this, changed);
        connect(m_watcher, &QFileSystemWatcher::fileChanged, this, changed);
    }

    if (!m_debounce.contains(relDir)) {
        auto *timer = new QTimer(this);
        timer->setSingleShot(true);
        timer->setInterval(150);
        connect(timer, &QTimer::timeout, this, [this, relDir]() {
            rewatch(relDir);
            emit dirChanged(relDir);
        });
        m_debounce.insert(relDir, timer);
    }
    rewatch(relDir);
    return true;
}

void ModBridge::rewatch(const QString &relDir)
{
    const QString path = resolve(relDir);
    if (path.isEmpty() || !m_watcher)
        return;
    // Saved-by-rename files are new inodes, so the file list is refreshed each time
    QStringList paths{path};
    for (const QFileInfo &info : QDir(path).entryInfoList(QDir::Files))
        paths << info.absoluteFilePath();
    const QStringList current = m_watcher->files() + m_watcher->directories();
    for (const QString &p : paths) {
        if (!current.contains(p))
            m_watcher->addPath(p);
    }
}

QString ModBridge::clipboardText() const
{
    return QGuiApplication::clipboard()->text().left(4096);
}
