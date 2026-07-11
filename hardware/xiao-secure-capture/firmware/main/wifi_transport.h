#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

esp_err_t argus_wifi_start(void);
bool argus_wifi_ready(void);
int64_t argus_capture_timestamp_ms(void);
esp_err_t argus_wifi_upload_capture(
    const uint8_t *image_bytes,
    size_t image_len,
    const char *server_nonce,
    const char *receipt_json,
    const char *capture_session_id
);
