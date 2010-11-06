wsproxy: wsproxy.o websocket.o md5.o
	$(CC) $(LDFLAGS) $^ -l ssl -lcrypto -l resolv -o $@

websocket.o: websocket.c websocket.h md5.h
wsproxy.o: wsproxy.c websocket.h
md5.o: md5.c md5.h
	$(CC) $(CFLAGS) -c -o $@ $*.c -DHAVE_MEMCPY -DSTDC_HEADERS

clean:
	rm -f wsproxy wsproxy.o websocket.o md5.o

