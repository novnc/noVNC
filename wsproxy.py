#!/usr/bin/python

import sys, os, socket, time, traceback
from base64 import b64encode, b64decode
from select import select

buffer_size = 65536

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: ws://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>"""

def handshake(client):
    handshake = client.recv(1024)
    print "Handshake [%s]" % handshake
    if handshake.startswith("<policy-file-request/>"):
        print "Sending:", policy_response
        client.send(policy_response)
        handshake = client.recv(1024)
        print "Handshake [%s]" % handshake
    req_lines = handshake.split("\r\n")
    _, path, _ = req_lines[0].split(" ")
    _, origin = req_lines[4].split(" ")
    _, host = req_lines[3].split(" ")
    client.send(server_handshake % (origin, host, path))

def traffic(token="."):
    sys.stdout.write(token)
    sys.stdout.flush()

def decode(buf):
    """ Parse out WebSocket packets. """
    if buf.count('\xff') > 1:
        return [d[1:] for d in buf.split('\xff')]
    else:
        return [b64decode(buf[1:-1])]

def proxy(client, target):
    """ Proxy WebSocket to normal socket. """
    cqueue = []
    cpartial = ""
    tqueue = []
    socks = [client, target]

    while True:
        ins, outs, excepts = select(socks, socks, socks, 1)
        if excepts: raise Exception("Socket exception")

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")

            if buf[-1] == "\xff":
                if cpartial:
                    tqueue.extend(decode(cpartial + buf))
                    cpartial = ""
                else:
                    tqueue.extend(decode(buf))
                traffic("}")
            else:
                traffic(".}")
                cpartial = cpartial + buf

            #print "Client recv: %s (%d)" % (repr(buf, len(buf))

        if target in ins:
            buf = target.recv(buffer_size)
            if len(buf) == 0: raise Exception("Target closed")
            cqueue.append("\x00" + b64encode(buf) + "\xff")
            #print "Target recv: %s (%d)" % (repr(buf), len(buf))
            traffic("{")

        if cqueue and client in outs:
            while cqueue:
                #print "Client send: %s" % repr(cqueue[0])
                client.send(cqueue.pop(0))
                traffic("<")

        if tqueue and target in outs:
            while tqueue:
                #print "Target send: %s" % repr(tqueue[0])
                target.send(tqueue.pop(0))
                traffic(">")

def start_server(listen_port, target_host, target_port):
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(('', listen_port))
    lsock.listen(100)
    while True:
        try:
            csock = tsock = None
            print 'listening on port %s' % listen_port
            csock, address = lsock.accept()
            print 'Got client connection from %s' % address[0]
            handshake(csock)
            print "Connecting to: %s:%s" % (target_host, target_port)
            tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            tsock.connect((target_host, target_port))

            proxy(csock, tsock)

        except Exception:
            print "Ignoring exception:"
            print traceback.format_exc()
            if csock: csock.close()
            if tsock: tsock.close()

if __name__ == '__main__':
    try:
        if len(sys.argv) != 4: raise
        listen_port = int(sys.argv[1])
        target_host = sys.argv[2]
        target_port = int(sys.argv[3])
    except:
        print "Usage: <listen_port> <target_host> <target_port>"
        sys.exit(1)
    start_server(listen_port, target_host, target_port)
