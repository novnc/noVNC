/*
 * wswrap/wswrapper: Add WebSockets support to any service.
 * Copyright 2010 Joel Martin
 * Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)
 *
 * Use wswrap to run a program using the wrapper.
 */

/* WARNING: multi-threaded programs are not supported */

#include <stdio.h>
#include <stdlib.h>

#define __USE_GNU 1 // Pull in RTLD_NEXT
#include <dlfcn.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <resolv.h>      /* base64 encode/decode */
#include "md5.h"

//#define DO_DEBUG 1

#ifdef DO_DEBUG
#define DEBUG(...) \
    if (DO_DEBUG) { \
        fprintf(stderr, "wswrapper: "); \
        fprintf(stderr, __VA_ARGS__); \
    }
#else
#define DEBUG(...)
#endif

#define MSG(...) \
    fprintf(stderr, "wswrapper: "); \
    fprintf(stderr, __VA_ARGS__);

#define RET_ERROR(eno, ...) \
    fprintf(stderr, "wswrapper error: "); \
    fprintf(stderr, __VA_ARGS__); \
    errno = eno; \
    return -1;



const char _WS_response[] = "HTTP/1.1 101 Web Socket Protocol Handshake\r\n\
Upgrade: WebSocket\r\n\
Connection: Upgrade\r\n\
%sWebSocket-Origin: %s\r\n\
%sWebSocket-Location: %s://%s%s\r\n\
%sWebSocket-Protocol: sample\r\n\
\r\n%s";

/*
 * If WSWRAP_PORT environment variable is set then listen to the bind fd that
 * matches WSWRAP_PORT, otherwise listen to the first socket fd that bind is
 * called on.
 */
int   _WS_listen_fd  = 0;
int   _WS_sockfd     = 0;

typedef struct {
    char _WS_rbuf[65536];
    char _WS_sbuf[65536];
} _WS_connection;

int   _WS_bufsize    = 65536;
char *_WS_rbuf       = NULL;
char *_WS_sbuf       = NULL;
int   _WS_rcarry_cnt = 0;
char  _WS_rcarry[3]  = "";
int   _WS_newframe   = 1;

int _WS_init() {
    if (! (_WS_rbuf = malloc(_WS_bufsize)) ) {
        return 0;
    }
    if (! (_WS_sbuf = malloc(_WS_bufsize)) ) {
        return 0;
    }
}

int _WS_gen_md5(char *key1, char *key2, char *key3, char *target) {
    unsigned int i, spaces1 = 0, spaces2 = 0;
    unsigned long num1 = 0, num2 = 0;
    unsigned char buf[17];
    for (i=0; i < strlen(key1); i++) {
        if (key1[i] == ' ') {
            spaces1 += 1;
        }
        if ((key1[i] >= 48) && (key1[i] <= 57)) {
            num1 = num1 * 10 + (key1[i] - 48);
        }
    }
    num1 = num1 / spaces1;

    for (i=0; i < strlen(key2); i++) {
        if (key2[i] == ' ') {
            spaces2 += 1;
        }
        if ((key2[i] >= 48) && (key2[i] <= 57)) {
            num2 = num2 * 10 + (key2[i] - 48);
        }
    }
    num2 = num2 / spaces2;

    /* Pack it big-endian */
    buf[0] = (num1 & 0xff000000) >> 24;
    buf[1] = (num1 & 0xff0000) >> 16;
    buf[2] = (num1 & 0xff00) >> 8;
    buf[3] =  num1 & 0xff;

    buf[4] = (num2 & 0xff000000) >> 24;
    buf[5] = (num2 & 0xff0000) >> 16;
    buf[6] = (num2 & 0xff00) >> 8;
    buf[7] =  num2 & 0xff;

    strncpy(buf+8, key3, 8);
    buf[16] = '\0';

    md5_buffer(buf, 16, target);
    target[16] = '\0';

    return 1;
}


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
            // We got something but it wasn't a WebSockets client
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

        // Now parse out the data
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
            MSG("Got handshake (v76)\n");

        } else {
            sprintf(prefix, "");
            sprintf(key1, "");
            sprintf(key2, "");
            sprintf(key3, "");
            sprintf(chksum, "");

            //DEBUG("Got handshake (v75): %s\n", handshake);
            MSG("Got handshake (v75)\n");
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

ssize_t _WS_recv(int recvf, int sockfd, const void *buf,
                 size_t len, int flags)
{
    int rawcount, deccount, left, rawlen, retlen, decodelen;
    int sockflags;
    int i;
    char * fstart, * fend, * cstart;

    static void * (*rfunc)(), * (*rfunc2)();
    if (!rfunc) rfunc = (void *(*)()) dlsym(RTLD_NEXT, "recv");
    if (!rfunc2) rfunc2 = (void *(*)()) dlsym(RTLD_NEXT, "read");

    if (len == 0) {
        return 0;
    }

    if ((_WS_sockfd == 0) || (_WS_sockfd != sockfd)) {
        // Not our file descriptor, just pass through
        if (recvf) {
            return (ssize_t) rfunc(sockfd, buf, len, flags);
        } else {
            return (ssize_t) rfunc2(sockfd, buf, len);
        }
    }
    DEBUG("_WS_recv(%d, _, %d) called\n", sockfd, len);

    sockflags = fcntl(sockfd, F_GETFL, 0);
    left = len;
    retlen = 0;

    // first copy in any carry-over bytes
    if (_WS_rcarry_cnt) {
        if (_WS_rcarry_cnt == 1) {
            DEBUG("Using carry byte: %u (", _WS_rcarry[0]);
        } else if (_WS_rcarry_cnt == 2) {
            DEBUG("Using carry bytes: %u,%u (", _WS_rcarry[0],
                    _WS_rcarry[1]);
        } else {
            RET_ERROR(EIO, "Too many carry-over bytes\n");
        }
        if (len <= _WS_rcarry_cnt) {
            DEBUG("final)\n");
            memcpy((char *) buf, _WS_rcarry, len);
            _WS_rcarry_cnt -= len;
            return len;
        } else {
            DEBUG("prepending)\n");
            memcpy((char *) buf, _WS_rcarry, _WS_rcarry_cnt);
            retlen += _WS_rcarry_cnt;
            left -= _WS_rcarry_cnt;
            _WS_rcarry_cnt = 0;
        }
    }

    // Determine the number of base64 encoded bytes needed
    rawcount = (left * 4) / 3 + 3;
    rawcount -= rawcount%4;

    if (rawcount > _WS_bufsize - 1) {
        RET_ERROR(ENOMEM, "recv of %d bytes is larger than buffer\n", rawcount);
    }

    i = 0;
    while (1) {
        // Peek at everything available
        rawlen = (int) rfunc(sockfd, _WS_rbuf, _WS_bufsize-1,
                            flags | MSG_PEEK);
        if (rawlen <= 0) {
            DEBUG("_WS_recv: returning because rawlen %d\n", rawlen);
            return (ssize_t) rawlen;
        }
        fstart = _WS_rbuf;

        /*
        while (rawlen >= 2 && fstart[0] == '\x00' && fstart[1] == '\xff') {
            fstart += 2;
            rawlen -= 2;
        }
        */
        if (rawlen >= 2 && fstart[0] == '\x00' && fstart[1] == '\xff') {
            rawlen = (int) rfunc(sockfd, _WS_rbuf, 2, flags);
            if (rawlen != 2) {
                RET_ERROR(EIO, "Could not strip empty frame headers\n");
            }
            continue;
        }

        fstart[rawlen] = '\x00';

        if (rawlen - _WS_newframe >= 4) {
            // We have enough to base64 decode at least 1 byte
            break;
        }
        // Not enough to base64 decode
        if (sockflags & O_NONBLOCK) {
            // Just tell the caller to call again
            DEBUG("_WS_recv: returning because O_NONBLOCK, rawlen %d\n", rawlen);
            errno = EAGAIN;
            return -1;
        }
        // Repeat until at least 1 byte (4 raw bytes) to decode
        i++;
        if (i > 1000000) { 
            MSG("Could not send final part of frame\n");
        }
    }

    /*
    DEBUG("_WS_recv, left: %d, len: %d, rawlen: %d, newframe: %d, raw: ",
          left, len, rawlen, _WS_newframe);
    for (i = 0; i < rawlen; i++) {
        DEBUG("%u,", (unsigned char) ((char *) fstart)[i]);
    }
    DEBUG("\n");
    */

    if (_WS_newframe) {
        if (fstart[0] != '\x00') {
            RET_ERROR(EPROTO, "Missing frame start\n");
        }
        fstart++;
        rawlen--;
        _WS_newframe = 0;
    }

    fend = memchr(fstart, '\xff', rawlen);

    if (fend) {
        _WS_newframe = 1;
        if ((fend - fstart) % 4) {
            RET_ERROR(EPROTO, "Frame length is not multiple of 4\n");
        }
    } else {
        fend = fstart + rawlen - (rawlen % 4);
        if (fend - fstart < 4) {
            RET_ERROR(EPROTO, "Frame too short\n");
        }
    }

    // How much should we consume
    if (rawcount < fend - fstart) {
        _WS_newframe = 0;
        deccount = rawcount;
    } else {
        deccount = fend - fstart;
    }

    // Now consume what we processed
    if (flags & MSG_PEEK) {
        MSG("*** Got MSG_PEEK ***\n");
    } else {
        rfunc(sockfd, _WS_rbuf, fstart - _WS_rbuf + deccount + _WS_newframe, flags);
    }

    fstart[deccount] = '\x00'; // base64 terminator

    // Do direct base64 decode, instead of decode()
    decodelen = b64_pton(fstart, (char *) buf + retlen, deccount);
    if (decodelen <= 0) {
        RET_ERROR(EPROTO, "Base64 decode error\n");
    }

    if (decodelen <= left) {
        retlen += decodelen;
    } else {
        retlen += left;

        if (! (flags & MSG_PEEK)) {
            // Add anything left over to the carry-over
            _WS_rcarry_cnt = decodelen - left;
            if (_WS_rcarry_cnt > 2) {
                RET_ERROR(EPROTO, "Got too much base64 data\n");
            }
            memcpy(_WS_rcarry, buf + retlen, _WS_rcarry_cnt);
            if (_WS_rcarry_cnt == 1) {
                DEBUG("Saving carry byte: %u\n", _WS_rcarry[0]);
            } else if (_WS_rcarry_cnt == 2) {
                DEBUG("Saving carry bytes: %u,%u\n", _WS_rcarry[0],
                        _WS_rcarry[1]);
            } else {
                MSG("Waah2!\n");
            }
        }
    }
    ((char *) buf)[retlen] = '\x00';

    /*
    DEBUG("*** recv %s as ", fstart);
    for (i = 0; i < retlen; i++) {
        DEBUG("%u,", (unsigned char) ((char *) buf)[i]);
    }
    DEBUG(" (%d -> %d): %d\n", deccount, decodelen, retlen);
    */
    return retlen;
}

ssize_t _WS_send(int sendf, int sockfd, const void *buf,
                 size_t len, int flags)
{
    int rawlen, enclen, rlen, over, left, clen, retlen, dbufsize;
    int sockflags;
    char * target;
    int i;
    static void * (*sfunc)(), * (*sfunc2)();
    if (!sfunc) sfunc = (void *(*)()) dlsym(RTLD_NEXT, "send");
    if (!sfunc2) sfunc2 = (void *(*)()) dlsym(RTLD_NEXT, "write");

    if ((_WS_sockfd == 0) || (_WS_sockfd != sockfd)) {
        // Not our file descriptor, just pass through
        if (sendf) {
            return (ssize_t) sfunc(sockfd, buf, len, flags);
        } else {
            return (ssize_t) sfunc2(sockfd, buf, len);
        }
    }
    DEBUG("_WS_send(%d, _, %d) called\n", sockfd, len);

    sockflags = fcntl(sockfd, F_GETFL, 0);

    dbufsize = (_WS_bufsize * 3)/4 - 2;
    if (len > dbufsize) {
        RET_ERROR(ENOMEM, "send of %d bytes is larger than send buffer\n", len);
    }

    // base64 encode and add frame markers
    rawlen = 0;
    _WS_sbuf[rawlen++] = '\x00';
    enclen = b64_ntop(buf, len, _WS_sbuf+rawlen, _WS_bufsize-rawlen);
    if (enclen < 0) {
        RET_ERROR(EPROTO, "Base64 encoding error\n");
    }
    rawlen += enclen;
    _WS_sbuf[rawlen++] = '\xff';

    rlen = (int) sfunc(sockfd, _WS_sbuf, rawlen, flags);

    if (rlen <= 0) {
        return rlen;
    } else if (rlen < rawlen) {
        // Spin until we can send a whole base64 chunck and frame end
        over = (rlen - 1) % 4;  
        left = (4 - over) % 4 + 1; // left to send
        DEBUG("_WS_send: rlen: %d (over: %d, left: %d), rawlen: %d\n", rlen, over, left, rawlen);
        rlen += left;
        _WS_sbuf[rlen-1] = '\xff';
        i = 0;
        do {
            i++;
            clen = (int) sfunc(sockfd, _WS_sbuf + rlen - left, left, flags);
            if (clen > 0) {
                left -= clen;
            } else if (clen == 0) {
                MSG("_WS_send: got clen %d\n", clen);
            } else if (!(sockflags & O_NONBLOCK)) {
                MSG("_WS_send: clen %d\n", clen);
                return clen;
            }
            if (i > 1000000) { 
                MSG("Could not send final part of frame\n");
            }
        } while (left > 0);
        DEBUG("_WS_send: spins until finished %d\n", i);
    }


    /*
     * Report back the number of original characters sent,
     * not the raw number sent
     */
    // Adjust for framing
    retlen = rlen - 2;
    // Adjust for base64 padding
    if (_WS_sbuf[rlen-1] == '=') { retlen --; }
    if (_WS_sbuf[rlen-2] == '=') { retlen --; }

    // Adjust for base64 encoding
    retlen = (retlen*3)/4;

    /*
    DEBUG("*** send ");
    for (i = 0; i < retlen; i++) {
        DEBUG("%u,", (unsigned char) ((char *)buf)[i]);
    }
    DEBUG(" as '%s' (%d)\n", _WS_sbuf+1, rlen);
    */
    return (ssize_t) retlen;
}


/* Override network routines */

/*
int socket(int domain, int type, int protocol)
{
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "socket");
    DEBUG("socket(_, %d, _) called\n", type);

    return (int) func(domain, type, protocol);
}
*/

int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen)
{
    static void * (*func)();
    struct sockaddr_in * addr_in = (struct sockaddr_in *)addr;
    char * WSWRAP_PORT, * end;
    int fd, envport, bindport = htons(addr_in->sin_port);
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "bind");
    DEBUG("bind(%d, _, %d) called\n", sockfd, addrlen);

    fd = (int) func(sockfd, addr, addrlen);

    if (addr_in->sin_family != AF_INET) {
        // TODO: handle IPv6
        DEBUG("bind, ignoring non-IPv4 socket\n");
        return fd;
    }

    WSWRAP_PORT = getenv("WSWRAP_PORT");
    if ((! WSWRAP_PORT) || (*WSWRAP_PORT == '\0')) {
        // TODO: interpose on all sockets
        DEBUG("bind, not interposing: WSWRAP_PORT is not set\n");
        return fd;
    }

    envport = strtol(WSWRAP_PORT, &end, 10);
    if ((envport == 0) || (*end != '\0')) {
        MSG("bind, not interposing: WSWRAP_PORT is not a number\n");
        return fd;
    }

    if (envport != bindport) {
        DEBUG("bind, not interposing on port %d\n", bindport);
        return fd;
    }

    MSG("bind, interposing on port: %d\n", envport);
    _WS_listen_fd = envport;

    return fd;
}

int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen)
{
    int fd, ret, envfd;
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "accept");
    DEBUG("accept(%d, _, _) called\n", sockfd);

    fd = (int) func(sockfd, addr, addrlen);

    if (_WS_listen_fd == 0) {
        DEBUG("not interposing\n");
        return fd;
    }

    if (_WS_sockfd == 0) {
        // TODO: not just first connection
        _WS_sockfd = fd;

        if (!_WS_rbuf) {
            if (! _WS_init()) {
                RET_ERROR(ENOMEM, "Could not allocate interposer buffer\n");
            }
        }

        ret = _WS_handshake(_WS_sockfd);
        if (ret < 0) {
            errno = EPROTO;
            return ret;
        }
        MSG("interposing on fd %d\n", _WS_sockfd);
    } else {
        DEBUG("already interposing on fd %d\n", _WS_sockfd);
    }

    return fd;
}

int close(int fd)
{
    static void * (*func)();
    if (!func) func = (void *(*)()) dlsym(RTLD_NEXT, "close");

    if ((_WS_sockfd != 0) && (_WS_sockfd == fd)) {
        MSG("finished interposing on fd %d\n", _WS_sockfd);
        _WS_sockfd = 0;
    }
    return (int) func(fd);
}


ssize_t read(int fd, void *buf, size_t count)
{
    //DEBUG("read(%d, _, %d) called\n", fd, count);
    return (ssize_t) _WS_recv(0, fd, buf, count, 0);
}

ssize_t write(int fd, const void *buf, size_t count)
{
    //DEBUG("write(%d, _, %d) called\n", fd, count);
    return (ssize_t) _WS_send(0, fd, buf, count, 0);
}

ssize_t recv(int sockfd, void *buf, size_t len, int flags)
{
    //DEBUG("recv(%d, _, %d, %d) called\n", sockfd, len, flags);
    return (ssize_t) _WS_recv(1, sockfd, buf, len, flags);
}

ssize_t send(int sockfd, const void *buf, size_t len, int flags)
{
    //DEBUG("send(%d, _, %d, %d) called\n", sockfd, len, flags);
    return (ssize_t) _WS_send(1, sockfd, buf, len, flags);
}

