idf_component_register(
    SRCS "app_main.c" "receipt.c" "key_enrollment.c" "wifi_transport.c"
    INCLUDE_DIRS "."
    REQUIRES esp32-camera nvs_flash driver esp_driver_tsens esp_driver_ledc esp_driver_usb_serial_jtag esp_event esp_http_client esp_netif esp_timer esp-tls esp_wifi mbedtls
    PRIV_REQUIRES esp_security
)
