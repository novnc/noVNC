#!/bin/sh

listen_port="$(snapctl get novncsvc.listen-port)"
vnc_host_port="$(snapctl get novncsvc.vnc-host-port)"

expr "$listen_port" : '^[0-9]\+$' > /dev/null
listen_port_valid=$?
if [ ! $listen_port_valid ] || [ -z "$vnc_host_port" ]; then
    # invalid values mean the service is disabled, do nothing
    echo "novncsvc disabled"
else
    $SNAP/utils/launch.sh --listen $listen_port --vnc $vnc_host_port
fi
