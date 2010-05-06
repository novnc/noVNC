#!/usr/bin/python

'''
WebSocket server-side load test program. Sends and receives traffic
that has a random payload (length and content) that is checksummed and
given a sequence number. Any errors are reported and counted.
'''

import sys, socket, ssl, time, traceback
import random, time
from base64 import b64encode, b64decode
from select import select
from websocket import *

buffer_size = 65536
recv_cnt = send_cnt = 0


def check(buf):
    global recv_cnt

    try:
        data_list = decode(buf)
    except:
        print "\n<BOF>" + repr(buf) + "<EOF>"
        return "Failed to decode"

    err = ""
    for data in data_list:
        if data.count('$') > 1:
            raise Exception("Multiple parts within single packet")
        if len(data) == 0:
            traffic("_")
            continue

        if data[0] != "^":
            err += "buf did not start with '^'\n"
            continue

        try:
            cnt, length, chksum, nums = data[1:-1].split(':')
            cnt    = int(cnt)
            length = int(length)
            chksum = int(chksum)
        except:
            print "\n<BOF>" + repr(data) + "<EOF>"
            err += "Invalid data format\n"
            continue

        if recv_cnt != cnt:
            err += "Expected count %d but got %d\n" % (recv_cnt, cnt)
            recv_cnt = cnt + 1
            continue

        recv_cnt += 1

        if len(nums) != length:
            err += "Expected length %d but got %d\n" % (length, len(nums))
            continue

        inv = nums.translate(None, "0123456789")
        if inv:
            err += "Invalid characters found: %s\n" % inv
            continue

        real_chksum = 0
        for num in nums:
            real_chksum += int(num)

        if real_chksum != chksum:
            err += "Expected checksum %d but real chksum is %d\n" % (chksum, real_chksum)
    return err


def generate():
    global send_cnt, rand_array
    length = random.randint(10, 100000)
    numlist = rand_array[100000-length:]
    # Error in length
    #numlist.append(5)
    chksum = sum(numlist)
    # Error in checksum
    #numlist[0] = 5
    nums = "".join( [str(n) for n in numlist] )
    data = "^%d:%d:%d:%s$" % (send_cnt, length, chksum, nums)
    send_cnt += 1

    buf = "\x00" + b64encode(data) + "\xff"
    return buf

def responder(client, delay=10):
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

def test_handler(client):
    global errors, delay, send_cnt, recv_cnt

    send_cnt = 0
    recv_cnt = 0

    try:
        responder(client, delay)
    except:
        print "accumulated errors:", errors
        errors = 0
        raise


if __name__ == '__main__':
    errors = 0
    try:
        if len(sys.argv) < 2: raise
        listen_port = int(sys.argv[1])
        if len(sys.argv) == 3:
            delay = int(sys.argv[2])
        else:
            delay = 10
    except:
        print "Usage: <listen_port> [delay_ms]"
        sys.exit(1)

    print "Prepopulating random array"
    rand_array = []
    for i in range(0, 100000):
        rand_array.append(random.randint(0, 9))

    start_server(listen_port, test_handler)
