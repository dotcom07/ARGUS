package com.argus

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.nio.file.LinkOption
import java.nio.file.Files
import java.nio.file.attribute.BasicFileAttributes

internal object ArgusCaptureFilePolicy {
    private const val MAX_CAPTURE_FILE_TIMESTAMP_DELTA_MS = 5_000L
    private const val READ_BUFFER_BYTES = 8 * 1024
    private val ARGUS_CAPTURE_FILE_NAME_PATTERN = Regex("^argus_capture_[1-9][0-9]*\\.jpg$")

    private data class CaptureFileIdentity(
        val fileKey: Any?,
        val creationTimeMs: Long,
    )

    fun reserveCaptureFile(cacheDir: File, capturedAtMs: Long): File? {
        if (capturedAtMs <= 0L) {
            return null
        }

        val outputFile = File(cacheDir, expectedFileName(capturedAtMs))
        val createdCaptureFile = try {
            outputFile.createNewFile()
        } catch (error: IOException) {
            false
        }

        return if (createdCaptureFile) outputFile else null
    }

    fun deleteCreatedCaptureFile(outputFile: File, cacheDir: File): Boolean {
        return try {
            // kr: cleanup은 CameraX용으로 예약한 일반 파일만 지웁니다. raw File 인자가 cache 안의 directory/symlink를 지우게 두지 않습니다.
            // en: Cleanup deletes only regular files reserved for CameraX; a raw File argument must not delete cache directories or symlinks.
            if (
                isArgusCaptureFileName(outputFile.name) &&
                isDirectPrivateCacheChild(outputFile, cacheDir) &&
                outputFile.isFile &&
                !isSymbolicLink(outputFile)
            ) {
                outputFile.delete()
            } else {
                false
            }
        } catch (error: IOException) {
            false
        }
    }

    fun isAllowedCaptureFile(captureFile: File, cacheDir: File, capturedAtMs: Long): Boolean {
        return allowedCaptureFile(captureFile, cacheDir, capturedAtMs) != null
    }

    fun allowedCaptureFile(captureFile: File, cacheDir: File, capturedAtMs: Long): File? {
        if (capturedAtMs <= 0L) {
            return null
        }

        val expectedFileName = expectedFileName(capturedAtMs)
        if (captureFile.name != expectedFileName) {
            return null
        }

        val canonicalCacheDir = cacheDir.canonicalFile
        if (!isDirectPrivateCacheChild(captureFile, cacheDir)) {
            return null
        }

        val canonicalCaptureFile = captureFile.canonicalFile
        if (canonicalCaptureFile.parentFile != canonicalCacheDir) {
            return null
        }

        if (canonicalCaptureFile.name != expectedFileName) {
            return null
        }

        if (!canonicalCaptureFile.isFile || canonicalCaptureFile.length() <= 0L) {
            return null
        }

        if (canonicalCaptureFile.length() > ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES.toLong()) {
            return null
        }

        val modifiedAtMs = canonicalCaptureFile.lastModified()
        if (modifiedAtMs <= 0L) {
            return null
        }

        if (kotlin.math.abs(modifiedAtMs - capturedAtMs) > MAX_CAPTURE_FILE_TIMESTAMP_DELTA_MS) {
            return null
        }

        return canonicalCaptureFile
    }

    fun readBytesWithinNativeCaptureLimit(
        captureFile: File,
        cacheDir: File,
        capturedAtMs: Long,
        beforePostReadValidation: (() -> Unit)? = null,
    ): ByteArray? {
        // kr: CameraX가 private cache에 쓴 파일만 읽고, 읽기 전후 path/file identity/length/mtime이 그대로인지 확인합니다.
        // en: Read only the CameraX private-cache file, then verify path/file identity/length/mtime before and after the read.
        // kr: 이 검사는 앱 내부 file swap/race 방어용이며 camera sensor가 bytes를 서명했다는 뜻은 아닙니다.
        // en: This is an app-internal file-swap/race guard, not evidence that the camera sensor signed the bytes.
        val canonicalCaptureFile = allowedCaptureFile(captureFile, cacheDir, capturedAtMs) ?: return null
        if (isSymbolicLink(canonicalCaptureFile)) {
            return null
        }
        val initialCanonicalPath = canonicalCaptureFile.canonicalPath
        val initialIdentity = captureFileIdentity(canonicalCaptureFile) ?: return null
        val initialLength = canonicalCaptureFile.length()
        val initialModifiedAtMs = canonicalCaptureFile.lastModified()

        return try {
            FileInputStream(canonicalCaptureFile).use { input ->
                val initialCapacity = minOf(
                    initialLength,
                    ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES.toLong(),
                ).toInt()
                val output = ByteArrayOutputStream(initialCapacity)
                val buffer = ByteArray(READ_BUFFER_BYTES)
                var totalBytes = 0L

                while (true) {
                    val bytesRead = input.read(buffer)
                    if (bytesRead == -1) {
                        break
                    }

                    totalBytes += bytesRead.toLong()
                    if (totalBytes > ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES.toLong()) {
                        return null
                    }

                    output.write(buffer, 0, bytesRead)
                }

                beforePostReadValidation?.invoke()

                if (
                    totalBytes <= 0L ||
                    totalBytes != initialLength ||
                    !captureFileStillMatches(
                        canonicalCaptureFile,
                        cacheDir,
                        capturedAtMs,
                        initialCanonicalPath,
                        initialIdentity,
                        initialLength,
                        initialModifiedAtMs,
                    )
                ) {
                    return null
                }

                output.toByteArray()
            }
        } catch (error: IOException) {
            null
        }
    }

    private fun captureFileStillMatches(
        captureFile: File,
        cacheDir: File,
        capturedAtMs: Long,
        expectedCanonicalPath: String,
        expectedIdentity: CaptureFileIdentity,
        expectedLength: Long,
        expectedModifiedAtMs: Long,
    ): Boolean {
        val allowedFile = allowedCaptureFile(captureFile, cacheDir, capturedAtMs) ?: return false
        val currentIdentity = captureFileIdentity(allowedFile) ?: return false
        return allowedFile.canonicalPath == expectedCanonicalPath &&
            sameCaptureFileIdentity(currentIdentity, expectedIdentity) &&
            allowedFile.length() == expectedLength &&
            allowedFile.lastModified() == expectedModifiedAtMs &&
            !isSymbolicLink(allowedFile)
    }

    private fun captureFileIdentity(file: File): CaptureFileIdentity? {
        return try {
            val attributes = Files.readAttributes(
                file.toPath(),
                BasicFileAttributes::class.java,
                LinkOption.NOFOLLOW_LINKS,
            )
            if (!attributes.isRegularFile) {
                return null
            }

            CaptureFileIdentity(
                fileKey = attributes.fileKey(),
                creationTimeMs = attributes.creationTime().toMillis(),
            )
        } catch (error: Exception) {
            null
        }
    }

    private fun sameCaptureFileIdentity(
        current: CaptureFileIdentity,
        expected: CaptureFileIdentity,
    ): Boolean {
        if (current.fileKey != null || expected.fileKey != null) {
            return current.fileKey == expected.fileKey
        }

        return current.creationTimeMs == expected.creationTimeMs
    }

    private fun isSymbolicLink(file: File): Boolean {
        return try {
            Files.isSymbolicLink(file.toPath())
        } catch (error: Exception) {
            true
        }
    }

    private fun isArgusCaptureFileName(fileName: String): Boolean {
        return ARGUS_CAPTURE_FILE_NAME_PATTERN.matches(fileName)
    }

    private fun isDirectPrivateCacheChild(file: File, cacheDir: File): Boolean {
        return try {
            val rawCacheDir = cacheDir.absoluteFile
            val canonicalCacheDir = cacheDir.canonicalFile
            val rawParentFile = file.absoluteFile.parentFile ?: return false
            // kr: raw Android path와 canonical path가 모두 private cache 바로 아래여야 trusted capture/cleanup 대상으로 봅니다.
            // en: Both the raw Android path and canonical path must sit directly under private cache before capture/cleanup trust is applied.
            if (
                rawParentFile.absoluteFile != rawCacheDir &&
                rawParentFile.absoluteFile != canonicalCacheDir
            ) {
                return false
            }

            rawParentFile.canonicalFile == canonicalCacheDir
        } catch (error: IOException) {
            false
        }
    }

    private fun expectedFileName(capturedAtMs: Long): String {
        return "argus_capture_$capturedAtMs.jpg"
    }
}
