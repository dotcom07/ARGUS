# 처음 하는 사람을 위한 XIAO Secure Capture 가이드

이 문서는 Seeed Studio XIAO ESP32-S3 Sense로 `MCU 펌웨어 + RTOS + 카메라 + 서명 + trace 분석` 경험을 만들기 위한 입문 가이드입니다.

목표는 단순히 카메라 예제를 실행하는 것이 아닙니다. 최종 목표는 아래 claim을 작고 검증 가능한 펌웨어 프로젝트로 구현하는 것입니다.

```text
ESP32-S3 펌웨어가 서버 nonce를 받고,
온보드 카메라로 JPEG 바이트를 캡처하고,
그 정확한 JPEG 바이트의 SHA-256을 계산하고,
nonce + imageHash + captureCounter + firmwareVersion + deviceId를 서명한 뒤,
trace log와 함께 host/backend에서 자동 검증한다.
```

이 claim은 "현실 장면이 진짜임을 증명한다"가 아닙니다. 더 정확히는 "특정 MCU 펌웨어 경로가 특정 사진 바이트를 캡처하고 서명했다"입니다. 이 표현이 Argus의 trust model과도 잘 맞고, 면접에서 방어하기도 좋습니다.

## 먼저 이해할 그림

```text
XIAO ESP32-S3 Sense
  camera sensor -> JPEG frame buffer -> SHA-256 -> signed receipt -> USB serial or Wi-Fi

Host / Backend
  nonce issue -> receive JPEG + receipt -> recompute image hash -> verify signature -> analyze trace
```

처음에는 Wi-Fi를 쓰지 않아도 됩니다. USB serial로 nonce를 보내고 receipt를 받아도 이미 MCU, firmware, RTOS, trace 분석 경험을 만들 수 있습니다. Wi-Fi 업로드는 2단계입니다.

## 이 보드로 가능한 것

XIAO ESP32-S3 Sense는 작은 보드지만 이 프로젝트에 필요한 핵심이 이미 들어 있습니다.

- ESP32-S3R8 dual-core MCU, 최대 240 MHz.
- 2.4 GHz Wi-Fi와 BLE 내장.
- 8 MB PSRAM, 8 MB flash.
- Sense 확장 보드의 카메라, 디지털 마이크, microSD 슬롯.
- USB-C로 flashing, serial monitor, host tool 연동 가능.
- ESP-IDF로 개발하면 FreeRTOS task, queue, event group, timer, watchdog을 사용할 수 있음.

처음 MVP는 납땜 없이 가능합니다. 외부 버튼, 센서, secure element, 모터를 추가할 때부터 납땜이나 배선이 필요해집니다.

## 보드 받으면 먼저 할 일

처음에는 코드를 쓰기보다 보드 상태를 확인하세요.

1. Sense 카메라 확장 보드가 XIAO 본체의 B2B 커넥터에 제대로 눌려 들어갔는지 확인합니다.
2. Wi-Fi/BLE 테스트 전에 동봉된 안테나를 연결합니다.
3. USB-C 케이블이 데이터 전송 가능한 케이블인지 확인합니다.
4. macOS에서 serial port가 보이는지 확인합니다.
5. reset button과 boot button 위치를 확인합니다.
6. 보드가 너무 뜨거워지는지 확인합니다. 장시간 streaming은 나중에 합니다.

Seeed 문서 기준으로 최신 XIAO ESP32-S3 Sense는 OV2640 대신 OV3660 카메라가 들어갈 수 있습니다. 판매 페이지가 OV2640이라고 써 있어도 실제 입고분은 다를 수 있습니다. 중요한 것은 Seeed가 camera wiki 예제가 OV2640, OV3660, OV5640에 적용된다고 안내한다는 점입니다. 그러니 코드에는 "무조건 OV2640"이라고 박아두지 말고, sensor detect log를 남기는 방향이 좋습니다.

## 개발 환경 선택

이 보드는 Arduino, MicroPython, ESP-IDF를 모두 시도할 수 있습니다. 하지만 이 프로젝트의 목적이 `펌웨어/RTOS/trace 분석/보안 서명` 경험이라면 최종 기준은 ESP-IDF입니다.

| 선택지 | 장점 | 이 프로젝트에서의 위치 |
| --- | --- | --- |
| Arduino | 예제 실행이 빠르고 진입장벽이 낮음 | 카메라가 살아있는지 확인하는 임시 smoke test에는 좋음 |
| MicroPython | REPL이 편하고 Python 사용자에게 친숙함 | 펌웨어/RTOS/C 경험 어필은 약함 |
| ESP-IDF | 공식 framework, FreeRTOS, component, menuconfig, 보안 기능 접근이 좋음 | 최종 프로젝트 기준 |

처음부터 ESP-IDF가 부담되면 Arduino 카메라 예제로 하드웨어만 확인하고, 실제 포트폴리오 코드는 ESP-IDF로 옮기면 됩니다.

처음 설치 후 확인할 것:

```bash
idf.py --version
idf.py set-target esp32s3
idf.py build
idf.py flash monitor
```

Mac에서 serial port는 보통 `/dev/cu.usbmodem*` 또는 `/dev/cu.usbserial*` 형태로 보입니다. 보드가 안 보이면 USB-C 케이블이 충전 전용인지 먼저 의심하세요.

ESP32-S3 보드가 flashing 모드로 잘 안 들어가면 보통 boot button을 누른 상태로 reset하거나 USB를 다시 연결하는 방식으로 bootloader mode에 들어갑니다. 정확한 버튼 sequence는 사용하는 tool과 보드 상태에 따라 달라질 수 있으니, 실패하면 serial monitor의 boot log를 먼저 남기세요.

## 용어부터 잡기

MCU는 작은 컴퓨터입니다. 노트북처럼 OS 위에서 앱을 실행하는 느낌이 아니라, 보드가 켜지면 우리가 만든 펌웨어가 거의 곧바로 하드웨어를 초기화하고 일을 시작합니다.

펌웨어는 MCU 안에서 돌아가는 프로그램입니다. 이 프로젝트에서는 C 또는 C++로 작성하고, 카메라 드라이버, 메모리, task, 통신, 보안 코드를 직접 다룹니다.

RTOS는 Real-Time Operating System입니다. 일반 OS처럼 파일 탐색기나 브라우저를 제공하는 것이 아니라, 작은 embedded 프로그램을 여러 task로 나누어 정해진 우선순위와 timing에 맞게 실행하게 해주는 kernel입니다.

ESP-IDF는 Espressif의 공식 개발 프레임워크입니다. ESP32-S3에서 ESP-IDF를 쓰면 FreeRTOS가 기본으로 포함됩니다. `app_main()`이 시작점이고, 여기서 task와 queue를 만들게 됩니다.

PSRAM은 외부 RAM입니다. 카메라 JPEG frame buffer처럼 큰 데이터를 다룰 때 중요합니다. XIAO ESP32-S3 Sense는 8 MB PSRAM을 가지고 있고, ESP-IDF 설정에서 Octal PSRAM으로 켜야 합니다.

Frame buffer는 카메라가 캡처한 이미지 바이트가 들어 있는 메모리 덩어리입니다. `esp_camera_fb_get()`으로 받고, 다 쓴 뒤에는 반드시 `esp_camera_fb_return(fb)`로 돌려줘야 합니다.

Hash는 데이터의 fingerprint입니다. SHA-256은 JPEG 바이트가 1바이트라도 바뀌면 완전히 다른 값이 나옵니다.

Signature는 "이 device key를 가진 쪽이 이 payload에 동의했다"는 검증 가능한 증거입니다. MVP에서는 software development key로 시작하고, 나중에 ESP32-S3 HMAC/eFuse/RSA_DS 같은 hardware-backed path를 실험합니다.

Trace log는 펌웨어가 내부 상태를 시간순으로 남기는 기록입니다. Sandisk 공고의 `automate FW trace analysis`를 겨냥하려면 trace format과 Python analyzer가 중요합니다.

## RTOS를 왜 쓰는가

카메라 캡처 프로젝트를 하나의 거대한 `while (true)`로 만들 수도 있습니다. 하지만 그렇게 하면 어떤 단계에서 느려졌는지, Wi-Fi와 카메라가 서로 방해하는지, hash나 signing이 어디서 실패했는지 보기 어렵습니다.

RTOS를 쓰면 일을 분리할 수 있습니다.

```text
control_task  nonce 명령을 받음
capture_task  카메라에서 JPEG frame buffer를 받음
hash_task     JPEG bytes의 SHA-256을 계산함
sign_task     receipt payload를 만들고 서명함
comm_task     USB serial 또는 Wi-Fi로 결과를 보냄
trace_task    structured trace log를 출력함
```

이 구조는 취업용으로도 좋습니다. "FreeRTOS를 써봤다"가 아니라 "카메라 캡처, 해시, 서명, 통신, trace를 task로 나누고 queue로 연결했다"라고 설명할 수 있기 때문입니다.

## RTOS 핵심 개념

Task는 독립적으로 실행되는 함수입니다. 보통 `for (;;)` 또는 `while (true)` 루프를 가지고 절대 그냥 return하지 않습니다.

Scheduler는 ready 상태인 task 중 어느 task를 실행할지 결정합니다. 우선순위가 높은 task가 먼저 실행될 수 있고, block된 task는 이벤트나 queue 메시지를 기다립니다.

Priority는 task의 중요도입니다. 너무 높은 priority의 task가 오래 CPU를 잡고 있으면 다른 task가 굶을 수 있습니다. 처음에는 priority를 적게 나누고, trace를 보고 조정하세요.

Stack은 각 task의 지역 변수와 call frame을 담는 메모리입니다. ESP-IDF의 FreeRTOS task stack size 단위는 vanilla FreeRTOS와 다를 수 있으므로 공식 문서를 확인해야 합니다.

Queue는 task 사이에 데이터를 전달하는 통로입니다. 예를 들어 `capture_task`는 "JPEG captured" 메시지를 `hash_task`에게 보냅니다. 큰 JPEG 전체를 queue에 복사하지 말고, pointer와 길이 같은 작은 descriptor를 넘기는 방향이 좋습니다.

Event group은 여러 상태 bit를 공유하는 방식입니다. 예를 들어 `WIFI_READY`, `NONCE_READY`, `CAPTURE_DONE`, `UPLOAD_DONE` 같은 bit를 둘 수 있습니다.

Semaphore는 자원 사용권을 표현합니다. Mutex는 공유 자원을 한 task만 쓰게 할 때 사용합니다. 예를 들어 serial 출력이나 shared counter를 보호할 수 있습니다.

Timer는 정해진 시간 뒤 또는 주기적으로 callback을 실행하는 장치입니다. 주기적인 health check나 capture timeout에 사용할 수 있습니다.

Watchdog은 task가 멈추거나 너무 오래 block되었을 때 문제를 감지하는 안전장치입니다. 카메라/네트워크 코드가 멈추는지 확인할 때 중요합니다.

Core affinity는 특정 task를 특정 CPU core에 묶는 것입니다. ESP32-S3는 dual-core입니다. 처음에는 core pinning을 과하게 쓰지 말고, 필요해지면 `capture/hash/sign` 쪽과 `Wi-Fi/comm` 쪽을 나누는 식으로 접근하세요.

## C 펌웨어 코드 읽는 법

C 코드가 처음이면 아래 순서로 보면 덜 무섭습니다.

`.h` 파일은 약속입니다. 다른 파일에서 사용할 type, constant, function prototype을 선언합니다.

```c
typedef struct {
    const uint8_t *bytes;
    size_t length;
} jpeg_view_t;

esp_err_t capture_take_frame(jpeg_view_t *out);
```

`.c` 파일은 구현입니다. 실제로 어떻게 동작하는지 들어 있습니다.

```c
esp_err_t capture_take_frame(jpeg_view_t *out) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb == NULL) {
        return ESP_FAIL;
    }
    out->bytes = fb->buf;
    out->length = fb->len;
    return ESP_OK;
}
```

`struct`는 관련 데이터를 묶는 상자입니다. RTOS queue에는 보통 struct message를 넣습니다.

Pointer는 "데이터 자체"가 아니라 "데이터가 있는 주소"입니다. JPEG처럼 큰 데이터는 queue에 복사하지 말고 pointer와 length를 전달해야 합니다.

`esp_err_t`는 ESP-IDF에서 자주 쓰는 성공/실패 코드입니다. `ESP_OK`가 아니면 trace event를 남기고 실패 경로를 명확히 해야 합니다.

Ownership은 누가 메모리를 책임지는지입니다. 카메라 frame buffer는 camera driver가 빌려준 메모리입니다. 해시와 서명이 끝나면 반드시 `esp_camera_fb_return(fb)`로 돌려줘야 합니다.

## 이 프로젝트의 추천 RTOS 구조

처음부터 복잡하게 만들지 마세요. 아래 순서로 키우는 것이 좋습니다.

1. Single task MVP: serial command를 받고 캡처, 해시, receipt 출력까지 한 task에서 처리.
2. Trace 추가: 각 단계마다 structured trace log 출력.
3. Queue 추가: capture, hash, sign을 별도 task로 분리.
4. Comm 분리: USB serial과 Wi-Fi upload를 분리.
5. Core 분리: 필요할 때만 capture/hash/sign을 한 core 쪽에, Wi-Fi/comm을 다른 core 쪽에 배치.

처음부터 멀티코어 최적화를 하지 않는 이유는 간단합니다. 카메라가 안 되는 문제인지, PSRAM 문제인지, queue 문제인지, core affinity 문제인지 동시에 터지면 디버깅이 어렵습니다.

## 파일 구조 읽는 법

현재 폴더는 의도적으로 SDK와 분리되어 있습니다.

```text
hardware/xiao-secure-capture/
  README.md
  docs/
  firmware/
  host-tools/
  backend/
```

나중에 펌웨어가 들어오면 이런 순서로 읽으세요.

1. `firmware/CMakeLists.txt`: ESP-IDF project가 어떤 component를 빌드하는지 봅니다.
2. `firmware/main/app_main.c`: 진짜 시작점입니다. 여기서 config, queue, task가 만들어집니다.
3. `firmware/components/board/`: XIAO 핀, 카메라 설정, 보드 전용 초기화가 들어갑니다.
4. `firmware/components/capture/`: 카메라 frame buffer를 얻고 반환하는 코드입니다.
5. `firmware/components/crypto/`: SHA-256, receipt payload, signing code가 들어갑니다.
6. `firmware/components/protocol/`: serial command, Wi-Fi upload, message framing이 들어갑니다.
7. `firmware/components/trace/`: trace event 이름과 log format이 들어갑니다.
8. `host-tools/`: Python으로 nonce를 보내고 receipt, JPEG, trace를 검증합니다.
9. `backend/`: Wi-Fi 단계에서 MCU가 호출할 nonce/capture API가 들어갑니다.

코드를 읽을 때는 함수 하나하나보다 데이터가 어디서 어디로 이동하는지 먼저 보세요.

```text
nonce -> capture request -> camera_fb_t -> imageSha256 -> receiptPayload -> signature -> upload/serial -> verifier
```

## ESP-IDF 코드에서 먼저 볼 것

`app_main()`을 먼저 봅니다. ESP-IDF는 여기서 시작합니다.

```c
void app_main(void) {
    // init NVS, board, camera, queues, tasks
}
```

그 다음 `xTaskCreate()`나 `xTaskCreatePinnedToCore()`를 찾습니다. 어떤 task가 있고 priority와 stack size가 얼마인지 보면 설계 의도가 보입니다.

```c
xTaskCreate(capture_task, "capture", 8192, NULL, 5, NULL);
```

Queue 생성도 중요합니다.

```c
QueueHandle_t capture_queue = xQueueCreate(4, sizeof(capture_request_t));
```

위 코드는 `capture_request_t` 크기의 메시지를 최대 4개 담는 queue를 만든다는 뜻입니다.

Error handling은 `esp_err_t`를 따라가면 됩니다.

```c
esp_err_t err = esp_camera_init(&config);
if (err != ESP_OK) {
    TRACE_ERROR("CAMERA_INIT_FAILED", err);
    return;
}
```

이런 코드는 "실패를 숨기지 않고 trace로 남긴다"는 점에서 firmware debug/validation 경험을 보여줍니다.

## 카메라 코드 보는 법

카메라 코드는 보통 세 부분으로 나뉩니다.

1. `camera_config_t` 채우기.
2. `esp_camera_init(&config)`로 초기화.
3. `esp_camera_fb_get()`으로 frame buffer 얻기.

중요 설정은 다음입니다.

```text
pixel_format  JPEG 권장. RGB/YUV는 메모리와 CPU 부담이 큼.
frame_size    처음에는 VGA/SVGA처럼 낮게 시작.
jpeg_quality  숫자가 낮을수록 고품질이고 파일이 커질 수 있음.
fb_count      처음에는 1 권장. 안정화 후 2 이상 검토.
fb_location   PSRAM 사용.
```

절대 잊지 말아야 하는 코드 흐름:

```c
camera_fb_t *fb = esp_camera_fb_get();
if (fb == NULL) {
    // trace failure
    return;
}

// hash fb->buf with fb->len

esp_camera_fb_return(fb);
```

`fb->buf`가 실제 JPEG bytes이고 `fb->len`이 길이입니다. 우리가 서명할 `imageSha256`은 이 정확한 byte range에서 계산해야 합니다.

Frame buffer ownership 규칙:

```text
capture_task가 fb를 받는다.
hash_task/sign_task가 fb->buf/fb->len을 읽는다.
모든 처리가 끝나면 capture_task 또는 owner가 esp_camera_fb_return(fb)를 호출한다.
fb 반환 후에는 fb->buf를 절대 읽지 않는다.
```

초기 구현에서는 ownership을 단순하게 하기 위해 `capture_task` 안에서 캡처, 해시, 서명까지 끝내고 `fb`를 반환하세요. 그 다음 queue 기반 분리를 하면서 `frame_owner` 규칙을 문서화하는 것이 안전합니다.

## 보안/서명 코드 보는 법

처음에는 세 단계를 구분하세요.

Hash는 이미지 바이트의 fingerprint입니다.

```text
imageSha256 = SHA256(jpegBytes)
```

Receipt payload는 서명할 의미 있는 데이터입니다.

```json
{
  "schema": "argus.xiao.capture.receipt.v1",
  "deviceId": "xiao-esp32s3-sense-001",
  "nonce": "...",
  "imageSha256": "...",
  "captureCounter": 1,
  "firmwareVersion": "0.1.0"
}
```

Signature는 receipt payload에 대한 device identity의 증거입니다.

```text
signature = Sign(devicePrivateKey, canonicalReceiptPayload)
```

MVP에서는 software development key를 써도 됩니다. 대신 문서에 "development key, not production hardware security"라고 명시해야 합니다.

Advanced path에서는 ESP32-S3의 HMAC/eFuse/RSA Digital Signature peripheral을 검토합니다. 이 경로는 private key material을 software가 직접 보지 못하게 하는 hardware-backed signing PoC에 가깝습니다. 하지만 eFuse는 되돌릴 수 없으므로 첫 번째 보드에서 바로 태우면 안 됩니다.

현실적인 보안 단계:

| 단계 | 구현 | 말할 수 있는 claim |
| --- | --- | --- |
| v0.1 | software development key | 펌웨어 data path와 receipt 검증을 구현했다 |
| v0.2 | flash encryption / secure boot 실험 | 임의 firmware나 flash 추출에 대한 방어 개념을 검토했다 |
| v0.3 | HMAC/eFuse 기반 challenge-response | eFuse secret 기반 HMAC으로 device authenticity를 실험했다 |
| v0.4 | RSA_DS 기반 signing PoC | private key material을 software가 직접 보지 않는 hardware-backed signing path를 검토했다 |
| 제품급 | provisioning, key lifecycle, secure manufacturing | 개인 프로젝트 범위를 넘어서는 production security |

HMAC은 대칭키 방식이라 backend도 같은 secret 또는 파생 검증 경로를 알아야 합니다. 공개키 검증이 필요한 receipt에는 ECDSA/RSA signature가 설명하기 쉽습니다. 그래서 MVP는 software ECDSA/RSA로 전체 검증 흐름을 만들고, advanced path에서 RSA_DS를 검토하는 순서가 좋습니다.

## Argus와 연결되는 지점

Argus Android 쪽은 이미 "앱이 사진 바이트와 evidence를 묶고, relayer가 검증하고, Solana registry에 commitment를 남기는" 구조입니다.

XIAO 프로젝트는 별도 MCU witness입니다. 나중에 Argus proof에 아래처럼 붙일 수 있습니다.

```json
{
  "hardwareWitness": {
    "deviceModel": "Seeed XIAO ESP32-S3 Sense",
    "receiptSchema": "argus.xiao.capture.receipt.v1",
    "nonce": "...",
    "imageSha256": "...",
    "captureCounter": 12,
    "firmwareVersion": "0.1.0",
    "signatureAlgorithm": "...",
    "signature": "...",
    "publicKeyId": "xiao-dev-001"
  }
}
```

중요한 점은 phone camera proof와 MCU camera proof가 반드시 같은 사진일 필요는 없다는 것입니다. 처음에는 MCU가 독립적으로 캡처한 JPEG와 receipt를 검증하는 프로젝트로 완성하고, 이후 Argus backend에 `hardwareWitness` evidence로 저장하는 순서가 안전합니다.

## Trace log 설계

Trace log는 "나중에 문제를 분석하기 위한 데이터"입니다. 그냥 `printf("done")`을 찍는 것이 아니라, script가 읽을 수 있게 구조화해야 합니다.

권장 형식:

```text
T=12345 LVL=INFO EVT=NONCE_RX nonce=ab12...
T=12400 LVL=INFO EVT=CAPTURE_START core=1 heap=151232 psram=7012344
T=12890 LVL=INFO EVT=CAPTURE_DONE bytes=84231 elapsed_ms=490
T=12920 LVL=INFO EVT=HASH_DONE sha256=...
T=12960 LVL=INFO EVT=SIGN_DONE counter=12
T=13100 LVL=INFO EVT=SERIAL_TX_DONE bytes=...
```

Python analyzer는 이런 질문에 답해야 합니다.

- nonce를 받은 뒤 capture가 시작되었는가?
- capture, hash, sign, transmit 순서가 맞는가?
- JPEG hash가 receipt의 `imageSha256`과 같은가?
- signature가 검증되는가?
- capture latency가 너무 길어지지 않았는가?
- heap/PSRAM이 반복 capture 후 계속 줄어드는가?
- 실패 이벤트가 있다면 root cause 후보는 무엇인가?

이 부분이 Sandisk 공고의 `automate FW trace analysis`와 가장 직접적으로 연결됩니다.

Analyzer 출력 예시:

```text
PASS capture_id=12
image_hash_match=true
signature_valid=true
event_order=NONCE_RX>CAPTURE_START>CAPTURE_DONE>HASH_DONE>SIGN_DONE>SERIAL_TX_DONE
capture_latency_ms=490
min_heap=151232
min_psram=7012344
root_cause=none
```

실패 분류 예시:

```text
FAIL root_cause=CAMERA_INIT_FAILED hint="check B2B connector, camera pins, PSRAM mode"
FAIL root_cause=HASH_MISMATCH hint="host did not verify the exact JPEG bytes emitted by firmware"
FAIL root_cause=COUNTER_ROLLBACK hint="captureCounter is not monotonic"
FAIL root_cause=SIGNATURE_INVALID hint="receipt payload canonicalization or key mismatch"
FAIL root_cause=UPLOAD_FAILED hint="check antenna, Wi-Fi credentials, backend URL"
```

## 처음 개발 순서

### 0단계: 문서와 목표 고정

먼저 이 문서, `xiao-esp32s3-sense-notes.md`, README를 읽고 목표 claim을 고정합니다.

성공 기준:

```text
보드 없이도 project layout, RTOS task plan, receipt format, trace format을 설명할 수 있다.
```

### 1단계: ESP-IDF bring-up

할 일:

```bash
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py flash monitor
```

설정:

```text
Flash size: 8 MB
PSRAM: enabled
PSRAM mode: Octal
PSRAM clock: 80 MHz
```

성공 기준:

```text
serial monitor에 app version, chip info, free heap, free psram이 출력된다.
```

### 2단계: 단일 frame capture

할 일:

```text
camera init
esp_camera_fb_get()
JPEG length 출력
first/last bytes 출력
esp_camera_fb_return()
```

성공 기준:

```text
반복 실행해도 camera capture가 실패하지 않고, heap/PSRAM이 계속 줄지 않는다.
```

### 3단계: SHA-256

할 일:

```text
fb->buf/fb->len에 대해 SHA-256 계산
serial로 imageSha256 출력
host Python이 같은 JPEG bytes로 hash 재계산
```

성공 기준:

```text
firmware hash와 host hash가 일치한다.
```

### 4단계: software-signed receipt

할 일:

```text
nonce 입력
captureCounter 증가
receipt JSON 생성
development key로 서명
host Python이 signature 검증
```

성공 기준:

```text
nonce, imageSha256, counter, firmwareVersion을 바꾸면 signature 검증이 실패한다.
```

### 5단계: RTOS pipeline

할 일:

```text
control_task
capture_task
hash_task
sign_task
comm_task
trace_task
```

성공 기준:

```text
각 task가 queue/event로 연결되고, trace analyzer가 정상 순서를 PASS로 판정한다.
```

### 6단계: Wi-Fi backend upload

할 일:

```text
GET /nonce
POST /captures with JPEG binary + receipt JSON
backend recomputes image hash
backend verifies signature
```

성공 기준:

```text
MCU가 Wi-Fi로 capture receipt를 업로드하고 backend가 PASS/FAIL을 저장한다.
```

### 7단계: hardware-backed security experiment

할 일:

```text
Secure Boot / Flash Encryption 조사
HMAC/eFuse/RSA_DS signing PoC 조사
두 번째 보드 또는 복구 계획 확보 후 eFuse 실험
```

성공 기준:

```text
무엇을 hardware-backed라고 부를 수 있고, 무엇을 production security라고 부르면 안 되는지 문서화한다.
```

## Wi-Fi 전송 설계

Wi-Fi 단계는 아래처럼 단순하게 시작하세요.

```text
GET /nonce
  response: { "nonce": "...", "expiresAtMs": ... }

POST /captures
  multipart/form-data:
    image: raw JPEG binary
    receipt: JSON string
```

피해야 할 방식:

```text
JSON 안에 JPEG 전체를 base64로 넣기
```

base64는 크기가 커지고 MCU 메모리 사용이 불편해집니다. 가능한 한 JPEG는 binary part로 보내고, receipt만 JSON으로 보내세요.

처음에는 HTTPS가 아니라 로컬 HTTP로 시작해도 됩니다. TLS는 메모리와 인증서 처리가 추가되므로 capture/hash/sign/trace가 안정된 뒤 붙이는 것이 좋습니다.

## 디버깅 루틴

문제가 생기면 순서를 지켜서 좁혀가세요.

1. 전원/USB: serial port가 보이는가?
2. boot log: chip이 ESP32-S3로 인식되는가?
3. flash/PSRAM: 8 MB flash, Octal PSRAM이 맞는가?
4. camera board: B2B connector가 제대로 체결되었는가?
5. antenna: Wi-Fi 테스트 전에 안테나가 연결되었는가?
6. camera init: pin mapping과 sensor model assumptions가 맞는가?
7. frame buffer: `fb`가 NULL인가? `fb->len`이 비정상인가?
8. memory: 반복 capture 후 heap/PSRAM이 줄어드는가?
9. task: queue receive/send timeout이 있는가?
10. host verify: firmware가 보낸 JPEG와 host가 hash한 JPEG가 같은 파일인가?

## 좋은 코드 습관

처음부터 멋진 abstraction을 만들지 마세요. 이 프로젝트에서 가장 중요한 것은 trace 가능한 data path입니다.

좋은 습관:

- error를 삼키지 말고 trace event로 남기기.
- JPEG bytes를 복사하지 않고 가능한 한 pointer/length로 다루기.
- frame buffer를 반드시 반환하기.
- queue에 큰 데이터를 직접 넣지 않기.
- task stack size와 high-water mark를 확인하기.
- security claim을 과장하지 않기.
- MVP signing key와 hardware-backed signing을 문서에서 명확히 분리하기.

피할 것:

- 처음부터 continuous streaming 구현.
- 처음부터 high-resolution/high-quality JPEG.
- Wi-Fi, camera, SD, signing, backend를 한 번에 붙이기.
- eFuse를 첫날 바로 태우기.
- "camera sensor attestation"처럼 실제로 증명하지 못하는 표현 쓰기.

## 문서화 산출물

코드만 있으면 펌웨어 경험이 잘 드러나지 않습니다. 아래 문서를 같이 남기면 project documentation 우대사항에도 맞습니다.

```text
docs/architecture.md       전체 흐름, task graph, data path
docs/rtos-design.md        task, queue, priority, stack, core affinity 이유
docs/receipt-format.md     signed receipt schema와 canonicalization 규칙
docs/trace-format.md       trace event 목록과 analyzer 규칙
docs/security-model.md     software signing과 hardware-backed signing의 차이
docs/test-results.md       반복 capture, hash, signature, upload 결과
docs/failure-analysis.md   실패 케이스와 root cause 분류
```

이 문서들은 나중에 면접에서 "무엇을 만들었는지"보다 "어떻게 디버그하고 검증했는지"를 보여줍니다.

## 이력서/면접용 설명

짧은 설명:

```text
ESP32-S3 기반 XIAO Sense 보드에서 FreeRTOS 펌웨어를 작성해 카메라 JPEG 캡처, SHA-256 해시, signed capture receipt 생성, USB/Wi-Fi 전송, Python 기반 trace 분석 자동화를 구현했습니다.
```

조금 더 기술적인 설명:

```text
카메라 캡처, 해시, 서명, 통신, trace 출력을 FreeRTOS task와 queue로 분리했고, host Python tool이 firmware trace를 파싱해 capture latency, heap/PSRAM 상태, hash/signature 검증 결과를 자동 리포트하도록 설계했습니다.
```

보안 claim:

```text
MVP는 software development key로 capture receipt signing path를 검증했고, 고도화 단계에서 ESP32-S3 HMAC/eFuse/RSA_DS 기반 hardware-backed signing PoC를 검토했습니다.
```

## Sandisk 공고와 연결하기

`develop, debug, validate on embedded multi-core architectures`:

```text
ESP32-S3 dual-core에서 FreeRTOS task 구조를 설계하고, camera/hash/sign/comm task의 latency와 memory 상태를 trace로 검증했다.
```

`initiate first FA on customer issues`:

```text
camera init failure, PSRAM misconfiguration, hash mismatch, signature mismatch, upload failure를 trace event와 Python analyzer로 분류했다.
```

`automate FW trace analysis`:

```text
UART trace log를 Python CLI로 파싱해 PASS/FAIL, root cause 후보, latency, heap trend를 자동 리포트했다.
```

`C/C++/Python`:

```text
ESP-IDF C firmware와 Python host verification/analyzer를 함께 구현했다.
```

## 참고 자료

- Seeed XIAO ESP32-S3 getting started: https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/
- Seeed XIAO ESP32-S3 Sense camera usage: https://wiki.seeedstudio.com/xiao_esp32s3_camera_usage/
- Seeed XIAO ESP32-S3 FreeRTOS guide: https://wiki.seeedstudio.com/xiao-esp32s3-freertos/
- Seeed XIAO ESP32-S3 pin multiplexing: https://wiki.seeedstudio.com/xiao_esp32s3_pin_multiplexing/
- Espressif esp32-camera component: https://github.com/espressif/esp32-camera
- ESP-IDF FreeRTOS docs: https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32s3/api-reference/system/freertos.html
- ESP32-S3 datasheet: https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf
- ESP32-S3 RSA Digital Signature peripheral: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/ds.html
- ESP32-S3 HMAC peripheral: https://docs.espressif.com/projects/esp-idf/en/v4.4.6/esp32s3/api-reference/peripherals/hmac.html
