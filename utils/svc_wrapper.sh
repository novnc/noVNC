#!/bin/bash

echo "snactp get services is: $(snapctl get services)"

#for service in $(snapctl get services | cut -f1 -d' ' |cut -f2 -d".") # the cut calls get only the first column and then change 'service.n6801' to 'n6801'
snapctl get services | jq -c '.[]' | while read service; do
    listen_port="$(echo $service | jq '.listen')"
    vnc_host_port="$(echo $service | jq '.vnc')"

    # check for valid values
    expr "$listen_port" : '^[0-9]\+$' > /dev/null
    listen_port_valid=$?
    if [ ! $listen_port_valid ] || [ -z "$vnc_host_port" ]; then
        # invalid values mean the service is disabled, do nothing
        echo "novnc: not starting service ${service} with listen_port ${listen_port} and vnc_host_port ${vnc_host_port}"
    else
        $SNAP/utils/launch.sh --listen $listen_port --vnc $vnc_host_port
    fi
done
