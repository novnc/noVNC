#!/usr/bin/python
# File: asynchat-example-1.py

import asyncore, asynchat
import sys, os, socket, string

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: ws://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

class WSChannel(asynchat.async_chat):

    def __init__(self, server, sock, addr):
        print ">> WSChannel.__init__"
        asynchat.async_chat.__init__(self, sock)
        self.set_terminator("\r\n\r\n")
        self.handshake = None
        self.data = ""
        self.shutdown = 0

    def collect_incoming_data(self, data):
        #print ">> WSChannel.collect_incoming_data"
        self.data = self.data + data

    def found_terminator(self):
        #print ">> WSChannel.found_terminator"
        if not self.handshake:
            # got the client handshake lines
            self.handshake = self.data
            req_lines = self.handshake.split("\r\n")
            _, path, _ = req_lines[0].split(" ")
            _, origin = req_lines[4].split(" ")
            _, host = req_lines[3].split(" ")
            print "*** got handshake:\n%s" % self.handshake
            print "*** origin: %s, location: ws://%s%s" % (origin, host, path)
            self.push(server_handshake % (origin, host, path))
#            self.push("HTTP/1.1 101 Web Socket Protocol Handshake\r\n")
#            self.push("Upgrade: WebSocket\r\n")
#            self.push("Connection: Upgrade\r\n")
#            self.push("WebSocket-Origin: %s\r\n" % origin)
#            self.push("WebSocket-Location: ws://%s%s\r\n" % (host, path))
#            self.push("WebSocket-Protocol: sample\r\n")
#            self.push("\r\n")
            self.set_terminator("\xff") # look for frame terminators
        else:
            # return payload.
            print "received: %s" % self.data
            self.push("\x00 client sent: %s \xff" % self.data)

        self.data = ""

class WSServer(asyncore.dispatcher):

    def __init__(self, port):
        asyncore.dispatcher.__init__(self)
        self.create_socket(socket.AF_INET, socket.SOCK_STREAM)
        self.bind(("", port))
        self.listen(5)
        print "<< WSServer.__init__"

    def handle_accept(self):
        print ">> WSServer.handle_accept"
        conn, addr = self.accept()
        WSChannel(self, conn, addr)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print "Usage: %s <port>" % sys.argv[0]
        sys.exit(2)
    PORT = int(sys.argv[1])
    s = WSServer(PORT)
    print "serving Web Socket at port", PORT, "..."
    asyncore.loop()
