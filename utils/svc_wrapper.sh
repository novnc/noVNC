#!/usr/bin/bash

listen_port="$(snapctl get novncsvc.listen_port)"
vnc_host_port="$(snapctl get novncsvc.vnc_host_port)"

utils/launch.sh --listen $listen_port --vnc $vnc_host_port
