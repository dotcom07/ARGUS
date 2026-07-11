#include "receipt.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#include "key_enrollment.h"
#include "mbedtls/base64.h"
#include "mbedtls/md.h"

static void hex_encode(const uint8_t *bytes, size_t length, char *output)
{
    static const char hex[] = "0123456789abcdef";
    for (size_t index = 0; index < length; index++) {
        output[index * 2] = hex[(bytes[index] >> 4) & 0xf];
        output[index * 2 + 1] = hex[bytes[index] & 0xf];
    }
    output[length * 2] = '\0';
}

static esp_err_t sha256_hex(const uint8_t *bytes, size_t length, char output[65])
{
    uint8_t digest[32];
    const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (sha256 == NULL || mbedtls_md(sha256, bytes, length, digest) != 0) {
        return ESP_FAIL;
    }
    hex_encode(digest, sizeof(digest), output);
    return ESP_OK;
}

esp_err_t argus_receipt_build(
    const argus_receipt_input_t *input,
    argus_receipt_result_t *result
)
{
    if (input == NULL || result == NULL || input->device_id == NULL ||
        input->nonce == NULL || input->image_bytes == NULL || input->image_len == 0 ||
        input->firmware_version == NULL || input->firmware_build == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(result, 0, sizeof(*result));
    esp_err_t err = sha256_hex(input->image_bytes, input->image_len, result->image_sha256);
    if (err != ESP_OK) {
        return err;
    }

    char canonical[2048];
    const int written = snprintf(
        canonical,
        sizeof(canonical),
        "argus.xiao.capture.receipt.v1|%s|%s|%" PRIu64 "|%" PRIu64 "|%s|%s|%s",
        input->device_id,
        input->nonce,
        input->capture_counter,
        input->captured_at_ms,
        result->image_sha256,
        input->firmware_version,
        input->firmware_build
    );
    if (written < 0 || (size_t)written >= sizeof(canonical)) {
        return ESP_ERR_INVALID_SIZE;
    }
    return sha256_hex((const uint8_t *)canonical, (size_t)written, result->receipt_digest);
}

esp_err_t argus_receipt_sign(argus_receipt_result_t *result)
{
    if (result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t digest[32];
    for (size_t index = 0; index < sizeof(digest); index++) {
        const char high = result->receipt_digest[index * 2];
        const char low = result->receipt_digest[index * 2 + 1];
        const uint8_t high_value = (uint8_t)(high <= '9' ? high - '0' : high - 'a' + 10);
        const uint8_t low_value = (uint8_t)(low <= '9' ? low - '0' : low - 'a' + 10);
        digest[index] = (uint8_t)((high_value << 4) | low_value);
    }

    uint8_t signature[ARGUS_DS_SIGNATURE_MAX];
    size_t signature_len = 0;
    const esp_err_t err = argus_ds_sign_digest(
        digest,
        signature,
        sizeof(signature),
        &signature_len
    );
    if (err == ESP_ERR_NOT_SUPPORTED) {
        strcpy(result->signature_algorithm, "none");
        strcpy(result->security_level, "unsigned_dev_only");
        result->signature_len = 0;
        result->signature_base64[0] = '\0';
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    size_t encoded_len = 0;
    if (mbedtls_base64_encode(
            (unsigned char *)result->signature_base64,
            sizeof(result->signature_base64),
            &encoded_len,
            signature,
            signature_len) != 0) {
        return ESP_ERR_INVALID_SIZE;
    }
    result->signature_base64[encoded_len] = '\0';
    strcpy(result->signature_algorithm, "esp32s3-rsa-ds-raw-v1");
    strcpy(result->security_level, "hardware_ds_non_exportable");
    result->signature_len = signature_len;
    return ESP_OK;
}

esp_err_t argus_receipt_json(
    const argus_receipt_input_t *input,
    const argus_receipt_result_t *result,
    char *output,
    size_t capacity
)
{
    if (input == NULL || result == NULL || output == NULL || capacity == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    const int written = snprintf(
        output,
        capacity,
        "{\"schema\":\"argus.xiao.capture.receipt.v1\","
        "\"deviceId\":\"%s\",\"nonce\":\"%s\","
        "\"imageSha256\":\"%s\",\"receiptDigest\":\"%s\","
        "\"captureCounter\":%" PRIu64 ",\"capturedAtMs\":%" PRIu64 ","
        "\"firmwareVersion\":\"%s\",\"firmwareBuild\":\"%s\","
        "\"signatureAlgorithm\":\"%s\",\"signatureBase64\":\"%s\","
        "\"securityLevel\":\"%s\"}",
        input->device_id,
        input->nonce,
        result->image_sha256,
        result->receipt_digest,
        input->capture_counter,
        input->captured_at_ms,
        input->firmware_version,
        input->firmware_build,
        result->signature_algorithm,
        result->signature_base64,
        result->security_level
    );
    if (written < 0 || (size_t)written >= capacity) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}
