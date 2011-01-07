## WebSockets Utilities: wswrapper and wsproxy


### wswrapper

wswrapper is an LD_PRELOAD library that converts a TCP listen socket
of an existing program to a be a WebSockets socket. The `wswrap`
script can be used to easily launch a program using wswrapper. Here is
an example of using wswrapper with vncserver. wswrapper will convert
the socket listening on port 5901 to be a WebSockets port:

    `cd noVNC/utils`

    `./wswrap 5901 vncserver -geometry 640x480 :1`


### wsproxy

At the most basic level, wsproxy just translates WebSockets traffic
to normal socket traffic. wsproxy accepts the WebSockets handshake,
parses it, and then begins forwarding traffic between the client and
the target in both directions. WebSockets payload data is UTF-8
encoded so in order to transport binary data it must use an encoding
that can be encapsulated within UTF-8. wsproxy uses base64 to encode
all traffic to and from the client. Also, WebSockets traffic starts
with '\0' (0) and ends with '\xff' (255). Some buffering is done in
case the data from the client is not a full WebSockets frame (i.e.
does not end in 255).


#### Additional wsproxy features

These are not necessary for the basic operation.

* Daemonizing: When the `-f` option is not specified, wsproxy runs
  in the background as a daemon process.

* SSL (the wss:// WebSockets URI): This is detected automatically by
  wsproxy by sniffing the first byte sent from the client and then
  wrapping the socket if the data starts with '\x16' or '\x80'
  (indicating SSL).

* Flash security policy: wsproxy detects flash security policy
  requests (again by sniffing the first packet) and answers with an
  appropriate flash security policy response (and then closes the
  port). This means no separate flash security policy server is needed
  for supporting the flash WebSockets fallback emulator.

* Session recording: This feature that allows recording of the traffic
  sent and received from the client to a file using the `--record`
  option.


#### Implementations of wsproxy

There are three implementations of wsproxy: python, C, and Node
(node.js). wswrapper is only implemented in C.

Here is the feature support matrix for the the wsproxy implementations
and wswrapper:

<table>
    <tr>
        <th>Program</th>
        <th>Language</th>
        <th>Proxy or Interposer</th>
        <th>Multiprocess</th>
        <th>Daemonize</th>
        <th>SSL/wss</th>
        <th>Flash Policy Server</th>
        <th>Session Record</th>
        <th>Web Server</th>
    </tr> <tr>
        <td>wsproxy.py</td>
        <td>python</td>
        <td>proxy</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes 1</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
    </tr> <tr>
        <td>wsproxy</td>
        <td>C</td>
        <td>proxy</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>no</td>
        <td>no</td>
    </tr>
    </tr> <tr>
        <td>wsproxy.js</td>
        <td>Node (node.js)</td>
        <td>proxy</td>
        <td>yes</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
    </tr>
    </tr> <tr>
        <td>wswrap/wswrapper.so</td>
        <td>shell/C</td>
        <td>interposer</td>
        <td>indirectly</td>
        <td>indirectly</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
    </tr>
</table>


* Note 1: to use SSL/wss with python 2.5 or older, see the following
  section on *Building the Python ssl module*.


### Building the Python ssl module (for python 2.5 and older)

* Install the build dependencies. On Ubuntu use this command:

    `sudo aptitude install python-dev bluetooth-dev`

* Download, build the ssl module and symlink to it:

    `cd noVNC/utils`

    `wget http://pypi.python.org/packages/source/s/ssl/ssl-1.15.tar.gz`

    `tar xvzf ssl-1.15.tar.gz`

    `cd ssl-1.15`

    `make`

    `cd ../`

    `ln -sf ssl-1.15/build/lib.linux-*/ssl ssl`

