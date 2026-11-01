#!/bin/zsh
# Development build for Apple Silicon/Intel Macs using Homebrew Qt 6 and mpv.
# Builds build/StremioPlus.app and puts the streaming server next to the binary.
#
#   brew install qtwebengine qtwebchannel qtdeclarative mpv node ffmpeg
#   ./mac/dev-build.sh
set -euo pipefail
cd "${0:A:h}/.."

qmake6 -spec macx-clang stremio.pro
make -j"$(sysctl -n hw.ncpu)"

MACOS_DIR=build/StremioPlus.app/Contents/MacOS
SERVER_DIR="$HOME/Library/Application Support/stremio-plus/streamingserver"

if [[ ! -f "$MACOS_DIR/server.js" ]]; then
    if [[ -f "$SERVER_DIR/server.js" ]]; then
        cp "$SERVER_DIR/server.js" "$MACOS_DIR/server.js"
    else
        curl -fsSL "$(curl -fsSL https://raw.githubusercontent.com/Stremio/stremio-shell/master/server-url.txt)" -o "$MACOS_DIR/server.js"
    fi
fi

# Dev builds use the Homebrew binaries; a release bundle would copy them in
ln -sf "$(command -v node)" "$MACOS_DIR/node"
ln -sf "$(command -v ffmpeg)" "$MACOS_DIR/ffmpeg"
ln -sf "$(command -v ffprobe)" "$MACOS_DIR/ffprobe"

echo "Built $MACOS_DIR/StremioPlus"

# Install into /Applications (quitting a running copy first so it can be replaced)
INSTALL_PATH="/Applications/Stremio Plus.app"
if pgrep -f "$INSTALL_PATH/Contents/MacOS/StremioPlus" >/dev/null; then
    osascript -e "tell application \"$INSTALL_PATH\" to quit" 2>/dev/null || true
    for _ in {1..50}; do pgrep -f "$INSTALL_PATH/Contents/MacOS/StremioPlus" >/dev/null || break; sleep 0.1; done
    pkill -f "$INSTALL_PATH/Contents/MacOS/StremioPlus" 2>/dev/null || true
fi
rm -rf "$INSTALL_PATH"
ditto build/StremioPlus.app "$INSTALL_PATH"
echo "Installed $INSTALL_PATH"
