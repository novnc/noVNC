#!/bin/bash
# By default, start script starts a gnome desktop environment on a vnc server, which can be connected via the web browser
#
# Sample usage 1: RUN_IN_BACKGROUND=1 ./start.sh
# Sample usage 2: RUN_IN_BACKGROUND=1 DESKTOP_ENV=xfce ./start.sh
# Sample usage 3: RUN_IN_BACKGROUND=1 MUTE_ALL_LOGS=1 ./start.sh # for use in bash.rc automation, replace ./start.sh with full path
# set FORCE_KILL=1 to force restart vnc server and client if it is already running
# set FORCE_REINSTALL_TURBOVNC=1 to reinstall turbovnc to the latest version
# set RUN_IN_BACKGROUND=1 to start proxy and vnc client in background
# set DESKTOP_ENV=xfce to switch desktop environments to xfce instead of default gnome
# set MUTE_ALL_LOGS=1 to mute all logs to console, for automation purposes

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd "$SCRIPT_DIR"

if [ ! -z $MUTE_ALL_LOGS ] && [ $MUTE_ALL_LOGS -eq 1 ]; then
    export LOGGER_LEVEL=ERROR
fi

. ./utils/shell-logger

hasUpdated=0
desktopEnv=${DESKTOP_ENV:-gnome} # Supports xfce or gnome, others like kde needs intervention in this script
NOVNC_PORT=6080

info "Selected Desktop environment :: $desktopEnv"

if [ -z $FORCE_KILL ]; then
    if pgrep -f novnc_proxy >/dev/null && pgrep -f vncserver >/dev/null; then
        if pgrep -fdesktopEnv $ >/dev/null; then
            info "Virtual desktop already running on $NOVNC_PORT-$WEB_HOST/vnc.html\n"
            exit
        fi
    fi
fi

# desktop environment installation - gnome installed by default in cloud workstation, so we skip that
if ! dpkg-query -W -f='${Status}' xfce4 2>/dev/null | grep -q "install ok installed"; then
    if [ $desktopEnv == "xfce" ]; then
        info "installing xfce4 desktop environment"
        sudo apt update
        hasUpdated=1
        sudo DEBIAN_FRONTEND=noninteractive apt install -y xfce4 xfce4-goodies
    fi
fi

# vnc server installation
if [ ! -d /opt/TurboVNC ] || [ ! -z $FORCE_REINSTALL_TURBOVNC ]; then
    info "installing latest version of turbo vnc"
    curl -s https://api.github.com/repos/TurboVNC/turbovnc/releases/latest | grep "browser_download_url.*amd64.deb" | cut -d : -f 2,3 | tr -d \" | wget --show-progress -O ./vnc/turbovnc.deb -qi -
    sudo dpkg -i ./vnc/turbovnc.deb # Install turbo vnc
fi

info "updating vnc startup initialization script @ ~/.vnc/xstartup"
mkdir -p ~/.vnc

if [ $desktopEnv == "gnome" ]; then
    startCmd="$(which gnome-session) &"
    wm=""
elif [ $desktopEnv == "xfce" ]; then
    startCmd="startxcfe4 &" # not required for turbovnc
    wm="xfce"
else
    error "invalid desktop environment selected"
    exit 1
fi

# All other vnc servers uses xstartup
cat > ~/.vnc/xstartup << EOF
#!/bin/sh
xrdb $HOME/.Xresources
$startCmd
EOF
chmod u+x ~/.vnc/xstartup

# Turbo vnc uses this configuration instead
cat > ~/.vnc/turbovncserver.conf << EOF
\$wm = "$wm";
EOF

display=$(/opt/TurboVNC/bin/vncserver -list | grep -E "^:" | awk '{print $1}')
displayNumber=${display/:}
info "previous display number $displayNumber"

if [ ! -z $display ]; then
    info "restarting vnc server on display $display"
    /opt/TurboVNC/bin/vncserver -kill $display
else
    info "no display found"
fi
/opt/TurboVNC/bin/vncserver -localhost -depth 24 -geometry 3440x1440
display=$(/opt/TurboVNC/bin/vncserver -list | grep -E "^:" | awk '{print $1}')
displayNumber=${display/:}
displayPort=$((5900+$displayNumber))
info "display number $displayNumber, display port $displayPort"

cd utils

# Start noVNC
info "starting vnc client and forwarder"
if lsof -t -i:$NOVNC_PORT>/dev/null; then
    info "previous novnc client detected, killing process now"
    kill -9 $(lsof -t -i:$NOVNC_PORT)
fi

if [ ! -z $RUN_IN_BACKGROUND ]; then
    info "running novnc proxy in background"
    mkdir -p ~/logs
    ./novnc_proxy --vnc localhost:$displayPort &> ~/logs/novnc.log &
    info "\nNavigate to this URL:\n\n$NOVNC_PORT-$WEB_HOST/vnc.html\n"
else
    ./novnc_proxy --vnc localhost:$displayPort 
fi
