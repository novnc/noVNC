#!/usr/bin/python

'''
A WebSocket to TCP socket proxy with support for "wss://" encryption.

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, os, socket, ssl, time, traceback, re
from base64 import b64encode, b64decode
from select import select

buffer_size = 65536
send_seq = 0
client_settings = {}

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: %s://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\n"""

traffic_legend = """
Traffic Legend:
    }  - Client receive
    }. - Client receive partial
    {  - Target receive

    >  - Target send
    >. - Target send partial
    <  - Client send
    <. - Client send partial
"""


def traffic(token="."):
    sys.stdout.write(token)
    sys.stdout.flush()

def decode(buf):
    """ Parse out WebSocket packets. """
    if buf.count('\xff') > 1:
        traffic(str(buf.count('\xff')))
        return [b64decode(d[1:]) for d in buf.split('\xff')]
    else:
        return [b64decode(buf[1:-1])]

def proxy(client, target):
    """ Proxy WebSocket to normal socket. """
    global send_seq
    cqueue = []
    cpartial = ""
    tqueue = []
    socks = [client, target]

    while True:
        ins, outs, excepts = select(socks, socks, socks, 1)
        if excepts: raise Exception("Socket exception")

        if tqueue and target in outs:
            #print "Target send: %s" % repr(tqueue[0])
            ##log.write("Target send: %s\n" % map(ord, tqueue[0]))
            dat = tqueue.pop(0)
            sent = target.send(dat)
            if sent == len(dat):
                traffic(">")
            else:
                tqueue.insert(0, dat[sent:])
                traffic(">.")

        if cqueue and client in outs:
            dat = cqueue.pop(0)
            sent = client.send(dat)
            if sent == len(dat):
                traffic("<")
                ##log.write("Client send: %s\n" % repr(dat))
            else:
                cqueue.insert(0, dat[sent:])
                traffic("<.")
                ##log.write("Client send partial: %s\n" % repr(dat[0:send]))


        if target in ins:
            buf = target.recv(buffer_size)
            if len(buf) == 0: raise Exception("Target closed")

            ##log.write("Target recv (%d): %s\n" % (len(buf), map(ord, buf)))

            if client_settings.get("b64encode"):
                buf = b64encode(buf)

            if client_settings.get("seq_num"):
                cqueue.append("\x00%d:%s\xff" % (send_seq, buf))
                send_seq += 1
            else:
                cqueue.append("\x00%s\xff" % buf)

            traffic("{")

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")

            if buf[-1] == "\xff":
                traffic("}")
                ##log.write("Client recv (%d): %s\n" % (len(buf), repr(buf)))
                if cpartial:
                    tqueue.extend(decode(cpartial + buf))
                    cpartial = ""
                else:
                    tqueue.extend(decode(buf))
            else:
                traffic("}.")
                ##log.write("Client recv partial (%d): %s\n" % (len(buf), repr(buf)))
                cpartial = cpartial + buf


def do_handshake(sock):
    global client_settings
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
    for cvar in [c for c in cvars if c]:
        name, _, value = cvar.partition('=')
        client_settings[name] = value and value or True

    print "client_settings:", client_settings

    retsock.send(server_handshake % (origin, scheme, host, path))
    return retsock

def start_server(listen_port, target_host, target_port):
    global send_seq
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(('', listen_port))
    lsock.listen(100)
    print traffic_legend
    while True:
        try:
            csock = tsock = None
            print 'waiting for connection on port %s' % listen_port
            startsock, address = lsock.accept()
            print 'Got client connection from %s' % address[0]
            csock = do_handshake(startsock)
            if not csock: continue
            print "Connecting to: %s:%s" % (target_host, target_port)
            tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            tsock.connect((target_host, target_port))

            send_seq = 0
            proxy(csock, tsock)

        except Exception:
            print "Ignoring exception:"
            print traceback.format_exc()
            if csock: csock.close()
            if tsock: tsock.close()

if __name__ == '__main__':
    ##log = open("ws.log", 'w')
    try:
        if len(sys.argv) != 4: raise
        listen_port = int(sys.argv[1])
        target_host = sys.argv[2]
        target_port = int(sys.argv[3])
    except:
        print "Usage: <listen_port> <target_host> <target_port>"
        sys.exit(1)
    start_server(listen_port, target_host, target_port)
