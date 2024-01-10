#!/bin/bash
# export FORCE_REINSTALL_TURBOVNC=1 to reinstall turbovnc to the latest version

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd "$SCRIPT_DIR"

. ./utils/shell-logger

hasUpdated=0

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
cat > ~/.vnc/xstartup << EOF
#!/bin/bash
xrdb $HOME/.Xresources
# autocutsel -s CLIPBOARD -fork
startxfce4 &
EOF

display=$(/opt/TurboVNC/bin/vncserver -list | grep -E "^:" | awk '{print $1}')

if [ -z $display ]; then
    info "restarting vnc server"
    /opt/TurboVNC/bin/vncserver -kill $display
    /opt/TurboVNC/bin/vncserver -localhost -depth 24 -geometry 3440x1440
fi
cd utils

# Start noVNC
info "starting vnc client and forwarder"
if lsof -t -i:6080; then
    kill -9 $(lsof -t -i:6080)
fi

echo "6080-$WEB_HOST:80"

./novnc_proxy --vnc localhost:5901 
