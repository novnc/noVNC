/*
 * wswrap/wswrapper: Add WebSockets support to any service.
 * Copyright 2010 Joel Martin
 * Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)
 *
 * wswrapper is an LD_PRELOAD library that converts a TCP listen socket of an
 * existing program to a be a WebSockets socket. The `wswrap` script can be
 * used to easily launch a program using wswrapper. Here is an example of
 * using wswrapper with vncserver. wswrapper will convert the socket listening
 * on port 5901 to be a WebSockets port:
 *
 *  cd noVNC/utils
 *  ./wswrap 5901 vncserver -geometry 640x480 :1
 *
 * This is tricky a subtle process so there are some serious limitations:
 * - multi-threaded programs may not work
 * - programs that fork may behave in strange and mysterious ways (such as
 *   fork bombing your system)
 * - programs using ppoll or epoll will not work correctly
 * - doesn't support fopencookie, streams, putc, etc.
 *
 * **********************************************************************
 * WARNING:
 * Due to the above limitations, this code should be considered an experiment
 * only. Consider using the program wrap mode of wsproxy.py instead.
 * **********************************************************************
 */

#define DO_MSG 1
#define DO_DEBUG 1
#define DO_TRACE 1

#include <stdio.h>
#include <stdlib.h>

#define __USE_GNU 1 // Pull in RTLD_NEXT
#include <dlfcn.h>

#include <poll.h>
#include <sys/poll.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <resolv.h>      /* base64 encode/decode */
#include <sys/time.h>
#include "md5.h"
#include "wswrapper.h"

/*
 * If WSWRAP_PORT environment variable is set then listen to the bind fd that
 * matches WSWRAP_PORT
 */
int              _WS_listen_fd  = -1;
int              _WS_nfds       = 0;
int              _WS_fds[WS_MAX_FDS];
_WS_connection  *_WS_connections[65536];


/* 
 * Utillity routines
 */
    
/*
 * Subtract the `struct timeval' values X and Y, storing the
 * result in RESULT. If TS is set then RESULT and X are really
 * type-cast `struct timespec` so scale them appropriately.
 * Return 1 if the difference is negative or 0, otherwise 0.
 */
int _WS_subtract_time (result, x, y, ts)
    struct timeval *result, *x, *y;
{
    int scale = ts ? 1000 : 1;
    /* Perform the carry for the later subtraction by updating y. */
    if ((x->tv_usec / scale) < y->tv_usec) {
        int sec = (y->tv_usec - (x->tv_usec / scale)) / 1000000 + 1;
        y->tv_usec -= 1000000 * sec;
        y->tv_sec += sec;
    }
    if ((x->tv_usec / scale) - y->tv_usec > 1000000) {
        int sec = ((x->tv_usec / scale) - y->tv_usec) / 1000000;
        y->tv_usec += 1000000 * sec;
        y->tv_sec -= sec;
    }

    /* Compute the time remaining to wait.
     * tv_usec is certainly positive. */
    result->tv_sec = x->tv_sec - y->tv_sec;
    result->tv_usec = x->tv_usec - (y->tv_usec * scale);

    /* Return 1 if result is negative or 0. */
    return x->tv_sec <= y->tv_sec;
}

int _WS_alloc(int fd) {
    if (_WS_connections[fd]) {
        RET_ERROR(ENOMEM, "Memory already allocated for fd %d\n", fd);
    }
    if (! (_WS_connections[fd] = malloc(sizeof(_WS_connection)))) {
        RET_ERROR(ENOMEM, "Could not allocate interposer memory\n");
    }
    _WS_connections[fd]->rcarry_cnt = 0;
    _WS_connections[fd]->rcarry[0]  = '\0';
    _WS_connections[fd]->newframe   = 1;
    _WS_connections[fd]->refcnt     = 1;

    /* Add to search list for select/pselect */
    _WS_fds[_WS_nfds] = fd;
    _WS_nfds++;

    return 0;
}

int _WS_free(int fd) {
    int i;
    _WS_connection * wsptr;
    wsptr = _WS_connections[fd];
    if (wsptr) {
        TRACE(">> _WS_free(%d)\n", fd);

        wsptr->refcnt--;
        if (wsptr->refcnt <= 0) {
            free(wsptr);
            DEBUG("freed memory for fd %d\n", fd);
        }
        _WS_connections[fd] = NULL;

        /* Remove from the search list for select/pselect */
        for (i = 0; i < _WS_nfds; i++) {
            if (_WS_fds[i] == fd) {
                break;
            }
        }
        if (_WS_nfds - i - 1 > 0) {
            memmove(_WS_fds + i, _WS_fds + i + 1, _WS_nfds - i - 1);
        }
        _WS_nfds--;

        MSG("finished interposing on fd %d\n", fd);
        TRACE("<< _WS_free(%d)\n", fd);
    }
}


/* 
 * WebSocket handshake routines
 */

/* For WebSockets v76, use key1, key2 and key3 to generate md5 hash */
int _WS_gen_md5(char *key1, char *key2, char *key3, char *target) {
    unsigned int i, spaces1 = 0, spaces2 = 0;
    unsigned long num1 = 0, num2 = 0;
    unsigned char buf[17];

    /* Parse number 1 from key 1 */
    for (i=0; i < strlen(key1); i++) {
        if (key1[i] == ' ') {
            spaces1 += 1;
        }
        if ((key1[i] >= 48) && (key1[i] <= 57)) {
            num1 = num1 * 10 + (key1[i] - 48);
        }
    }
    num1 = num1 / spaces1;

    /* Parse number 2 from key 2 */
    for (i=0; i < strlen(key2); i++) {
        if (key2[i] == ' ') {
            spaces2 += 1;
        }
        if ((key2[i] >= 48) && (key2[i] <= 57)) {
            num2 = num2 * 10 + (key2[i] - 48);
        }
    }
    num2 = num2 / spaces2;

    /* Pack it big-endian as the first 8 bytes */
    buf[0] = (num1 & 0xff000000) >> 24;
    buf[1] = (num1 & 0xff0000) >> 16;
    buf[2] = (num1 & 0xff00) >> 8;
    buf[3] =  num1 & 0xff;

    buf[4] = (num2 & 0xff000000) >> 24;
    buf[5] = (num2 & 0xff0000) >> 16;
    buf[6] = (num2 & 0xff00) >> 8;
    buf[7] =  num2 & 0xff;

    /* Add key 3 as the last 8 bytes */
    strncpy(buf+8, key3, 8);
    buf[16] = '\0';

    /* md5 hash all 16 bytes to generate 16 byte target */
    md5_buffer(buf, 16, target);
    target[16] = '\0';

    return 1;
}

/* Do v75 and v76 handshake on WebSocket connection */
int _WS_handshake(int sockfd)
{
    int sz = 0, len, idx;
    int ret = -1, save_errno = EPROTO;
    char *last, *start, *end;
    long flags;
    char handshake[4096], response[4096],
         path[1024], prefix[5] = "", scheme[10] = "ws", host[1024],
         origin[1024], key1[100], key2[100], key3[9], chksum[17];

    static void * (*rfunc)(), * (*wfunc)();
    if (!rfunc) rfunc = (void *(*)()) dlsym(RTLD_NEXT, "recv");
    if (!wfunc) wfunc = (void *(*)()) dlsym(RTLD_NEXT, "send");
    DEBUG("_WS_handshake starting\n");

    /* Disable NONBLOCK if set */
    flags = fcntl(sockfd, F_GETFL, 0);
    if (flags & O_NONBLOCK) {
        fcntl(sockfd, F_SETFL, flags^O_NONBLOCK);
    }

    while (1) {
        len = (int) rfunc(sockfd, handshake+sz, 4095, 0);
        if (len < 1) {
            ret = len;
            save_errno = errno;
            break;
        }
        sz += len;
        handshake[sz] = '\x00';
        if (sz < 4) {
            // Not enough yet
            continue;
        }
        if (strstr(handshake, "GET ") != handshake) {
            MSG("Got non-WebSockets client connection\n");
            break;
        }
        last = strstr(handshake, "\r\n\r\n");
        if (! last) {
            continue;
        }
        if (! strstr(handshake, "Upgrade: WebSocket\r\n")) {
            MSG("Invalid WebSockets handshake\n");
            break;
        }

        /* Now parse out the data elements */
        start = handshake+4;
        end = strstr(start, " HTTP/1.1");
        if (!end) { break; }
        snprintf(path, end-start+1, "%s", start);

        start = strstr(handshake, "\r\nHost: ");
        if (!start) { break; }
        start += 8;
        end = strstr(start, "\r\n");
        snprintf(host, end-start+1, "%s", start);

        start = strstr(handshake, "\r\nOrigin: ");
        if (!start) { break; }
        start += 10;
        end = strstr(start, "\r\n");
        snprintf(origin, end-start+1, "%s", start);

        start = strstr(handshake, "\r\n\r\n") + 4;
        if (strlen(start) == 8) {
            sprintf(prefix, "Sec-");

            snprintf(key3, 8+1, "%s", start);

            start = strstr(handshake, "\r\nSec-WebSocket-Key1: ");
            if (!start) { break; }
            start += 22;
            end = strstr(start, "\r\n");
            snprintf(key1, end-start+1, "%s", start);

            start = strstr(handshake, "\r\nSec-WebSocket-Key2: ");
            if (!start) { break; }
            start += 22;
            end = strstr(start, "\r\n");
            snprintf(key2, end-start+1, "%s", start);

            _WS_gen_md5(key1, key2, key3, chksum);

            //DEBUG("Got handshake (v76): %s\n", handshake);
            MSG("New WebSockets client (v76)\n");

        } else {
            sprintf(prefix, "");
            sprintf(key1, "");
            sprintf(key2, "");
            sprintf(key3, "");
            sprintf(chksum, "");

            //DEBUG("Got handshake (v75): %s\n", handshake);
            MSG("New WebSockets client (v75)\n");
        }
        sprintf(response, _WS_response, prefix, origin, prefix, scheme,
                host, path, prefix, chksum);
        //DEBUG("Handshake response: %s\n", response);
        wfunc(sockfd, response, strlen(response), 0);
        save_errno = 0;
        ret = 0;
        break;
    }

    /* Re-enable NONBLOCK if it was set */
    if (flags & O_NONBLOCK) {
        fcntl(sockfd, F_SETFL, flags);
    }
    errno = save_errno;
    return ret;
}

/* 
 * Strip empty WebSockets frames and return a positive value if there is
 * enough data to base64 decode (a 4 byte chunk). If nonblock is not set then
 * it will block until there is enough data (or until an error occurs).
 */
ssize_t _WS_ready(int sockfd, int nonblock)
{
    _WS_connection *ws = _WS_connections[sockfd];
    char buf[6];
    int count, len, flags, i;
    static void * (*rfunc)();
    if (!rfunc) rfunc = (void *(*)()) dlsym(RTLD_NEXT, "recv");

    TRACE(">> _WS_ready(%d, %d)\n", sockfd, nonblock);

    count = 4 + ws->newframe;
    flags = MSG_PEEK;
    if (nonblock) {
        flags |= MSG_DONTWAIT;
    }
    while (1) {
        len = (int) rfunc(sockfd, buf, count, flags);
        if (len < 1) {
            TRACE("<< _WS_ready(%d, %d) len %d, errno: %d\n",
                  sockfd, nonblock, len, errno);
            return len;
        }
        if (len >= 2 && buf[0] == '\x00' && buf[1] == '\xff') {
            /* Strip emtpy frame */
            DEBUG("_WS_ready(%d, %d), strip empty\n", sockfd, nonblock);
            len = (int) rfunc(sockfd, buf, 2, 0);
            if (len < 2) {
                MSG("Failed to strip empty frame headers\n");
                TRACE("<< _WS_ready: failed to strip empty frame headers\n");
                return len;
            } else if (len == 2 && nonblock) {
                errno = EAGAIN;
                TRACE("<< _WS_ready(%d, %d), len == 2, EAGAIN\n",
                      sockfd, nonblock);
                return -1;
            }
            continue;
        }
        if (len < count) {
            if (nonblock) {
                errno = EAGAIN;
                TRACE("<< _WS_ready(%d, %d), len < count, EAGAIN\n",
                      sockfd, nonblock);
                return -1;
            } else {
                fprintf(stderr, "_WS_ready(%d, %d), loop: len %d, buf:",
                        sockfd, nonblock, len, (unsigned char) buf[0]);
                for (i = 0; i < len; i++) {
                    fprintf(stderr, "%d", (unsigned char) buf[i]);
                }
                fprintf(stderr, "\n");

                continue;
            }
        }
        TRACE("<< _WS_ready(%d, %d) len: %d\n", sockfd, nonblock, len);
        return len;
    }
}

/*
 * WebSockets recv/read interposer routine
 */
ssize_t _WS_recv(int recvf, int sockfd, const void *buf,
                 size_t len, int flags)
{
    _WS_connection *ws = _WS_connections[sockfd];
    int rawcount, deccount, left, striplen, decodelen, ready;
    ssize_t retlen, rawlen;
    int sockflags;
    int i;
    char *fstart, *fend, *cstart;

    static void * (*rfunc)(), * (*rfunc2)();
    if (!rfunc) rfunc = (void *(*)()) dlsym(RTLD_NEXT, "recv");
    if (!rfunc2) rfunc2 = (void *(*)()) dlsym(RTLD_NEXT, "read");

    if (! ws) {
        // Not our file descriptor, just pass through
        if (recvf) {
            return (ssize_t) rfunc(sockfd, buf, len, flags);
        } else {
            return (ssize_t) rfunc2(sockfd, buf, len);
        }
    }
    TRACE(">> _WS_recv(%d)\n", sockfd);

    if (len == 0) {
        TRACE("<< _WS_recv(%d) len == 0\n", sockfd);
        return 0;
    }

    sockflags = fcntl(sockfd, F_GETFL, 0);
    if (sockflags & O_NONBLOCK) {
        TRACE("_WS_recv(%d, _, %d) with O_NONBLOCK\n", sockfd, len);
    } else {
        TRACE("_WS_recv(%d, _, %d) without O_NONBLOCK\n", sockfd, len);
    }

    left = len;
    retlen = 0;

    /* first copy in carry-over bytes from previous recv/read */
    if (ws->rcarry_cnt) {
        if (ws->rcarry_cnt == 1) {
            DEBUG("Using carry byte: %u (", ws->rcarry[0]);
        } else if (ws->rcarry_cnt == 2) {
            DEBUG("Using carry bytes: %u,%u (", ws->rcarry[0],
                    ws->rcarry[1]);
        } else {
            RET_ERROR(EIO, "Too many carry-over bytes\n");
        }
        if (len <= ws->rcarry_cnt) {
            DEBUG("final)\n");
            memcpy((char *) buf, ws->rcarry, len);
            ws->rcarry_cnt -= len;
            return len;
        } else {
            DEBUG("prepending)\n");
            memcpy((char *) buf, ws->rcarry, ws->rcarry_cnt);
            retlen += ws->rcarry_cnt;
            left -= ws->rcarry_cnt;
            ws->rcarry_cnt = 0;
        }
    }

    /* Determine the number of base64 encoded bytes needed */
    rawcount = (left * 4) / 3 + 3;
    rawcount -= rawcount%4;

    if (rawcount > WS_BUFSIZE - 1) {
        RET_ERROR(ENOMEM, "recv of %d bytes is larger than buffer\n", rawcount);
    }

    ready = _WS_ready(sockfd, 0);
    if (ready < 1) {
        if (retlen) {
            /* We had some carry over, don't error until next call */
            errno = 0;
        } else {
            retlen = ready;
        }
        TRACE("<< _WS_recv(%d, _, %d) retlen %d\n", sockfd, len, retlen);
        return retlen;
    }

    /* We have enough data to return something */

    /* Peek at everything available */
    rawlen = (ssize_t) rfunc(sockfd, ws->rbuf, WS_BUFSIZE-1,
                             flags | MSG_PEEK);
    if (rawlen <= 0) {
        RET_ERROR(EPROTO, "Socket was ready but then had failure");
    }
    fstart = ws->rbuf;
    fstart[rawlen] = '\x00';


    if (ws->newframe) {
        if (fstart[0] != '\x00') {
            RET_ERROR(EPROTO, "Missing frame start\n");
        }
        fstart++;
        rawlen--;
        ws->newframe = 0;
    }

    fend = memchr(fstart, '\xff', rawlen);

    if (fend) {
        ws->newframe = 1;
        if ((fend - fstart) % 4) {
            RET_ERROR(EPROTO, "Frame length is not multiple of 4\n");
        }
    } else {
        fend = fstart + rawlen - (rawlen % 4);
        if (fend - fstart < 4) {
            RET_ERROR(EPROTO, "Frame too short\n");
        }
    }

    /* Determine amount to consume */
    if (rawcount < fend - fstart) {
        ws->newframe = 0;
        deccount = rawcount;
    } else {
        deccount = fend - fstart;
    }

    /* Now consume what was processed (if not MSG_PEEK) */
    if (flags & MSG_PEEK) {
        DEBUG("_WS_recv(%d, _, %d) MSG_PEEK, not consuming\n", sockfd, len);
    } else {
        rfunc(sockfd, ws->rbuf, fstart - ws->rbuf + deccount + ws->newframe, flags);
    }

    fstart[deccount] = '\x00'; // base64 terminator

    /* Do base64 decode into the return buffer */
    decodelen = b64_pton(fstart, (char *) buf + retlen, deccount);
    if (decodelen <= 0) {
        RET_ERROR(EPROTO, "Base64 decode error\n");
    }

    /* Calculate return length and carry-over */
    if (decodelen <= left) {
        retlen += decodelen;
    } else {
        retlen += left;

        if (! (flags & MSG_PEEK)) {
            /* Add anything left over to the carry-over */
            ws->rcarry_cnt = decodelen - left;
            if (ws->rcarry_cnt > 2) {
                RET_ERROR(EPROTO, "Got too much base64 data\n");
            }
            memcpy(ws->rcarry, buf + retlen, ws->rcarry_cnt);
            if (ws->rcarry_cnt == 1) {
                DEBUG("Saving carry byte: %u\n", ws->rcarry[0]);
            } else if (ws->rcarry_cnt == 2) {
                DEBUG("Saving carry bytes: %u,%u\n", ws->rcarry[0],
                        ws->rcarry[1]);
            } else {
                RET_ERRO(EPROTO, "Too many carry bytes!\n");
            }
        }
    }
    ((char *) buf)[retlen] = '\x00';

    TRACE("<< _WS_recv(%d) retlen %d\n", sockfd, retlen);
    return retlen;
}

/*
 * WebSockets send and write interposer routine
 */
ssize_t _WS_send(int sendf, int sockfd, const void *buf,
                 size_t len, int flags)
{
    _WS_connection *ws = _WS_connections[sockfd];
    int rawlen, enclen, rlen, over, left, clen, retlen, dbufsize;
    int sockflags;
    char * target;
    int i;
    static void * (*sfunc)(), * (*sfunc2)();
    if (!sfunc) sfunc   = (void *(*)()) dlsym(RTLD_NEXT, "send");
    if (!sfunc2) sfunc2 = (void *(*)()) dlsym(RTLD_NEXT, "write");

    if (! ws) {
        // Not our file descriptor, just pass through
        if (sendf) {
            return (ssize_t) sfunc(sockfd, buf, len, flags);
        } else {
            return (ssize_t) sfunc2(sockfd, buf, len);
        }
    }
    TRACE(">> _WS_send(%d, _, %d)\n", sockfd, len);

    sockflags = fcntl(sockfd, F_GETFL, 0);

    dbufsize = (WS_BUFSIZE * 3)/4 - 2;
    if (len > dbufsize) {
        RET_ERROR(ENOMEM, "send of %d bytes is larger than send buffer\n", len);
    }

    /* base64 encode and add frame markers */
    rawlen = 0;
    ws->sbuf[rawlen++] = '\x00';
    enclen = b64_ntop(buf, len, ws->sbuf+rawlen, WS_BUFSIZE-rawlen);
    if (enclen < 0) {
        RET_ERROR(EPROTO, "Base64 encoding error\n");
    }
    rawlen += enclen;
    ws->sbuf[rawlen++] = '\xff';

    rlen = (int) sfunc(sockfd, ws->sbuf, rawlen, flags);

    if (rlen <= 0) {
        TRACE("<< _WS_send(%d, _, %d) send failed, returning\n", sockfd, len);
        return rlen;
    } else if (rlen < rawlen) {
        /* Spin until we can send a whole base64 chunck and frame end */
        over = (rlen - 1) % 4;  
        left = (4 - over) % 4 + 1; // left to send
        DEBUG("_WS_send: rlen: %d (over: %d, left: %d), rawlen: %d\n",
              rlen, over, left, rawlen);
        rlen += left;
        ws->sbuf[rlen-1] = '\xff';
        i = 0;
        do {
            i++;
            clen = (int) sfunc(sockfd, ws->sbuf + rlen - left, left, flags);
            if (clen > 0) {
                left -= clen;
            } else if (clen == 0) {
                MSG("_WS_send: got clen %d\n", clen);
            } else if (!(sockflags & O_NONBLOCK)) {
                MSG("<< _WS_send: clen %d\n", clen);
                return clen;
            }
            if (i > 1000000) { 
                RET_ERROR(EIO, "Could not send final part of frame\n");
            }
        } while (left > 0);
        //DEBUG("_WS_send: spins until finished %d\n", i);
        DEBUG("_WS_send: spins until finished %d\n", i);
    }


    /*
     * Report back the number of original characters sent,
     * not the raw number sent
     */

    /* Adjust for framing */
    retlen = rlen - 2;

    /* Adjust for base64 padding */
    if (ws->sbuf[rlen-1] == '=') { retlen --; }
    if (ws->sbuf[rlen-2] == '=') { retlen --; }

    /* Scale return value for base64 encoding size */
    retlen = (retlen*3)/4;

    TRACE(">> _WS_send(%d, _, %d) retlen %d\n", sockfd, len, retlen);
    return (ssize_t) retlen;
}

/*
 * Interpose select/pselect/poll.
 *
 * WebSocket descriptors are not ready until we have received a frame start
 * ('\x00') and at least 4 bytes of base64 encoded data. In addition we may
 * have carry-over data from the last 4 bytes of base64 data in which case the
 * WebSockets socket is ready even though there might not be data in the raw
 * socket itself.
 */

/* Interpose on select (mode==0) and pselect (mode==1) */
int _WS_select(int mode, int nfds, fd_set *readfds,
               fd_set *writefds, fd_set *exceptfds,
               void *timeptr, const sigset_t *sigmask)
{
    _WS_connection *ws;
    fd_set carryfds, savefds;
    /* Assumes timeptr is two longs whether timeval or timespec */
    struct timeval savetv, starttv, nowtv, difftv;
    int carrycnt = 0, less = 0;
    int ret, i, ready, fd;
    static void * (*func0)(), * (*func1)();
    if (!func0) func0 = (void *(*)()) dlsym(RTLD_NEXT, "select");
    if (!func1) func1 = (void *(*)()) dlsym(RTLD_NEXT, "pselect");

    if ((_WS_listen_fd == -1) || (_WS_nfds == 0)) {
        if (mode == 0) {
            ret = (int) func0(nfds, readfds, writefds, exceptfds,
                              timeptr);
        } else if (mode == 1) {
            ret = (int) func1(nfds, readfds, writefds, exceptfds,
                              timeptr, sigmask);
        }
        return ret;
    }

#ifdef DO_TRACE
    TRACE(">> _WS_select(%d, %d, _, _, _, _)\n", mode, nfds);
    for (i = 0; i < _WS_nfds; i++) {
        fd = _WS_fds[i];
        if (readfds && (FD_ISSET(fd, readfds))) {
            TRACE("   WS %d is in readfds\n", fd, nfds);
        }
        if (writefds && (FD_ISSET(fd, writefds))) {
            TRACE("   WS %d is in writefds\n", fd, nfds);
        }
        if (exceptfds && (FD_ISSET(fd, exceptfds))) {
            TRACE("   WS %d is in exceptfds\n", fd, nfds);
        }
    }
#endif
    if (timeptr) {
        memcpy(&savetv, timeptr, sizeof(savetv));
        gettimeofday(&starttv, NULL);
    }

    /* If we have carry-over return it right away */
    FD_ZERO(&carryfds);
    if (readfds) {
        memcpy(&savefds, readfds, sizeof(savefds));
        for (i = 0; i < _WS_nfds; i++) {
            fd = _WS_fds[i];
            ws = _WS_connections[fd];
            if ((ws->rcarry_cnt) && (FD_ISSET(fd, readfds))) {
                FD_SET(fd, &carryfds);
                carrycnt++;
            }
        }
    }
    if (carrycnt) {
        if (writefds) {
            FD_ZERO(writefds);
        }
        if (exceptfds) {
            FD_ZERO(writefds);
        }
        memcpy(readfds, &carryfds, sizeof(carryfds));
        TRACE("<< _WS_select(%d, %d, _, _, _, _) carrycnt %d\n",
              mode, nfds, carrycnt);
        return carrycnt;
    }

    do {
        if (timeptr) {
            TRACE("   _WS_select tv/ts: %ld:%ld\n",
                ((struct timeval *) timeptr)->tv_sec,
                ((struct timeval *) timeptr)->tv_usec);
        }
        if (mode == 0) {
            ret = (int) func0(nfds, readfds, writefds, exceptfds,
                              timeptr);
        } else if (mode == 1) {
            ret = (int) func1(nfds, readfds, writefds, exceptfds,
                              timeptr, sigmask);
        }
        if (! readfds) {
            break;
        }
        if (ret <= 0) {
            break;
        }

        for (i = 0; i < _WS_nfds; i++) {
            fd = _WS_fds[i];
            ws = _WS_connections[fd];
            if (FD_ISSET(fd, readfds)) {
                ready = _WS_ready(fd, 1);
                if (ready == 0) {
                    /* 0 means EOF which is also a ready condition */
                    DEBUG("_WS_select: detected %d is closed\n", fd);
                } else if (ready < 0) {
                    DEBUG("_WS_select: FD_CLR(%d,readfds) - not enough to decode\n", fd);
                    FD_CLR(fd, readfds);
                    ret--;
                }
            }
        }
        errno = 0; /* errno could be set by _WS_ready */

        if (ret == 0) {
            /*
             * If all the ready readfds were WebSockets, but none of
             * them were really ready (empty frames) then we select again. But
             * first restore original values less passage of time.
             */
            if (! timeptr) {
                /* No timeout, spin forever */
                continue;
            }
            memcpy(readfds, &savefds, sizeof(savefds));
            gettimeofday(&nowtv, NULL);
            /* Amount of time that has passed */
            _WS_subtract_time(&difftv, &nowtv, &starttv, 0);
            /* Subtract from original timout */
            less = _WS_subtract_time((struct timeval *) timeptr,
                                     &savetv, &difftv, mode);
            if (less) {
                /* Timer has expired */
                TRACE("  _WS_select expired timer\n", mode, nfds);
                break;
            }
        }
    } while (ret == 0);

    /* Restore original time value for pselect glibc does */
    if (timeptr && mode == 1) {
        memcpy(timeptr, &savetv, sizeof(savetv));
    }

#ifdef DO_TRACE
    TRACE("<< _WS_select(%d, %d, _, _, _, _) ret %d, errno %d\n",
          mode, nfds, ret, errno);
    for (i = 0; i < _WS_nfds; i++) {
        fd = _WS_fds[i];
        if (readfds && (FD_ISSET(fd, readfds))) {
            TRACE("   WS %d is set in readfds\n", fd, nfds);
        }
        if (writefds && (FD_ISSET(fd, writefds))) {
            TRACE("   WS %d is set in writefds\n", fd, nfds);
        }
        if (exceptfds && (FD_ISSET(fd, exceptfds))) {
            TRACE("   WS %d is set in exceptfds\n", fd, nfds);
        }
    }
#endif
    return ret;
}

/* Interpose on poll (mode==0) and ppoll (mode==1) */
int _WS_poll(int mode, struct pollfd *fds, nfds_t nfds, int timeout,
             struct timespec *ptimeout, sigset_t *sigmask)
{
    _WS_connection *ws;
    int savetimeout;
    struct timespec savets;
    struct timeval starttv, nowtv, difftv;
    struct pollfd *pfd;
    int carrycnt = 0, less = 0;
    int ret, i, ready, fd;
    static void * (*func0)(), * (*func1)();
    if (!func0) func0 = (void *(*)()) dlsym(RTLD_NEXT, "poll");
    if (!func1) func1 = (void *(*)()) dlsym(RTLD_NEXT, "ppoll");

    if ((_WS_listen_fd == -1) || (_WS_nfds == 0)) {
        if (mode == 0) {
            ret = (int) func0(fds, nfds, timeout);
        } else if (mode == 1) {
            ret = (int) func1(fds, nfds, ptimeout, sigmask);
        }
        return ret;
    }

    TRACE(">> _WS_poll(%d, %ld, _, _, _, _)\n", mode, nfds);
    if (mode == 0) {
        savetimeout = timeout;
    } else if (mode == 1) {
        memcpy(&savets, ptimeout, sizeof(savets));
    }
    gettimeofday(&starttv, NULL);

    do {
        TRACE("   _WS_poll(%d, %ld, _, _, _, _) tv/ts: %ld:%ld\n", mode, nfds,
              ptimeout->tv_sec, ptimeout->tv_nsec);

        if (mode == 0) {
            ret = (int) func0(fds, nfds, timeout);
        } else if (mode == 1) {
            ret = (int) func1(fds, nfds, ptimeout, sigmask);
        }
        if (ret <= 0) {
            break;
        }

        for (i = 0; i < nfds; i++) {
            pfd = &fds[i];
            if (! (pfd->events & POLLIN)) {
                continue;
            }
            ws = _WS_connections[pfd->fd];
            if (! ws) {
                continue;
            }
            if (ws->rcarry_cnt) {
                if (! (pfd->revents & POLLIN)) {
                    pfd->revents |= POLLIN;
                    ret++;
                }
            } else if (pfd->revents & POLLIN) {
                ready = _WS_ready(pfd->fd, 1);
                if (ready == 0) {
                    /* 0 means EOF which is also a ready condition */
                    DEBUG("_WS_poll: detected %d is closed\n", fd);
                } else if (ready < 0) {
                    DEBUG("_WS_poll: not enough to decode\n", fd);
                    pfd->revents -= POLLIN;
                    ret--;
                }
            }
        }
        errno = 0; /* errno could be set by _WS_ready */

        if (ret == 0) {
            /*
             * If all the ready readfds were WebSockets, but none of
             * them were really ready (empty frames) then we select again. But
             * first restore original values less passage of time.
             */
            gettimeofday(&nowtv, NULL);
            /* Amount of time that has passed */
            _WS_subtract_time(&difftv, &nowtv, &starttv, 0);
            if (mode == 0) {
                if (timeout < 0) {
                    /* Negative timeout means infinite */
                    continue;
                }
                timeout -= difftv.tv_sec * 1000 + difftv.tv_usec / 1000;
                if (timeout <= 0) {
                    less = 1;
                }
            } else if (mode == 1) {
                /* Subtract from original timout */
                less = _WS_subtract_time((struct timeval *) ptimeout,
                                         (struct timeval *) &savets,
                                         &difftv, 1);
            }
            if (less) {
                /* Timer has expired */
                TRACE("  _WS_poll expired timer\n", mode, nfds);
                break;
            }
        }
    } while (ret == 0);

    /* Restore original time value for pselect glibc does */
    if (mode == 1) {
        memcpy(ptimeout, &savets, sizeof(savets));
    }

    TRACE("<< _WS_poll(%d, %ld, _, _, _, _) ret %d, errno %d\n",
          mode, nfds, ret, errno);
    return ret;
}


/*
 * Overload (LD_PRELOAD) standard library network routines
 */

int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen)
{
    static void * (*func)();
    struct sockaddr_in * addr_in = (struct sockaddr_in *)addr;
    char * WSWRAP_PORT, * end;
    int ret, envport, bindport = htons(addr_in->sin_port);
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "bind");
    TRACE(">> bind(%d, _, %d)\n", sockfd, addrlen);

    ret = (int) func(sockfd, addr, addrlen);

    if (addr_in->sin_family != AF_INET) {
        // TODO: handle IPv6
        TRACE("<< bind, ignoring non-IPv4 socket\n");
        return ret;
    }

    WSWRAP_PORT = getenv("WSWRAP_PORT");
    if ((! WSWRAP_PORT) || (*WSWRAP_PORT == '\0')) {
        // TODO: interpose on all sockets when WSWRAP_PORT not set
        TRACE("<< bind, not interposing: WSWRAP_PORT is not set\n");
        return ret;
    }

    envport = strtol(WSWRAP_PORT, &end, 10);
    if ((envport == 0) || (*end != '\0')) {
        TRACE("<< bind, not interposing: WSWRAP_PORT is not a number\n");
        return ret;
    }

    if (envport != bindport) {
        TRACE("<< bind, not interposing on port: %d (fd %d)\n", bindport, sockfd);
        return ret;
    }

    _WS_listen_fd = sockfd;

    TRACE("<< bind, listening for WebSockets connections on port: %d (fd %d)\n", envport, sockfd);
    return ret;
}

int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen)
{
    int fd, ret, envfd;
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "accept");
    TRACE("<< accept(%d, _, _)\n", sockfd);

    fd = (int) func(sockfd, addr, addrlen);

    if (_WS_listen_fd == -1) {
        TRACE("<< accept: not interposing\n");
        return fd;
    }

    if (_WS_listen_fd != sockfd) {
        TRACE("<< accept: not interposing on fd %d\n", sockfd);
        return fd;
    }


    if (_WS_connections[fd]) {
        RET_ERROR(EINVAL, "already interposing on fd %d\n", fd);
    } else {
        /* It's a port we're interposing on so allocate memory for it */
        if (_WS_nfds >= WS_MAX_FDS) {
            RET_ERROR(ENOMEM, "Too many interposer fds\n");
        }
        if (_WS_alloc(fd) < 0) {
            return -1;
        }

        ret = _WS_handshake(fd);
        if (ret < 0) {
            _WS_free(fd);
            errno = EPROTO;
            TRACE("<< accept(%d, _, _): ret %d\n", sockfd, ret);
            return ret;
        }
        MSG("interposing on fd %d (allocated memory)\n", fd);
    }

    return fd;
}

int close(int fd)
{
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "close");

    TRACE("close(%d) called\n", fd);

    _WS_free(fd);

    return (int) func(fd);
}


ssize_t read(int fd, void *buf, size_t count)
{
    TRACE("read(%d, _, %d) called\n", fd, count);
    return (ssize_t) _WS_recv(0, fd, buf, count, 0);
}

ssize_t write(int fd, const void *buf, size_t count)
{
    TRACE("write(%d, _, %d) called\n", fd, count);
    return (ssize_t) _WS_send(0, fd, buf, count, 0);
}

ssize_t recv(int sockfd, void *buf, size_t len, int flags)
{
    TRACE("recv(%d, _, %d, %d) called\n", sockfd, len, flags);
    return (ssize_t) _WS_recv(1, sockfd, buf, len, flags);
}

ssize_t send(int sockfd, const void *buf, size_t len, int flags)
{
    TRACE("send(%d, _, %d, %d) called\n", sockfd, len, flags);
    return (ssize_t) _WS_send(1, sockfd, buf, len, flags);
}

int select(int nfds, fd_set *readfds, fd_set *writefds,
           fd_set *exceptfds, struct timeval *timeout)
{
    TRACE("select(%d, _, _, _, _) called\n", nfds);
    return _WS_select(0, nfds, readfds, writefds, exceptfds,
                      (void *) timeout, NULL);
}

int pselect(int nfds, fd_set *readfds, fd_set *writefds,
            fd_set *exceptfds, const struct timespec *timeout,
            const sigset_t *sigmask)
{
    TRACE("pselect(%d, _, _, _, _, _) called\n", nfds);
    return _WS_select(1, nfds, readfds, writefds, exceptfds,
                      (void *) timeout, sigmask);
}

int poll(struct pollfd *fds, nfds_t nfds, int timeout)
{
    TRACE("poll(_, %ld, %d) called\n", nfds, timeout);
    return _WS_poll(0, fds, nfds, timeout, NULL, NULL);
}

int ppoll(struct pollfd *fds, nfds_t nfds,
          const struct timespec *timeout, const sigset_t *sigmask)
{
    TRACE("ppoll(_, %ld, _, _) called\n", nfds);
    return _WS_poll(0, fds, nfds, 0, (struct timespec *)timeout,
                    (sigset_t *)sigmask);
}

int dup(int oldfd) {
    int ret;
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "dup");

    TRACE(">> dup(%d) called\n", oldfd);

    ret = (int) func(oldfd);

    TRACE("<< dup(%d) ret %d\n", oldfd, ret);
    return ret;
}

int dup2(int oldfd, int newfd) {
    int ret;
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "dup2");

    TRACE(">> dup2(%d, %d) called\n", oldfd, newfd);

    ret = (int) func(oldfd, newfd);
    if ((! _WS_connections[oldfd]) && (! _WS_connections[newfd])) {
        return ret;
    }

    if ((ret < 0) || (oldfd == newfd) ||
        (_WS_connections[oldfd] == _WS_connections[newfd])) {
        TRACE("<< dup2(%d, %d) ret %d\n", oldfd, newfd, ret);
        return ret;
    }
    
    /* dup2 behavior is to close newfd if it's open */
    if (_WS_connections[newfd]) {
        _WS_free(newfd);
    }

    if (! _WS_connections[oldfd]) {
        TRACE("<< dup2(%d, %d) ret %d\n", oldfd, newfd, ret);
        return ret;
    }

    MSG("interposing on duplicated fd %d\n", newfd);
    /* oldfd and newfd are now descriptors for the same socket,
     * re-use the same context memory area */
    _WS_connections[newfd] = _WS_connections[oldfd];
    _WS_connections[newfd]->refcnt++;

    /* Add to search list for select/pselect */
    _WS_fds[_WS_nfds] = newfd;
    _WS_nfds++;

    TRACE("<< dup2(%d, %d) ret %d\n", oldfd, newfd, ret);
    return ret;

}

int dup3(int oldfd, int newfd, int flags) {
    int ret;
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "dup3");

    TRACE(">> dup3(%d, %d, %d) called\n", oldfd, newfd, flags);

    ret = (int) func(oldfd, newfd, flags);

    TRACE("<< dup3(%d, %d, %d) ret %d\n", oldfd, newfd, flags, ret);
    return ret;
}

