#!/usr/bin/python

'''
WebSocket server-side load test program. Sends and receives traffic
that has a random payload (length and content) that is checksummed and
given a sequence number. Any errors are reported and counted.
'''

import sys, os, socket, ssl, time, traceback
import random, time
from base64 import b64encode, b64decode
from codecs import utf_8_encode, utf_8_decode
from select import select

sys.path.insert(0,os.path.dirname(__file__) + "/../utils/")
from websocket import *

buffer_size = 65536
recv_cnt = send_cnt = 0


def check(buf):

    if buf[0] != '\x00' or buf[-1] != '\xff':
        raise Exception("Invalid WS packet")

    for decoded in decode(buf):
        nums = [ord(c) for c in decoded]
        print "Received nums: ", nums

    return


def responder(client):
    cpartial = ""
    socks = [client]
    sent = False
    received = False

    while True:
        ins, outs, excepts = select(socks, socks, socks, 1)
        if excepts: raise Exception("Socket exception")

        if client in ins:
            buf = client.recv(buffer_size)
            if len(buf) == 0: raise Exception("Client closed")
            received = True
            #print "Client recv: %s (%d)" % (repr(buf[1:-1]), len(buf))
            if buf[-1] == '\xff':
                if cpartial:
                    err = check(cpartial + buf)
                    cpartial = ""
                else:
                    err = check(buf)
                if err:
                    print err
            else:
                print "received partitial"
                cpartial = cpartial + buf

        if received and not sent and client in outs:
            sent = True
            #nums = "".join([unichr(c) for c in range(0,256)])
            #nums = "".join([chr(c) for c in range(1,128)])
            #nums = nums + chr(194) + chr(128) + chr(194) + chr(129)
            #nums = "".join([chr(c) for c in range(0,256)])
            nums = "\x81\xff"
            nums = nums + "".join([chr(c) for c in range(0,256,4)])
            nums = nums + "\x00\x40\x41\xff\x81"
#            print nums
            client.send(encode(nums))
#            client.send("\x00" + nums + "\xff")
#            print "Sent characters 0-255"
#            #print "Client send: %s (%d)" % (repr(nums), len(nums))

if __name__ == '__main__':
    try:
        if len(sys.argv) < 2: raise
        listen_port = int(sys.argv[1])
    except:
        print "Usage: <listen_port>"
        sys.exit(1)

    settings['listen_port'] = listen_port
    settings['daemon'] = False
    settings['handler'] = responder
    start_server()
