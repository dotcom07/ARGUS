package com.argus

import android.content.ContextWrapper
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import kotlin.io.path.createTempDirectory
import kotlin.io.path.pathString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ArgusModuleTest {
    @Test
    fun allowsFreshArgusCaptureFileInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs)

            assertTrue(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
            assertEquals(
                captureFile.canonicalFile,
                ArgusCaptureFilePolicy.allowedCaptureFile(captureFile, cacheDir, capturedAtMs),
            )
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsCaptureFileOutsideCacheDir() {
        val cacheDir = tempDir()
        val externalDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(externalDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
            externalDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsStaleCaptureFileInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs - 60_000L)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsFutureDatedCaptureFileInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs + 60_000L)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsZeroByteCaptureFileInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.createNewFile()
            captureFile.setLastModified(capturedAtMs)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsOversizedCaptureFileInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            RandomAccessFile(captureFile, "rw").use { file ->
                file.setLength(ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES.toLong() + 1L)
            }
            captureFile.setLastModified(capturedAtMs)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun readsAllowedCaptureBytesInsideLimit() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            val bytes = byteArrayOf(1, 2, 3)
            captureFile.writeBytes(bytes)
            captureFile.setLastModified(capturedAtMs)

            assertEquals(
                bytes.toList(),
                ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                    captureFile,
                    cacheDir,
                    capturedAtMs,
                )?.toList(),
            )
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsCaptureFileWhenSameLengthBytesChangeBeforePostReadValidation() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            val bytes = byteArrayOf(1, 2, 3)
            captureFile.writeBytes(bytes)
            captureFile.setLastModified(capturedAtMs)

            val readBytes = ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                captureFile,
                cacheDir,
                capturedAtMs,
            ) {
                captureFile.writeBytes(byteArrayOf(1, 9, 3))
                captureFile.setLastModified(capturedAtMs + 1L)
            }

            assertEquals(null, readBytes)
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsCaptureFileWhenLengthChangesBeforePostReadValidation() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            val bytes = byteArrayOf(1, 2, 3)
            captureFile.writeBytes(bytes)
            captureFile.setLastModified(capturedAtMs)

            val readBytes = ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                captureFile,
                cacheDir,
                capturedAtMs,
            ) {
                captureFile.appendBytes(byteArrayOf(4))
                captureFile.setLastModified(capturedAtMs)
            }

            assertEquals(null, readBytes)
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsCaptureFileReplacementWithSameLengthAndTimestampBeforePostReadValidation() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            val bytes = byteArrayOf(1, 2, 3)
            captureFile.writeBytes(bytes)
            captureFile.setLastModified(capturedAtMs)

            val readBytes = ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                captureFile,
                cacheDir,
                capturedAtMs,
            ) {
                assertTrue(captureFile.delete())
                captureFile.writeBytes(byteArrayOf(1, 9, 3))
                captureFile.setLastModified(capturedAtMs)
            }

            assertEquals(null, readBytes)
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun readsAllowedCaptureBytesAtNativeLimit() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            val bytes = jpegBytesOfLength(ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES)
            captureFile.writeBytes(bytes)
            captureFile.setLastModified(capturedAtMs)

            val readBytes = ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                captureFile,
                cacheDir,
                capturedAtMs,
            )

            assertEquals(ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES, readBytes?.size)
            assertTrue(ArgusImageBytesPolicy.isJpegImage(readBytes!!))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsOversizedCaptureBytesBeforeFullAllocation() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            RandomAccessFile(captureFile, "rw").use { file ->
                file.setLength(ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES.toLong() + 1L)
            }
            captureFile.setLastModified(capturedAtMs)

            assertEquals(
                null,
                ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                    captureFile,
                    cacheDir,
                    capturedAtMs,
                ),
            )
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun reservesNewCaptureFileBeforeCameraWritesBytes() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = ArgusCaptureFilePolicy.reserveCaptureFile(cacheDir, capturedAtMs)

            assertEquals(File(cacheDir, "argus_capture_$capturedAtMs.jpg"), captureFile)
            assertTrue(captureFile?.isFile == true)
            assertEquals(0L, captureFile?.length())
            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile!!, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsStaleFileReuseWhenCaptureFileAlreadyExists() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs - 60_000L)

            assertEquals(null, ArgusCaptureFilePolicy.reserveCaptureFile(cacheDir, capturedAtMs))
            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun deletesReservedCaptureFileOnCancellationOrError() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = ArgusCaptureFilePolicy.reserveCaptureFile(cacheDir, capturedAtMs)!!

            assertTrue(ArgusCaptureFilePolicy.deleteCreatedCaptureFile(captureFile, cacheDir))
            assertFalse(captureFile.exists())
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun cleanupDoesNotDeleteFilesOutsideCacheDir() {
        val cacheDir = tempDir()
        val externalDir = tempDir()
        try {
            val captureFile = File(externalDir, "argus_capture_1777000000000.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))

            assertFalse(ArgusCaptureFilePolicy.deleteCreatedCaptureFile(captureFile, cacheDir))
            assertTrue(captureFile.exists())
        } finally {
            cacheDir.deleteRecursively()
            externalDir.deleteRecursively()
        }
    }

    @Test
    fun cleanupDoesNotDeleteUnrelatedFilesInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val cacheFile = File(cacheDir, "partner_session.json")
            cacheFile.writeText("""{"keep":true}""")

            assertFalse(ArgusCaptureFilePolicy.deleteCreatedCaptureFile(cacheFile, cacheDir))
            assertTrue(cacheFile.exists())
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun cleanupDoesNotDeleteCaptureNamedDirectoryInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val captureNamedDirectory = File(cacheDir, "argus_capture_1777000000000.jpg")
            assertTrue(captureNamedDirectory.mkdir())

            assertFalse(ArgusCaptureFilePolicy.deleteCreatedCaptureFile(captureNamedDirectory, cacheDir))
            assertTrue(captureNamedDirectory.exists())
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsUnexpectedFileNameInsideCacheDir() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "gallery_import.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsCaptureFileWhoseNameDoesNotMatchCaptureTimestamp() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(cacheDir, "argus_capture_${capturedAtMs - 1L}.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsNestedCacheFileWithArgusCaptureName() {
        val cacheDir = tempDir()
        try {
            val nestedDir = File(cacheDir, "nested")
            nestedDir.mkdirs()
            val capturedAtMs = 1_777_000_000_000L
            val captureFile = File(nestedDir, "argus_capture_$capturedAtMs.jpg")
            captureFile.writeBytes(byteArrayOf(1, 2, 3))
            captureFile.setLastModified(capturedAtMs)

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(captureFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsSymlinkAliasToAllowedCaptureFile() {
        val cacheDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val targetFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            targetFile.writeBytes(byteArrayOf(1, 2, 3))
            targetFile.setLastModified(capturedAtMs)
            val aliasFile = File(cacheDir, "gallery_import.jpg")
            Files.createSymbolicLink(aliasFile.toPath(), targetFile.toPath())

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(aliasFile, cacheDir, capturedAtMs))
        } finally {
            cacheDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsExpectedCaptureNameSymlinkToExternalFile() {
        val cacheDir = tempDir()
        val externalDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val targetFile = File(externalDir, "argus_capture_$capturedAtMs.jpg")
            targetFile.writeBytes(byteArrayOf(1, 2, 3))
            targetFile.setLastModified(capturedAtMs)
            val linkFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            Files.createSymbolicLink(linkFile.toPath(), targetFile.toPath())

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(linkFile, cacheDir, capturedAtMs))
            assertEquals(
                null,
                ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                    linkFile,
                    cacheDir,
                    capturedAtMs,
                ),
            )
        } finally {
            cacheDir.deleteRecursively()
            externalDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsResultIntentPathOutsideCacheEvenWhenSymlinkResolvesToAllowedCaptureFile() {
        val cacheDir = tempDir()
        val externalDir = tempDir()
        try {
            val capturedAtMs = 1_777_000_000_000L
            val targetFile = File(cacheDir, "argus_capture_$capturedAtMs.jpg")
            targetFile.writeBytes(byteArrayOf(1, 2, 3))
            targetFile.setLastModified(capturedAtMs)
            val linkFile = File(externalDir, "argus_capture_$capturedAtMs.jpg")
            Files.createSymbolicLink(linkFile.toPath(), targetFile.toPath())

            assertFalse(ArgusCaptureFilePolicy.isAllowedCaptureFile(linkFile, cacheDir, capturedAtMs))
            assertEquals(
                null,
                ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                    linkFile,
                    cacheDir,
                    capturedAtMs,
                ),
            )
        } finally {
            cacheDir.deleteRecursively()
            externalDir.deleteRecursively()
        }
    }

    @Test
    fun imagePolicyRejectsNonJpegImageBytes() {
        assertFalse(ArgusImageBytesPolicy.isJpegImage("not camera jpeg bytes".toByteArray()))
    }

    @Test
    fun imagePolicyRejectsTruncatedJpegImageBytes() {
        assertFalse(ArgusImageBytesPolicy.isJpegImage(byteArrayOf(0xff.toByte(), 0xd8.toByte())))
    }

    @Test
    fun imagePolicyRejectsMarkerOnlyJpegImageBytes() {
        assertFalse(
            ArgusImageBytesPolicy.isJpegImage(
                byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte()),
            ),
        )
    }

    @Test
    fun imagePolicyRejectsOversizedImageBytes() {
        assertFalse(
            ArgusImageBytesPolicy.isJpegImage(
                ByteArray(ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES + 1) { 0xff.toByte() },
            ),
        )
    }

    @Test
    fun imagePolicyAllowsJpegImageBytes() {
        assertTrue(ArgusImageBytesPolicy.isJpegImage(sampleJpegBytes()))
    }

    @Test
    fun imagePolicyRejectsEmptyStartOfFrameSegment() {
        val imageBytes = sampleJpegBytes().toMutableList()
        imageBytes[10] = 0x00
        imageBytes[11] = 0x02

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyRejectsEmptyStartOfScanSegment() {
        val imageBytes = sampleJpegBytes().toMutableList()
        imageBytes[23] = 0x00
        imageBytes[24] = 0x02

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyRejectsScanComponentMissingFromFrame() {
        val imageBytes = sampleJpegBytes().toMutableList()
        imageBytes[26] = 0x02

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyRejectsStartOfScanComponentCountThatExceedsFrame() {
        val imageBytes = sampleJpegBytes().toMutableList()
        imageBytes[23] = 0x00
        imageBytes[24] = 0x0a
        imageBytes[25] = 0x02
        imageBytes.addAll(28, listOf(0x02, 0x00))

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyRejectsDuplicateStartOfFrameBeforeScan() {
        assertFalse(ArgusImageBytesPolicy.isJpegImage(duplicateStartOfFrameJpegBytes()))
    }

    @Test
    fun imagePolicyRejectsDuplicateStartOfScanComponentIds() {
        assertTrue(ArgusImageBytesPolicy.isJpegImage(twoComponentJpegBytes()))
        assertFalse(ArgusImageBytesPolicy.isJpegImage(twoComponentJpegBytes(secondScanComponentId = 0x01)))
    }

    @Test
    fun imagePolicyRejectsDuplicateStartOfFrameComponentIds() {
        assertFalse(ArgusImageBytesPolicy.isJpegImage(twoComponentJpegBytes(secondFrameComponentId = 0x01)))
    }

    @Test
    fun imagePolicyMatchesNativeCaptureActivityByteBinding() {
        val imageBytes = sampleJpegBytes()

        assertTrue(
            ArgusImageBytesPolicy.matchesNativeCaptureBinding(
                imageBytes,
                imageBytes.size.toLong(),
                ArgusImageBytesPolicy.sha256Hex(imageBytes),
            ),
        )
    }

    @Test
    fun imagePolicyRejectsChangedBytesAfterActivityByteBinding() {
        val imageBytes = sampleJpegBytes()
        val changedBytes = imageBytes.copyOf().also { bytes ->
            bytes[bytes.size - 3] = 0x7f
        }

        assertFalse(
            ArgusImageBytesPolicy.matchesNativeCaptureBinding(
                changedBytes,
                imageBytes.size.toLong(),
                ArgusImageBytesPolicy.sha256Hex(imageBytes),
            ),
        )
    }

    @Test
    fun imagePolicyRejectsSameSizeJpegReplacementAfterActivityByteBinding() {
        val originalBytes = sampleJpegBytes()
        val replacementBytes = sampleJpegBytes().also { bytes ->
            bytes[31] = 0x01
        }

        assertEquals(originalBytes.size, replacementBytes.size)
        assertTrue(ArgusImageBytesPolicy.isJpegImage(replacementBytes))
        assertFalse(
            ArgusImageBytesPolicy.matchesNativeCaptureBinding(
                replacementBytes,
                originalBytes.size.toLong(),
                ArgusImageBytesPolicy.sha256Hex(originalBytes),
            ),
        )
    }

    @Test
    fun imagePolicyRejectsMissingNativeCaptureActivityByteBinding() {
        val imageBytes = sampleJpegBytes()

        assertFalse(
            ArgusImageBytesPolicy.matchesNativeCaptureBinding(
                imageBytes,
                imageBytes.size.toLong(),
                null,
            ),
        )
    }

    @Test
    fun imagePolicyAllowsJpegImageBytesAtNativeLimit() {
        assertTrue(
            ArgusImageBytesPolicy.isJpegImage(
                jpegBytesOfLength(ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES),
            ),
        )
    }

    @Test
    fun imagePolicyRejectsRestartMarkerBeforeScanData() {
        val imageBytes = sampleJpegBytes().toMutableList()
        imageBytes.addAll(2, listOf(0xff.toByte(), 0xd0.toByte()))

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyAllowsEscapedFfByteInsideScanData() {
        val imageBytes = sampleJpegBytes().toMutableList()
        val eoiIndex = imageBytes.size - 2
        imageBytes.addAll(eoiIndex, listOf(0xff.toByte(), 0x00))

        assertTrue(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyRejectsForbiddenMarkerInsideScanData() {
        val imageBytes = sampleJpegBytes().toMutableList()
        val eoiIndex = imageBytes.size - 2
        imageBytes.addAll(eoiIndex, listOf(0xff.toByte(), 0xe0.toByte(), 0x00, 0x02))

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun imagePolicyRejectsSecondStartOfScanMarkerInsideScanData() {
        val imageBytes = sampleJpegBytes().toMutableList()
        val eoiIndex = imageBytes.size - 2
        imageBytes.addAll(eoiIndex, listOf(0xff.toByte(), 0xda.toByte(), 0x00, 0x08))

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun rustBridgeRejectsNonJpegBytesWithStructuralPolicyMessage() {
        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = "{}",
                cameraEvidenceJson = "not-json",
                deviceEvidenceJson = "not-json",
                appIdentityHash = APP_IDENTITY_HASH,
                captureSessionId = "capture-session-001",
                sessionNonce = SESSION_NONCE,
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = "not camera jpeg bytes".toByteArray(),
            )
        }

        assertEquals("imageBytes must pass the native-capture JPEG-like byte policy", error.message)
    }

    @Test
    fun imagePolicyRejectsEarlyEoiWithTrailingBytes() {
        val imageBytes = sampleJpegBytes().toMutableList()
        val eoiIndex = imageBytes.size - 2
        imageBytes.addAll(eoiIndex, listOf(0xff.toByte(), 0xd9.toByte(), 0x00))

        assertFalse(ArgusImageBytesPolicy.isJpegImage(imageBytes.toByteArray()))
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithoutNativeCaptureSurface() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(cameraEvidenceJson = cameraEvidenceJson(captureSurface = "gallery_import"))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceJsonWithTrailingTokens() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(cameraEvidenceJson = "${cameraEvidenceJson()} true")
        }

        assertEquals("cameraEvidenceJson must be a valid JSON object", error.message)
    }

    @Test
    fun rustBridgeRejectsOversizedCameraEvidenceJsonBeforeParsing() {
        val oversizedCameraEvidenceJson = "{\"pad\":\"${"a".repeat(ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES)}\"}"

        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(cameraEvidenceJson = oversizedCameraEvidenceJson)
        }

        assertEquals("cameraEvidenceJson exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun rustBridgeRejectsOversizedDeviceEvidenceJsonBeforeParsing() {
        val oversizedDeviceEvidenceJson = "{\"pad\":\"${"a".repeat(ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES)}\"}"

        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(deviceEvidenceJson = oversizedDeviceEvidenceJson)
        }

        assertEquals("deviceEvidenceJson exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun rustBridgeRejectsOversizedMetadataJsonBeforeImageOrEvidenceValidation() {
        val oversizedMetadataJson = "{\"pad\":\"${"a".repeat(ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES)}\"}"

        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = oversizedMetadataJson,
                cameraEvidenceJson = "not-json",
                deviceEvidenceJson = "not-json",
                appIdentityHash = APP_IDENTITY_HASH,
                captureSessionId = "capture-session-001",
                sessionNonce = SESSION_NONCE,
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = byteArrayOf(),
            )
        }

        assertEquals("metadataJson exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun textPolicyCountsUtf8BytesForMultibyteCharacters() {
        ArgusProofTextPolicy.requireWithinLimit(
            "metadataJson",
            "é".repeat(ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES / 2),
            ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES,
        )

        val error = assertFailsWith<IllegalArgumentException> {
            ArgusProofTextPolicy.requireWithinLimit(
                "metadataJson",
                "é".repeat(ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES / 2) + "a",
                ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES,
            )
        }

        assertEquals("metadataJson exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun textPolicyCountsUtf8BytesForSurrogatePairs() {
        ArgusProofTextPolicy.requireWithinLimit(
            "cameraEvidenceJson",
            "😀".repeat(ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES / 4),
            ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES,
        )

        val error = assertFailsWith<IllegalArgumentException> {
            ArgusProofTextPolicy.requireWithinLimit(
                "cameraEvidenceJson",
                "😀".repeat(ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES / 4) + "a",
                ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES,
            )
        }

        assertEquals("cameraEvidenceJson exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun rustBridgeRejectsOversizedCaptureSessionIdBeforeImageOrEvidenceValidation() {
        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = "{}",
                cameraEvidenceJson = "not-json",
                deviceEvidenceJson = "not-json",
                appIdentityHash = APP_IDENTITY_HASH,
                captureSessionId = "a".repeat(
                    ArgusProofTextPolicy.MAX_CANONICAL_MANIFEST_JSON_BYTES + 1,
                ),
                sessionNonce = SESSION_NONCE,
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = byteArrayOf(),
            )
        }

        assertEquals("captureSessionId exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun rustBridgeRejectsOversizedCanonicalManifestJsonBeforeReturningProof() {
        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = "{}",
                cameraEvidenceJson = cameraEvidenceJson(),
                deviceEvidenceJson = deviceEvidenceJson(),
                appIdentityHash = APP_IDENTITY_HASH,
                captureSessionId = "a".repeat(
                    ArgusProofTextPolicy.MAX_CANONICAL_MANIFEST_JSON_BYTES - 1,
                ),
                sessionNonce = SESSION_NONCE,
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = sampleJpegBytes(),
            )
        }

        assertEquals("canonicalManifestJson exceeds Argus JSON text limit", error.message)
    }

    @Test
    fun rustBridgeRejectsZeroSessionNonce() {
        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = "{}",
                cameraEvidenceJson = cameraEvidenceJson(),
                deviceEvidenceJson = deviceEvidenceJson(),
                appIdentityHash = APP_IDENTITY_HASH,
                captureSessionId = "capture-session-001",
                sessionNonce = "0".repeat(64),
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = sampleJpegBytes(),
            )
        }

        assertEquals("sessionNonce must be a non-zero 32-byte hex string", error.message)
    }

    @Test
    fun rustBridgeRejectsZeroAppIdentityHash() {
        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = "{}",
                cameraEvidenceJson = cameraEvidenceJson(),
                deviceEvidenceJson = deviceEvidenceJson(),
                appIdentityHash = "0".repeat(64),
                captureSessionId = "capture-session-001",
                sessionNonce = SESSION_NONCE,
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = sampleJpegBytes(),
            )
        }

        assertEquals("appIdentityHash must be a non-zero 32-byte hex string", error.message)
    }

    @Test
    fun keystoreEvidenceValidatesLevel3ProofBindingSignature() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val keyPair = ecKeyPair()
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(keyPair, bindingData)

        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
            bindingData = bindingData,
        )

        assertTrue(validation.claimedSigned)
        assertTrue(validation.signaturePresent)
        assertFalse(validation.attestationPresent)
        assertEquals(3, validation.level)
        assertEquals(publicKeyPem(keyPair), validation.publicKeyPem)
    }

    @Test
    fun keystoreEvidenceRejectsSignedPayloadJsonMismatch() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val keyPair = ecKeyPair()
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(
            keyPair,
            bindingData,
            signedPayloadJson = bindingData.replace("marketplace_listing", "marketplace_listing_changed"),
        )

        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
            bindingData = bindingData,
        )

        assertTrue(validation.claimedSigned)
        assertFalse(validation.signaturePresent)
    }

    @Test
    fun keystoreEvidenceRejectsMismatchedPublicKeyPem() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val signingKeyPair = ecKeyPair()
        val otherKeyPair = ecKeyPair()
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(
            signingKeyPair,
            bindingData,
            publicKeyPem = publicKeyPem(otherKeyPair),
        )

        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
            bindingData = bindingData,
        )

        assertTrue(validation.claimedSigned)
        assertFalse(validation.signaturePresent)
    }

    @Test
    fun keystoreValidationDoesNotTrustClaimedLevelWithoutSignatureMaterial() {
        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = """{"androidEvidenceLevel":4,"keystoreSignature":false}""",
            bindingData = "{}",
        )

        assertFalse(validation.claimedSigned)
        assertFalse(validation.signaturePresent)
        assertFalse(validation.attestationPresent)
        assertEquals(2, validation.level)
    }

    @Test
    fun keystoreEvidencePreservesLevel4MaterialWithoutClaimingLevel4BeforeRootValidation() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val keyPair = ecKeyPair()
        val certificatePem = "-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----"
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(
            keyPair = keyPair,
            bindingData = bindingData,
            level = 3,
            securityLevel = "keystore_signature_attestation_material_root_unverified",
            level4AttestationMaterial = true,
            attestationJson = level4AttestationJson(
                publicKeyPem = publicKeyPem(keyPair),
                certificatePem = certificatePem,
            ),
        )

        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
            bindingData = bindingData,
        )

        assertTrue(validation.signaturePresent)
        assertTrue(validation.attestationMaterialPresent)
        assertFalse(validation.attestationPresent)
        assertEquals(3, validation.level)
        assertEquals("keystore_signature_attestation_material_root_unverified", validation.securityLevel)
        assertEquals(listOf(certificatePem), validation.attestationCertificateChainPem)
    }

    @Test
    fun keystoreEvidenceFallsBackToLevel3WhenLevel4ChallengeDoesNotMatchBinding() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val keyPair = ecKeyPair()
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(
            keyPair = keyPair,
            bindingData = bindingData,
            level = 3,
            securityLevel = "keystore_signature_attestation_material_root_unverified",
            level4AttestationMaterial = true,
            attestationJson = level4AttestationJson(
                publicKeyPem = publicKeyPem(keyPair),
                challengeHex = OTHER_APP_IDENTITY_HASH,
            ),
        )

        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
            bindingData = bindingData,
        )

        assertTrue(validation.signaturePresent)
        assertFalse(validation.attestationMaterialPresent)
        assertFalse(validation.attestationPresent)
        assertEquals(3, validation.level)
        assertEquals("keystore_signature", validation.securityLevel)
    }

    @Test
    fun keystoreEvidenceFallsBackToLevel3WithoutVerifierPemCertificateChain() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val keyPair = ecKeyPair()
        val keyPem = publicKeyPem(keyPair)
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(
            keyPair = keyPair,
            bindingData = bindingData,
            level = 3,
            securityLevel = "keystore_signature_attestation_material_root_unverified",
            level4AttestationMaterial = true,
            attestationJson = """
                {"requested":true,"available":true,"attestationChallengeHex":"$SESSION_NONCE","challengeSha256":"${sha256Hex(SESSION_NONCE.chunked(2).map { it.toInt(16).toByte() }.toByteArray())}","certificateChainBase64":["AQID"],"certificateChainPem":[],"certificateChainSha256":["${sha256Hex(byteArrayOf(1, 2, 3))}"],"hardwareBacked":true,"publicKeyPem":"${escapeJson(keyPem)}","securityLevel":"hardware_backed_chain_present","fallbackReason":""}
            """.trimIndent(),
        )

        val validation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
            bindingData = bindingData,
        )

        assertTrue(validation.signaturePresent)
        assertFalse(validation.attestationMaterialPresent)
        assertFalse(validation.attestationPresent)
        assertEquals(3, validation.level)
    }

    @Test
    fun nativeEvidenceDoesNotPromoteLocalOnlyKeystoreShapeToLevel3() {
        val localOnlyKeystoreEvidence = mapOf(
            "available" to true,
            "level" to 3,
            "algorithm" to "SHA256withECDSA",
            "bindingSha256" to "a".repeat(64),
            "publicKeySpkiBase64" to "AQID",
            "signatureBase64" to "AQID",
            "fallbackReason" to "level4_unavailable",
            "attestation" to mapOf(
                "available" to false,
                "certificateChainBase64" to emptyList<String>(),
            ),
        )

        assertFalse(ArgusEvidenceCollector.isVerifierCompatibleLevel3Evidence(localOnlyKeystoreEvidence))
    }

    @Test
    fun nativeEvidenceRecognizesVerifierCompatibleLevel3Shape() {
        val verifierCompatibleKeystoreEvidence = mapOf(
            "available" to true,
            "level" to 3,
            "algorithm" to "SHA256withECDSA",
            "bindingFormat" to "argus.keystore.binding.v1",
            "bindingSha256" to "a".repeat(64),
            "publicKeyPem" to "-----BEGIN PUBLIC KEY-----\nAQID\n-----END PUBLIC KEY-----",
            "publicKeySpkiBase64" to "AQID",
            "signatureBase64" to "AQID",
            "signedPayloadJson" to "{\"schema\":\"argus.android.keystore.v1\"}",
        )

        assertTrue(ArgusEvidenceCollector.isVerifierCompatibleLevel3Evidence(verifierCompatibleKeystoreEvidence))
    }

    @Test
    fun nativeEvidenceRecognizesLevel4MaterialFromKeystoreShape() {
        val publicKeyPem = "-----BEGIN PUBLIC KEY-----\nAQID\n-----END PUBLIC KEY-----"
        val verifierCompatibleKeystoreEvidence = mapOf(
            "available" to true,
            "level" to 3,
            "algorithm" to "SHA256withECDSA",
            "bindingFormat" to "argus.keystore.binding.v1",
            "bindingSha256" to "a".repeat(64),
            "publicKeyPem" to publicKeyPem,
            "publicKeySpkiBase64" to "AQID",
            "signatureBase64" to "AQID",
            "signedPayloadJson" to "{\"schema\":\"argus.keystore.binding.v1\"}",
            "level4AttestationMaterial" to true,
            "attestation" to mapOf(
                "available" to true,
                "hardwareBacked" to true,
                "attestationChallengeHex" to SESSION_NONCE,
                "publicKeyPem" to publicKeyPem,
                "certificateChainPem" to listOf("-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----"),
                "certificateChainBase64" to listOf("AQID"),
            ),
        )

        assertTrue(ArgusEvidenceCollector.hasVerifierCompatibleLevel4Material(verifierCompatibleKeystoreEvidence))
    }

    @Test
    fun nativeEvidenceFallsBackToLevel3UntilRelayerRootValidation() {
        val publicKeyPem = "-----BEGIN PUBLIC KEY-----\nAQID\n-----END PUBLIC KEY-----"
        val level4Material = mapOf(
            "available" to true,
            "level" to 3,
            "algorithm" to "SHA256withECDSA",
            "bindingFormat" to "argus.keystore.binding.v1",
            "bindingSha256" to "a".repeat(64),
            "publicKeyPem" to publicKeyPem,
            "publicKeySpkiBase64" to "AQID",
            "signatureBase64" to "AQID",
            "signedPayloadJson" to "{\"schema\":\"argus.keystore.binding.v1\"}",
            "level4AttestationMaterial" to true,
            "attestation" to mapOf(
                "available" to true,
                "hardwareBacked" to true,
                "attestationChallengeHex" to SESSION_NONCE,
                "publicKeyPem" to publicKeyPem,
                "certificateChainPem" to listOf("-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----"),
                "certificateChainBase64" to listOf("AQID"),
            ),
        )
        val evidence = ArgusEvidenceCollector(
            object : ContextWrapper(null) {
                override fun getPackageName(): String {
                    return "com.argus.test"
                }
            },
        ).collectDeviceEvidence(
            motionSnapshot = emptyMap(),
            keystoreEvidence = level4Material,
            appIdentityHash = APP_IDENTITY_HASH,
        )
        val hardwareAttestation = evidence["hardwareAttestation"] as Map<*, *>

        assertEquals(3, evidence["androidEvidenceLevel"])
        assertEquals("level_3_keystore_signature", evidence["evidenceLevel"])
        assertEquals("level_4_material_present_pending_relayer_root_validation", evidence["attestationStatus"])
        assertEquals(true, evidence["level4AttestationMaterial"])
        assertEquals(false, evidence["level4HardwareAttestation"])
        assertEquals(listOf("AQID"), evidence["attestationCertificateChainBase64"])
        assertEquals(false, hardwareAttestation["supported"])
        assertEquals(false, hardwareAttestation["rootValidated"])
        assertEquals("attestation_root_validation_required", hardwareAttestation["reason"])
    }

    @Test
    fun rustBridgeRejectsClaimedKeystoreSignatureWithWrongBinding() {
        val bindingData = ArgusKeystoreEvidence.canonicalProofBindingData(proofBindingInput())
        val wrongBindingData = bindingData.replace("marketplace_listing", "marketplace_listing_changed")
        val keyPair = ecKeyPair()
        val keystoreEvidenceJson = level3KeystoreEvidenceJson(keyPair, wrongBindingData)

        val error = assertFailsWith<IllegalArgumentException> {
            ArgusRustBridge().createProof(
                partnerId = "recommerce-demo",
                useCase = "marketplace_listing",
                metadataJson = "{}",
                cameraEvidenceJson = cameraEvidenceJson(),
                deviceEvidenceJson = deviceEvidenceJson(keystoreSignatureJson = keystoreEvidenceJson),
                appIdentityHash = APP_IDENTITY_HASH,
                captureSessionId = "capture-session-001",
                sessionNonce = SESSION_NONCE,
                capturedAtMs = CAPTURED_AT_MS,
                imageBytes = sampleJpegBytes(),
            )
        }

        assertEquals("keystoreSignature must verify canonical proof binding data", error.message)
    }

    @Test
    fun rustBridgeRejectsMotionSnapshotWithoutSensorSamples() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(
                deviceEvidenceJson = """
                    {"appIdentityHash":"$APP_IDENTITY_HASH","appIdentityHashPresent":true,"motionSnapshot":{"available":true,"sampledAtMs":$CAPTURED_AT_MS,"sampleWindowMs":180}}
                """.trimIndent(),
            )
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithMismatchedCaptureTime() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(cameraEvidenceJson = cameraEvidenceJson(capturedAtMs = CAPTURED_AT_MS - 1L))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsStaleCameraEvidence() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(
                cameraEvidenceJson = cameraEvidenceJson(
                    collectedAtMs = CAPTURED_AT_MS + 10_000L,
                    captureEvidenceDelayMs = 10_000L,
                ),
            )
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceDelayMismatch() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(
                cameraEvidenceJson = cameraEvidenceJson(
                    collectedAtMs = CAPTURED_AT_MS + 250L,
                    captureEvidenceDelayMs = 1L,
                ),
            )
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithNonIntegerCaptureTime() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(
                cameraEvidenceJson = """
                    {"cameraMetadata":true,"noGalleryImport":true,"captureSurface":"native_android_camera","capturedAtMs":$CAPTURED_AT_MS.0,"capturedFileBytes":34,"collectedAtMs":${CAPTURED_AT_MS + 250L},"captureEvidenceDelayMs":250}
                """.trimIndent(),
            )
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithoutCapturedFileBytes() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(
                cameraEvidenceJson = """
                    {"cameraMetadata":true,"noGalleryImport":true,"captureSurface":"native_android_camera","capturedAtMs":$CAPTURED_AT_MS,"collectedAtMs":${CAPTURED_AT_MS + 250L},"captureEvidenceDelayMs":250}
                """.trimIndent(),
            )
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithZeroCapturedFileBytes() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(cameraEvidenceJson = cameraEvidenceJson(capturedFileBytes = 0L))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithMismatchedCapturedFileBytes() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(cameraEvidenceJson = cameraEvidenceJson(capturedFileBytes = 35L))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsCameraEvidenceWithDecimalCapturedFileBytes() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(
                cameraEvidenceJson = """
                    {"cameraMetadata":true,"noGalleryImport":true,"captureSurface":"native_android_camera","capturedAtMs":$CAPTURED_AT_MS,"capturedFileBytes":34.0,"collectedAtMs":${CAPTURED_AT_MS + 250L},"captureEvidenceDelayMs":250}
                """.trimIndent(),
            )
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsAppIdentityMismatch() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(deviceEvidenceJson = deviceEvidenceJson(appIdentityHash = OTHER_APP_IDENTITY_HASH))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsStaleMotionSnapshot() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(deviceEvidenceJson = deviceEvidenceJson(sampledAtMs = CAPTURED_AT_MS - 3_000L))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    @Test
    fun rustBridgeRejectsWideMotionSnapshotWindow() {
        val error = assertFailsWith<IllegalArgumentException> {
            validateBridgeEvidence(deviceEvidenceJson = deviceEvidenceJson(sampleWindowMs = 10_000L))
        }

        assertEquals(
            "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            error.message,
        )
    }

    private fun sampleJpegBytes(): ByteArray {
        return byteArrayOf(
            0xff.toByte(),
            0xd8.toByte(),
            0xff.toByte(),
            0xe0.toByte(),
            0x00,
            0x04,
            0x00,
            0x00,
            0xff.toByte(),
            0xc0.toByte(),
            0x00,
            0x0b,
            0x08,
            0x00,
            0x01,
            0x00,
            0x01,
            0x01,
            0x01,
            0x11,
            0x00,
            0xff.toByte(),
            0xda.toByte(),
            0x00,
            0x08,
            0x01,
            0x01,
            0x00,
            0x00,
            0x3f,
            0x00,
            0x00,
            0xff.toByte(),
            0xd9.toByte(),
        )
    }

    private fun jpegBytesOfLength(byteLength: Int): ByteArray {
        val sample = sampleJpegBytes()
        require(byteLength >= sample.size)
        val bytes = ByteArray(byteLength)
        sample.copyInto(bytes, 0, 0, sample.size - 2)
        sample.copyInto(bytes, byteLength - 2, sample.size - 2, sample.size)
        return bytes
    }

    private fun duplicateStartOfFrameJpegBytes(): ByteArray {
        val sample = sampleJpegBytes()
        val duplicateStartOfFrameSegment = sample.sliceArray(8 until 21).toList()
        return sample.toMutableList().also { bytes ->
            bytes.addAll(21, duplicateStartOfFrameSegment)
        }.toByteArray()
    }

    private fun twoComponentJpegBytes(
        secondFrameComponentId: Byte = 0x02,
        secondScanComponentId: Byte = 0x02,
    ): ByteArray {
        return byteArrayOf(
            0xff.toByte(),
            0xd8.toByte(),
            0xff.toByte(),
            0xe0.toByte(),
            0x00,
            0x04,
            0x00,
            0x00,
            0xff.toByte(),
            0xc0.toByte(),
            0x00,
            0x0e,
            0x08,
            0x00,
            0x01,
            0x00,
            0x01,
            0x02,
            0x01,
            0x11,
            0x00,
            secondFrameComponentId,
            0x11,
            0x00,
            0xff.toByte(),
            0xda.toByte(),
            0x00,
            0x0a,
            0x02,
            0x01,
            0x00,
            secondScanComponentId,
            0x00,
            0x00,
            0x3f,
            0x00,
            0x00,
            0xff.toByte(),
            0xd9.toByte(),
        )
    }

    private fun tempDir(): File {
        return File(createTempDirectory("argus-capture-policy-").pathString)
    }

    private fun validateBridgeEvidence(
        cameraEvidenceJson: String = cameraEvidenceJson(),
        deviceEvidenceJson: String = deviceEvidenceJson(),
    ) {
        ArgusEvidencePolicy.validateAppCaptureEvidence(
            cameraEvidenceJson = cameraEvidenceJson,
            deviceEvidenceJson = deviceEvidenceJson,
            expectedAppIdentityHash = APP_IDENTITY_HASH,
            expectedCapturedFileBytes = sampleJpegBytes().size.toLong(),
            capturedAtMs = CAPTURED_AT_MS,
        )
    }

    private fun cameraEvidenceJson(
        captureSurface: String = "native_android_camera",
        capturedAtMs: Long = CAPTURED_AT_MS,
        capturedFileBytes: Long = 34L,
        collectedAtMs: Long = CAPTURED_AT_MS + 250L,
        captureEvidenceDelayMs: Long = 250L,
    ): String {
        return """
            {"cameraMetadata":true,"noGalleryImport":true,"captureSurface":"$captureSurface","capturedAtMs":$capturedAtMs,"capturedFileBytes":$capturedFileBytes,"collectedAtMs":$collectedAtMs,"captureEvidenceDelayMs":$captureEvidenceDelayMs}
        """.trimIndent()
    }

    private fun deviceEvidenceJson(
        sampledAtMs: Long = CAPTURED_AT_MS,
        sampleWindowMs: Long = 180L,
        appIdentityHash: String = APP_IDENTITY_HASH,
        keystoreSignatureJson: String? = null,
    ): String {
        val keystoreEvidence = keystoreSignatureJson?.let { ""","keystoreSignature":$it""" } ?: ""
        return """
            {"appIdentityHash":"$appIdentityHash","appIdentityHashPresent":true$keystoreEvidence,"motionSnapshot":{"available":true,"accelerometerAvailable":true,"gyroscopeAvailable":true,"accelerometer":[0.1,0.2,0.3],"gyroscope":[0.4,0.5,0.6],"sampledAtMs":$sampledAtMs,"sampleWindowMs":$sampleWindowMs}}
        """.trimIndent()
    }

    private fun proofBindingInput(): ArgusKeystoreEvidence.ProofBindingInput {
        return ArgusKeystoreEvidence.ProofBindingInput(
            partnerId = "recommerce-demo",
            useCase = "marketplace_listing",
            metadataJson = "{}",
            cameraEvidenceJson = cameraEvidenceJson(),
            appIdentityHash = APP_IDENTITY_HASH,
            captureSessionId = "capture-session-001",
            sessionNonce = SESSION_NONCE,
            capturedAtMs = CAPTURED_AT_MS,
            imageBytes = sampleJpegBytes(),
        )
    }

    private fun ecKeyPair(): KeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        return generator.generateKeyPair()
    }

    private fun level3KeystoreEvidenceJson(
        keyPair: KeyPair,
        bindingData: String,
        publicKeyPem: String = publicKeyPem(keyPair),
        signedPayloadJson: String = bindingData,
        level: Int = 3,
        securityLevel: String = "software",
        level4AttestationMaterial: Boolean = false,
        attestationJson: String? = null,
    ): String {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(keyPair.private)
        signature.update(bindingData.toByteArray())
        val signatureBase64 = Base64.getEncoder().encodeToString(signature.sign())
        val publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.public.encoded)
        val bindingSha256 = sha256Hex(bindingData.toByteArray())
        val attestation = attestationJson
            ?: """{"requested":false,"available":false,"challengeSha256":"$bindingSha256","certificateChainBase64":[],"certificateChainSha256":[],"securityLevel":"software","fallbackReason":""}"""
        return """
            {"available":true,"level":$level,"algorithm":"SHA256withECDSA","bindingFormat":"argus.keystore.binding.v1","bindingSha256":"$bindingSha256","publicKeyAlgorithm":"EC","publicKeyPem":"${escapeJson(publicKeyPem)}","publicKeySpkiBase64":"$publicKeyBase64","signatureBase64":"$signatureBase64","signedPayloadJson":"${escapeJson(signedPayloadJson)}","securityLevel":"$securityLevel","level4AttestationMaterial":$level4AttestationMaterial,"fallbackReason":"level4_unavailable","attestation":$attestation}
        """.trimIndent()
    }

    private fun level4AttestationJson(
        publicKeyPem: String,
        challengeHex: String = SESSION_NONCE,
        certificatePem: String = "-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----",
    ): String {
        return """
            {"requested":true,"available":true,"attestationChallengeHex":"$challengeHex","challengeSha256":"${sha256Hex(challengeHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray())}","certificateChainBase64":["AQID"],"certificateChainPem":["${escapeJson(certificatePem)}"],"certificateChainSha256":["${sha256Hex(byteArrayOf(1, 2, 3))}"],"hardwareBacked":true,"publicKeyPem":"${escapeJson(publicKeyPem)}","securityLevel":"hardware_backed_chain_present","fallbackReason":""}
        """.trimIndent()
    }

    private fun publicKeyPem(keyPair: KeyPair): String {
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(keyPair.public.encoded)
        return "-----BEGIN PUBLIC KEY-----\n$body\n-----END PUBLIC KEY-----"
    }

    private fun escapeJson(value: String): String {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }

    companion object {
        private const val CAPTURED_AT_MS = 1_777_000_000_000L
        private const val APP_IDENTITY_HASH =
            "0909090909090909090909090909090909090909090909090909090909090909"
        private const val OTHER_APP_IDENTITY_HASH =
            "1010101010101010101010101010101010101010101010101010101010101010"
        private const val SESSION_NONCE =
            "0707070707070707070707070707070707070707070707070707070707070707"
    }
}
