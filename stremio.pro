TEMPLATE = app
TARGET = StremioPlus
VERSION=5.0.0
QMAKE_TARGET_BUNDLE_PREFIX = com.fxy6969
DEFINES += STREMIO_SHELL_VERSION=\\\"$$VERSION\\\"
ICON = images/stremio.icns
QMAKE_INFO_PLIST = mac/Info.plist

QT += qml quick network widgets opengl webenginequick webchannel webchannelquick
CONFIG += c++17

mac {
    QMAKE_LFLAGS_SONAME  = -Wl,-install_name,@executable_path/../Frameworks/
    LIBS += -framework CoreFoundation -framework IOKit
    QMAKE_RPATHDIR += @executable_path/../Frameworks
    QMAKE_RPATHDIR += @executable_path/lib
    # Homebrew mpv (no pkg-config needed)
    MPV_PREFIX = $$system(brew --prefix mpv)
    INCLUDEPATH += $$MPV_PREFIX/include
    LIBS += -L$$MPV_PREFIX/lib -lmpv

    # Remotes, game controllers and Now Playing (src/remotecontrol.mm)
    OBJECTIVE_SOURCES += src/remotecontrol.mm
    HEADERS += src/remotecontrol.h
    LIBS += -framework AppKit -framework GameController -framework MediaPlayer
    QMAKE_OBJECTIVE_CFLAGS += -fobjc-arc
}

win32 {
    INCLUDEPATH += ./dependencies/mpv/include
    LIBS += -L$$PWD/dependencies/mpv/ -lmpv
    RC_ICONS = $$PWD/images/stremio.ico
}

SOURCES += src/main.cpp \
    src/mpv.cpp \
    src/stremioprocess.cpp \
    src/screensaver.cpp \
    src/systemtray.cpp \
    src/modbridge.cpp

RESOURCES += src/qml.qrc
QML_IMPORT_PATH = src

HEADERS += src/main.h \
    src/mpv.h \
    src/stremioprocess.h \
    src/screensaver.h \
    src/systemtray.h \
    src/modbridge.h

DESTDIR = ./build
OBJECTS_DIR = ./build/obj
MOC_DIR = ./build/moc
RCC_DIR = build/.rcc
UI_DIR = build/.ui
