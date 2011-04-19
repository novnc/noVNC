#!/usr/bin/env python

'''
Python WebSocket library with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, socket, ssl, struct, traceback, select
import os, resource, errno, signal # daemonizing
from SimpleHTTPServer import SimpleHTTPRequestHandler
from cStringIO import StringIO
from base64 import b64encode, b64decode
try:
    from hashlib import md5
except:
    from md5 import md5  # Support python 2.4
from urlparse import urlsplit
from cgi import parse_qsl

class WebSocketServer(object):
    """
    WebSockets server class.
    Must be sub-classed with new_client method definition.
    """

    server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
%sWebSocket-Origin: %s\r
%sWebSocket-Location: %s://%s%s\r
%sWebSocket-Protocol: sample\r
\r
%s"""

    policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\n"""

    class EClose(Exception):
        pass

    def __init__(self, listen_host='', listen_port=None,
            verbose=False, cert='', key='', ssl_only=None,
            daemon=False, record='', web=''):

        # settings
        self.verbose     = verbose
        self.listen_host = listen_host
        self.listen_port = listen_port
        self.ssl_only    = ssl_only
        self.daemon      = daemon


        # Make paths settings absolute
        self.cert = os.path.abspath(cert)
        self.key = self.web = self.record = ''
        if key:
            self.key = os.path.abspath(key)
        if web:
            self.web = os.path.abspath(web)
        if record:
            self.record = os.path.abspath(record)

        if self.web:
            os.chdir(self.web)

        self.handler_id  = 1

        print "WebSocket server settings:"
        print "  - Listen on %s:%s" % (
                self.listen_host, self.listen_port)
        print "  - Flash security policy server"
        if self.web:
            print "  - Web server"
        if os.path.exists(self.cert):
            print "  - SSL/TLS support"
            if self.ssl_only:
                print "  - Deny non-SSL/TLS connections"
        else:
            print "  - No SSL/TLS support (no cert file)"
        if self.daemon:
            print "  - Backgrounding (daemon)"

    #
    # WebSocketServer static methods
    #
    @staticmethod
    def daemonize(self, keepfd=None):
        os.umask(0)
        if self.web:
            os.chdir(self.web)
        else:
            os.chdir('/')
        os.setgid(os.getgid())  # relinquish elevations
        os.setuid(os.getuid())  # relinquish elevations

        # Double fork to daemonize
        if os.fork() > 0: os._exit(0)  # Parent exits
        os.setsid()                    # Obtain new process group
        if os.fork() > 0: os._exit(0)  # Parent exits

        # Signal handling
        def terminate(a,b): os._exit(0)
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, signal.SIG_IGN)

        # Close open files
        maxfd = resource.getrlimit(resource.RLIMIT_NOFILE)[1]
        if maxfd == resource.RLIM_INFINITY: maxfd = 256
        for fd in reversed(range(maxfd)):
            try:
                if fd != keepfd:
                    os.close(fd)
            except OSError, exc:
                if exc.errno != errno.EBADF: raise

        # Redirect I/O to /dev/null
        os.dup2(os.open(os.devnull, os.O_RDWR), sys.stdin.fileno())
        os.dup2(os.open(os.devnull, os.O_RDWR), sys.stdout.fileno())
        os.dup2(os.open(os.devnull, os.O_RDWR), sys.stderr.fileno())

    @staticmethod
    def encode(buf):
        """ Encode a WebSocket packet. """
        buf = b64encode(buf)
        return "\x00%s\xff" % buf

    @staticmethod
    def decode(buf):
        """ Decode WebSocket packets. """
        if buf.count('\xff') > 1:
            return [b64decode(d[1:]) for d in buf.split('\xff')]
        else:
            return [b64decode(buf[1:-1])]

    @staticmethod
    def parse_handshake(handshake):
        """ Parse fields from client WebSockets handshake. """
        ret = {}
        req_lines = handshake.split("\r\n")
        if not req_lines[0].startswith("GET "):
            raise Exception("Invalid handshake: no GET request line")
        ret['path'] = req_lines[0].split(" ")[1]
        for line in req_lines[1:]:
            if line == "": break
            try:
                var, val = line.split(": ")
            except:
                raise Exception("Invalid handshake header: %s" % line)
            ret[var] = val

        if req_lines[-2] == "":
            ret['key3'] = req_lines[-1]

        return ret

    @staticmethod
    def gen_md5(keys):
        """ Generate hash value for WebSockets handshake v76. """
        key1 = keys['Sec-WebSocket-Key1']
        key2 = keys['Sec-WebSocket-Key2']
        key3 = keys['key3']
        spaces1 = key1.count(" ")
        spaces2 = key2.count(" ")
        num1 = int("".join([c for c in key1 if c.isdigit()])) / spaces1
        num2 = int("".join([c for c in key2 if c.isdigit()])) / spaces2

        return md5(struct.pack('>II8s', num1, num2, key3)).digest()


    #
    # WebSocketServer logging/output functions
    #

    def traffic(self, token="."):
        """ Show traffic flow in verbose mode. """
        if self.verbose and not self.daemon:
            sys.stdout.write(token)
            sys.stdout.flush()

    def msg(self, msg):
        """ Output message with handler_id prefix. """
        if not self.daemon:
            print "% 3d: %s" % (self.handler_id, msg)

    def vmsg(self, msg):
        """ Same as msg() but only if verbose. """
        if self.verbose:
            self.msg(msg)

    #
    # Main WebSocketServer methods
    #

    def do_handshake(self, sock, address):
        """
        do_handshake does the following:
        - Peek at the first few bytes from the socket.
        - If the connection is Flash policy request then answer it,
          close the socket and return.
        - If the connection is an HTTPS/SSL/TLS connection then SSL
          wrap the socket.
        - Read from the (possibly wrapped) socket.
        - If we have received a HTTP GET request and the webserver
          functionality is enabled, answer it, close the socket and
          return.
        - Assume we have a WebSockets connection, parse the client
          handshake data.
        - Send a WebSockets handshake server response.
        - Return the socket for this WebSocket client.
        """

        stype = ""

        ready = select.select([sock], [], [], 3)[0]
        if not ready:
            raise self.EClose("ignoring socket not ready")
        # Peek, but do not read the data so that we have a opportunity
        # to SSL wrap the socket first
        handshake = sock.recv(1024, socket.MSG_PEEK)
        #self.msg("Handshake [%s]" % repr(handshake))

        if handshake == "":
            raise self.EClose("ignoring empty handshake")

        elif handshake.startswith("<policy-file-request/>"):
            # Answer Flash policy request
            handshake = sock.recv(1024)
            sock.send(self.policy_response)
            raise self.EClose("Sending flash policy response")

        elif handshake[0] in ("\x16", "\x80"):
            # SSL wrap the connection
            if not os.path.exists(self.cert):
                raise self.EClose("SSL connection but '%s' not found"
                                  % self.cert)
            try:
                retsock = ssl.wrap_socket(
                        sock,
                        server_side=True,
                        certfile=self.cert,
                        keyfile=self.key)
            except ssl.SSLError, x:
                if x.args[0] == ssl.SSL_ERROR_EOF:
                    raise self.EClose("")
                else:
                    raise

            scheme = "wss"
            stype = "SSL/TLS (wss://)"

        elif self.ssl_only:
            raise self.EClose("non-SSL connection received but disallowed")

        else:
            retsock = sock
            scheme = "ws"
            stype = "Plain non-SSL (ws://)"

        # Now get the data from the socket
        handshake = retsock.recv(4096)

        if len(handshake) == 0:
            raise self.EClose("Client closed during handshake")

        # Check for and handle normal web requests
        if handshake.startswith('GET ') and \
            handshake.find('Upgrade: WebSocket\r\n') == -1:
            if not self.web:
                raise self.EClose("Normal web request received but disallowed")
            sh = SplitHTTPHandler(handshake, retsock, address)
            if sh.last_code < 200 or sh.last_code >= 300:
                raise self.EClose(sh.last_message)
            elif self.verbose:
                raise self.EClose(sh.last_message)
            else:
                raise self.EClose("")

        #self.msg("handshake: " + repr(handshake))
        # Parse client WebSockets handshake
        self.headers = self.parse_handshake(handshake)

        if self.headers.get('key3'):
            trailer = self.gen_md5(self.headers)
            pre = "Sec-"
            ver = 76
        else:
            trailer = ""
            pre = ""
            ver = 75

        self.msg("%s: %s WebSocket connection (version %s)"
                    % (address[0], stype, ver))

        # Send server WebSockets handshake response
        response = self.server_handshake % (pre,
                self.headers['Origin'], pre, scheme,
                self.headers['Host'], self.headers['path'], pre,
                trailer)
        #self.msg("sending response:", repr(response))
        retsock.send(response)

        # Return the WebSockets socket which may be SSL wrapped
        return retsock


    #
    # Events that can/should be overridden in sub-classes
    #
    def started(self):
        """ Called after WebSockets startup """
        self.vmsg("WebSockets server started")

    def poll(self):
        """ Run periodically while waiting for connections. """
        #self.vmsg("Running poll()")
        pass

    def top_SIGCHLD(self, sig, stack):
        # Reap zombies after calling child SIGCHLD handler
        self.do_SIGCHLD(sig, stack)
        self.vmsg("Got SIGCHLD, reaping zombies")
        try:
            result = os.waitpid(-1, os.WNOHANG)
            while result[0]:
                self.vmsg("Reaped child process %s" % result[0])
                result = os.waitpid(-1, os.WNOHANG)
        except (OSError):
            pass

    def do_SIGCHLD(self, sig, stack):
        pass

    def do_SIGINT(self, sig, stack):
        self.msg("Got SIGINT, exiting")
        sys.exit(0)

    def new_client(self, client):
        """ Do something with a WebSockets client connection. """
        raise("WebSocketServer.new_client() must be overloaded")

    def start_server(self):
        """
        Daemonize if requested. Listen for for connections. Run
        do_handshake() method for each connection. If the connection
        is a WebSockets client then call new_client() method (which must
        be overridden) for each new client connection.
        """

        lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        lsock.bind((self.listen_host, self.listen_port))
        lsock.listen(100)

        if self.daemon:
            self.daemonize(self, keepfd=lsock.fileno())

        self.started()  # Some things need to happen after daemonizing

        # Reep zombies
        signal.signal(signal.SIGCHLD, self.top_SIGCHLD)
        signal.signal(signal.SIGINT, self.do_SIGINT)

        while True:
            try:
                try:
                    csock = startsock = None
                    pid = err = 0

                    try:
                        self.poll()

                        ready = select.select([lsock], [], [], 1)[0];
                        if lsock in ready:
                            startsock, address = lsock.accept()
                        else:
                            continue
                    except Exception, exc:
                        if hasattr(exc, 'errno'):
                            err = exc.errno
                        else:
                            err = exc[0]
                        if err == errno.EINTR:
                            self.vmsg("Ignoring interrupted syscall")
                            continue
                        else:
                            raise

                    self.vmsg('%s: forking handler' % address[0])
                    pid = os.fork()

                    if pid == 0:
                        # handler process
                        csock = self.do_handshake(startsock, address)
                        self.new_client(csock)
                    else:
                        # parent process
                        self.handler_id += 1

                except self.EClose, exc:
                    # Connection was not a WebSockets connection
                    if exc.args[0]:
                        self.msg("%s: %s" % (address[0], exc.args[0]))
                except KeyboardInterrupt, exc:
                    pass
                except Exception, exc:
                    self.msg("handler exception: %s" % str(exc))
                    if self.verbose:
                        self.msg(traceback.format_exc())

            finally:
                if csock and csock != startsock:
                    csock.close()
                if startsock:
                    startsock.close()

            if pid == 0:
                break # Child process exits


# HTTP handler with request from a string and response to a socket
class SplitHTTPHandler(SimpleHTTPRequestHandler):
    def __init__(self, req, resp, addr):
        # Save the response socket
        self.response = resp
        SimpleHTTPRequestHandler.__init__(self, req, addr, object())

    def setup(self):
        self.connection = self.response
        # Duck type request string to file object
        self.rfile = StringIO(self.request)
        self.wfile = self.connection.makefile('wb', self.wbufsize)

    def send_response(self, code, message=None):
        # Save the status code
        self.last_code = code
        SimpleHTTPRequestHandler.send_response(self, code, message)

    def log_message(self, f, *args):
        # Save instead of printing
        self.last_message = f % args


