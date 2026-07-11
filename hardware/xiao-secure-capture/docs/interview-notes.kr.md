# MCU 보안 프로젝트 면접 노트

## 한 문장

ESP32-S3 카메라가 받은 exact JPEG 바이트를 hash하고, 서버 nonce와 capture counter를 receipt에 묶은 뒤, FreeRTOS task와 thermal guard로 반복 캡처를 운영하는 프로젝트다. Android 경로와 MCU 경로의 보안 주장을 분리한다.

## 질문별 답변

### 왜 Level 2를 Verified Capture로 인정하지 않았나?

Level 2는 native camera path라는 provenance를 보여주지만, 공개된 앱 식별자와 요청 JSON은 공격자가 만들 수 있다. 따라서 private-key signature 없이 production badge를 만들면 direct API forgery가 된다. Level 3 Keystore signature 또는 Level 4 hardware attestation을 production gate로 둔다.

### 왜 session store를 Map에서 바꿨나?

프로세스가 재시작되면 Map의 consumed state가 사라지고, 서버가 여러 개면 두 요청이 동시에 같은 nonce를 읽을 수 있다. 지금 adapter는 directory lock과 atomic rename을 사용한다. 규모가 커지면 DB conditional update로 교체한다.

### Play Integrity는 어디에서 검증하나?

앱은 session nonce를 request hash 또는 nonce 입력으로 사용해 token을 얻고, relayer는 Google Play 응답을 직접 믿지 않고 별도 verifier service에 보낸다. verifier가 돌려준 decoded nonce/app identity를 session과 비교한다. token 문자열 안의 JSON field는 신뢰하지 않는다.

### ESP32-S3에서 private signing key가 정말 안 나오나?

DS 경로에서는 RSA private parameters가 암호화되어 flash에 있고, HMAC eFuse key가 read-protected 상태에서 hardware crypto path로만 사용된다. 소프트웨어는 DS blob과 key slot을 넘길 뿐 raw private key를 읽지 않는다. 단, eFuse와 DS provisioning을 실제로 하지 않은 개발 보드는 unsigned receipt다.

### FreeRTOS를 어디에서 썼나?

command_task는 capture request를 queue에 넣고, capture_task는 카메라 frame buffer를 처리하고, thermal_task는 부하를 줄이기 위해 30초 주기로 온도를 읽는다. EventGroup이 thermal state를 전달한다. capture task는 frame buffer를 반드시 반환한다.

### 발열을 왜 기능으로 봤나?

카메라와 PSRAM, Wi-Fi는 순간 전류와 열을 만든다. 열을 무시하면 장시간 테스트의 재현성이 떨어진다. 그래서 부하를 줄이기 위해 30초 주기로 내부 온도를 확인하고, 70 C부터 속도를 늦추며 78 C부터 캡처를 막고, 온도와 임계치를 구조화 로그로 남긴다. 실제 임계치는 보드/케이스/주변 온도 시험으로 조정해야 한다. 현재 보드에서 부팅 직후와 30초 뒤 약 30.8 C를 확인했다.

### USB Serial/JTAG 입력이 처음 동작하지 않은 이유는?

ESP-IDF의 기본 USB Serial/JTAG VFS가 non-blocking이면 입력 전 `fgets()`가 `NULL`을 반환하고 command task가 종료될 수 있다. 공식 USB Serial/JTAG driver를 설치하고 `usb_serial_jtag_vfs_use_driver()`로 blocking/interrupt-driven VFS를 선택한 뒤, nonce 입력과 receipt 2회를 실제 보드에서 확인했다. 이 경험은 “콘솔이 보인다”와 “콘솔 입력이 task까지 도착한다”가 별도 검증 항목임을 보여준다.

### 왜 stack high-water mark를 로그로 남겼나?

camera frame pointer, SHA-256 canonical buffer, receipt result, JSON을 한 task에서 처리하면 FreeRTOS stack이 빠르게 소진될 수 있다. JSON을 static storage로 옮기고 capture task를 12KB로 조정한 뒤 `uxTaskGetStackHighWaterMark()`를 로그로 남겼다. 최종 테스트에서 6980 words가 남았고 두 번째 capture 뒤에도 reboot가 없었다.

## 읽어볼 코드

- firmware/main/app_main.c: camera pins, tasks, queue, EventGroup, thermal guard
- firmware/main/receipt.c: exact bytes hash, canonical digest, DS signature boundary
- firmware/main/key_enrollment.c: encrypted DS blob load, non-exportable key handoff
- api/relayer/sessionStore.mjs: durable atomic nonce consumption
- api/relayer/playIntegrityPolicy.mjs: verifier-service boundary
- api/relayer/androidEvidencePolicy.mjs: Level 2 rejection, root rotation, revocation, extension position
- packages/argus-rn-sdk/src/proofStatus.ts: production UI promotion gate

## 이력서에 쓰면 안 되는 표현

- 카메라 센서가 현실의 진실을 서명했다
- Level 2가 hardware-backed attestation이다
- Secure Boot/eFuse를 완료했다: 실제 burn 전에는 쓰지 않기
- Play Integrity를 검증했다: verifier service 없이 쓰지 않기

## 이력서 표현

ESP32-S3/ESP-IDF/FreeRTOS 기반 camera capture node에서 exact JPEG hash receipt, nonce binding, capture counter, periodic thermal protection을 구현하고, Android/relayer의 Level 2 native evidence가 production Verified Capture로 승격되지 않도록 cryptographic evidence gate를 설계했다.
