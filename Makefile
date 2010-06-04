wsproxy: wsproxy.o websocket.o
	$(CC) $^ -l ssl -l resolv -o $@

#websocket.o: websocket.c
#	$(CC) -c $^ -o $@
#
#wsproxy.o: wsproxy.c
#	$(CC) -c $^ -o $@

clean:
	rm -f wsproxy wsproxy.o websocket.o

