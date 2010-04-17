#!/usr/bin/python

import sys, os, socket, time, traceback
from base64 import b64encode, b64decode
from select import select

buffer_size = 65536
send_seq = 0

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: ws://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>"""

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


def handshake(client):
    handshake = client.recv(1024)
    print "Handshake [%s]" % handshake
    if handshake.startswith("<policy-file-request/>"):
        print "Sending:", policy_response
        client.send(policy_response)
        handshake = client.recv(1024)
        print "Handshake [%s]" % handshake
    req_lines = handshake.split("\r\n")
    _, path, _ = req_lines[0].split(" ")
    _, origin = req_lines[4].split(" ")
    _, host = req_lines[3].split(" ")
    client.send(server_handshake % (origin, host, path))

def traffic(token="."):
    sys.stdout.write(token)
    sys.stdout.flush()

def decode(buf):
    """ Parse out WebSocket packets. """
    if buf.count('\xff') > 1:
        traffic(str(buf.count('\xff')))
        return [b64decode(d[1:]) for d in buf.split('\xff')]
    else:
        return [b64decode(buf[1:-1])]

def proxy(client, target):
    """ Proxy WebSocket to normal socket. """
    global send_seq
    cqueue = []
    cpartial = ""
    tqueue = []
    socks = [client, target]

    while True:
        ins, outs, excepts = select(socks, socks, socks, 1)
        if excepts: raise Exception("Socket exception")

        if tqueue and target in outs:
            #print "Target send: %s" % repr(tqueue[0])
            log.write("Target send: %s\n" % map(ord, tqueue[0]))
            dat = tqueue.pop(0)
            sent = target.send(dat)
            if sent == len(dat):
                traffic(">")
            else:
                tqueue.insert(0, dat[sent:])
                traffic(">.")

        if cqueue and client in outs:
            dat = cqueue.pop(0)
            sent = client.send(dat)
            if sent == len(dat):
                traffic("<")
                log.write("Client send: %s\n" % repr(dat))
            else:
                cqueue.insert(0, dat[sent:])
                traffic("<.")
                log.write("Client send partial: %s\n" % repr(dat[0:send]))


        if target in ins:
            buf = target.recv(buffer_size)
            if len(buf) == 0: raise Exception("Target closed")

            #enc = b64encode(buf)
            #chksum = sum([ord(c) for c in enc])
            #cqueue.append("\x00^" + str(chksum) + "@" + enc + "$\xff")

            cqueue.append("\x00%d:%s\xff" % (send_seq, b64encode(buf)))
            send_seq += 1

            log.write("Target recv (%d): %s\n" % (len(buf), map(ord, buf)))
            traffic("{")

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")

            if buf[-1] == "\xff":
                traffic("}")
                log.write("Client recv (%d): %s\n" % (len(buf), repr(buf)))
                if cpartial:
                    tqueue.extend(decode(cpartial + buf))
                    cpartial = ""
                else:
                    tqueue.extend(decode(buf))
            else:
                traffic("}.")
                log.write("Client recv partial (%d): %s\n" % (len(buf), repr(buf)))
                cpartial = cpartial + buf


def start_server(listen_port, target_host, target_port):
    global send_seq
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(('', listen_port))
    lsock.listen(100)
    print traffic_legend
    while True:
        try:
            csock = tsock = None
            print 'waiting for connection on port %s' % listen_port
            csock, address = lsock.accept()
            print 'Got client connection from %s' % address[0]
            handshake(csock)
            print "Connecting to: %s:%s" % (target_host, target_port)
            tsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            tsock.connect((target_host, target_port))

            send_seq = 0
            proxy(csock, tsock)

        except Exception:
            print "Ignoring exception:"
            print traceback.format_exc()
            if csock: csock.close()
            if tsock: tsock.close()

if __name__ == '__main__':
    log = open("ws.log", 'w')
    try:
        if len(sys.argv) != 4: raise
        listen_port = int(sys.argv[1])
        target_host = sys.argv[2]
        target_port = int(sys.argv[3])
    except:
        print "Usage: <listen_port> <target_host> <target_port>"
        sys.exit(1)
    start_server(listen_port, target_host, target_port)
