#!/usr/bin/python

'''
A WebSocket to TCP socket proxy with support for "wss://" encryption.
Copyright 2010 Joel Martin
Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

You can make a cert/key with openssl using:
openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
as taken from http://docs.python.org/dev/library/ssl.html#certificates

'''

import socket, optparse, time
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
    tstart = int(time.time()*1000)

    while True:
        wlist = []
        tdelta = int(time.time()*1000) - tstart
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
                if rec: rec.write("%s,\n" % repr("{%s{" % tdelta + dat[1:-1]))
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

            if buf == '\xff\x00':
                raise Exception("Client sent orderly close frame")
            elif buf[-1] == '\xff':
                if buf.count('\xff') > 1:
                    traffic(str(buf.count('\xff')))
                traffic("}")
                ##if rec: rec.write("Client recv (%d): %s\n" % (len(buf), repr(buf)))
                if rec: rec.write("%s,\n" % (repr("}%s}" % tdelta + buf[1:-1])))
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

    if settings['record']:
        print "Opening record file: %s" % settings['record']
        rec = open(settings['record'], 'a')

    print "Connecting to: %s:%s" % (target_host, target_port)
    tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tsock.connect((target_host, target_port))

    print traffic_legend

    try:
        do_proxy(client, tsock)
    except:
        if tsock: tsock.close()
        if rec: rec.close()
        raise

if __name__ == '__main__':
    usage = "%prog [--record FILE]"
    usage += " [source_addr:]source_port target_addr:target_port"
    parser = optparse.OptionParser(usage=usage)
    parser.add_option("--record",
            help="record session to a file", metavar="FILE")
    parser.add_option("--foreground", "-f",
            dest="daemon", default=True, action="store_false",
            help="stay in foreground, do not daemonize")
    parser.add_option("--ssl-only", action="store_true",
            help="disallow non-encrypted connections")
    parser.add_option("--cert", default="self.pem",
            help="SSL certificate")
    (options, args) = parser.parse_args()

    if len(args) > 2: parser.error("Too many arguments")
    if len(args) < 2: parser.error("Too few arguments")
    if args[0].count(':') > 0:
        host,port = args[0].split(':')
    else:
        host,port = '',args[0]
    if args[1].count(':') > 0:
        target_host,target_port = args[1].split(':')
    else:
        parser.error("Error parsing target")
    try:    port = int(port)
    except: parser.error("Error parsing listen port")
    try:    target_port = int(target_port)
    except: parser.error("Error parsing target port")

    if options.ssl_only and not os.path.exists(options.cert):
        parser.error("SSL only and %s not found" % options.cert)

    settings['listen_host'] = host
    settings['listen_port'] = port
    settings['handler'] = proxy_handler
    settings['cert'] = os.path.abspath(options.cert)
    settings['ssl_only'] = options.ssl_only
    settings['daemon'] = options.daemon
    if options.record:
        settings['record'] = os.path.abspath(options.record)
    start_server()
