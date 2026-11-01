#include "remotecontrol.h"

#import <AppKit/AppKit.h>
#import <GameController/GameController.h>
#import <MediaPlayer/MediaPlayer.h>

struct RemoteControl::Private
{
    QStringList controllers;
    NSMutableArray *observers = [NSMutableArray array];
    NSMutableArray *targets = [NSMutableArray array];   // (command, target) pairs to remove
    QString artworkUrl;                                   // last artwork requested
    MPMediaItemArtwork *artwork = nil;
};

namespace
{
// A direction is reported pressed / released; the web UI repeats while held
void bindDirection(RemoteControl *rc, GCControllerButtonInput *button, const char *name)
{
    if (!button)
        return;
    const QString direction = QString::fromLatin1(name);
    button.pressedChangedHandler = ^(GCControllerButtonInput *, float, BOOL pressed) {
        rc->emitCommand(direction, bool(pressed));
    };
}

void bindPress(RemoteControl *rc, GCControllerButtonInput *button, const char *name)
{
    if (!button)
        return;
    const QString command = QString::fromLatin1(name);
    button.pressedChangedHandler = ^(GCControllerButtonInput *, float, BOOL pressed) {
        if (pressed)
            rc->emitCommand(command);
    };
}

void setUpController(RemoteControl *rc, GCController *controller)
{
    if (GCExtendedGamepad *pad = controller.extendedGamepad) {
        bindDirection(rc, pad.dpad.up, "up");
        bindDirection(rc, pad.dpad.down, "down");
        bindDirection(rc, pad.dpad.left, "left");
        bindDirection(rc, pad.dpad.right, "right");
        bindDirection(rc, pad.leftThumbstick.up, "up");
        bindDirection(rc, pad.leftThumbstick.down, "down");
        bindDirection(rc, pad.leftThumbstick.left, "left");
        bindDirection(rc, pad.leftThumbstick.right, "right");
        bindPress(rc, pad.buttonA, "select");
        bindPress(rc, pad.buttonB, "back");
        bindPress(rc, pad.buttonMenu, "playPause");
        bindPress(rc, pad.leftShoulder, "skipBackward");
        bindPress(rc, pad.rightShoulder, "skipForward");
    } else if (GCMicroGamepad *remote = controller.microGamepad) {
        // Siri Remote: swipes or presses on the touch surface / click pad move,
        // pressing it selects, Menu / Back goes back, Play/Pause plays
        remote.reportsAbsoluteDpadValues = NO;
        remote.allowsRotation = NO;
        bindDirection(rc, remote.dpad.up, "up");
        bindDirection(rc, remote.dpad.down, "down");
        bindDirection(rc, remote.dpad.left, "left");
        bindDirection(rc, remote.dpad.right, "right");
        bindPress(rc, remote.buttonA, "select");
        bindPress(rc, remote.buttonX, "playPause");
        bindPress(rc, remote.buttonMenu, "back");
    }
}

MPRemoteCommandHandlerStatus ok() { return MPRemoteCommandHandlerStatusSuccess; }
} // namespace

RemoteControl::RemoteControl(QObject *parent)
    : QObject(parent), d(new Private)
{
    // ── Controllers ──────────────────────────────────────────────────────────
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [d->observers addObject:[center addObserverForName:GCControllerDidConnectNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        setUpController(this, note.object);
        updateControllers();
    }]];
    [d->observers addObject:[center addObserverForName:GCControllerDidDisconnectNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
        updateControllers();
    }]];
    for (GCController *controller in GCController.controllers)
        setUpController(this, controller);
    updateControllers();

    // ── Media keys, AirPods, Control Center ─────────────────────────────────
    MPRemoteCommandCenter *commands = MPRemoteCommandCenter.sharedCommandCenter;
    auto add = [&](MPRemoteCommand *command, const char *name) {
        const QString commandName = QString::fromLatin1(name);
        id target = [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *) {
            emitCommand(commandName);
            return ok();
        }];
        [d->targets addObject:@[command, target]];
    };
    add(commands.togglePlayPauseCommand, "playPause");
    add(commands.playCommand, "play");
    add(commands.pauseCommand, "pause");
    add(commands.nextTrackCommand, "next");
    add(commands.previousTrackCommand, "previous");
    commands.skipForwardCommand.preferredIntervals = @[@10];
    commands.skipBackwardCommand.preferredIntervals = @[@10];
    add(commands.skipForwardCommand, "skipForward");
    add(commands.skipBackwardCommand, "skipBackward");
    id seek = [commands.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
        emitCommand(QStringLiteral("seek"), static_cast<MPChangePlaybackPositionCommandEvent *>(event).positionTime);
        return ok();
    }];
    [d->targets addObject:@[commands.changePlaybackPositionCommand, seek]];
}

RemoteControl::~RemoteControl()
{
    for (id observer in d->observers)
        [NSNotificationCenter.defaultCenter removeObserver:observer];
    for (NSArray *pair in d->targets)
        [static_cast<MPRemoteCommand *>(pair[0]) removeTarget:pair[1]];
    clearNowPlaying();
    delete d;
}

QStringList RemoteControl::controllers() const
{
    return d->controllers;
}

void RemoteControl::updateControllers()
{
    QStringList names;
    for (GCController *controller in GCController.controllers)
        names << QString::fromNSString(controller.vendorName ?: @"Controller");
    if (names == d->controllers)
        return;
    d->controllers = names;
    emit controllersChanged(names);
}

void RemoteControl::emitCommand(const QString &name, const QVariant &value)
{
    emit command(name, value);
}

void RemoteControl::setNowPlaying(const QVariantMap &info)
{
    NSMutableDictionary *now = [NSMutableDictionary dictionary];
    now[MPMediaItemPropertyTitle] = info.value("title").toString().toNSString();
    const QString subtitle = info.value("subtitle").toString();
    if (!subtitle.isEmpty())
        now[MPMediaItemPropertyArtist] = subtitle.toNSString();
    const double duration = info.value("duration").toDouble();
    if (duration > 0)
        now[MPMediaItemPropertyPlaybackDuration] = @(duration);
    now[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(info.value("position").toDouble());
    const bool paused = info.value("paused").toBool();
    now[MPNowPlayingInfoPropertyPlaybackRate] = @(paused ? 0.0 : 1.0);
    now[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeVideo);
    if (d->artwork)
        now[MPMediaItemPropertyArtwork] = d->artwork;

    MPNowPlayingInfoCenter *center = MPNowPlayingInfoCenter.defaultCenter;
    center.nowPlayingInfo = now;
    center.playbackState = paused ? MPNowPlayingPlaybackStatePaused : MPNowPlayingPlaybackStatePlaying;

    // Artwork loads in the background and is added once it arrives
    const QString artworkUrl = info.value("artwork").toString();
    if (artworkUrl.isEmpty() || artworkUrl == d->artworkUrl)
        return;
    d->artworkUrl = artworkUrl;
    d->artwork = nil;
    NSURL *url = [NSURL URLWithString:artworkUrl.toNSString()];
    if (!url)
        return;
    Private *priv = d;
    [[NSURLSession.sharedSession dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *, NSError *) {
        NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
        if (!image)
            return;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (priv->artworkUrl != artworkUrl)
                return;
            priv->artwork = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size requestHandler:^NSImage *(CGSize) { return image; }];
            NSMutableDictionary *current = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo mutableCopy];
            if (!current)
                return;
            current[MPMediaItemPropertyArtwork] = priv->artwork;
            MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = current;
        });
    }] resume];
}

void RemoteControl::clearNowPlaying()
{
    MPNowPlayingInfoCenter *center = MPNowPlayingInfoCenter.defaultCenter;
    center.nowPlayingInfo = nil;
    center.playbackState = MPNowPlayingPlaybackStateStopped;
    d->artworkUrl.clear();
    d->artwork = nil;
}
