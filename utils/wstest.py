#!/usr/bin/python

'''
WebSocket server-side load test program. Sends and receives traffic
that has a random payload (length and content) that is checksummed and
given a sequence number. Any errors are reported and counted.
'''

import sys, os, socket, ssl, time, traceback
import random, time
from select import select

sys.path.insert(0,os.path.dirname(__file__) + "/../utils/")
from websocket import WebSocketServer


class WebSocketTest(WebSocketServer):

    buffer_size = 65536
    max_packet_size = 10000
    recv_cnt = 0
    send_cnt = 0

    def __init__(self, *args, **kwargs):
        self.errors = 0
        self.delay = kwargs.pop('delay')

        print "Prepopulating random array"
        self.rand_array = []
        for i in range(0, self.max_packet_size):
            self.rand_array.append(random.randint(0, 9))

        WebSocketServer.__init__(self, *args, **kwargs)

    def handler(self, client):
        self.send_cnt = 0
        self.recv_cnt = 0

        try:
            self.responder(client)
        except:
            print "accumulated errors:", self.errors
            self.errors = 0
            raise

    def responder(self, client):
        cqueue = []
        cpartial = ""
        socks = [client]
        last_send = time.time() * 1000

        while True:
            ins, outs, excepts = select(socks, socks, socks, 1)
            if excepts: raise Exception("Socket exception")

            if client in ins:
                buf = client.recv(self.buffer_size)
                if len(buf) == 0:
                    raise self.EClose("Client closed")
                #print "Client recv: %s (%d)" % (repr(buf[1:-1]), len(buf))
                if buf[-1] == '\xff':
                    if cpartial:
                        err = self.check(cpartial + buf)
                        cpartial = ""
                    else:
                        err = self.check(buf)
                    if err:
                        self.traffic("}")
                        self.errors = self.errors + 1
                        print err
                    else:
                        self.traffic(">")
                else:
                    self.traffic(".>")
                    cpartial = cpartial + buf

            now = time.time() * 1000
            if client in outs and now > (last_send + self.delay):
                last_send = now
                #print "Client send: %s" % repr(cqueue[0])
                client.send(self.generate())
                self.traffic("<")

    def generate(self):
        length = random.randint(10, self.max_packet_size)
        numlist = self.rand_array[self.max_packet_size-length:]
        # Error in length
        #numlist.append(5)
        chksum = sum(numlist)
        # Error in checksum
        #numlist[0] = 5
        nums = "".join( [str(n) for n in numlist] )
        data = "^%d:%d:%d:%s$" % (self.send_cnt, length, chksum, nums)
        self.send_cnt += 1

        return WebSocketServer.encode(data)


    def check(self, buf):
        try:
            data_list = WebSocketServer.decode(buf)
        except:
            print "\n<BOF>" + repr(buf) + "<EOF>"
            return "Failed to decode"

        err = ""
        for data in data_list:
            if data.count('$') > 1:
                raise Exception("Multiple parts within single packet")
            if len(data) == 0:
                self.traffic("_")
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

            if self.recv_cnt != cnt:
                err += "Expected count %d but got %d\n" % (self.recv_cnt, cnt)
                self.recv_cnt = cnt + 1
                continue

            self.recv_cnt += 1

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


if __name__ == '__main__':
    try:
        if len(sys.argv) < 2: raise
        listen_port = int(sys.argv[1])
        if len(sys.argv) == 3:
            delay = int(sys.argv[2])
        else:
            delay = 10
    except:
        print "Usage: %s <listen_port> [delay_ms]" % sys.argv[0]
        sys.exit(1)

    server = WebSocketTest(
            listen_port=listen_port,
            verbose=True,
            cert='self.pem',
            web='.',
            delay=delay)
    server.start_server()
