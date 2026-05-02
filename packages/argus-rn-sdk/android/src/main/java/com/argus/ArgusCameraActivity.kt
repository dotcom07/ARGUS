package com.argus

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File

class ArgusCameraActivity : ComponentActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var captureButton: Button
    private var imageCapture: ImageCapture? = null
    private var pendingCaptureFile: File? = null

    // kr: onCreate는 CameraX preview와 capture button을 붙일 Android 화면의 시작점입니다.
    // en: onCreate is the Android screen entry point where CameraX preview and capture button attach.
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildCaptureLayout()

        if (hasCameraPermission()) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                CAMERA_PERMISSION_REQUEST,
            )
        }
    }

    // kr: onRequestPermissionsResult는 camera 권한이 허용된 뒤 native capture flow를 시작합니다.
    // en: onRequestPermissionsResult starts the native capture flow after camera permission is granted.
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == CAMERA_PERMISSION_REQUEST && hasCameraPermission()) {
            startCamera()
            return
        }

        setResult(RESULT_CANCELED)
        finish()
    }

    override fun onDestroy() {
        pendingCaptureFile?.let { outputFile ->
            ArgusCaptureFilePolicy.deleteCreatedCaptureFile(outputFile, cacheDir)
            pendingCaptureFile = null
        }
        super.onDestroy()
    }

    // kr: buildCaptureLayout은 검증 촬영 전용 preview와 shutter button만 보여줍니다.
    // en: buildCaptureLayout shows only the verified-capture preview and shutter button.
    private fun buildCaptureLayout() {
        previewView = PreviewView(this)
        captureButton = Button(this)
        captureButton.text = "Take verified photo"
        captureButton.setOnClickListener { captureImage() }

        val layout = LinearLayout(this)
        layout.orientation = LinearLayout.VERTICAL
        layout.addView(
            previewView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )
        layout.addView(
            captureButton,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ),
        )
        setContentView(layout)
    }

    // kr: startCamera는 gallery import 없이 CameraX preview와 ImageCapture를 구성합니다.
    // en: startCamera configures CameraX preview and ImageCapture without any gallery import path.
    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener(
            {
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build()
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()

                preview.setSurfaceProvider(previewView.surfaceProvider)
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageCapture,
                )
            },
            ContextCompat.getMainExecutor(this),
        )
    }

    // kr: captureImage는 CameraX가 저장한 파일을 즉시 다시 읽어 RN module이 나중에 같은 bytes만 binding하게 합니다.
    // en: captureImage immediately rereads the CameraX output so the RN module can bind only the same bytes later.
    private fun captureImage() {
        val capture = imageCapture ?: return
        if (pendingCaptureFile != null) {
            return
        }

        captureButton.isEnabled = false
        val motionSnapshot = ArgusEvidenceCollector(this).collectMotionSnapshot()
        val capturedAtMs = System.currentTimeMillis()
        val outputFile = ArgusCaptureFilePolicy.reserveCaptureFile(cacheDir, capturedAtMs)
        if (outputFile == null) {
            setResult(RESULT_CANCELED)
            finish()
            return
        }
        pendingCaptureFile = outputFile
        val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()

        capture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    if (!outputFile.setLastModified(capturedAtMs)) {
                        ArgusCaptureFilePolicy.deleteCreatedCaptureFile(outputFile, cacheDir)
                        pendingCaptureFile = null
                        setResult(RESULT_CANCELED)
                        finish()
                        return
                    }
                    val imageBytes = ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                        outputFile,
                        cacheDir,
                        capturedAtMs,
                    )
                    if (imageBytes == null) {
                        ArgusCaptureFilePolicy.deleteCreatedCaptureFile(outputFile, cacheDir)
                        pendingCaptureFile = null
                        setResult(RESULT_CANCELED)
                        finish()
                        return
                    }

                    pendingCaptureFile = null
                    finishWithCapture(
                        outputFile,
                        capturedAtMs,
                        motionSnapshot,
                        imageBytes.size.toLong(),
                        ArgusImageBytesPolicy.sha256Hex(imageBytes),
                    )
                }

                override fun onError(exception: ImageCaptureException) {
                    ArgusCaptureFilePolicy.deleteCreatedCaptureFile(outputFile, cacheDir)
                    pendingCaptureFile = null
                    setResult(RESULT_CANCELED)
                    finish()
                }
            },
        )
    }

    // kr: finishWithCapture는 private cache path와 저장 직후의 byte binding을 함께 반환합니다.
    // en: finishWithCapture returns the private cache path plus the just-saved byte binding.
    // kr: 이 binding은 post-capture file swap을 막는 경계이며, 물리 camera sensor 서명은 아닙니다.
    // en: This binding blocks post-capture file swaps; it is not a physical camera-sensor signature.
    private fun finishWithCapture(
        outputFile: File,
        capturedAtMs: Long,
        motionSnapshot: Map<String, Any>,
        captureFileBytes: Long,
        captureBytesSha256: String,
    ) {
        val result = Intent()
        result.putExtra(EXTRA_CAPTURE_PATH, outputFile.absolutePath)
        result.putExtra(EXTRA_CAPTURED_AT_MS, capturedAtMs)
        result.putExtra(EXTRA_CAPTURE_FILE_BYTES, captureFileBytes)
        result.putExtra(EXTRA_CAPTURE_BYTES_SHA256, captureBytesSha256)
        putMotionSnapshot(result, motionSnapshot)
        setResult(RESULT_OK, result)
        finish()
    }

    private fun putMotionSnapshot(result: Intent, motionSnapshot: Map<String, Any>) {
        result.putExtra(EXTRA_MOTION_AVAILABLE, motionSnapshot["available"] as? Boolean ?: false)
        result.putExtra(
            EXTRA_ACCELEROMETER_AVAILABLE,
            motionSnapshot["accelerometerAvailable"] as? Boolean ?: false,
        )
        result.putExtra(
            EXTRA_GYROSCOPE_AVAILABLE,
            motionSnapshot["gyroscopeAvailable"] as? Boolean ?: false,
        )
        result.putExtra(EXTRA_ACCELEROMETER, floatArray(motionSnapshot["accelerometer"]))
        result.putExtra(EXTRA_GYROSCOPE, floatArray(motionSnapshot["gyroscope"]))
        result.putExtra(EXTRA_MOTION_SAMPLED_AT_MS, motionSnapshot["sampledAtMs"] as? Long ?: 0L)
        result.putExtra(EXTRA_MOTION_SAMPLE_WINDOW_MS, motionSnapshot["sampleWindowMs"] as? Long ?: 0L)
    }

    private fun floatArray(value: Any?): FloatArray {
        return (value as? List<*>)
            ?.mapNotNull { item -> (item as? Number)?.toFloat() }
            ?.toFloatArray()
            ?: FloatArray(0)
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA,
        ) == PackageManager.PERMISSION_GRANTED
    }

    companion object {
        const val EXTRA_CAPTURE_PATH = "argusCapturePath"
        const val EXTRA_CAPTURED_AT_MS = "argusCapturedAtMs"
        const val EXTRA_CAPTURE_FILE_BYTES = "argusCaptureFileBytes"
        const val EXTRA_CAPTURE_BYTES_SHA256 = "argusCaptureBytesSha256"
        const val EXTRA_MOTION_AVAILABLE = "argusMotionAvailable"
        const val EXTRA_ACCELEROMETER_AVAILABLE = "argusAccelerometerAvailable"
        const val EXTRA_GYROSCOPE_AVAILABLE = "argusGyroscopeAvailable"
        const val EXTRA_ACCELEROMETER = "argusAccelerometer"
        const val EXTRA_GYROSCOPE = "argusGyroscope"
        const val EXTRA_MOTION_SAMPLED_AT_MS = "argusMotionSampledAtMs"
        const val EXTRA_MOTION_SAMPLE_WINDOW_MS = "argusMotionSampleWindowMs"
        const val EXTRA_PARTNER_ID = "argusPartnerId"
        const val EXTRA_USE_CASE = "argusUseCase"
        private const val CAMERA_PERMISSION_REQUEST = 4207
    }
}
