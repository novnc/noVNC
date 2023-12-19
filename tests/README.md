# KasmVNC Client Tests

The page `/tests/vnc_playback.html` can be used to playback KasmVNC session recordings. The playbacks can be ran in realtime or as fast as possible for performance testing.

## Creating new recordings

In order to create a new recording, you will need to disable KasmVNC's built-in web server, enable the legacy VNC TCP port, and disable authentication.

```bash
sudo apt-get install websockify
vncserver -noWebsocket -disableBasicAuth
websockify --web /usr/share/kasmvnc/www --record=/home/ubuntu/record.bin 8444 localhost:5901
```

Websockify automatically adds a number to the end of the filename, so the above example might be record.bin.8. After you are finished recording, Ctrl+C the running websockify process and mv the file to the noVNC www directory.

```bash
sudo mkdir /usr/share/kasmvnc/www/recordings
mv /home/ubuntu/record.bin.8 /usr/share/kasmvnc/www/recordings
```

## Playing Back Recordings

Place recordings on the KasmVNC server in the /usr/share/kasmvnc/www/recordings directory, you may need to create this directory. Then navigate to https://server-ip:8444/tests/vnc_playback.html?data=record.bin.8 where record.bin.8 is the name of the playback file you placed in the recordings directory.

## Pre-Test Modifications

Before running performance testing using recording playback, you need to run noVNC from source, rather than the 'compiled' webpack. See the docs at docs/DEVELOP.md for running noVNC from source. 

## Kasm Provided Recordings

The following recordings are used by Kasm Technologies to provide repeatable performance statisitics using different rendering settings.

| Name | Description | URL|
|------|-------|----|
| newyork.1 | Default 'Static' preset mode. | https://kasm-static-content.s3.amazonaws.com/kasmvnc/playbacktests/newyork.1 |
| losangeles.1 | Default static preset mode with webp disabled | https://kasm-static-content.s3.amazonaws.com/kasmvnc/playbacktests/losangeles.1 |


## Historical Statistics

This table keeps track of performance of pre-defined recordings, defined in the previous section, on static hardware that can be replicated over time to track performance improvements.

| File | Commit | Hardware | OS | Browser | Webpacked | Result Avg |
|------|-----|----|----|---------|-------|---------|
| newyork.1 | 08233e6 | Macbook M1 Pro, 32GB RAM | macOS 12.2 | Chrome 106 | False | 2446ms |
| losangeles.1 | 08233e6 | Macbook M1 Pro, 32GB RAM | macOS 12.2 | Chrome 106 | False | 2272ms |
| newyork.1 | base64opt | Macbook M1 Pro, 32GB RAM | macOS 12.2 | Chrome 106 | False | 2273ms |
| losangeles.1 | base64opt | Macbook M1 Pro, 32GB RAM | macOS 12.2 | Chrome 106 | False | 1847ms |
| newyork.1 | 4a6aa73 | Macbook M1 Pro, 32GB RAM | macOS 12.2 | Chrome 119 | False | 2128ms |
| losangeles.1 | 4a6aa73 | Macbook M1 Pro, 32GB RAM | macOS 12.2 | Chrome 119 | False | 1766ms |