package com.argus

import java.security.MessageDigest

internal object ArgusImageBytesPolicy {
    const val MAX_NATIVE_CAPTURE_IMAGE_BYTES = 20 * 1024 * 1024

    // kr: matchesNativeCaptureBinding은 CameraActivity가 저장 직후 본 bytes와 RN module이 나중에 읽은 bytes가 같은지 확인합니다.
    // en: matchesNativeCaptureBinding checks that bytes seen by CameraActivity just after save match bytes later read by the RN module.
    // kr: 이 값은 앱 내부 handoff를 묶는 경계이며 camera sensor가 bytes에 서명했다는 뜻은 아닙니다.
    // en: This binds the app-internal handoff; it does not mean the camera sensor signed the bytes.
    fun matchesNativeCaptureBinding(
        bytes: ByteArray,
        expectedByteLength: Long,
        expectedSha256Hex: String?,
    ): Boolean {
        val normalizedSha256 = normalizeSha256Hex(expectedSha256Hex) ?: return false
        return bytes.isNotEmpty() &&
            expectedByteLength == bytes.size.toLong() &&
            sha256Hex(bytes) == normalizedSha256
    }

    // kr: isJpegImage는 native-capture JPEG-like byte 정책용 구조 검사이며 scene truth나 sensor 서명을 증명하지 않습니다.
    // en: isJpegImage is a structural native-capture JPEG-like byte policy, not proof of scene truth or a sensor signature.
    fun isJpegImage(bytes: ByteArray): Boolean {
        if (
            bytes.size > MAX_NATIVE_CAPTURE_IMAGE_BYTES ||
            bytes.size < 12 ||
            byteAt(bytes, 0) != 0xff ||
            byteAt(bytes, 1) != 0xd8 ||
            byteAt(bytes, bytes.size - 2) != 0xff ||
            byteAt(bytes, bytes.size - 1) != 0xd9
        ) {
            return false
        }

        var index = 2
        var sawStartOfFrame = false
        var frameComponentIds = emptySet<Int>()
        val eoiIndex = bytes.size - 2

        while (index < eoiIndex) {
            if (byteAt(bytes, index) != 0xff) {
                return false
            }

            while (index < eoiIndex && byteAt(bytes, index) == 0xff) {
                index += 1
            }

            if (index >= eoiIndex) {
                return false
            }

            val marker = byteAt(bytes, index)
            index += 1

            if (marker == 0x00 || marker == 0xd9) {
                return false
            }

            if (marker == 0x01) {
                continue
            }

            if (index + 2 > eoiIndex) {
                return false
            }

            val segmentLength = (byteAt(bytes, index) shl 8) or byteAt(bytes, index + 1)
            if (segmentLength < 2) {
                return false
            }

            val segmentEnd = index + segmentLength
            if (segmentEnd > eoiIndex) {
                return false
            }

            if (isStartOfFrameMarker(marker)) {
                // kr: SOF는 뒤의 SOS가 참조할 component id allowlist입니다. 중복 SOF는 그 allowlist를 바꾸므로 fail-closed 합니다.
                // en: SOF is the component-id allowlist for the later SOS. A duplicate SOF would replace that allowlist, so fail closed.
                if (sawStartOfFrame) {
                    return false
                }
                frameComponentIds = startOfFrameComponents(bytes, index, segmentLength) ?: return false
                sawStartOfFrame = true
            }

            if (marker == 0xda) {
                // kr: native-capture JPEG-like byte policy도 Rust/relayer와 같은 SOS->SOF component id binding을 적용합니다.
                // en: The native-capture JPEG-like byte policy mirrors Rust/relayer SOS-to-SOF component-id binding.
                if (!startOfScanReferencesFrameComponents(bytes, index, segmentLength, frameComponentIds)) {
                    return false
                }
                return sawStartOfFrame && scanDataRunsToFinalEoi(bytes, segmentEnd)
            }

            index = segmentEnd
        }

        return false
    }

    private fun byteAt(bytes: ByteArray, index: Int): Int {
        return bytes[index].toInt() and 0xff
    }

    fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun normalizeSha256Hex(value: String?): String? {
        val trimmed = value?.trim() ?: return null
        if (!Regex("^[0-9a-fA-F]{64}$").matches(trimmed) || Regex("^0{64}$").matches(trimmed)) {
            return null
        }

        return trimmed.lowercase()
    }

    private fun isStartOfFrameMarker(marker: Int): Boolean {
        return marker in 0xc0..0xc3 ||
            marker in 0xc5..0xc7 ||
            marker in 0xc9..0xcb ||
            marker in 0xcd..0xcf
    }

    private fun startOfFrameComponents(
        bytes: ByteArray,
        lengthIndex: Int,
        segmentLength: Int,
    ): Set<Int>? {
        if (segmentLength < 11 || lengthIndex + segmentLength > bytes.size) {
            return null
        }

        val height = (byteAt(bytes, lengthIndex + 3) shl 8) or byteAt(bytes, lengthIndex + 4)
        val width = (byteAt(bytes, lengthIndex + 5) shl 8) or byteAt(bytes, lengthIndex + 6)
        val componentCount = byteAt(bytes, lengthIndex + 7)
        if (
            height <= 0 ||
            width <= 0 ||
            componentCount !in 1..4 ||
            segmentLength != 8 + componentCount * 3
        ) {
            return null
        }

        val componentIds = (0 until componentCount)
            .map { componentIndex -> byteAt(bytes, lengthIndex + 8 + componentIndex * 3) }
            .toSet()
        if (componentIds.size != componentCount) {
            return null
        }

        return componentIds
    }

    private fun startOfScanReferencesFrameComponents(
        bytes: ByteArray,
        lengthIndex: Int,
        segmentLength: Int,
        frameComponentIds: Set<Int>,
    ): Boolean {
        if (segmentLength < 8 || lengthIndex + segmentLength > bytes.size) {
            return false
        }

        val componentCount = byteAt(bytes, lengthIndex + 2)
        if (
            componentCount !in 1..4 ||
            componentCount > frameComponentIds.size ||
            segmentLength != 6 + componentCount * 2
        ) {
            return false
        }

        val scanComponentIds = mutableSetOf<Int>()
        return (0 until componentCount).all { componentIndex ->
            val componentId = byteAt(bytes, lengthIndex + 3 + componentIndex * 2)
            scanComponentIds.add(componentId) && frameComponentIds.contains(componentId)
        }
    }

    private fun scanDataRunsToFinalEoi(bytes: ByteArray, startIndex: Int): Boolean {
        val eoiIndex = bytes.size - 2
        if (startIndex >= eoiIndex) {
            return false
        }

        // kr: Scan data 안에서는 FF 00(escaped FF byte)와 restart marker만 데이터 흐름으로 허용합니다.
        // en: Inside scan data, only FF 00 (escaped FF byte) and restart markers remain part of the data stream.
        // kr: 그 외 marker는 최종 EOI 하나만 허용해 두 번째 SOS/APP marker 같은 구조 변경을 fail-closed 합니다.
        // en: Any other marker must be the final EOI, which fails closed on a second SOS, APP marker, or similar structure change.
        var index = startIndex
        var sawScanData = false
        while (index < eoiIndex) {
            if (byteAt(bytes, index) != 0xff) {
                sawScanData = true
                index += 1
                continue
            }

            index += 1
            while (index < bytes.size && byteAt(bytes, index) == 0xff) {
                index += 1
            }

            if (index >= bytes.size) {
                return false
            }

            val marker = byteAt(bytes, index)
            if (marker == 0x00) {
                sawScanData = true
                index += 1
                continue
            }

            if (marker in 0xd0..0xd7) {
                index += 1
                continue
            }

            return marker == 0xd9 && index == bytes.size - 1 && sawScanData
        }

        return sawScanData
    }
}
