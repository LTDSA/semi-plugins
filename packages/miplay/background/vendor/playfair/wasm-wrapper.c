/* SPDX-License-Identifier: GPL-3.0-only
 * Semi's fixed-size WASM boundary. No account, network, filesystem or logging API.
 */
#include <stdint.h>
#include "playfair.h"
static unsigned char message[164], wrapped[72], output[16];
uint32_t key_message_buffer(void) { return (uint32_t)(uintptr_t)message; }
uint32_t wrapped_key_buffer(void) { return (uint32_t)(uintptr_t)wrapped; }
uint32_t plain_key_buffer(void) { return (uint32_t)(uintptr_t)output; }
int unwrap_key(void) {
    if (message[12] > 3) return -1;
    playfair_decrypt(message, wrapped, output);
    return 0;
}
void wipe_key_buffers(void) {
    volatile unsigned char *p = message;
    for (unsigned i = 0; i < sizeof(message); i++) p[i] = 0;
    p = wrapped;
    for (unsigned i = 0; i < sizeof(wrapped); i++) p[i] = 0;
    p = output;
    for (unsigned i = 0; i < sizeof(output); i++) p[i] = 0;
}
