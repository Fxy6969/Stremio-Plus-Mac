#ifndef MODBRIDGE_H
#define MODBRIDGE_H

#include <QtCore/QHash>
#include <QtCore/QObject>
#include <QtCore/QVariant>

class QFileSystemWatcher;
class QNetworkAccessManager;
class QTimer;

// File access for the injected Stremio+ host script (plugins, themes, their
// settings and enabled state). Every path is relative to the data directory
// and requests that would escape it are refused.
class ModBridge : public QObject
{
    Q_OBJECT

public:
    explicit ModBridge(const QString &dataDir, QObject *parent = nullptr);

public slots:
    QString dataDir() const;
    // [{ file, text }] for every regular file in `subdir` ending with `suffix`
    QVariantList listFiles(const QString &subdir, const QString &suffix) const;
    // File contents, or null when the file does not exist
    QVariant readText(const QString &relPath) const;
    bool writeText(const QString &relPath, const QString &text);
    bool removeFile(const QString &relPath);
    bool openFolder(const QString &relPath);
    // Replies with fetchFinished(requestId, ...); only https:// is allowed
    void fetchText(int requestId, const QString &url);
    // Emits dirChanged(relDir) shortly after any file in it is added, edited or removed
    bool watchDir(const QString &relDir);
    // Plain text on the system clipboard (read natively, so the page needs no permission)
    QString clipboardText() const;

signals:
    void fetchFinished(int requestId, bool ok, int status, const QString &text);
    void dirChanged(const QString &relDir);

private:
    // Absolute path inside the data directory, or an empty string if outside
    QString resolve(const QString &relPath) const;

    void rewatch(const QString &relDir);

    QString m_dataDir;
    QNetworkAccessManager *m_network;
    QFileSystemWatcher *m_watcher = nullptr;
    QHash<QString, QTimer *> m_debounce; // relDir -> pending notification
};

#endif // MODBRIDGE_H
