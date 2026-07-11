#include "key_enrollment.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "sdkconfig.h"

#ifndef CONFIG_ARGUS_DS_PRODUCTION
#define CONFIG_ARGUS_DS_PRODUCTION 0
#endif

#if CONFIG_ARGUS_DS_PRODUCTION
#include "esp_ds.h"
#include "esp_heap_caps.h"
#include "esp_hmac.h"
#endif

static const char *TAG = "argus.keys";
#if CONFIG_ARGUS_DS_PRODUCTION
static const char *NVS_NAMESPACE = "argus_keys";
#endif

#if CONFIG_ARGUS_DS_PRODUCTION
static argus_ds_key_material_t s_material;
static bool s_material_loaded;
#endif

esp_err_t argus_ds_key_load(argus_ds_key_material_t *material)
{
    if (material == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

#if !CONFIG_ARGUS_DS_PRODUCTION
    ESP_LOGW(TAG, "DS key enrollment is disabled; no private key is available");
    return ESP_ERR_NOT_SUPPORTED;
#else
    nvs_handle_t nvs;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        return err;
    }

    uint32_t key_slot = 0;
    size_t blob_len = sizeof(material->encrypted_ds_data);
    err = nvs_get_blob(nvs, "ds_data", material->encrypted_ds_data, &blob_len);
    if (err == ESP_OK) {
        err = nvs_get_u32(nvs, "hmac_key_slot", &key_slot);
    }
    nvs_close(nvs);

    if (err != ESP_OK || blob_len == 0 || key_slot > 5) {
        ESP_LOGE(TAG, "DS enrollment record is missing or invalid");
        return ESP_ERR_INVALID_STATE;
    }

    material->encrypted_ds_data_len = blob_len;
    material->hmac_key_slot = key_slot;
    s_material = *material;
    s_material_loaded = true;
    ESP_LOGI(TAG, "DS encrypted parameters loaded; private key never enters software");
    return ESP_OK;
#endif
}

esp_err_t argus_ds_sign_digest(
    const uint8_t digest[32],
    uint8_t *signature,
    size_t signature_capacity,
    size_t *signature_len
)
{
    if (digest == NULL || signature == NULL || signature_len == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

#if !CONFIG_ARGUS_DS_PRODUCTION
    (void)signature_capacity;
    *signature_len = 0;
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (!s_material_loaded) {
        return ESP_ERR_INVALID_STATE;
    }

    const esp_ds_data_t *ds_data = (const esp_ds_data_t *)s_material.encrypted_ds_data;
    const size_t rsa_bytes = (size_t)(ds_data->rsa_length + 1U) * 4U;
    if (rsa_bytes > ARGUS_DS_SIGNATURE_MAX || rsa_bytes > signature_capacity || rsa_bytes < 32U) {
        return ESP_ERR_INVALID_SIZE;
    }

    uint8_t *message = heap_caps_calloc(1, rsa_bytes, MALLOC_CAP_INTERNAL);
    if (message == NULL) {
        return ESP_ERR_NO_MEM;
    }
    memcpy(message + rsa_bytes - 32U, digest, 32U);

    const esp_err_t err = esp_ds_sign(
        message,
        ds_data,
        (hmac_key_id_t)s_material.hmac_key_slot,
        signature
    );
    free(message);

    if (err == ESP_OK) {
        *signature_len = rsa_bytes;
    }
    return err;
#endif
}
