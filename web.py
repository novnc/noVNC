#!/usr/bin/python

import sys
from BaseHTTPServer import HTTPServer
from CGIHTTPServer import CGIHTTPRequestHandler

try:
    port = int(sys.argv[1])
except:
    print "%s port" % sys.argv[0]
    sys.exit(2)

server = HTTPServer(('',port), CGIHTTPRequestHandler)
server.serve_forever()
