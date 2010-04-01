#!/usr/bin/python

from BaseHTTPServer import HTTPServer
from CGIHTTPServer import CGIHTTPRequestHandler
server = HTTPServer(('',8777), CGIHTTPRequestHandler)
server.serve_forever()
