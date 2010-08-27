#!/usr/bin/python

'''
Python WebSocket library with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, socket, ssl, struct, traceback
import os, resource, errno, signal # daemonizing
from base64 import b64encode, b64decode
try:
    from hashlib import md5
except:
    from md5 import md5  # Support python 2.4
from urlparse import urlsplit
from cgi import parse_qsl

settings = {
    'listen_host' : '',
    'listen_port' : None,
    'handler'     : None,
    'cert'        : None,
    'ssl_only'    : False,
    'daemon'      : True,
    'record'      : None, }

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
%sWebSocket-Origin: %s\r
%sWebSocket-Location: %s://%s%s\r
%sWebSocket-Protocol: sample\r
\r
%s"""

policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\n"""

def traffic(token="."):
    sys.stdout.write(token)
    sys.stdout.flush()

def encode(buf):
    buf = b64encode(buf)

    return "\x00%s\xff" % buf

def decode(buf):
    """ Parse out WebSocket packets. """
    if buf.count('\xff') > 1:
        return [b64decode(d[1:]) for d in buf.split('\xff')]
    else:
        return [b64decode(buf[1:-1])]

def parse_handshake(handshake):
    ret = {}
    req_lines = handshake.split("\r\n")
    if not req_lines[0].startswith("GET "):
        raise Exception("Invalid handshake: no GET request line")
    ret['path'] = req_lines[0].split(" ")[1]
    for line in req_lines[1:]:
        if line == "": break
        var, val = line.split(": ")
        ret[var] = val

    if req_lines[-2] == "":
        ret['key3'] = req_lines[-1]

    return ret

def gen_md5(keys):
    key1 = keys['Sec-WebSocket-Key1']
    key2 = keys['Sec-WebSocket-Key2']
    key3 = keys['key3']
    spaces1 = key1.count(" ")
    spaces2 = key2.count(" ")
    num1 = int("".join([c for c in key1 if c.isdigit()])) / spaces1
    num2 = int("".join([c for c in key2 if c.isdigit()])) / spaces2

    return md5(struct.pack('>II8s', num1, num2, key3)).digest()


def do_handshake(sock):

    # Peek, but don't read the data
    handshake = sock.recv(1024, socket.MSG_PEEK)
    #print "Handshake [%s]" % repr(handshake)
    if handshake == "":
        print "Ignoring empty handshake"
        sock.close()
        return False
    elif handshake.startswith("<policy-file-request/>"):
        handshake = sock.recv(1024)
        print "Sending flash policy response"
        sock.send(policy_response)
        sock.close()
        return False
    elif handshake.startswith("\x16"):
        retsock = ssl.wrap_socket(
                sock,
                server_side=True,
                certfile=settings['cert'],
                ssl_version=ssl.PROTOCOL_TLSv1)
        scheme = "wss"
        print "  using SSL/TLS"
    elif settings['ssl_only']:
        print "Non-SSL connection disallowed"
        sock.close()
        return False
    else:
        retsock = sock
        scheme = "ws"
        print "  using plain (not SSL) socket"
    handshake = retsock.recv(4096)
    #print "handshake: " + repr(handshake)
    h = parse_handshake(handshake)

    if h.get('key3'):
        trailer = gen_md5(h)
        pre = "Sec-"
        print "  using protocol version 76"
    else:
        trailer = ""
        pre = ""
        print "  using protocol version 75"

    response = server_handshake % (pre, h['Origin'], pre, scheme,
            h['Host'], h['path'], pre, trailer)

    #print "sending response:", repr(response)
    retsock.send(response)
    return retsock

def daemonize(keepfd=None):
    os.umask(0)
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
            else:
                print "Keeping fd: %d" % fd
        except OSError, exc:
            if exc.errno != errno.EBADF: raise

    # Redirect I/O to /dev/null
    os.dup2(os.open(os.devnull, os.O_RDWR), sys.stdin.fileno())
    os.dup2(os.open(os.devnull, os.O_RDWR), sys.stdout.fileno())
    os.dup2(os.open(os.devnull, os.O_RDWR), sys.stderr.fileno())


def start_server():

    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind((settings['listen_host'], settings['listen_port']))
    lsock.listen(100)

    if settings['daemon']: daemonize(keepfd=lsock.fileno())

    while True:
        try:
            csock = startsock = None
            print 'waiting for connection on port %s' % settings['listen_port']
            startsock, address = lsock.accept()
            print 'Got client connection from %s' % address[0]
            csock = do_handshake(startsock)
            if not csock: continue

            settings['handler'](csock)

        except Exception:
            print "Ignoring exception:"
            print traceback.format_exc()
            if csock: csock.close()
            if startsock and startsock != csock: startsock.close()
