#!/usr/bin/python

import sys, os, socket, time
from select import select

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: ws://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

cqueue = []
tqueue = []

def start_proxy(listen_port, target_host, target_port):
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(('', listen_port))
    lsock.listen(100)
    while True:
        try:
            print 'listening on port %s' % listen_port
            csock, address = lsock.accept()
            print 'Got client connection'
            handshake(csock)
            print "Handshake complete"
            print "Connecting to: %s:%s" % (target_host, target_port)
            tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            tsock.connect((target_host, target_port))

            socks = [csock, tsock]

            while True:
                ins, outs, excepts = select(socks, socks, socks, 1)
                if excepts: raise Exception("Socket exception")

                if csock in ins:
                    buf = csock.recv(1024)
                    if len(buf) == 0:
                        csock.close()
                        tsock.close()
                        raise Exception("Client closed")
                    tqueue.append(buf[1:-1])
                    print "Client recv: %s (%d)" % (buf[1:-1], len(buf))

                if tsock in ins:
                    buf = tsock.recv(1024)
                    if len(buf) == 0:
                        csock.close()
                        tsock.close()
                        raise Exception("Target closed")
                    cqueue.append(buf)
                    print "Target recv: %s (%d)" % (buf[1:-1], len(buf))

                if cqueue and csock in outs:
                    while cqueue:
                        print "Client send: %s" % "\x00" + cqueue[0] + "\xff"
                        csock.send("\x00" + cqueue.pop(0) + "\xff")

                if tqueue and tsock in outs:
                    while tqueue:
                        print "Target send: %s" % tqueue[0]
                        tsock.send(tqueue.pop(0))

        except Exception, e:
            csock = tsock = None
            print "Ignoring exception:", e

def handshake(client):
    handshake = client.recv(255)
    req_lines = handshake.split("\r\n")
    _, path, _ = req_lines[0].split(" ")
    _, origin = req_lines[4].split(" ")
    _, host = req_lines[3].split(" ")
    #print "*** got handshake:\n%s" % handshake
    print "*** client origin: %s, location: ws://%s%s" % (origin, host, path)
    client.send(server_handshake % (origin, host, path))

if __name__ == '__main__':
    try:
        if len(sys.argv) != 4: raise
        listen_port = int(sys.argv[1])
        target_host = sys.argv[2]
        target_port = int(sys.argv[3])
    except:
        print "Usage: <listen_port> <target_host> <target_port>"
        sys.exit(1)
    start_proxy(listen_port, target_host, target_port)
