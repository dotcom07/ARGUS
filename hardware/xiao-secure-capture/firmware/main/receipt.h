#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define ARGUS_RECEIPT_JSON_MAX 4096

typedef struct {
    const char *device_id;
    const char *nonce;
    uint64_t capture_counter;
    uint64_t captured_at_ms;
    const uint8_t *image_bytes;
    size_t image_len;
    const char *firmware_version;
    const char *firmware_build;
} argus_receipt_input_t;

typedef struct {
    char image_sha256[65];
    char receipt_digest[65];
    char signature_base64[1024];
    char signature_algorithm[48];
    char security_level[48];
    size_t signature_len;
} argus_receipt_result_t;

esp_err_t argus_receipt_build(
    const argus_receipt_input_t *input,
    argus_receipt_result_t *result
);
esp_err_t argus_receipt_sign(argus_receipt_result_t *result);
esp_err_t argus_receipt_json(
    const argus_receipt_input_t *input,
    const argus_receipt_result_t *result,
    char *output,
    size_t capacity
);
