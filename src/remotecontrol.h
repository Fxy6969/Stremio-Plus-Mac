#ifndef REMOTECONTROL_H
#define REMOTECONTROL_H

#include <QObject>
#include <QStringList>
#include <QVariantMap>

// Remotes and media controls, reported to the web UI as commands:
//  - game controllers and the Siri Remote (GameController framework):
//    "up" / "down" / "left" / "right" (value: pressed), "select", "back",
//    "playPause", "skipForward", "skipBackward"
//  - media keys, AirPods, Control Center (MediaPlayer framework): "playPause",
//    "play", "pause", "skipForward", "skipBackward", "next", "previous",
//    "seek" (value: seconds)
// It also publishes what's playing to Control Center's Now Playing.
class RemoteControl : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QStringList controllers READ controllers NOTIFY controllersChanged)

public:
    explicit RemoteControl(QObject *parent = nullptr);
    ~RemoteControl() override;

    QStringList controllers() const;

    // info: title, subtitle, duration and position (seconds), paused, artwork (URL)
    Q_INVOKABLE void setNowPlaying(const QVariantMap &info);
    Q_INVOKABLE void clearNowPlaying();

    // Called from the Objective-C side
    void emitCommand(const QString &name, const QVariant &value = QVariant());
    void updateControllers();

signals:
    void command(const QString &name, const QVariant &value);
    void controllersChanged(const QStringList &controllers);

private:
    struct Private;
    Private *d;
};

#endif // REMOTECONTROL_H
