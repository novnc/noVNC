#!/usr/bin/python

import sys, os, socket, time, traceback, random, time
from base64 import b64encode, b64decode
from select import select

buffer_size = 65536

server_handshake = """HTTP/1.1 101 Web Socket Protocol Handshake\r
Upgrade: WebSocket\r
Connection: Upgrade\r
WebSocket-Origin: %s\r
WebSocket-Location: ws://%s%s\r
WebSocket-Protocol: sample\r
\r
"""

policy_response = """<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>"""

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

def check(buf):

    try:
        data = b64decode(buf[1:-1])
    except:
        print "\n<BOF>" + repr(buf) + "<EOF>"
        return "Failed to decode"

    chunks = data.count('$')
    if chunks > 1:
        traffic(str(chunks))

    for chunk in data.split("$"):
        if not chunk: continue

        if chunk[0] != "^":
            return "buf did not start with '^'"

        try:
            length, chksum, nums = chunk[1:].split(':')
            length = int(length)
            chksum = int(chksum)
        except:
            print "\n<BOF>" + repr(data) + "<EOF>"
            return "Invalid data format"

        if len(nums) != length:
            return "Real length %d is not %d" % (len(nums), length)

        inv = nums.translate(None, "0123456789")
        if inv:
            return "Invalid characters found: %s" % inv

        real_chksum = 0
        for num in nums:
            real_chksum += int(num)

        if real_chksum != chksum:
            return "Real checksum %d is not %d" % (real_chksum, chksum)


def generate():
    length = random.randint(10, 10000)
    numlist = rand_array[10000-length:]
    # Error in length
    #numlist.append(5)
    chksum = sum(numlist)
    # Error in checksum
    #numlist[0] = 5
    nums = "".join( [str(n) for n in numlist] )
    data = "^%d:%d:%s$" % (length, chksum, nums)

    buf = "\x00" + b64encode(data) + "\xff"
    return buf

def responder(client, delay=500):
    global errors
    cqueue = []
    cpartial = ""
    socks = [client]
    last_send = time.time() * 1000

    while True:
        ins, outs, excepts = select(socks, socks, socks, 1)
        if excepts: raise Exception("Socket exception")

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")
            #print "Client recv: %s (%d)" % (repr(buf[1:-1]), len(buf))
            if buf[-1] == '\xff':
                if cpartial:
                    err = check(cpartial + buf)
                    cpartial = ""
                else:
                    err = check(buf)
                if err:
                    traffic("}")
                    errors = errors + 1
                    print err
                else:
                    traffic(">")
            else:
                traffic(".>")
                cpartial = cpartial + buf

        now = time.time() * 1000
        if client in outs and now > (last_send + delay):
            last_send = now
            #print "Client send: %s" % repr(cqueue[0])
            client.send(generate())
            traffic("<")

def start_server(listen_port, delay=500):
    global errors
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(('', listen_port))
    lsock.listen(100)
    while True:
        try:
            csock = None
            print 'listening on port %s' % listen_port
            csock, address = lsock.accept()
            print 'Got client connection from %s' % address[0]
            handshake(csock)

            responder(csock, delay=delay)

        except Exception:
            print "accumulated errors:", errors
            errors = 0
            print "Ignoring exception:"
            print traceback.format_exc()
            if csock: csock.close()

if __name__ == '__main__':
    errors = 0
    try:
        if len(sys.argv) < 2: raise
        listen_port = int(sys.argv[1])
        if len(sys.argv) == 3:
            delay = int(sys.argv[2])
        else:
            delay = 500
    except:
        print "Usage: <listen_port> [delay_ms]"
        sys.exit(1)

    print "Prepopulating random array"
    rand_array = []
    for i in range(0, 10000):
        rand_array.append(random.randint(0, 9))

    start_server(listen_port, delay=delay)
