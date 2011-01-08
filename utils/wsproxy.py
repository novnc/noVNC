#!/usr/bin/python

'''
A WebSocket to TCP socket proxy with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import socket, optparse, time, os
from select import select
from websocket import WebSocketServer

class WebSocketProxy(WebSocketServer):
    """
    Proxy traffic to and from a WebSockets client to a normal TCP
    socket server target. All traffic to/from the client is base64
    encoded/decoded to allow binary data to be sent/received to/from
    the target.
    """

    buffer_size = 65536

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

    def __init__(self, *args, **kwargs):
        # Save off the target host:port
        self.target_host = kwargs.pop('target_host')
        self.target_port = kwargs.pop('target_port')
        WebSocketServer.__init__(self, *args, **kwargs)

    def handler(self, client):
        """
        Called after a new WebSocket connection has been established.
        """

        self.rec = None
        if self.record:
            # Record raw frame data as a JavaScript compatible file
            fname = "%s.%s" % (self.record,
                                self.handler_id)
            self.msg("opening record file: %s" % fname)
            self.rec = open(fname, 'w+')
            self.rec.write("var VNC_frame_data = [\n")

        # Connect to the target
        self.msg("connecting to: %s:%s" % (
                 self.target_host, self.target_port))
        tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        tsock.connect((self.target_host, self.target_port))

        if self.verbose and not self.daemon:
            print self.traffic_legend

        # Stat proxying
        try:
            self.do_proxy(client, tsock)
        except:
            if tsock: tsock.close()
            if self.rec:
                self.rec.write("'EOF']\n")
                self.rec.close()
            raise

    def do_proxy(self, client, target):
        """
        Proxy client WebSocket to normal target socket.
        """
        cqueue = []
        cpartial = ""
        tqueue = []
        rlist = [client, target]
        tstart = int(time.time()*1000)

        while True:
            wlist = []
            tdelta = int(time.time()*1000) - tstart

            if tqueue: wlist.append(target)
            if cqueue: wlist.append(client)
            ins, outs, excepts = select(rlist, wlist, [], 1)
            if excepts: raise Exception("Socket exception")

            if target in outs:
                # Send queued client data to the target
                dat = tqueue.pop(0)
                sent = target.send(dat)
                if sent == len(dat):
                    self.traffic(">")
                else:
                    # requeue the remaining data
                    tqueue.insert(0, dat[sent:])
                    self.traffic(".>")

            if client in outs:
                # Send queued target data to the client
                dat = cqueue.pop(0)
                sent = client.send(dat)
                if sent == len(dat):
                    self.traffic("<")
                    if self.rec:
                        self.rec.write("%s,\n" %
                                repr("{%s{" % tdelta + dat[1:-1]))
                else:
                    cqueue.insert(0, dat[sent:])
                    self.traffic("<.")


            if target in ins:
                # Receive target data, encode it and queue for client
                buf = target.recv(self.buffer_size)
                if len(buf) == 0: raise self.EClose("Target closed")

                cqueue.append(self.encode(buf))
                self.traffic("{")

            if client in ins:
                # Receive client data, decode it, and queue for target
                buf = client.recv(self.buffer_size)
                if len(buf) == 0: raise self.EClose("Client closed")

                if buf == '\xff\x00':
                    raise self.EClose("Client sent orderly close frame")
                elif buf[-1] == '\xff':
                    if buf.count('\xff') > 1:
                        self.traffic(str(buf.count('\xff')))
                    self.traffic("}")
                    if self.rec:
                        self.rec.write("%s,\n" %
                                (repr("}%s}" % tdelta + buf[1:-1])))
                    if cpartial:
                        # Prepend saved partial and decode frame(s)
                        tqueue.extend(self.decode(cpartial + buf))
                        cpartial = ""
                    else:
                        # decode frame(s)
                        tqueue.extend(self.decode(buf))
                else:
                    # Save off partial WebSockets frame
                    self.traffic(".}")
                    cpartial = cpartial + buf

if __name__ == '__main__':
    usage = "%prog [--record FILE]"
    usage += " [source_addr:]source_port target_addr:target_port"
    parser = optparse.OptionParser(usage=usage)
    parser.add_option("--verbose", "-v", action="store_true",
            help="verbose messages and per frame traffic")
    parser.add_option("--record",
            help="record sessions to FILE.[session_number]", metavar="FILE")
    parser.add_option("--foreground", "-f",
            dest="daemon", default=True, action="store_false",
            help="stay in foreground, do not daemonize")
    parser.add_option("--cert", default="self.pem",
            help="SSL certificate file")
    parser.add_option("--key", default=None,
            help="SSL key file (if separate from cert)")
    parser.add_option("--ssl-only", action="store_true",
            help="disallow non-encrypted connections")
    parser.add_option("--web", default=None, metavar="DIR",
            help="run webserver on same port. Serve files from DIR.")
    (opts, args) = parser.parse_args()

    # Sanity checks
    if len(args) > 2: parser.error("Too many arguments")
    if len(args) < 2: parser.error("Too few arguments")

    if opts.ssl_only and not os.path.exists(opts.cert):
        parser.error("SSL only and %s not found" % opts.cert)
    elif not os.path.exists(opts.cert):
        print "Warning: %s not found" % opts.cert

    # Parse host:port and convert ports to numbers
    if args[0].count(':') > 0:
        opts.listen_host, opts.listen_port = args[0].split(':')
    else:
        opts.listen_host, opts.listen_port = '', args[0]
    if args[1].count(':') > 0:
        opts.target_host, opts.target_port = args[1].split(':')
    else:
        parser.error("Error parsing target")
    try:    opts.listen_port = int(opts.listen_port)
    except: parser.error("Error parsing listen port")
    try:    opts.target_port = int(opts.target_port)
    except: parser.error("Error parsing target port")

    # Create and start the WebSockets proxy
    server = WebSocketProxy(**opts.__dict__)
    server.start_server()
