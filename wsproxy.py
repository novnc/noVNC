#!/usr/bin/python

'''
A WebSocket to TCP socket proxy with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, socket, ssl
from select import select
from websocket import *

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

def do_proxy(client, target):
    """ Proxy WebSocket to normal socket. """
    cqueue = []
    cpartial = ""
    tqueue = []
    rlist = [client, target]

    while True:
        wlist = []
        if tqueue: wlist.append(target)
        if cqueue: wlist.append(client)
        ins, outs, excepts = select(rlist, wlist, [], 1)
        if excepts: raise Exception("Socket exception")

        if target in outs:
            dat = tqueue.pop(0)
            sent = target.send(dat)
            if sent == len(dat):
                traffic(">")
            else:
                tqueue.insert(0, dat[sent:])
                traffic(".>")
            ##log.write("Target send: %s\n" % map(ord, dat))

        if client in outs:
            dat = cqueue.pop(0)
            sent = client.send(dat)
            if sent == len(dat):
                traffic("<")
                ##log.write("Client send: %s ...\n" % repr(dat[0:80]))
            else:
                cqueue.insert(0, dat[sent:])
                traffic("<.")
                ##log.write("Client send partial: %s\n" % repr(dat[0:send]))


        if target in ins:
            buf = target.recv(buffer_size)
            if len(buf) == 0: raise Exception("Target closed")

            cqueue.append(encode(buf))
            traffic("{")
            ##log.write("Target recv (%d): %s\n" % (len(buf), map(ord, buf)))

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")

            if buf[-1] == '\xff':
                if buf.count('\xff') > 1:
                    traffic(str(buf.count('\xff')))
                traffic("}")
                ##log.write("Client recv (%d): %s\n" % (len(buf), repr(buf)))
                if cpartial:
                    tqueue.extend(decode(cpartial + buf))
                    cpartial = ""
                else:
                    tqueue.extend(decode(buf))
            else:
                traffic(".}")
                ##log.write("Client recv partial (%d): %s\n" % (len(buf), repr(buf)))
                cpartial = cpartial + buf

def proxy_handler(client):
    global target_host, target_port

    print "Connecting to: %s:%s" % (target_host, target_port)
    tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tsock.connect((target_host, target_port))

    print traffic_legend

    try:
        do_proxy(client, tsock)
    except:
        if tsock: tsock.close()
        raise

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
    start_server(listen_port, proxy_handler)
