#ifndef MPVRENDERER_H_
#define MPVRENDERER_H_
#define MPV_ENABLE_DEPRECATED 0

#include <QtQuick/QQuickItem>

#include <QtCore/QObject>
#include <QtCore/QJsonObject>

#include <QtCore/QtGlobal>
#include <QtGui/QOpenGLContext>


#include <QtQuick/QQuickWindow>
#include <QtQuick/QQuickView>

#include <mpv/client.h>
#include <mpv/render_gl.h>
#include "mpv_qthelper.h"

class MpvObject : public QQuickItem
{
    Q_OBJECT

    mpv_handle *mpv;
    mpv_render_context *mpv_gl;

public:
    static void on_update(void *ctx);

    MpvObject(QQuickItem * parent = 0);
    virtual ~MpvObject();

public slots:
    void command(const QVariant& params);
    void setProperty(const QString& name, const QVariant& value);
    QVariant getProperty(const QString& name);
    void observeProperty(const QString& name);

signals:
    void onUpdate();
    void mpvEvent(const QString& ev, const QVariant& value);

private slots:
    void doUpdate();
    void handleWindowChanged(QQuickWindow *win);
    void renderUnderlay();
    void releaseGl();
    void on_mpv_events();

private:
    static void wakeup(void *ctx);
    void handle_mpv_event(mpv_event *event);
    void initialize_mpv();
    QSet<QString> observed_properties;
};

#endif
