## wsproxy: WebSockets to TCP Proxy


### How it works

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


### Additional features

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


### Implementations

There are two implementations of wsproxy included: a python
implementation and a C implementation.

Here is the feature support matrix for the wsproxy implementations:


<table>
    <tr>
        <th>Implementation</th>
        <th>Basic Proxying</th>
        <th>Daemonizing</th>
        <th>SSL/wss</th>
        <th>Flash Policy Server</th>
        <th>Session Recording</th>
    </tr> <tr>
        <td>python</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes 1</td>
        <td>yes</td>
        <td>yes</td>
    </tr> <tr>
        <td>C</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>yes</td>
        <td>no</td>
    </tr>
</table>

* Note 1: to use SSL/wss with python 2.5 or older, see the following
  section on *Building the Python ssl module*.


### Building the Python ssl module (for python 2.5 and older)

* Install the build dependencies. On Ubuntu use this command:

    sudo aptitude install python-dev bluetooth-dev

* Download, build the ssl module and symlink to it:

    cd noVNC/utils
    wget http://pypi.python.org/packages/source/s/ssl/ssl-1.15.tar.gz
    tar xvzf ssl-1.15.tar.gz
    cd ssl-1.15
    make
    cd ../
    ln -sf ssl-1.15/build/lib.linux-*/ssl ssl

