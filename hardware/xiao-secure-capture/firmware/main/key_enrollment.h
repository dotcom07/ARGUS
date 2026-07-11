#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define ARGUS_DS_DATA_BLOB_MAX 2048
#define ARGUS_DS_SIGNATURE_MAX 512

typedef struct {
    uint8_t encrypted_ds_data[ARGUS_DS_DATA_BLOB_MAX];
    size_t encrypted_ds_data_len;
    uint32_t hmac_key_slot;
} argus_ds_key_material_t;

esp_err_t argus_ds_key_load(argus_ds_key_material_t *material);
esp_err_t argus_ds_sign_digest(
    const uint8_t digest[32],
    uint8_t *signature,
    size_t signature_capacity,
    size_t *signature_len
);
