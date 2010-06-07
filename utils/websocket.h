#include <openssl/ssl.h>

typedef struct {
    int      sockfd;
    SSL_CTX *ssl_ctx;
    SSL     *ssl;
} ws_ctx_t;

typedef struct {
    int do_b64encode;
    int do_seq_num;
    int seq_num;
} client_settings_t;


ssize_t ws_recv(ws_ctx_t *ctx, void *buf, size_t len);

ssize_t ws_send(ws_ctx_t *ctx, const void *buf, size_t len);

/* base64.c declarations */
//int b64_ntop(u_char const *src, size_t srclength, char *target, size_t targsize);
//int b64_pton(char const *src, u_char *target, size_t targsize);

