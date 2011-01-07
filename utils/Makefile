TARGETS=wsproxy wswrapper.so 
CFLAGS += -fPIC

all: $(TARGETS)

wsproxy: wsproxy.o websocket.o md5.o
	$(CC) $(LDFLAGS) $^ -lssl -lcrypto -lresolv -o $@

wswrapper.o: wswrapper.h
wswrapper.so: wswrapper.o md5.o
	$(CC) $(LDFLAGS) $^ -shared -fPIC -ldl -lresolv -o $@

websocket.o: websocket.c websocket.h md5.h
wsproxy.o: wsproxy.c websocket.h
wswrapper.o: wswrapper.c
	$(CC) -c $(CFLAGS) -o $@ $*.c
md5.o: md5.c md5.h
	$(CC) -c $(CFLAGS) -o $@ $*.c -DHAVE_MEMCPY -DSTDC_HEADERS

clean:
	rm -f wsproxy wswrapper.so *.o

