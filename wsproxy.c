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
#include <resolv.h>
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
client_settings_t client_settings;
char *record_filename = NULL;
int recordfd = 0;
char *tbuf, *cbuf, *tbuf_tmp, *cbuf_tmp;
unsigned int bufsize, dbufsize;

void do_proxy(ws_ctx_t *ws_ctx, int target) {
    fd_set rlist, wlist, elist;
    struct timeval tv;
    int maxfd, client = ws_ctx->sockfd;
    unsigned int tstart, tend, cstart, cend, ret;
    ssize_t len, bytes;

    tstart = tend = cstart = cend = 0;
    maxfd = client > target ? client+1 : target+1;
    // Account for base64 encoding and WebSocket delims:
    //     49150 = 65536 * 3/4 + 2 - 1

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
                error("target closed connection");
                break;
            }
            cbuf[0] = '\x00';
            cstart = 0;
            len = b64_ntop(cbuf_tmp, bytes, cbuf+1, bufsize-1);
            if (len < 0) {
                fprintf(stderr, "base64 encoding error\n");
                break;
            }
            cbuf[len+1] = '\xff';
            cend = len+1+1;
            traffic("{");
        }

        if (FD_ISSET(client, &rlist)) {
            bytes = ws_recv(ws_ctx, tbuf_tmp, bufsize-1);
            if (bytes <= 0) {
                fprintf(stderr, "client closed connection\n");
                break;
            }
            if (tbuf_tmp[bytes-1] != '\xff') {
                //traffic(".}");
                fprintf(stderr, "Malformed packet\n");
                break;
            }
            if (recordfd) {
                write(recordfd, "'", 1);
                write(recordfd, tbuf_tmp + 1, bytes - 2);
                write(recordfd, "',\n", 3);
            }
            tbuf_tmp[bytes-1] = '\0';
            len = b64_pton(tbuf_tmp+1, tbuf, bufsize-1);
            if (len < 0) {
                fprintf(stderr, "base64 decoding error\n");
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

    if (client_settings.b64encode) {
        dbufsize = (bufsize * 3)/4 + 2 - 10; // padding and for good measure
    } else {
    }

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

    start_server(listen_port, &proxy_handler, &client_settings);

    free(tbuf);
    free(cbuf);
    free(tbuf_tmp);
    free(cbuf_tmp);
}
