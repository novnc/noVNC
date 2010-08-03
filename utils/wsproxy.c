/*
 * A WebSocket to TCP socket proxy with support for "wss://" encryption.
 * Copyright 2010 Joel Martin
 * Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)
 *
 * You can make a cert/key with openssl using:
 * openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
 * as taken from http://docs.python.org/dev/library/ssl.html#certificates
 */
#include <stdio.h>
#include <errno.h>
#include <limits.h>
#include <getopt.h>
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

char USAGE[] = "Usage: [options] " \
               "[source_addr:]source_port target_addr:target_port\n\n" \
               "  --record REC       record traffic to REC\n" \
               "  --cert CERT        load CERT as SSL certificate\n" \
               "  --foreground|-f    run in the foreground\n" \
               "  --ssl-only         disallow non-SSL connections";

#define usage(fmt, args...) \
    fprintf(stderr, "%s\n\n", USAGE); \
    fprintf(stderr, fmt , ## args); \
    exit(1);

char target_host[256];
int target_port;
int recordfd = 0;

extern settings_t settings;
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
            } else if ((bytes == 2) &&
                       (tbuf_tmp[0] == '\xff') && 
                       (tbuf_tmp[1] == '\x00')) {
                fprintf(stderr, "client sent orderly close frame");
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

    if (settings.record && settings.record[0] != '\0') {
        recordfd = open(settings.record, O_WRONLY | O_CREAT | O_APPEND,
                        S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH);
    }

    printf("Connecting to: %s:%d\n", target_host, target_port);

    tsock = socket(AF_INET, SOCK_STREAM, 0);
    if (tsock < 0) {
        error("Could not create target socket");
        return;
    }
    bzero((char *) &taddr, sizeof(taddr));
    taddr.sin_family = AF_INET;
    taddr.sin_port = htons(target_port);

    /* Resolve target address */
    if (resolve_host(&taddr.sin_addr, target_host) < -1) {
        error("Could not resolve target address");
    }

    if (connect(tsock, (struct sockaddr *) &taddr, sizeof(taddr)) < 0) {
        error("Could not connect to target");
        close(tsock);
        return;
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
    int fd, c, option_index = 0;
    static int ssl_only = 0, foreground = 0;
    char *found;
    static struct option long_options[] = {
        {"ssl-only",   no_argument,       &ssl_only,    1 },
        {"foreground", no_argument,       &foreground, 'f'},
        /* ---- */
        {"record",     required_argument, 0,           'r'},
        {"cert",       required_argument, 0,           'c'},
        {0, 0, 0, 0}
    };

    settings.record = NULL;
    settings.cert = realpath("self.pem", NULL);

    while (1) {
        c = getopt_long (argc, argv, "fr:c:",
                         long_options, &option_index);

        /* Detect the end */
        if (c == -1) { break; }

        switch (c) {
            case 0:
                break; // ignore
            case 1:
                break; // ignore
            case 'f':
                foreground = 1;
                break;
            case 'r':
                if ((fd = open(optarg, O_CREAT,
                               S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)) < -1) {
                    usage("Could not access %s\n", optarg);
                }
                close(fd);
                settings.record = realpath(optarg, NULL);
                break;
            case 'c':
                settings.cert = realpath(optarg, NULL);
                if (! settings.cert) {
                    usage("No cert file at %s\n", optarg);
                }
                break;
            default:
                usage("");
        }
    }
    settings.ssl_only  = ssl_only;
    settings.daemon    = foreground ? 0: 1;

    if ((argc-optind) != 2) {
        usage("Invalid number of arguments\n");
    }

    found = strstr(argv[optind], ":");
    if (found) {
        memcpy(settings.listen_host, argv[optind], found-argv[optind]);
        settings.listen_port = strtol(found+1, NULL, 10);
    } else {
        settings.listen_host[0] = '\0';
        settings.listen_port = strtol(argv[optind], NULL, 10);
    }
    optind++;
    if (settings.listen_port == 0) {
        usage("Could not parse listen_port\n");
    }

    found = strstr(argv[optind], ":");
    if (found) {
        memcpy(target_host, argv[optind], found-argv[optind]);
        target_port = strtol(found+1, NULL, 10);
    } else {
        usage("Target argument must be host:port\n");
    }
    if (target_port == 0) {
        usage("Could not parse target port\n");
    }

    if (ssl_only) {
        printf("cert: %s\n", settings.cert);
        if (!settings.cert || !access(settings.cert)) {
            usage("SSL only and cert file not found\n");
        }
    }

    //printf("  ssl_only: %d\n", settings.ssl_only);
    //printf("  daemon: %d\n",   settings.daemon);
    //printf("  record: %s\n",   settings.record);
    //printf("  cert: %s\n",     settings.cert);

    settings.handler = proxy_handler; 
    start_server();

    free(tbuf);
    free(cbuf);
    free(tbuf_tmp);
    free(cbuf_tmp);
}
