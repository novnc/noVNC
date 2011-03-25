#!/usr/bin/env python
'''
A super simple HTTP/HTTPS webserver for python. Automatically detect

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import traceback, sys
import socket
import ssl
#import http.server as server      # python 3.X
import SimpleHTTPServer as server  # python 2.X

def do_request(connstream, from_addr):
    x = object()
    server.SimpleHTTPRequestHandler(connstream, from_addr, x)
    connstream.close()

def serve():
    bindsocket = socket.socket()
    bindsocket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    #bindsocket.bind(('localhost', PORT))
    bindsocket.bind(('', PORT))
    bindsocket.listen(5)

    print("serving on port", PORT)

    while True:
        try:
            newsocket, from_addr = bindsocket.accept()
            peek = newsocket.recv(1024, socket.MSG_PEEK)
            if peek.startswith("\x16"):
                connstream = ssl.wrap_socket(
                        newsocket,
                        server_side=True,
                        certfile='self.pem',
                        ssl_version=ssl.PROTOCOL_TLSv1)
            else:
                connstream = newsocket

            do_request(connstream, from_addr)

        except Exception:
            traceback.print_exc()

try:
    PORT = int(sys.argv[1])
except:
    print "%s port" % sys.argv[0]
    sys.exit(2)

serve()
