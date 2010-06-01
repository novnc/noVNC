#!/usr/bin/python

'''
A WebSocket to TCP socket proxy with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import sys, socket, ssl, optparse
from select import select
from websocket import *

buffer_size = 65536
rec = None

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
    global rec
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
            ##if rec: rec.write("Target send: %s\n" % map(ord, dat))

        if client in outs:
            dat = cqueue.pop(0)
            sent = client.send(dat)
            if sent == len(dat):
                traffic("<")
                ##if rec: rec.write("Client send: %s ...\n" % repr(dat[0:80]))
                if rec: rec.write("%s,\n" % repr(">" + dat[1:-1]))
            else:
                cqueue.insert(0, dat[sent:])
                traffic("<.")
                ##if rec: rec.write("Client send partial: %s\n" % repr(dat[0:send]))


        if target in ins:
            buf = target.recv(buffer_size)
            if len(buf) == 0: raise Exception("Target closed")

            cqueue.append(encode(buf))
            traffic("{")
            ##if rec: rec.write("Target recv (%d): %s\n" % (len(buf), map(ord, buf)))

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")

            if buf[-1] == '\xff':
                if buf.count('\xff') > 1:
                    traffic(str(buf.count('\xff')))
                traffic("}")
                ##if rec: rec.write("Client recv (%d): %s\n" % (len(buf), repr(buf)))
                if rec: rec.write("%s,\n" % repr(buf[1:-1]))
                if cpartial:
                    tqueue.extend(decode(cpartial + buf))
                    cpartial = ""
                else:
                    tqueue.extend(decode(buf))
            else:
                traffic(".}")
                ##if rec: rec.write("Client recv partial (%d): %s\n" % (len(buf), repr(buf)))
                cpartial = cpartial + buf

def proxy_handler(client):
    global target_host, target_port, options, rec

    print "Connecting to: %s:%s" % (target_host, target_port)
    tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tsock.connect((target_host, target_port))

    if options.record:
        print "Opening record file: %s" % options.record
        rec = open(options.record, 'w')

    print traffic_legend

    try:
        do_proxy(client, tsock)
    except:
        if tsock: tsock.close()
        if rec: rec.close()
        raise

if __name__ == '__main__':
    parser = optparse.OptionParser()
    parser.add_option("--record", dest="record",
            help="record session to a file", metavar="FILE")
    (options, args) = parser.parse_args()

    if len(args) > 3: parser.error("Too many arguments")
    if len(args) < 3: parser.error("Too few arguments")
    try:    listen_port = int(args[0])
    except: parser.error("Error parsing listen port")
    try:    target_host = args[1]
    except: parser.error("Error parsing target host")
    try:    target_port = int(args[2])
    except: parser.error("Error parsing target port")

    start_server(listen_port, proxy_handler)
