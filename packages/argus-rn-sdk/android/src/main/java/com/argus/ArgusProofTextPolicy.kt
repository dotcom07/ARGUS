package com.argus

internal object ArgusProofTextPolicy {
    const val MAX_CANONICAL_MANIFEST_JSON_BYTES = 4 * 1024
    const val MAX_METADATA_JSON_BYTES = 64 * 1024
    const val MAX_EVIDENCE_JSON_BYTES = 16 * 1024

    fun requireWithinLimit(field: String, value: String, maxBytes: Int) {
        if (exceedsUtf8ByteLimit(value, maxBytes)) {
            throw IllegalArgumentException("$field exceeds Argus JSON text limit")
        }
    }

    private fun exceedsUtf8ByteLimit(value: String, maxBytes: Int): Boolean {
        var byteLength = 0
        var index = 0
        while (index < value.length) {
            val codePoint = Character.codePointAt(value, index)
            byteLength += when {
                codePoint <= 0x7f -> 1
                codePoint <= 0x7ff -> 2
                codePoint <= 0xffff -> 3
                else -> 4
            }
            if (byteLength > maxBytes) {
                return true
            }
            index += Character.charCount(codePoint)
        }

        return false
    }
}
