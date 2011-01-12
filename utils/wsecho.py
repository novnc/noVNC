#!/usr/bin/python

'''
A WebSocket server that echos back whatever it receives from the client.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, socket, select
from websocket import WebSocketServer

class WebSocketEcho(WebSocketServer):
    """
    WebSockets server that echo back whatever is received from the
    client. All traffic to/from the client is base64
    encoded/decoded.
    """
    buffer_size = 8096

    def new_client(self, client):
        """
        Echo back whatever is received.
        """

        cqueue = []
        cpartial = ""
        rlist = [client]

        while True:
            wlist = []

            if cqueue: wlist.append(client)
            ins, outs, excepts = select.select(rlist, wlist, [], 1)
            if excepts: raise Exception("Socket exception")

            if client in outs:
                # Send queued target data to the client
                dat = cqueue.pop(0)
                sent = client.send(dat)
                self.vmsg("Sent %s/%s bytes of frame: '%s'" % (
                          sent, len(dat), self.decode(dat)[0]))
                if sent != len(dat):
                    # requeue the remaining data
                    cqueue.insert(0, dat[sent:])


            if client in ins:
                # Receive client data, decode it, and send it back
                buf = client.recv(self.buffer_size)
                if len(buf) == 0: raise self.EClose("Client closed")

                if buf == '\xff\x00':
                    raise self.EClose("Client sent orderly close frame")
                elif buf[-1] == '\xff':
                    if cpartial:
                        # Prepend saved partial and decode frame(s)
                        frames = self.decode(cpartial + buf)
                        cpartial = ""
                    else:
                        # decode frame(s)
                        frames = self.decode(buf)

                    for frame in frames:
                        self.vmsg("Received frame: %s" % repr(frame))
                        cqueue.append(self.encode(frame))
                else:
                    # Save off partial WebSockets frame
                    self.vmsg("Received partial frame")
                    cpartial = cpartial + buf

if __name__ == '__main__':
    try:
        if len(sys.argv) < 1: raise
        listen_port = int(sys.argv[1])
    except:
        print "Usage: %s <listen_port>" % sys.argv[0]
        sys.exit(1)

    server = WebSocketEcho(
            listen_port=listen_port,
            verbose=True,
            cert='self.pem',
            web='.')
    server.start_server()

