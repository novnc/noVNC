#!/bin/bash

usage() {
    if [ "$*" ]; then
        echo "$*"
        echo
    fi
    echo "Usage: ${NAME} [--web WEB_PORT] [--proxy PROXY_PORT] [--vnc VNC_HOST:PORT]"
    echo
    echo "Starts a mini-webserver and the WebSockets proxy and"
    echo "provides a cut and paste URL to go to."
    echo 
    echo "    --web WEB_PORT        Port to serve web pages at"
    echo "                          Default: 8080"
    echo "    --proxy PROXY_PORT    Port for proxy to listen on"
    echo "                          Default: 8081"
    echo "    --vnc VNC_HOST:PORT   VNC server host:port proxy target"
    echo "                          Default: localhost:5900"
    exit 2
}

NAME="$(basename $0)"
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB_PORT="6080"
PROXY_PORT="6081"
VNC_DEST="localhost:5900"
web_pid=""
proxy_pid=""

die() {
    echo "$*"
    exit 1
}

cleanup() {
    trap - TERM QUIT INT EXIT
    trap "true" CHLD   # Ignore cleanup messages
    echo
    if [ -n "${web_pid}" ]; then
        echo "Terminating webserver (${web_pid})"
        kill ${web_pid}
    fi
    if [ -n "${proxy_pid}" ]; then
        echo "Terminating WebSockets proxy (${proxy_pid})"
        kill ${proxy_pid}
    fi
}

# Process Arguments

# Arguments that only apply to chrooter itself
while [ "$*" ]; do
    param=$1; shift; OPTARG=$1
    case $param in
    --web)   WEB_PORT="${OPTARG}"; shift          ;;
    --proxy) PROXY_PORT="${OPTARG}"; shift        ;;
    --vnc)   VNC_DEST="${OPTARG}"; shift          ;;
    -h|--help) usage ;;
    -*) usage "Unknown chrooter option: ${param}" ;;
    *) break ;;
    esac
done

# Sanity checks
which netstat >/dev/null 2>&1 \
    || die "Must have netstat installed"

netstat -ltn | grep -qs "${WEB_PORT}.*LISTEN" \
    && die "Port ${WEB_PORT} in use. Try --web WEB_PORT"

netstat -ltn | grep -qs "${PROXY_PORT}.*LISTEN" \
    && die "Port ${PROXY_PORT} in use. Try --proxy PROXY_PORT"

trap "cleanup" TERM QUIT INT EXIT

# Find vnc.html
if [ -e "$(pwd)/vnc.html" ]; then
    TOP=$(pwd)
elif [ -e "${HERE}/../vnc.html" ]; then
    TOP=${HERE}/../
elif [ -e "${HERE}/vnc.html" ]; then
    TOP=${HERE}
else
    die "Could not find vnc.html"
fi
cd ${TOP}

echo "Starting webserver on port ${WEB_PORT}"
${HERE}/web.py ${WEB_PORT} >/dev/null &
web_pid="$!"
sleep 1
if ps -p ${web_pid} >/dev/null; then
    echo "Started webserver (pid: ${web_pid})"
else
    web_pid=
    echo "Failed to start webserver"
    exit 1
fi

echo "Starting WebSockets proxy on port ${PROXY_PORT}"
${HERE}/wsproxy.py -f ${PROXY_PORT} ${VNC_DEST} &
proxy_pid="$!"
sleep 1
if ps -p ${proxy_pid} >/dev/null; then
    echo "Started WebSockets proxy (pid: ${proxy_pid})"
else
    proxy_pid=
    echo "Failed to start WebSockets proxy"
    exit 1
fi

echo -e "\n\nNavigate to to this URL:\n"
echo -e "    http://$(hostname):${WEB_PORT}/vnc.html?host=$(hostname)&port=${PROXY_PORT}\n"
echo -e "Press Ctrl-C to exit\n\n"

wait ${web_pid}

