#!/usr/bin/env python

'''
Python WebSocket library with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

Supports following protocol versions:
    - http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-75
    - http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-76
    - http://tools.ietf.org/html/draft-ietf-hybi-thewebsocketprotocol-07

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
    from hashlib import md5, sha1
except:
    # Support python 2.4
    from md5 import md5
    from sha import sha as sha1
try:
    import numpy, ctypes
except:
    numpy = ctypes = None
from urlparse import urlsplit
from cgi import parse_qsl

class WebSocketServer(object):
    """
    WebSockets server class.
    Must be sub-classed with new_client method definition.
    """

    buffer_size = 65536

    server_handshake_hixie = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
%sWebSocket-Origin: %s\r
%sWebSocket-Location: %s://%s%s\r
"""

    server_handshake_hybi = """HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: %s\r
"""

    GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

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
    def daemonize(keepfd=None, chdir='/'):
        os.umask(0)
        if chdir:
            os.chdir(chdir)
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
    def encode_hybi(buf, opcode, base64=False):
        """ Encode a HyBi style WebSocket frame.
        Optional opcode:
            0x0 - continuation
            0x1 - text frame (base64 encode buf)
            0x2 - binary frame (use raw buf)
            0x8 - connection close
            0x9 - ping
            0xA - pong
        """
        if base64:
            buf = b64encode(buf)

        b1 = 0x80 | (opcode & 0x0f) # FIN + opcode
        payload_len = len(buf)
        if payload_len <= 125:
            header = struct.pack('>BB', b1, payload_len)
        elif payload_len > 125 and payload_len <= 65536:
            header = struct.pack('>BBH', b1, 126, payload_len)
        elif payload_len >= 65536:
            header = struct.pack('>BBQ', b1, 127, payload_len)

        #print "Encoded: %s" % repr(header + buf)

        return header + buf

    @staticmethod
    def decode_hybi(buf, base64=False):
        """ Decode HyBi style WebSocket packets.
        Returns:
            {'fin'          : 0_or_1,
             'opcode'       : number,
             'mask'         : 32_bit_number,
             'length'       : payload_bytes_number,
             'payload'      : decoded_buffer,
             'left'         : bytes_left_number,
             'close_code'   : number,
             'close_reason' : string}
        """

        ret = {'fin'          : 0,
               'opcode'       : 0,
               'mask'         : 0,
               'length'       : 0,
               'payload'      : None,
               'left'         : 0,
               'close_code'   : None,
               'close_reason' : None}

        blen = len(buf)
        ret['left'] = blen
        header_len = 2

        if blen < header_len:
            return ret # Incomplete frame header

        b1, b2 = struct.unpack_from(">BB", buf)
        ret['opcode'] = b1 & 0x0f
        ret['fin'] = (b1 & 0x80) >> 7
        has_mask = (b2 & 0x80) >> 7

        ret['length'] = b2 & 0x7f

        if ret['length'] == 126:
            header_len = 4
            if blen < header_len:
                return ret # Incomplete frame header
            (ret['length'],) = struct.unpack_from('>xxH', buf)
        elif ret['length'] == 127:
            header_len = 10
            if blen < header_len:
                return ret # Incomplete frame header
            (ret['length'],) = struct.unpack_from('>xxQ', buf)

        full_len = header_len + has_mask * 4 + ret['length']

        if blen < full_len: # Incomplete frame
            return ret # Incomplete frame header

        # Number of bytes that are part of the next frame(s)
        ret['left'] = blen - full_len

        # Process 1 frame
        if has_mask:
            # unmask payload
            ret['mask'] = buf[header_len:header_len+4]
            b = c = ''
            if ret['length'] >= 4:
                mask = numpy.frombuffer(buf, dtype=numpy.dtype('<L4'),
                        offset=header_len, count=1)
                data = numpy.frombuffer(buf, dtype=numpy.dtype('<L4'),
                        offset=header_len + 4, count=int(ret['length'] / 4))
                #b = numpy.bitwise_xor(data, mask).data
                b = numpy.bitwise_xor(data, mask).tostring()

            if ret['length'] % 4:
                print "Partial unmask"
                mask = numpy.frombuffer(buf, dtype=numpy.dtype('B'),
                        offset=header_len, count=(ret['length'] % 4))
                data = numpy.frombuffer(buf, dtype=numpy.dtype('B'),
                        offset=full_len - (ret['length'] % 4),
                        count=(ret['length'] % 4))
                c = numpy.bitwise_xor(data, mask).tostring()
            ret['payload'] = b + c
        else:
            print "Unmasked frame:", repr(buf)
            ret['payload'] = buf[(header_len + has_mask * 4):full_len]

        if base64 and ret['opcode'] in [1, 2]:
            try:
                ret['payload'] = b64decode(ret['payload'])
            except:
                print "Exception while b64decoding buffer:", repr(buf)
                raise

        if ret['opcode'] == 0x08:
            if ret['length'] >= 2:
                ret['close_code'] = struct.unpack_from(
                        ">H", ret['payload'])
            if ret['length'] > 3:
                ret['close_reason'] = ret['payload'][2:]

        return ret

    @staticmethod
    def encode_hixie(buf):
        return "\x00" + b64encode(buf) + "\xff"

    @staticmethod
    def decode_hixie(buf):
        end = buf.find('\xff')
        return {'payload': b64decode(buf[1:end]),
                'left': len(buf) - (end + 1)}


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
        """ Generate hash value for WebSockets hixie-76. """
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
    def send_frames(self, bufs=None):
        """ Encode and send WebSocket frames. Any frames already
        queued will be sent first. If buf is not set then only queued
        frames will be sent. Returns the number of pending frames that
        could not be fully sent. If returned pending frames is greater
        than 0, then the caller should call again when the socket is
        ready. """

        if bufs:
            for buf in bufs:
                if self.version.startswith("hybi"):
                    if self.base64:
                        self.send_parts.append(self.encode_hybi(buf,
                            opcode=1, base64=True))
                    else:
                        self.send_parts.append(self.encode_hybi(buf,
                            opcode=2, base64=False))
                else:
                    self.send_parts.append(self.encode_hixie(buf))

        while self.send_parts:
            # Send pending frames
            buf = self.send_parts.pop(0)
            sent = self.client.send(buf)

            if sent == len(buf):
                self.traffic("<")
            else:
                self.traffic("<.")
                self.send_parts.insert(0, buf[sent:])
                break

        return len(self.send_parts)

    def recv_frames(self):
        """ Receive and decode WebSocket frames.

        Returns:
            (bufs_list, closed_string)
        """

        closed = False
        bufs = []

        buf = self.client.recv(self.buffer_size)
        if len(buf) == 0:
            closed = "Client closed abruptly"
            return bufs, closed

        if self.recv_part:
            # Add partially received frames to current read buffer
            buf = self.recv_part + buf
            self.recv_part = None

        while buf:
            if self.version.startswith("hybi"):

                frame = self.decode_hybi(buf, base64=self.base64)
                #print "Received buf: %s, frame: %s" % (repr(buf), frame)

                if frame['payload'] == None:
                    # Incomplete/partial frame
                    self.traffic("}.")
                    if frame['left'] > 0:
                        self.recv_part = buf[-frame['left']:]
                    break
                else:
                    if frame['opcode'] == 0x8: # connection close
                        closed = "Client closed, reason: %s - %s" % (
                                frame['close_code'],
                                frame['close_reason'])
                        break

            else:
                if buf[0:2] == '\xff\x00':
                    closed = "Client sent orderly close frame"
                    break

                elif buf[0:2] == '\x00\xff':
                    buf = buf[2:]
                    continue # No-op

                elif buf.count('\xff') == 0:
                    # Partial frame
                    self.traffic("}.")
                    self.recv_part = buf
                    break

                frame = self.decode_hixie(buf)

            self.traffic("}")

            bufs.append(frame['payload'])

            if frame['left']:
                buf = buf[-frame['left']:]
            else:
                buf = ''

        return bufs, closed

    def send_close(self, code=None, reason=''):
        """ Send a WebSocket orderly close frame. """

        if self.version.startswith("hybi"):
            msg = ''
            if code != None:
                msg = struct.pack(">H%ds" % (len(reason)), code)

            buf = self.encode_hybi(msg, opcode=0x08, base64=False)
            self.client.send(buf)

        elif self.version == "hixie-76":
            buf = self.encode_hixie('\xff\x00')
            self.client.send(buf)

        # No orderly close for 75

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
        #self.msg("Handshake [%s]" % handshake)

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
        if (handshake.startswith('GET ') and
                handshake.find('Upgrade: WebSocket\r\n') == -1 and
                handshake.find('Upgrade: websocket\r\n') == -1):
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
        h = self.headers = self.parse_handshake(handshake)

        prot = 'WebSocket-Protocol'
        protocols = h.get('Sec-'+prot, h.get(prot, '')).split(',')

        ver = h.get('Sec-WebSocket-Version')
        if ver:
            # HyBi/IETF version of the protocol

            if not numpy or not ctypes:
                self.EClose("Python numpy and ctypes modules required for HyBi-07 or greater")

            if ver == '7':
                self.version = "hybi-07"
            else:
                raise self.EClose('Unsupported protocol version %s' % ver)

            key = h['Sec-WebSocket-Key']

            # Choose binary if client supports it
            if 'binary' in protocols:
                self.base64 = False
            elif 'base64' in protocols:
                self.base64 = True
            else:
                raise self.EClose("Client must support 'binary' or 'base64' protocol")

            # Generate the hash value for the accept header
            accept = b64encode(sha1(key + self.GUID).digest())

            response = self.server_handshake_hybi % accept
            if self.base64:
                response += "Sec-WebSocket-Protocol: base64\r\n"
            else:
                response += "Sec-WebSocket-Protocol: binary\r\n"
            response += "\r\n"

        else:
            # Hixie version of the protocol (75 or 76)

            if h.get('key3'):
                trailer = self.gen_md5(h)
                pre = "Sec-"
                self.version = "hixie-76"
            else:
                trailer = ""
                pre = ""
                self.version = "hixie-75"

            # We only support base64 in Hixie era
            self.base64 = True

            response = self.server_handshake_hixie % (pre,
                    h['Origin'], pre, scheme, h['Host'], h['path'])

            if 'base64' in protocols:
                response += "%sWebSocket-Protocol: base64\r\n" % pre
            else:
                self.msg("Warning: client does not report 'base64' protocol support")
            response += "\r\n" + trailer

        self.msg("%s: %s WebSocket connection" % (address[0], stype))
        self.msg("%s: Version %s, base64: '%s'" % (address[0],
            self.version, self.base64))

        # Send server WebSockets handshake response
        #self.msg("sending response [%s]" % response)
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
            self.daemonize(keepfd=lsock.fileno(), chdir=self.web)

        self.started()  # Some things need to happen after daemonizing

        # Reep zombies
        signal.signal(signal.SIGCHLD, self.top_SIGCHLD)
        signal.signal(signal.SIGINT, self.do_SIGINT)

        while True:
            try:
                try:
                    self.client = None
                    startsock = None
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
                        # Initialize per client settings
                        self.send_parts = []
                        self.recv_part  = None
                        self.base64     = False
                        # handler process
                        self.client = self.do_handshake(
                                startsock, address)
                        self.new_client()
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
                if self.client and self.client != startsock:
                    self.client.close()
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


