#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "driver/temperature_sensor.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_camera.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "receipt.h"
#include "wifi_transport.h"

static const char *TAG = "argus.capture";
static const char *DEVICE_ID = CONFIG_ARGUS_DEVICE_ID;
static const char *FIRMWARE_VERSION = "0.1.0";
static const char *FIRMWARE_BUILD = "local-idf";

#define THERMAL_HOT_BIT BIT0
#define THERMAL_CRITICAL_BIT BIT1
// Thermal sampling is intentionally slower than the capture loop so the guard adds negligible work.
#define THERMAL_SAMPLE_PERIOD_MS 30000
#define THERMAL_WARN_C 70.0f
#define THERMAL_CRITICAL_C 78.0f

typedef struct {
    char nonce[96];
    char capture_session_id[128];
} capture_command_t;

static QueueHandle_t s_capture_queue;
static EventGroupHandle_t s_thermal_events;
static uint64_t s_capture_counter;

static camera_config_t camera_config(void)
{
    return (camera_config_t) {
        .pin_pwdn = -1,
        .pin_reset = -1,
        .pin_xclk = 10,
        .pin_sscb_sda = 40,
        .pin_sscb_scl = 39,
        .pin_d7 = 48,
        .pin_d6 = 11,
        .pin_d5 = 12,
        .pin_d4 = 14,
        .pin_d3 = 16,
        .pin_d2 = 18,
        .pin_d1 = 17,
        .pin_d0 = 15,
        .pin_vsync = 38,
        .pin_href = 47,
        .pin_pclk = 13,
        .xclk_freq_hz = 20 * 1000 * 1000,
        .ledc_timer = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG,
        .frame_size = FRAMESIZE_VGA,
        .jpeg_quality = 12,
        .fb_count = 1,
        .fb_location = CAMERA_FB_IN_PSRAM,
        .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
    };
}

static esp_err_t camera_start(void)
{
    camera_config_t config = camera_config();
    const esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "camera init failed: %s", esp_err_to_name(err));
        return err;
    }
    ESP_LOGI(TAG, "camera ready; single-frame mode");
    return ESP_OK;
}

static bool frame_looks_like_jpeg(const camera_fb_t *frame)
{
    return frame != NULL && frame->len >= 4 &&
        frame->buf[0] == 0xff && frame->buf[1] == 0xd8 &&
        frame->buf[frame->len - 2] == 0xff &&
        frame->buf[frame->len - 1] == 0xd9;
}

static bool is_lower_hex_nonce(const char *value)
{
    if (value == NULL || strlen(value) != 64) {
        return false;
    }
    for (size_t index = 0; index < 64; index++) {
        const char character = value[index];
        if (!((character >= '0' && character <= '9') ||
              (character >= 'a' && character <= 'f'))) {
            return false;
        }
    }
    return true;
}

static bool is_capture_session_token(const char *value)
{
    if (value == NULL || value[0] == '\0' || strlen(value) >= 128) {
        return false;
    }
    for (size_t index = 0; value[index] != '\0'; index++) {
        const char character = value[index];
        if (!((character >= 'a' && character <= 'z') ||
              (character >= 'A' && character <= 'Z') ||
              (character >= '0' && character <= '9') ||
              character == '-' || character == '_' || character == '.' ||
              character == ':')) {
            return false;
        }
    }
    return true;
}

static void thermal_task(void *argument)
{
    (void)argument;
    temperature_sensor_handle_t sensor = NULL;
    const temperature_sensor_config_t config =
        TEMPERATURE_SENSOR_CONFIG_DEFAULT(-10, 80);
    if (temperature_sensor_install(&config, &sensor) != ESP_OK ||
        temperature_sensor_enable(sensor) != ESP_OK) {
        ESP_LOGW(TAG, "internal temperature sensor unavailable");
        vTaskDelete(NULL);
        return;
    }

    while (true) {
        float temperature_c = 0.0f;
        const esp_err_t err = temperature_sensor_get_celsius(sensor, &temperature_c);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "THERMAL temp_c=%.2f warn_c=%.2f critical_c=%.2f",
                temperature_c, THERMAL_WARN_C, THERMAL_CRITICAL_C);
            if (temperature_c >= THERMAL_CRITICAL_C) {
                xEventGroupSetBits(s_thermal_events, THERMAL_HOT_BIT | THERMAL_CRITICAL_BIT);
                ESP_LOGW(TAG, "THERMAL capture paused: critical temperature");
            } else if (temperature_c >= THERMAL_WARN_C) {
                xEventGroupSetBits(s_thermal_events, THERMAL_HOT_BIT);
                xEventGroupClearBits(s_thermal_events, THERMAL_CRITICAL_BIT);
                ESP_LOGW(TAG, "THERMAL capture rate limited: high temperature");
            } else {
                xEventGroupClearBits(s_thermal_events, THERMAL_HOT_BIT | THERMAL_CRITICAL_BIT);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(THERMAL_SAMPLE_PERIOD_MS));
    }
}

static void capture_task(void *argument)
{
    (void)argument;
    capture_command_t command;
    // Keep the largest serialized object out of the FreeRTOS task stack.
    static char receipt_json[ARGUS_RECEIPT_JSON_MAX];

    while (xQueueReceive(s_capture_queue, &command, portMAX_DELAY) == pdTRUE) {
        const EventBits_t thermal = xEventGroupGetBits(s_thermal_events);
        if ((thermal & THERMAL_CRITICAL_BIT) != 0) {
            ESP_LOGW(TAG, "capture skipped; wait for thermal recovery");
            continue;
        }
        if ((thermal & THERMAL_HOT_BIT) != 0) {
            ESP_LOGW(TAG, "capture delayed by thermal guard");
            vTaskDelay(pdMS_TO_TICKS(1500));
        }

        const int64_t captured_at_ms = argus_capture_timestamp_ms();
        camera_fb_t *frame = esp_camera_fb_get();
        if (!frame_looks_like_jpeg(frame)) {
            ESP_LOGE(TAG, "capture failed or JPEG byte policy failed");
            if (frame != NULL) {
                esp_camera_fb_return(frame);
            }
            continue;
        }

        argus_receipt_input_t input = {
            .device_id = DEVICE_ID,
            .nonce = command.nonce,
            .capture_counter = ++s_capture_counter,
            .captured_at_ms = (uint64_t)captured_at_ms,
            .image_bytes = frame->buf,
            .image_len = frame->len,
            .firmware_version = FIRMWARE_VERSION,
            .firmware_build = FIRMWARE_BUILD,
        };
        argus_receipt_result_t result;
        esp_err_t err = argus_receipt_build(&input, &result);
        if (err == ESP_OK) {
            err = argus_receipt_sign(&result);
        }
        if (err == ESP_OK) {
            err = argus_receipt_json(&input, &result, receipt_json, sizeof(receipt_json));
        }
        if (err == ESP_OK) {
            printf("ARGUS_RECEIPT %s\n", receipt_json);
            ESP_LOGI(TAG, "capture complete bytes=%u counter=%llu security=%s",
                (unsigned)frame->len,
                (unsigned long long)input.capture_counter,
                result.security_level);
            ESP_LOGI(TAG, "capture task stack_free_words=%u",
                (unsigned)uxTaskGetStackHighWaterMark(NULL));
            if (argus_wifi_ready() && command.capture_session_id[0] != '\0') {
                const esp_err_t upload_err = argus_wifi_upload_capture(
                    frame->buf,
                    frame->len,
                    command.nonce,
                    receipt_json,
                    command.capture_session_id
                );
                if (upload_err != ESP_OK) {
                    ESP_LOGW(TAG, "Wi-Fi upload failed: %s", esp_err_to_name(upload_err));
                }
            }
        } else {
            ESP_LOGE(TAG, "receipt failed: %s", esp_err_to_name(err));
        }
        esp_camera_fb_return(frame);
    }
}

static void command_task(void *argument)
{
    (void)argument;
    char line[256];
    capture_command_t command;
    printf("ARGUS_READY Send: CAPTURE <server_nonce> [capture_session_id]\n");

    while (fgets(line, sizeof(line), stdin) != NULL) {
        if (strncmp(line, "CAPTURE ", 8) != 0) {
            printf("ARGUS_COMMAND_ERROR expected CAPTURE <server_nonce> [capture_session_id]\n");
            continue;
        }

        line[strcspn(line, "\r\n")] = '\0';
        char *save_pointer = NULL;
        char *nonce = strtok_r(line + 8, " \t", &save_pointer);
        char *capture_session_id = strtok_r(NULL, " \t", &save_pointer);
        char *unexpected = strtok_r(NULL, " \t", &save_pointer);
        if (!is_lower_hex_nonce(nonce)) {
            printf("ARGUS_COMMAND_ERROR nonce must be 64 lowercase hex characters\n");
            continue;
        }
        if (capture_session_id != NULL && !is_capture_session_token(capture_session_id)) {
            printf("ARGUS_COMMAND_ERROR capture_session_id is invalid\n");
            continue;
        }
        if (unexpected != NULL) {
            printf("ARGUS_COMMAND_ERROR too many command arguments\n");
            continue;
        }

        strcpy(command.nonce, nonce);
        if (capture_session_id == NULL) {
            command.capture_session_id[0] = '\0';
        } else {
            strcpy(command.capture_session_id, capture_session_id);
        }
        if (xQueueSend(s_capture_queue, &command, pdMS_TO_TICKS(100)) != pdTRUE) {
            printf("ARGUS_COMMAND_ERROR capture queue is full\n");
        }
    }
    vTaskDelete(NULL);
}

static esp_err_t console_start(void)
{
    usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    const esp_err_t err = usb_serial_jtag_driver_install(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "USB Serial/JTAG driver install failed: %s", esp_err_to_name(err));
        return err;
    }
    usb_serial_jtag_vfs_use_driver();
    return ESP_OK;
}

void app_main(void)
{
    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_err);
    ESP_ERROR_CHECK(camera_start());

    s_capture_queue = xQueueCreate(2, sizeof(capture_command_t));
    s_thermal_events = xEventGroupCreate();
    configASSERT(s_capture_queue != NULL && s_thermal_events != NULL);
    ESP_ERROR_CHECK(console_start());

    const esp_err_t wifi_err = argus_wifi_start();
    if (wifi_err == ESP_ERR_NOT_SUPPORTED) {
        ESP_LOGI(TAG, "Wi-Fi disabled; serial capture mode only");
    } else if (wifi_err != ESP_OK) {
        ESP_LOGW(TAG, "Wi-Fi unavailable; serial capture mode continues: %s",
            esp_err_to_name(wifi_err));
    }

    xTaskCreate(thermal_task, "thermal_task", 4096, NULL, 5, NULL);
    xTaskCreate(capture_task, "capture_task", 12288, NULL, 6, NULL);
    xTaskCreate(command_task, "command_task", 4096, NULL, 4, NULL);
    ESP_LOGI(TAG, "FreeRTOS capture pipeline started");
}
