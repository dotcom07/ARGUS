# Beginner Guide Review Log

Date: 2026-05-12

This log records the ten feedback and revision passes applied to `beginner-guide.kr.md` and `beginner-guide.en.md`.

## Passes

1. Goal clarity
   - Feedback: The guide must state the exact project claim before teaching tools.
   - Revision: Added the signed-capture claim and the non-claim about real-world scene truth.

2. Beginner vocabulary
   - Feedback: A first-time embedded developer may not know MCU, firmware, RTOS, PSRAM, frame buffer, hash, signature, or trace.
   - Revision: Added vocabulary sections in both Korean and English.

3. RTOS usefulness
   - Feedback: "Use FreeRTOS" is too vague for interview readiness.
   - Revision: Added task split, queue/event-group concepts, scheduler, priority, stack, watchdog, and core-affinity explanations.

4. Code-reading path
   - Feedback: The guide should teach how to read firmware files, not only what to build.
   - Revision: Added `.h` vs `.c`, struct, pointer, `esp_err_t`, ownership, `app_main()`, task creation, queue creation, and error handling notes.

5. XIAO hardware bring-up
   - Feedback: The guide did not yet explain what to check when the board physically arrives.
   - Revision: Added antenna, B2B connector, USB data cable, serial port, reset/boot buttons, heat, and OV2640/OV3660 notes.

6. Camera correctness
   - Feedback: Camera work needs explicit PSRAM, JPEG, frame-buffer, and return rules.
   - Revision: Added camera settings, `esp_camera_fb_get()`, `esp_camera_fb_return()`, and frame-buffer ownership rules.

7. Security realism
   - Feedback: Signing language must be Argus-like but not overclaim hardware security.
   - Revision: Added software signing, flash encryption, secure boot, HMAC/eFuse, RSA_DS, production-security boundary, and eFuse caution.

8. Trace-analysis automation
   - Feedback: Sandisk-style firmware trace analysis should be visible as a project feature.
   - Revision: Added trace event format, PASS output, root-cause examples, and analyzer questions.

9. Transport design
   - Feedback: Backend upload needs a memory-aware MCU design.
   - Revision: Added local HTTP-first Wi-Fi plan, `GET /nonce`, multipart `POST /captures`, and warning against base64 JPEG-in-JSON.

10. Documentation and hiring alignment
    - Feedback: The guide should show how this becomes a documented portfolio project.
    - Revision: Added documentation deliverables and direct mapping to embedded multi-core, FA/debug, trace automation, C/C++/Python, and Sandisk-style requirements.
