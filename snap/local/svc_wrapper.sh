#!/bin/bash

# `snapctl get services` returns a JSON array, example:
#{
#"n6801": {
#   "listen": 6801,
#   "vnc": "localhost:5901"
#},
#"n6802": {
#    "listen": 6802,
#   "vnc": "localhost:5902"
#}
#}
snapctl get services | jq -c '.[]' | while read service; do # for each service the user sepcified..
    # get the important data for the service (listen port, VNC host:port)
    listen_port="$(echo $service | jq --raw-output '.listen')"
    vnc_host_port="$(echo $service | jq --raw-output '.vnc')" # --raw-output removes any quotation marks from the output
    
    # check whether those values are valid
    expr "$listen_port" : '^[0-9]\+$' > /dev/null
    listen_port_valid=$?
    if [ ! $listen_port_valid ] || [ -z "$vnc_host_port" ]; then
        # invalid values mean the service is disabled, do nothing except for printing a message (logged in /var/log/system or systemd journal)
        echo "novnc: not starting service ${service} with listen_port ${listen_port} and vnc_host_port ${vnc_host_port}"
    else
        # start (and fork with '&') the service using the specified listen port and VNC host:port
        $SNAP/utils/launch.sh --listen $listen_port --vnc $vnc_host_port &
    fi
done
