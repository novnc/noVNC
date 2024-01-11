#!/bin/bash
# Sample usage: RUN_IN_BACKGROUND=1 ./start.sh
# set FORCE_KILL=1 to force restart vnc server and client if it is already running
# set FORCE_REINSTALL_TURBOVNC=1 to reinstall turbovnc to the latest version
# set RUN_IN_BACKGROUND=1 to start proxy and vnc client in background

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd "$SCRIPT_DIR"

. ./utils/shell-logger

hasUpdated=0
NOVNC_PORT=6080

if [ -z $FORCE_KILL ]; then
    if pgrep -f novnc_proxy >/dev/null && pgrep -f vncserver >/dev/null && pgrep -f xfce4 >/dev/null; then
        printf "Virtual desktop already running on $NOVNC_PORT-$WEB_HOST/vnc.html\n"
        exit
    fi
fi

# desktop environment installation
if ! dpkg-query -W -f='${Status}' xfce4 2>/dev/null | grep -q "install ok installed"; then
    sudo apt update
    hasUpdated=1
    info "installing xfce4 desktop environment"
    sudo DEBIAN_FRONTEND=noninteractive apt install -y xfce4 xfce4-goodies
fi

# vnc server installation
if [ ! -d /opt/TurboVNC ] || [ ! -z $FORCE_REINSTALL_TURBOVNC ]; then
    info "installing latest version of turbo vnc"
    curl -s https://api.github.com/repos/TurboVNC/turbovnc/releases/latest | grep "browser_download_url.*amd64.deb" | cut -d : -f 2,3 | tr -d \" | wget --show-progress -O ./vnc/turbovnc.deb -qi -
    sudo dpkg -i ./vnc/turbovnc.deb # Install turbo vnc
fi

# utils
hash autocutsel 2>/dev/null || { 
    info "installing autocutsel for clipboard operations"
    if [ $hasUpdated -eq 0 ]; then
        sudo apt update
    fi
    sudo apt install autocutsel 
}

info "updating vnc startup initialization script @ ~/.vnc/xstartup"
mkdir -p ~/.vnc
cat > ~/.vnc/xstartup << EOF
#!/bin/bash
xrdb $HOME/.Xresources
# autocutsel -s CLIPBOARD -fork
startxfce4 &
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
    printf "\nNavigate to this URL:\n\n$NOVNC_PORT-$WEB_HOST/vnc.html\n"
else
    ./novnc_proxy --vnc localhost:$displayPort 
fi
