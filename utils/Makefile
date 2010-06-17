wsproxy: wsproxy.o websocket.o
	$(CC) $^ -l ssl -l resolv -o $@

websocket.o wsproxy.o: websocket.h

clean:
	rm -f wsproxy wsproxy.o websocket.o

