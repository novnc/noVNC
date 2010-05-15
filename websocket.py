#!/usr/bin/python

'''
Python WebSocket library with support for "wss://" encryption.

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, socket, ssl, traceback
from base64 import b64encode, b64decode

client_settings = {}
send_seq = 0

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: %s://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\n"""

def traffic(token="."):
    sys.stdout.write(token)
    sys.stdout.flush()

def decode(buf):
    """ Parse out WebSocket packets. """
    if buf.count('\xff') > 1:
        return [b64decode(d[1:]) for d in buf.split('\xff')]
    else:
        return [b64decode(buf[1:-1])]

def encode(buf):
    global send_seq
    if client_settings.get("b64encode"):
        buf = b64encode(buf)

    if client_settings.get("seq_num"):
        send_seq += 1
        return "\x00%d:%s\xff" % (send_seq-1, buf)
    else:
        return "\x00%s\xff" % buf


def do_handshake(sock):
    global client_settings, send_seq
    send_seq = 0
    # Peek, but don't read the data
    handshake = sock.recv(1024, socket.MSG_PEEK)
    #print "Handshake [%s]" % repr(handshake)
    if handshake.startswith("<policy-file-request/>"):
        handshake = sock.recv(1024)
        print "Sending flash policy response"
        sock.send(policy_response)
        sock.close()
        return False
    elif handshake.startswith("\x16"):
        retsock = ssl.wrap_socket(
                sock,
                server_side=True,
                certfile='self.pem',
                ssl_version=ssl.PROTOCOL_TLSv1)
        scheme = "wss"
        print "Using SSL/TLS"
    else:
        retsock = sock
        scheme = "ws"
        print "Using plain (not SSL) socket"
    handshake = retsock.recv(4096)
    req_lines = handshake.split("\r\n")
    _, path, _ = req_lines[0].split(" ")
    _, origin = req_lines[4].split(" ")
    _, host = req_lines[3].split(" ")

    # Parse settings from the path
    cvars = path.partition('?')[2].partition('#')[0].split('&')
    client_settings = {}
    for cvar in [c for c in cvars if c]:
        name, _, value = cvar.partition('=')
        client_settings[name] = value and value or True

    print "client_settings:", client_settings

    retsock.send(server_handshake % (origin, scheme, host, path))
    return retsock

def start_server(listen_port, handler):
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(('', listen_port))
    lsock.listen(100)
    while True:
        try:
            csock = None
            print 'waiting for connection on port %s' % listen_port
            startsock, address = lsock.accept()
            print 'Got client connection from %s' % address[0]
            csock = do_handshake(startsock)
            if not csock: continue

            handler(csock)

        except Exception:
            print "Ignoring exception:"
            print traceback.format_exc()
            if csock: csock.close()

