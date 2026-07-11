# Argus 보안 구현 노트

## 현재 보드 검증

- USB 장치: Espressif USB JTAG/serial debug unit
- 포트: /dev/cu.usbmodem101
- 개발 firmware: ESP-IDF v6.0.2 빌드 및 `/dev/cu.usbmodem101` flash 성공
- 부팅 검증: 8MB PSRAM, OV3660 camera, USB Serial/JTAG 양방향 console
- 캡처 검증: JPEG 11~13KB, receipt 2회, captureCounter 1 -> 2
- receipt 경계: `securityLevel=unsigned_dev_only`, signatureAlgorithm=`none`
- thermal 검증: 부팅 직후 약 30.8도, 30초 뒤 약 30.8도
- task 안정성: stack overflow 수정 후 `stack_free_words=6980` 로그 확인
- 새 펌웨어 온도 주기: 30초
- 새 펌웨어 열 보호: 70도부터 지연, 78도부터 캡처 중지

내부 temperature sensor는 칩 die 온도 기반 보호 신호다. 보드 표면/케이스 온도의 보정값으로 주장하지 않으며, 임계값 검증은 외부 온도계나 thermocouple로 별도 수행한다.

## 보안 경계

### Android

1. Level 2는 CameraX native path, 파일 바이트, timestamp, motion, app signing digest를 묶는다.
2. 그러나 공개된 앱 식별자와 위조 가능한 JSON만으로 API를 직접 호출할 수 있으므로 Level 2는 production Verified Capture가 아니다.
3. Level 3은 Android Keystore private key가 proof binding을 서명해야 한다.
4. Level 4는 Level 3에 더해 Android Key Attestation chain, challenge, TEE/StrongBox, trusted root, revocation을 relayer가 확인해야 한다.
5. Play Integrity token은 앱에서 세션 nonce로 요청하고, relayer가 별도 verifier service를 통해 Google Play 응답을 해독한 뒤 nonce와 app identity를 비교한다. JWE 문자열을 앱이 넣었다는 사실만으로는 신뢰하지 않는다.

### Relayer

- /capture-session과 proof read/write route는 Bearer API token 경계를 가진다.
- IP별 rate limit으로 session 발급과 proof 등록 남용을 줄인다.
- session store는 JSON temp file, atomic rename, directory lock을 쓴다.
- validateAndConsumeCaptureSession은 검증과 consumed=true 기록을 같은 lock 안에서 수행한다.
- session은 issuedAtMs, expiresAtMs, captureWindowStartMs, captureWindowEndMs를 가진다.
- capture timestamp가 session window 밖이면 거절한다.

## MCU receipt

~~~text
receiptDigest =
  SHA-256(
    "argus.xiao.capture.receipt.v1" |
    deviceId | nonce | captureCounter | capturedAtMs |
    imageSha256 | firmwareVersion | firmwareBuild
  )
~~~

카메라에서 받은 fb->buf와 fb->len을 그대로 hash한다. JPEG를 다시 decode하거나 재인코딩하지 않기 때문에 backend가 같은 바이트를 받아 같은 imageSha256을 재현할 수 있다.

개발 빌드에서는 securityLevel=unsigned_dev_only를 명시한다. production DS enrollment 전에는 서명됐다고 말하지 않는다.

## ESP32-S3 DS key enrollment

ESP32-S3 RSA Digital Signature peripheral은 HMAC eFuse key로 암호화된 RSA private-key parameter를 풀어 hardware 안에서 서명한다. 소프트웨어는 raw private key를 읽지 않는다.

순서:

1. 별도 오프라인 환경에서 Secure Boot signing key와 DS RSA key를 생성한다.
2. DS encrypted parameter blob을 준비한다.
3. 장치별 HMAC key를 eFuse에 기록하고 read-protect한다.
4. DS blob과 key slot metadata를 encrypted NVS에 넣는다.
5. Secure Boot v2와 Flash Encryption release mode를 검증한다.
6. 장치 하나에서 reboot, wrong firmware, wrong receipt, power loss recovery를 시험한다.
7. 그 뒤에만 양산 장치의 eFuse를 진행한다.

이 저장소의 firmware/main/key_enrollment.c는 eFuse를 태우지 않는다. provisioned blob을 읽고 DS peripheral에 전달하는 경계만 구현한다.

## Secure Boot와 Flash Encryption

firmware/sdkconfig.defaults는 개발 안전 모드다. firmware/sdkconfig.production.defaults는 검토용 production 설정이다. 설정 파일을 복사하는 것과 실제 eFuse를 태우는 것은 분리한다.

되돌릴 수 없는 작업:

- Secure Boot eFuse
- Flash Encryption release mode
- HMAC key eFuse 및 read-protect
- JTAG disable/read-protect

따라서 현재 연결된 보드에는 이 작업을 자동 실행하지 않는다. 먼저 두 번째 보드 또는 복구 이미지를 확보한다.

## 면접에서 설명할 코드 조각

### 원자적 nonce 소비

api/relayer/sessionStore.mjs

~~~js
return withExclusiveStore((state) => {
  const session = state.sessions[captureSessionId];
  if (!session || session.consumed) throw new Error("replay");
  if (captureTimestamp < session.captureWindowStartMs) throw new Error("too early");
  session.consumed = true;
  session.consumedAtMs = nowMs;
  return { ...session };
});
~~~

설명 포인트: read와 write 사이에 다른 process가 같은 nonce를 소비하지 못하도록 directory lock과 temp-file rename을 함께 썼다. 완전한 multi-node 저장소가 필요한 서비스에서는 PostgreSQL UPDATE ... WHERE consumed=false RETURNING 또는 Redis Lua로 교체한다.

### Level 2 downgrade

api/relayer/androidEvidencePolicy.mjs

~~~js
if (level === 2 && isProductionRegistrationRuntime()) {
  throw new Error("Production Verified Capture requires Level 3 or Level 4");
}
~~~

설명 포인트: native capture path와 cryptographic signer는 다른 보장이다. Level 2를 production badge로 승격하면 direct API forgery가 가능하다.

### RTOS thermal guard

hardware/xiao-secure-capture/firmware/main/app_main.c

~~~c
if (temperature_c >= THERMAL_CRITICAL_C) {
    xEventGroupSetBits(events, THERMAL_HOT_BIT | THERMAL_CRITICAL_BIT);
}
~~~

설명 포인트: thermal task와 capture task를 분리하고 EventGroup으로 backpressure를 전달한다. 단순 delay보다 상태 전파가 명확하고, 로그로 테스트 결과를 남길 수 있다.

## 이력서 문장 초안

ESP32-S3 기반 카메라 capture node를 ESP-IDF/FreeRTOS로 구성하고, exact JPEG bytes의 SHA-256 receipt, nonce/session binding, periodic thermal guard를 구현했습니다. Android/relayer 측에서는 Level 2 native capture를 production Verified Capture에서 제외하고, atomic durable session consumption, time-window validation, nonce-bound Play Integrity, Keystore/Key Attestation policy를 분리했습니다.

## 아직 실제 장치에서 확인하지 않은 것

- Wi-Fi 연결 및 HTTPS upload: 현재 firmware milestone은 의도적으로 serial-only다.
- JPEG 원본 바이트를 transport로 전달한 뒤 backend가 imageSha256을 재계산하는 end-to-end 경로
- DS encrypted parameter provisioning
- Secure Boot/Flash Encryption eFuse burn
- 실제 Google Play Integrity verifier service

이 항목들은 코드가 있다고 해서 완료된 것으로 표시하지 않는다.
