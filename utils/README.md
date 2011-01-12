## WebSockets Proxy


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

* Daemonizing: When the `-D` option is specified, wsproxy runs
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

* Mini-webserver: wsproxy can detect and respond to normal web
  requests on the same port as the WebSockets proxy and Flash security
  policy. This functionality is activate with the `--web DIR` option
  where DIR is the root of the web directory to serve.

* Wrap a program: see the "Wrap a Program" section below.


#### Implementations of wsproxy

There are three implementations of wsproxy: python, C, and Node
(node.js). wswrapper is only implemented in C.

Here is the feature support matrix for the the wsproxy
implementations:

<table>
    <tr>
        <th>Program</th>
        <th>Language</th>
        <th>Multiprocess</th>
        <th>Daemonize</th>
        <th>SSL/wss</th>
        <th>Flash Policy Server</th>
        <th>Session Record</th>
        <th>Web Server</th>
        <th>Program Wrap</th>
    </tr> <tr>
        <td>wsproxy.py</td>
        <td>python</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes 1</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
    </tr> <tr>
        <td>wsproxy</td>
        <td>C</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
    </tr>
    </tr> <tr>
        <td>wsproxy.js</td>
        <td>Node (node.js)</td>
        <td>yes</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
        <td>no</td>
    </tr>
</table>


* Note 1: to use SSL/wss with python 2.5 or older, see the following
  section on *Building the Python ssl module*.


### Wrap a Program

In addition to proxying from a source address to a target address
(which may be on a different system), wsproxy has the ability to
launch a program on the local system and proxy WebSockets traffic to
a normal TCP port owned/bound by the program.

The is accomplished with a small LD_PRELOAD library (`rebind.so`)
which intercepts bind() system calls by the program. The specified
port is moved to a new localhost/loopback free high port. wsproxy
then proxies WebSockets traffic directed to the original port to the
new (moved) port of the program.

The program wrap mode is invoked by replacing the target with `--`
followed by the program command line to wrap.

    `./utils/wsproxy.py 2023 -- PROGRAM ARGS`

The `--wrap-mode` option can be used to indicate what action to take
when the wrapped program exits or daemonizes.

Here is an example of using wsproxy to wrap the vncserver command
(which backgrounds itself):

    `./utils/wsproxy.py 5901 --wrap-mode=ignore -- vncserver -geometry 1024x768 :1`

Here is an example of wrapping telnetd (from krb5-telnetd).telnetd
exits after the connection closes so the wrap mode is set to respawn
the command:

    `sudo ./utils/wsproxy.py 2023 --wrap-mode=respawn -- telnetd -debug 2023`

The `utils/wstelnet.html` page demonstrates a simple WebSockets based
telnet client.


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

