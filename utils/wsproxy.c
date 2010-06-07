/*
 * A WebSocket to TCP socket proxy with support for "wss://" encryption.
 *
 * You can make a cert/key with openssl using:
 * openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
 * as taken from http://docs.python.org/dev/library/ssl.html#certificates
 */
#include <stdio.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>
#include <sys/select.h>
#include <fcntl.h>
#include <sys/stat.h>
#include "websocket.h"

char traffic_legend[] = "\n\
Traffic Legend:\n\
    }  - Client receive\n\
    }. - Client receive partial\n\
    {  - Target receive\n\
\n\
    >  - Target send\n\
    >. - Target send partial\n\
    <  - Client send\n\
    <. - Client send partial\n\
";

void usage() {
    fprintf(stderr,"Usage: <listen_port> <target_host> <target_port>\n");
    exit(1);
}

char *target_host;
int target_port;
char *record_filename = NULL;
int recordfd = 0;

extern char *tbuf, *cbuf, *tbuf_tmp, *cbuf_tmp;
extern unsigned int bufsize, dbufsize;

void do_proxy(ws_ctx_t *ws_ctx, int target) {
    fd_set rlist, wlist, elist;
    struct timeval tv;
    int i, maxfd, client = ws_ctx->sockfd;
    unsigned int tstart, tend, cstart, cend, ret;
    ssize_t len, bytes;

    tstart = tend = cstart = cend = 0;
    maxfd = client > target ? client+1 : target+1;

    while (1) {
        tv.tv_sec = 1;
        tv.tv_usec = 0;

        FD_ZERO(&rlist);
        FD_ZERO(&wlist);
        FD_ZERO(&elist);

        FD_SET(client, &elist);
        FD_SET(target, &elist);

        if (tend == tstart) {
            // Nothing queued for target, so read from client
            FD_SET(client, &rlist);
        } else {
            // Data queued for target, so write to it
            FD_SET(target, &wlist);
        }
        if (cend == cstart) {
            // Nothing queued for client, so read from target
            FD_SET(target, &rlist);
        } else {
            // Data queued for client, so write to it
            FD_SET(client, &wlist);
        }

        ret = select(maxfd, &rlist, &wlist, &elist, &tv);

        if (FD_ISSET(target, &elist)) {
            fprintf(stderr, "target exception\n");
            break;
        }
        if (FD_ISSET(client, &elist)) {
            fprintf(stderr, "client exception\n");
            break;
        }

        if (ret == -1) {
            error("select()");
            break;
        } else if (ret == 0) {
            //fprintf(stderr, "select timeout\n");
            continue;
        }

        if (FD_ISSET(target, &wlist)) {
            len = tend-tstart;
            bytes = send(target, tbuf + tstart, len, 0);
            if (bytes < 0) {
                error("target connection error");
                break;
            }
            tstart += bytes;
            if (tstart >= tend) {
                tstart = tend = 0;
                traffic(">");
            } else {
                traffic(">.");
            }
        }

        if (FD_ISSET(client, &wlist)) {
            len = cend-cstart;
            bytes = ws_send(ws_ctx, cbuf + cstart, len);
            if (len < 3) {
                fprintf(stderr, "len: %d, bytes: %d: %d\n", len, bytes, *(cbuf + cstart));
            }
            cstart += bytes;
            if (cstart >= cend) {
                cstart = cend = 0;
                traffic("<");
                if (recordfd) {
                    write(recordfd, "'>", 2);
                    write(recordfd, cbuf + cstart + 1, bytes - 2);
                    write(recordfd, "',\n", 3);
                }
            } else {
                traffic("<.");
            }
        }

        if (FD_ISSET(target, &rlist)) {
            bytes = recv(target, cbuf_tmp, dbufsize , 0);
            if (bytes <= 0) {
                fprintf(stderr, "target closed connection");
                break;
            }
            cstart = 0;
            cend = encode(cbuf_tmp, bytes, cbuf, bufsize);
            /*
            printf("encoded: ");
            for (i=0; i< cend; i++) {
                printf("%u,", (unsigned char) *(cbuf+i));
            }
            printf("\n");
            */
            if (cend < 0) {
                fprintf(stderr, "encoding error\n");
                break;
            }
            traffic("{");
        }

        if (FD_ISSET(client, &rlist)) {
            bytes = ws_recv(ws_ctx, tbuf_tmp, bufsize-1);
            if (bytes <= 0) {
                fprintf(stderr, "client closed connection\n");
                break;
            }
            if (recordfd) {
                write(recordfd, "'", 1);
                write(recordfd, tbuf_tmp + 1, bytes - 2);
                write(recordfd, "',\n", 3);
            }
            /*
            printf("before decode: ");
            for (i=0; i< bytes; i++) {
                printf("%u,", (unsigned char) *(tbuf_tmp+i));
            }
            printf("\n");
            */
            len = decode(tbuf_tmp, bytes, tbuf, bufsize-1);
            /*
            printf("decoded: ");
            for (i=0; i< len; i++) {
                printf("%u,", (unsigned char) *(tbuf+i));
            }
            printf("\n");
            */
            if (len < 0) {
                fprintf(stderr, "decoding error\n");
                break;
            }
            traffic("}");
            tstart = 0;
            tend = len;
        }
    }
}

void proxy_handler(ws_ctx_t *ws_ctx) {
    int tsock = 0;
    struct sockaddr_in taddr;
    struct hostent *thost;

    printf("Connecting to: %s:%d\n", target_host, target_port);

    tsock = socket(AF_INET, SOCK_STREAM, 0);
    if (tsock < 0) {
        error("Could not create target socket");
        return;
    }
    thost = gethostbyname(target_host);
    if (thost == NULL) {
        error("Could not resolve server");
        close(tsock);
        return;
    }
    bzero((char *) &taddr, sizeof(taddr));
    taddr.sin_family = AF_INET;
    bcopy((char *) thost->h_addr,
          (char *) &taddr.sin_addr.s_addr,
          thost->h_length);
    taddr.sin_port = htons(target_port);

    if (connect(tsock, (struct sockaddr *) &taddr, sizeof(taddr)) < 0) {
        error("Could not connect to target");
        close(tsock);
        return;
    }

    if (record_filename) {
        recordfd = open(record_filename, O_WRONLY | O_CREAT | O_TRUNC,
                        S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH);
    }

    printf("%s", traffic_legend);

    do_proxy(ws_ctx, tsock);

    close(tsock);
    if (recordfd) {
        close(recordfd);
        recordfd = 0;
    }
}

int main(int argc, char *argv[])
{
    int listen_port, idx=1;

    if (strcmp(argv[idx], "--record") == 0) {
        idx++;
        record_filename = argv[idx++];
    }

    if ((argc-idx) != 3) { usage(); }
    listen_port = strtol(argv[idx++], NULL, 10);
    if (errno != 0) { usage(); }
    target_host = argv[idx++];
    target_port = strtol(argv[idx++], NULL, 10);
    if (errno != 0) { usage(); }

    /* Initialize buffers */
    bufsize = 65536;
    if (! (tbuf = malloc(bufsize)) )
            { fatal("malloc()"); }
    if (! (cbuf = malloc(bufsize)) )
            { fatal("malloc()"); }
    if (! (tbuf_tmp = malloc(bufsize)) )
            { fatal("malloc()"); }
    if (! (cbuf_tmp = malloc(bufsize)) )
            { fatal("malloc()"); }

    start_server(listen_port, &proxy_handler);

    free(tbuf);
    free(cbuf);
    free(tbuf_tmp);
    free(cbuf_tmp);
}
