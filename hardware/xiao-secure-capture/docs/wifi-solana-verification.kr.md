# Wi-Fi 및 Solana 검증 기록

## 검증 범위

이 문서는 **영구적인 eFuse 변경 없이** 실행한 개발 단계 검증의 경계를 기록한다.

| 항목 | 결과 | 의미 |
| --- | --- | --- |
| ESP-IDF serial-only 빌드 | 통과 | 카메라, receipt, thermal task가 컴파일됨 |
| ESP-IDF Wi-Fi 빌드 | 통과 | station, SNTP, HTTP client, TLS CA bundle 코드가 컴파일됨 |
| 실제 보드 플래시 | 통과 | `/dev/cu.usbmodem101`, eFuse 미변경 |
| 실제 JPEG 캡처 | 통과 | 11,726 bytes와 12,932 bytes 프레임 확인 |
| counter 증가 | 통과 | 1 -> 2 |
| 내부 온도 | 통과 | 30.80 C, 31.80 C; 70 C warning 미만 |
| 로컬 HTTP MCU endpoint | 통과 | session 발급, JPEG hash, receipt digest, atomic consume |
| 물리 Wi-Fi AP 업로드 | 통과 | `dlink`, Mac `10.78.203.33`, 실제 보드 JPEG 9,764 bytes, HTTP 200 |
| Solana Devnet anchor | 통과 | `/register-proof`의 실제 transaction과 proof PDA 확인 |

## MCU HTTP 경로

1. relayer가 `POST /capture-session`으로 `captureSessionId`, `nonce`, `captureWindow`를 발급한다.
2. 펌웨어가 `CAPTURE <server_nonce> <capture_session_id>`를 받아 카메라 frame buffer의 JPEG bytes를 해시한다.
3. Wi-Fi가 켜진 경우 SNTP 동기화 후 `POST /mcu/capture`로 exact JPEG와 receipt를 보낸다.
4. relayer는 수신 JPEG를 다시 해시하고, receipt nonce/device ID/digest/time window를 검사한 뒤 session을 한 번만 소비한다.
5. 현재 receipt는 `securityLevel=unsigned_dev_only`이므로 결과의 `productionVerified`는 항상 `false`이다.

`/mcu/capture`는 진단용 transport endpoint다. 현재 MCU receipt를 그대로 `/register-proof` 또는 Verified Capture로 승격하지 않는다. RSA-DS key enrollment와 backend signature verification이 구현되기 전까지는 하드웨어 기원에 대한 cryptographic claim을 하지 않는다.

## 물리 Wi-Fi 실행 조건

물리 검증에는 다음이 필요하다.

- 보드와 relayer 호스트가 같은 2.4 GHz 네트워크에 있어야 한다.
- 저장소에 SSID, password, API token을 커밋하지 않는다.
- 로컬 HTTP만 시험할 때는 `ARGUS_ALLOW_INSECURE_HTTP=y`를 임시 개발 설정으로 사용한다. 외부 환경은 HTTPS와 CA bundle을 사용한다.
- 펌웨어 로그에서 `WIFI_CONNECTED`, `WIFI_TIME_SYNCED`, `WIFI_UPLOAD status=200`을 확인한다.
- `host-tools/serial_smoke.py --nonce <64-hex> --session-id <capture-session-id>`로 session-bound command를 보낸다.

실제 실행 결과: 보드가 `dlink`에 연결하고 SNTP를 완료한 뒤 `WIFI_UPLOAD status=200 bytes=9764`를 기록했다. relayer는 동일한 session을 한 번 소비하고 `imageHash=328e3ae99818d30ef32343b25b8060de4e64098306fe5b41e87356d4e0064604`를 확인했다. 보드 내부 온도는 해당 실행에서 32.80 C였다.

## Solana Devnet 결과

마지막 smoke 결과:

- Program: `STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL`
- Proof PDA: `6ksLB6BcShmqnnczNqseTcgY3ZJWjRFTBrsdBnBtq8Un`
- Transaction: [`2rt4XjjPXQybFuVGfqoZLcrFHSjkxL8rPsLqiicYBbGbjCXCHWuJ317U5wk5y7P8Z8EVMSeYJVaVahYfvpAhu7WR`](https://explorer.solana.com/tx/2rt4XjjPXQybFuVGfqoZLcrFHSjkxL8rPsLqiicYBbGbjCXCHWuJ317U5wk5y7P8Z8EVMSeYJVaVahYfvpAhu7WR?cluster=devnet)
- On-chain account length: 189 bytes

이 transaction은 기존 `app_capture` proof fixture의 anchor 검증이다. MCU unsigned receipt가 이 transaction에 들어갔다는 뜻은 아니다.

## 영구 작업 보류

다음은 이번 실행에서 하지 않았다.

- eFuse HMAC key write
- Secure Boot enable
- Flash Encryption enable
- JTAG/download disable
- non-exportable RSA-DS key enrollment

이 작업들은 recovery 절차, key custody, brick recovery, production signature verification을 먼저 테스트한 별도 단계에서 수행해야 한다.
