#!/usr/bin/python

import sys, os, socket

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: ws://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

def start_server(port):
    tick = 0
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('', port))
    sock.listen(100)
    while True:
        try:
            print 'listening on port %s' % port 
            csock, address = sock.accept()
            tick+=1
            print 'Got connection'
            handshake(csock, tick)
            print 'handshaken'
            while True:
                data = csock.recv(255)
                print 'got:%s' %(data)
                csock.send("\x00 server response %d \xff" % (tick))
                tick+=1
        except Exception, e:
            print "Ignoring exception:", e

def handshake(client, tick):
    handshake = client.recv(255)
    req_lines = handshake.split("\r\n")
    _, path, _ = req_lines[0].split(" ")
    _, origin = req_lines[4].split(" ")
    _, host = req_lines[3].split(" ")
    #print "*** got handshake:\n%s" % handshake
    print "*** client origin: %s, location: ws://%s%s" % (origin, host, path)
    client.send(server_handshake % (origin, host, path))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print "Usage: %s <port>" % sys.argv[0]
        sys.exit(2)
    PORT = int(sys.argv[1])
    start_server(PORT)

