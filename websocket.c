/*
 * WebSocket lib with support for "wss://" encryption.
 *
 * You can make a cert/key with openssl using:
 * openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem
 * as taken from http://docs.python.org/dev/library/ssl.html#certificates
 */
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <strings.h>
#include <sys/types.h> 
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <resolv.h>      /* base64 encode/decode */
#include "websocket.h"

const char server_handshake[] = "HTTP/1.1 101 Web Socket Protocol Handshake\r\n\
Upgrade: WebSocket\r\n\
Connection: Upgrade\r\n\
WebSocket-Origin: %s\r\n\
WebSocket-Location: %s://%s%s\r\n\
WebSocket-Protocol: sample\r\n\
\r\n";

const char policy_response[] = "<cross-domain-policy><allow-access-from domain=\"*\" to-ports=\"*\" /></cross-domain-policy>\n";

/*
 * Global state
 *
 *   Warning: not thread safe
 */
int ssl_initialized = 0;
char *tbuf, *cbuf, *tbuf_tmp, *cbuf_tmp;
unsigned int bufsize, dbufsize;
client_settings_t client_settings;

void traffic(char * token) {
    fprintf(stdout, "%s", token);
    fflush(stdout);
}

void error(char *msg)
{
    perror(msg);
}

void fatal(char *msg)
{
    perror(msg);
    exit(1);
}

/*
 * SSL Wrapper Code
 */

ssize_t ws_recv(ws_ctx_t *ctx, void *buf, size_t len) {
    if (ctx->ssl) {
        //printf("SSL recv\n");
        return SSL_read(ctx->ssl, buf, len);
    } else {
        return recv(ctx->sockfd, buf, len, 0);
    }
}

ssize_t ws_send(ws_ctx_t *ctx, const void *buf, size_t len) {
    if (ctx->ssl) {
        //printf("SSL send\n");
        return SSL_write(ctx->ssl, buf, len);
    } else {
        return send(ctx->sockfd, buf, len, 0);
    }
}

ws_ctx_t *ws_socket(int socket) {
    ws_ctx_t *ctx;
    ctx = malloc(sizeof(ws_ctx_t));
    ctx->sockfd = socket;
    ctx->ssl = NULL;
    ctx->ssl_ctx = NULL;
    return ctx;
}

ws_ctx_t *ws_socket_ssl(int socket, char * certfile) {
    int ret;
    char msg[1024];
    ws_ctx_t *ctx;
    ctx = ws_socket(socket);

    // Initialize the library
    if (! ssl_initialized) {
        SSL_library_init();
        OpenSSL_add_all_algorithms();
        SSL_load_error_strings();
        ssl_initialized = 1;

    }

    ctx->ssl_ctx = SSL_CTX_new(TLSv1_server_method());
    if (ctx->ssl_ctx == NULL) {
        ERR_print_errors_fp(stderr);
        fatal("Failed to configure SSL context");
    }

    if (SSL_CTX_use_PrivateKey_file(ctx->ssl_ctx, certfile,
                                     SSL_FILETYPE_PEM) <= 0) {
        sprintf(msg, "Unable to load private key file %s\n", certfile);
        fatal(msg);
    }

    if (SSL_CTX_use_certificate_file(ctx->ssl_ctx, certfile,
                                     SSL_FILETYPE_PEM) <= 0) {
        sprintf(msg, "Unable to load certificate file %s\n", certfile);
        fatal(msg);
    }

//    if (SSL_CTX_set_cipher_list(ctx->ssl_ctx, "DEFAULT") != 1) {
//        sprintf(msg, "Unable to set cipher\n");
//        fatal(msg);
//    }

    // Associate socket and ssl object
    ctx->ssl = SSL_new(ctx->ssl_ctx);
    SSL_set_fd(ctx->ssl, socket);

    ret = SSL_accept(ctx->ssl);
    if (ret < 0) {
        ERR_print_errors_fp(stderr);
        return NULL;
    }

    return ctx;
}

int ws_socket_free(ws_ctx_t *ctx) {
    if (ctx->ssl) {
        SSL_free(ctx->ssl);
        ctx->ssl = NULL;
    }
    if (ctx->ssl_ctx) {
        SSL_CTX_free(ctx->ssl_ctx);
        ctx->ssl_ctx = NULL;
    }
    if (ctx->sockfd) {
        close(ctx->sockfd);
        ctx->sockfd = 0;
    }
    free(ctx);
}

/* ------------------------------------------------------- */


int encode(u_char const *src, size_t srclength, char *target, size_t targsize) {
    int sz = 0, len = 0;
    target[sz++] = '\x00';
    if (client_settings.do_seq_num) {
        sz += sprintf(target+sz, "%d:", client_settings.seq_num);
        client_settings.seq_num++;
    }
    if (client_settings.do_b64encode) {
        len = __b64_ntop(src, srclength, target+sz, targsize-sz);
    } else {
        fatal("UTF-8 not yet implemented");
    }
    if (len < 0) {
        return len;
    }
    sz += len;
    target[sz++] = '\xff';
    return sz;
}

int decode(char *src, size_t srclength, u_char *target, size_t targsize) {
    char *start, *end;
    int len, retlen = 0;
    if ((src[0] != '\x00') || (src[srclength-1] != '\xff')) {
        fprintf(stderr, "WebSocket framing error\n");
        return -1;
    }
    start = src+1; // Skip '\x00' start
    do {
        /* We may have more than one frame */
        end = strchr(start, '\xff');
        if (end < (src+srclength-1)) {
            printf("More than one frame to decode\n");
        }
        *end = '\x00';
        if (client_settings.do_b64encode) {
            len = __b64_pton(start, target+retlen, targsize-retlen);
        } else {
            fatal("UTF-8 not yet implemented");
        }
        if (len < 0) {
            return len;
        }
        retlen += len;
        start = end + 2; // Skip '\xff' end and '\x00' start 
    } while (end < (src+srclength-1));
    return retlen;
}

ws_ctx_t *do_handshake(int sock) {
    char handshake[4096], response[4096];
    char *scheme, *line, *path, *host, *origin;
    char *args_start, *args_end, *arg_idx;
    int len;
    ws_ctx_t * ws_ctx;

    // Reset settings
    client_settings.do_b64encode = 0;
    client_settings.do_seq_num = 0;
    client_settings.seq_num = 0;

    len = recv(sock, handshake, 1024, MSG_PEEK);
    handshake[len] = 0;
    if (bcmp(handshake, "<policy-file-request/>", 22) == 0) {
        len = recv(sock, handshake, 1024, 0);
        handshake[len] = 0;
        printf("Sending flash policy response\n");
        send(sock, policy_response, sizeof(policy_response), 0);
        close(sock);
        return NULL;
    } else if (bcmp(handshake, "\x16", 1) == 0) {
        // SSL
        ws_ctx = ws_socket_ssl(sock, "self.pem");
        if (! ws_ctx) { return NULL; }
        scheme = "wss";
        printf("Using SSL socket\n");
    } else {
        ws_ctx = ws_socket(sock);
        if (! ws_ctx) { return NULL; }
        scheme = "ws";
        printf("Using plain (not SSL) socket\n");
    }
    len = ws_recv(ws_ctx, handshake, 4096);
    handshake[len] = 0;
    //printf("handshake: %s\n", handshake);
    if ((len < 92) || (bcmp(handshake, "GET ", 4) != 0)) {
        fprintf(stderr, "Invalid WS request\n");
        return NULL;
    }
    strtok(handshake, " ");      // Skip "GET "
    path = strtok(NULL, " ");    // Extract path
    strtok(NULL, "\n");          // Skip to Upgrade line
    strtok(NULL, "\n");          // Skip to Connection line
    strtok(NULL, "\n");          // Skip to Host line
    strtok(NULL, " ");           // Skip "Host: "
    host = strtok(NULL, "\r");   // Extract host
    strtok(NULL, " ");           // Skip "Origin: "
    origin = strtok(NULL, "\r"); // Extract origin

    //printf("path: %s\n", path);
    //printf("host: %s\n", host);
    //printf("origin: %s\n", origin);
    
    // TODO: parse out client settings
    args_start = strstr(path, "?");
    if (args_start) {
        if (strstr(args_start, "#")) {
            args_end = strstr(args_start, "#");
        } else {
            args_end = args_start + strlen(args_start);
        }
        arg_idx = strstr(args_start, "b64encode");
        if (arg_idx && arg_idx < args_end) {
            //printf("setting b64encode\n");
            client_settings.do_b64encode = 1;
        }
        arg_idx = strstr(args_start, "seq_num");
        if (arg_idx && arg_idx < args_end) {
            //printf("setting seq_num\n");
            client_settings.do_seq_num = 1;
        }
    }

    sprintf(response, server_handshake, origin, scheme, host, path);
    printf("response: %s\n", response);
    ws_send(ws_ctx, response, strlen(response));

    return ws_ctx;
}

void start_server(int listen_port,
                  void (*handler)(ws_ctx_t*)) {
    int lsock, csock, clilen, sopt = 1;
    struct sockaddr_in serv_addr, cli_addr;
    ws_ctx_t *ws_ctx;

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

    lsock = socket(AF_INET, SOCK_STREAM, 0);
    if (lsock < 0) { error("ERROR creating listener socket"); }
    bzero((char *) &serv_addr, sizeof(serv_addr));
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_addr.s_addr = INADDR_ANY;
    serv_addr.sin_port = htons(listen_port);
    setsockopt(lsock, SOL_SOCKET, SO_REUSEADDR, (char *)&sopt, sizeof(sopt));
    if (bind(lsock, (struct sockaddr *) &serv_addr, sizeof(serv_addr)) < 0) {
        error("ERROR on binding listener socket");
    }
    listen(lsock,100);

    while (1) {
        clilen = sizeof(cli_addr);
        printf("waiting for connection on port %d\n", listen_port);
        csock = accept(lsock, 
                       (struct sockaddr *) &cli_addr, 
                       &clilen);
        if (csock < 0) {
            error("ERROR on accept");
        }
        printf("Got client connection from %s\n", inet_ntoa(cli_addr.sin_addr));
        ws_ctx = do_handshake(csock);
        if (ws_ctx == NULL) {
            close(csock);
            continue;
        }

        /* Calculate dbufsize based on client_settings */
        if (client_settings.do_b64encode) {
            /* base64 is 4 bytes for every 3
             *    20 for WS '\x00' / '\xff', seq_num and good measure  */
            dbufsize = (bufsize * 3)/4 - 20;
        } else {
            fatal("UTF-8 not yet implemented");
            /* UTF-8 encoding is up to 2X larger */
            dbufsize = (bufsize/2) - 15;
        }

        handler(ws_ctx);
        close(csock);
    }

}

