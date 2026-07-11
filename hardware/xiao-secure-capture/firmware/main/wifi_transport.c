#include "wifi_transport.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

#include "esp_crt_bundle.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "mbedtls/base64.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAILED_BIT BIT1
#define WIFI_MAX_RETRIES 5
#define WIFI_CONNECT_TIMEOUT_MS 15000
#define SNTP_SYNC_TIMEOUT_MS 15000
#define UNIX_EPOCH_READY_SECONDS 1700000000

#if CONFIG_ARGUS_WIFI_ENABLED
static const char *TAG = "argus.wifi";
static EventGroupHandle_t s_wifi_events;
#endif
static bool s_wifi_ready;
static bool s_time_synced;
#if CONFIG_ARGUS_WIFI_ENABLED
static uint8_t s_retry_count;
#endif

#if CONFIG_ARGUS_WIFI_ENABLED
static void wifi_event_handler(
    void *argument,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data
)
{
    (void)argument;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_ready = false;
        if (s_retry_count < WIFI_MAX_RETRIES) {
            s_retry_count++;
            esp_wifi_connect();
            ESP_LOGW(TAG, "Wi-Fi disconnected; retry=%u", (unsigned)s_retry_count);
        } else {
            xEventGroupSetBits(s_wifi_events, WIFI_FAILED_BIT);
        }
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        s_retry_count = 0;
        s_wifi_ready = true;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
        ESP_LOGI(TAG, "WIFI_CONNECTED ip=" IPSTR, IP2STR(&event->ip_info.ip));
    }
}
#endif

esp_err_t argus_wifi_start(void)
{
#if !CONFIG_ARGUS_WIFI_ENABLED
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (CONFIG_ARGUS_WIFI_SSID[0] == '\0' || CONFIG_ARGUS_BACKEND_URL[0] == '\0') {
        ESP_LOGE(TAG, "Wi-Fi enabled but SSID or backend URL is empty");
        return ESP_ERR_INVALID_STATE;
    }

    if (strncmp(CONFIG_ARGUS_BACKEND_URL, "https://", 8) != 0 &&
        !CONFIG_ARGUS_ALLOW_INSECURE_HTTP) {
        ESP_LOGE(TAG, "backend URL must use HTTPS unless local HTTP is explicitly enabled");
        return ESP_ERR_INVALID_STATE;
    }

    s_wifi_events = xEventGroupCreate();
    if (s_wifi_events == NULL) {
        return ESP_ERR_NO_MEM;
    }

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "esp_netif_init failed");
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }
    if (esp_netif_create_default_wifi_sta() == NULL) {
        return ESP_ERR_NO_MEM;
    }

    wifi_init_config_t wifi_init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&wifi_init), TAG, "esp_wifi_init failed");
    ESP_RETURN_ON_ERROR(
        esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL),
        TAG,
        "Wi-Fi event registration failed"
    );
    ESP_RETURN_ON_ERROR(
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL),
        TAG,
        "IP event registration failed"
    );

    wifi_config_t config = {0};
    strlcpy((char *)config.sta.ssid, CONFIG_ARGUS_WIFI_SSID, sizeof(config.sta.ssid));
    strlcpy((char *)config.sta.password, CONFIG_ARGUS_WIFI_PASSWORD, sizeof(config.sta.password));
    config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM), TAG, "esp_wifi_set_storage failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "esp_wifi_set_mode failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &config), TAG, "esp_wifi_set_config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "esp_wifi_start failed");

    const EventBits_t bits = xEventGroupWaitBits(
        s_wifi_events,
        WIFI_CONNECTED_BIT | WIFI_FAILED_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(WIFI_CONNECT_TIMEOUT_MS)
    );
    if ((bits & WIFI_CONNECTED_BIT) == 0) {
        ESP_LOGE(TAG, "WIFI_CONNECT_FAILED");
        return ESP_ERR_TIMEOUT;
    }

    setenv("TZ", "UTC0", 1);
    tzset();
    esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    const int64_t deadline = esp_timer_get_time() / 1000 + SNTP_SYNC_TIMEOUT_MS;
    struct timeval now = {0};
    while (esp_timer_get_time() / 1000 < deadline) {
        gettimeofday(&now, NULL);
        if (now.tv_sec >= UNIX_EPOCH_READY_SECONDS) {
            s_time_synced = true;
            ESP_LOGI(TAG, "WIFI_TIME_SYNCED epoch_s=%ld", (long)now.tv_sec);
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(250));
    }

    ESP_LOGE(TAG, "WIFI_TIME_SYNC_FAILED");
    return ESP_ERR_TIMEOUT;
#endif
}

bool argus_wifi_ready(void)
{
    return s_wifi_ready && s_time_synced;
}

int64_t argus_capture_timestamp_ms(void)
{
    if (s_time_synced) {
        struct timeval now = {0};
        gettimeofday(&now, NULL);
        return ((int64_t)now.tv_sec * 1000) + (now.tv_usec / 1000);
    }
    return esp_timer_get_time() / 1000;
}

esp_err_t argus_wifi_upload_capture(
    const uint8_t *image_bytes,
    size_t image_len,
    const char *server_nonce,
    const char *receipt_json,
    const char *capture_session_id
)
{
#if !CONFIG_ARGUS_WIFI_ENABLED
    (void)image_bytes;
    (void)image_len;
    (void)server_nonce;
    (void)receipt_json;
    (void)capture_session_id;
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (!argus_wifi_ready() || server_nonce == NULL || receipt_json == NULL ||
        capture_session_id == NULL || capture_session_id[0] == '\0') {
        return ESP_ERR_NOT_SUPPORTED;
    }

    const size_t encoded_capacity = ((image_len + 2) / 3) * 4 + 1;
    const size_t body_capacity = encoded_capacity + strlen(receipt_json) + 1024;
    char *encoded = heap_caps_malloc(encoded_capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    char *body = heap_caps_malloc(body_capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (encoded == NULL || body == NULL) {
        free(encoded);
        free(body);
        return ESP_ERR_NO_MEM;
    }

    size_t encoded_length = 0;
    esp_err_t err = mbedtls_base64_encode(
        (unsigned char *)encoded,
        encoded_capacity,
        &encoded_length,
        image_bytes,
        image_len
    ) == 0 ? ESP_OK : ESP_ERR_INVALID_SIZE;
    if (err == ESP_OK) {
        encoded[encoded_length] = '\0';
        const int written = snprintf(
            body,
            body_capacity,
            "{\"deviceId\":\"%s\",\"captureSessionId\":\"%s\","
            "\"serverNonce\":\"%s\",\"partnerId\":\"%s\","
            "\"useCase\":\"%s\",\"appIdentityHash\":\"%s\","
            "\"photoBytesBase64\":\"%s\",\"receipt\":%s}",
            CONFIG_ARGUS_DEVICE_ID,
            capture_session_id,
            server_nonce,
            CONFIG_ARGUS_PARTNER_ID,
            CONFIG_ARGUS_USE_CASE,
            CONFIG_ARGUS_APP_IDENTITY_HASH,
            encoded,
            receipt_json
        );
        if (written < 0 || (size_t)written >= body_capacity) {
            err = ESP_ERR_INVALID_SIZE;
        } else {
            esp_http_client_config_t config = {
                .url = CONFIG_ARGUS_BACKEND_URL,
                .method = HTTP_METHOD_POST,
                .timeout_ms = 15000,
                .buffer_size = 1024,
                .buffer_size_tx = 1024,
                .crt_bundle_attach = esp_crt_bundle_attach,
            };
            esp_http_client_handle_t client = esp_http_client_init(&config);
            if (client == NULL) {
                err = ESP_ERR_NO_MEM;
            } else {
                esp_http_client_set_header(client, "content-type", "application/json");
                if (CONFIG_ARGUS_API_AUTH_TOKEN[0] != '\0') {
                    char authorization[256];
                    snprintf(authorization, sizeof(authorization), "Bearer %s", CONFIG_ARGUS_API_AUTH_TOKEN);
                    esp_http_client_set_header(client, "authorization", authorization);
                }
                esp_http_client_set_post_field(client, body, written);
                err = esp_http_client_perform(client);
                const int status = esp_http_client_get_status_code(client);
                ESP_LOGI(TAG, "WIFI_UPLOAD status=%d bytes=%u", status, (unsigned)image_len);
                if (err == ESP_OK && (status < 200 || status >= 300)) {
                    err = ESP_FAIL;
                }
                esp_http_client_cleanup(client);
            }
        }
    }

    free(encoded);
    free(body);
    return err;
#endif
}
