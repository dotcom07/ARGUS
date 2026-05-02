package com.argus

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt

class ArgusCameraActivity : ComponentActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var captureButton: ShutterButton
    private lateinit var flashButton: TextView
    private lateinit var gridButton: TextView
    private lateinit var flipButton: TextView
    private lateinit var gridOverlay: GridOverlayView
    private lateinit var focusOverlay: FocusOverlayView
    private lateinit var zoomButtons: List<TextView>
    private lateinit var scaleGestureDetector: ScaleGestureDetector

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var pendingCaptureFile: File? = null
    private var cameraLensFacing = CameraSelector.LENS_FACING_BACK
    private var flashMode = ImageCapture.FLASH_MODE_OFF
    private var currentZoomRatio = 1f
    private var lastExposureDragY = 0f
    private var exposureDragRemainder = 0f

    // kr: onCreate는 CameraX preview와 검증 촬영용 controls를 붙이는 Android 화면 시작점입니다.
    // en: onCreate is the Android screen entry point where CameraX preview and verified-capture controls attach.
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

    // kr: buildCaptureLayout은 gallery import 없이 PHOTO 단일 모드 카메라 조작만 노출합니다.
    // en: buildCaptureLayout exposes only PHOTO-mode camera controls without any gallery import path.
    @SuppressLint("ClickableViewAccessibility")
    private fun buildCaptureLayout() {
        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        gridOverlay = GridOverlayView(this)
        focusOverlay = FocusOverlayView(this)
        captureButton = ShutterButton(this).apply {
            contentDescription = "Take verified photo"
            setOnClickListener { captureImage() }
        }
        scaleGestureDetector = ScaleGestureDetector(
            this,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    setZoomRatio(currentZoomRatio * detector.scaleFactor)
                    return true
                }
            },
        )
        previewView.setOnTouchListener { _, event -> handlePreviewTouch(event) }

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        root.addView(previewView, matchParentParams())
        root.addView(gridOverlay, matchParentParams())
        root.addView(focusOverlay, matchParentParams())
        root.addView(buildTopControls(), FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(109),
            Gravity.TOP,
        ))
        root.addView(buildBottomControls(), FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(220),
            Gravity.BOTTOM,
        ))
        setContentView(root)
    }

    private fun handlePreviewTouch(event: MotionEvent): Boolean {
        scaleGestureDetector.onTouchEvent(event)
        if (event.pointerCount > 1) {
            return true
        }

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastExposureDragY = event.y
                exposureDragRemainder = 0f
                focusAt(event.x, event.y)
            }
            MotionEvent.ACTION_MOVE -> {
                adjustExposureByDrag(event.y - lastExposureDragY)
                lastExposureDragY = event.y
            }
        }
        return true
    }

    private fun buildTopControls(): FrameLayout {
        val controls = FrameLayout(this).apply {
            setBackgroundColor(0x99000000.toInt())
            setPadding(dp(16), dp(24), dp(16), dp(12))
        }
        val leftControls = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
        }
        flashButton = topControlButton("⚡/", "Flash off").apply {
            setOnClickListener { cycleFlashMode() }
        }
        gridButton = topControlButton("▦", "Grid on").apply {
            setOnClickListener {
                gridOverlay.isGridEnabled = !gridOverlay.isGridEnabled
                updateGridButton()
            }
        }
        leftControls.addView(flashButton, LinearLayout.LayoutParams(dp(36), dp(36)))
        leftControls.addView(gridButton, LinearLayout.LayoutParams(dp(36), dp(36)).apply {
            marginStart = dp(10)
        })

        val photoLabel = TextView(this).apply {
            gravity = Gravity.CENTER
            text = "ARGUS"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(ACCENT_COLOR)
            letterSpacing = 0.08f
        }
        val closeButton = topControlButton("×", "Cancel capture").apply {
            textSize = 26f
            setOnClickListener {
                setResult(RESULT_CANCELED)
                finish()
            }
        }

        controls.addView(leftControls, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(48),
            Gravity.START or Gravity.BOTTOM,
        ))
        controls.addView(photoLabel, FrameLayout.LayoutParams(
            dp(112),
            dp(40),
            Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM,
        ))
        controls.addView(closeButton, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.END or Gravity.BOTTOM))
        updateFlashButton()
        updateGridButton()
        return controls
    }

    private fun buildBottomControls(): FrameLayout {
        val controls = FrameLayout(this).apply {
            setBackgroundColor(0x99000000.toInt())
        }

        val zoomStrip = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            orientation = LinearLayout.HORIZONTAL
            background = roundedBackground(0x66000000, 32)
            setPadding(dp(8), dp(3), dp(8), dp(3))
        }
        zoomButtons = ZOOM_PRESETS.map { preset ->
            TextView(this).apply {
                gravity = Gravity.CENTER
                text = preset.label
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(0x99FFFFFF.toInt())
                setOnClickListener { setZoomRatio(preset.ratio) }
            }
        }
        zoomButtons.forEach { button ->
            zoomStrip.addView(button, LinearLayout.LayoutParams(dp(38), dp(38)))
        }

        flipButton = TextView(this).apply {
            gravity = Gravity.CENTER
            text = "↻"
            textSize = 30f
            setTextColor(Color.WHITE)
            background = circleBackground(0x66000000)
            contentDescription = "Switch camera"
            setOnClickListener { switchCamera() }
        }
        val modeLabel = TextView(this).apply {
            gravity = Gravity.CENTER
            text = "PHOTO"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(ACCENT_COLOR)
            letterSpacing = 0.08f
        }

        controls.addView(zoomStrip, FrameLayout.LayoutParams(dp(178), dp(42), Gravity.CENTER_HORIZONTAL or Gravity.TOP).apply {
            topMargin = dp(10)
        })
        controls.addView(modeLabel, FrameLayout.LayoutParams(dp(160), dp(28), Gravity.CENTER_HORIZONTAL or Gravity.TOP).apply {
            topMargin = dp(62)
        })
        controls.addView(captureButton, FrameLayout.LayoutParams(dp(86), dp(86), Gravity.CENTER_HORIZONTAL or Gravity.TOP).apply {
            topMargin = dp(92)
        })
        controls.addView(flipButton, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.END or Gravity.TOP).apply {
            topMargin = dp(108)
            marginEnd = dp(32)
        })
        return controls
    }

    // kr: startCamera는 gallery import 없이 CameraX preview와 ImageCapture를 구성합니다.
    // en: startCamera configures CameraX preview and ImageCapture without any gallery import path.
    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener(
            {
                val provider = cameraProviderFuture.get()
                cameraProvider = provider
                bindCamera(provider)
            },
            ContextCompat.getMainExecutor(this),
        )
    }

    private fun bindCamera(provider: ProcessCameraProvider) {
        val selector = cameraSelectorForCurrentLens(provider)
        val preview = Preview.Builder().build()
        val capture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setFlashMode(flashMode)
            .build()

        preview.setSurfaceProvider(previewView.surfaceProvider)
        provider.unbindAll()
        camera = provider.bindToLifecycle(this, selector, preview, capture)
        imageCapture = capture
        currentZoomRatio = camera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1f
        updateZoomButtons()
        updateFlashButton()
        updateFlipButton(provider)
    }

    private fun cameraSelectorForCurrentLens(provider: ProcessCameraProvider): CameraSelector {
        val requested = CameraSelector.Builder()
            .requireLensFacing(cameraLensFacing)
            .build()
        if (provider.hasCamera(requested)) {
            return requested
        }

        cameraLensFacing = CameraSelector.LENS_FACING_BACK
        return CameraSelector.DEFAULT_BACK_CAMERA
    }

    private fun switchCamera() {
        val provider = cameraProvider ?: return
        val nextLensFacing = if (cameraLensFacing == CameraSelector.LENS_FACING_BACK) {
            CameraSelector.LENS_FACING_FRONT
        } else {
            CameraSelector.LENS_FACING_BACK
        }
        val nextSelector = CameraSelector.Builder().requireLensFacing(nextLensFacing).build()
        if (!provider.hasCamera(nextSelector)) {
            return
        }

        cameraLensFacing = nextLensFacing
        currentZoomRatio = 1f
        bindCamera(provider)
    }

    private fun cycleFlashMode() {
        flashMode = when (flashMode) {
            ImageCapture.FLASH_MODE_OFF -> ImageCapture.FLASH_MODE_AUTO
            ImageCapture.FLASH_MODE_AUTO -> ImageCapture.FLASH_MODE_ON
            else -> ImageCapture.FLASH_MODE_OFF
        }
        imageCapture?.flashMode = flashMode
        updateFlashButton()
    }

    private fun focusAt(x: Float, y: Float) {
        val activeCamera = camera ?: return
        val action = FocusMeteringAction.Builder(
            previewView.meteringPointFactory.createPoint(x, y),
            FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE,
        )
            .setAutoCancelDuration(3, TimeUnit.SECONDS)
            .build()
        activeCamera.cameraControl.startFocusAndMetering(action)
        focusOverlay.show(x, y, exposureProgress(activeCamera))
    }

    private fun adjustExposureByDrag(deltaY: Float) {
        val activeCamera = camera ?: return
        val exposureState = activeCamera.cameraInfo.exposureState
        if (!exposureState.isExposureCompensationSupported) {
            return
        }

        exposureDragRemainder += deltaY
        val threshold = dp(8).toFloat()
        if (abs(exposureDragRemainder) < threshold) {
            return
        }

        val range = exposureState.exposureCompensationRange
        val steps = (abs(exposureDragRemainder) / threshold).roundToInt()
        val direction = if (exposureDragRemainder < 0f) 1 else -1
        val nextIndex = (exposureState.exposureCompensationIndex + direction * steps)
            .coerceIn(range.lower, range.upper)
        activeCamera.cameraControl.setExposureCompensationIndex(nextIndex)
        focusOverlay.updateExposure(exposureProgress(activeCamera, nextIndex))
        exposureDragRemainder = 0f
    }

    private fun exposureProgress(activeCamera: Camera, pendingIndex: Int? = null): Float {
        val exposureState = activeCamera.cameraInfo.exposureState
        if (!exposureState.isExposureCompensationSupported) {
            return 0f
        }

        val range = exposureState.exposureCompensationRange
        val spread = (range.upper - range.lower).toFloat()
        if (spread <= 0f) {
            return 0f
        }
        val index = pendingIndex ?: exposureState.exposureCompensationIndex
        return (((index - range.lower) / spread) * 2f - 1f).coerceIn(-1f, 1f)
    }

    private fun setZoomRatio(requestedRatio: Float) {
        val activeCamera = camera ?: return
        val zoomState = activeCamera.cameraInfo.zoomState.value ?: return
        val nextRatio = requestedRatio.coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)
        currentZoomRatio = nextRatio
        activeCamera.cameraControl.setZoomRatio(nextRatio)
        updateZoomButtons()
    }

    private fun updateZoomButtons() {
        val zoomState = camera?.cameraInfo?.zoomState?.value
        zoomButtons.forEachIndexed { index, button ->
            val ratio = ZOOM_PRESETS[index].ratio
            val supported = zoomState == null || ratio in zoomState.minZoomRatio..zoomState.maxZoomRatio
            val selected = abs(currentZoomRatio - ratio) < 0.12f
            button.isEnabled = supported
            button.alpha = if (supported) 1f else 0.35f
            button.setTextColor(if (selected) ACCENT_COLOR else 0x99FFFFFF.toInt())
            button.background = if (selected) circleBackground(0xAA000000.toInt()) else null
        }
    }

    private fun updateFlashButton() {
        flashButton.text = when (flashMode) {
            ImageCapture.FLASH_MODE_AUTO -> "⚡A"
            ImageCapture.FLASH_MODE_ON -> "⚡"
            else -> "⚡/"
        }
    }

    private fun updateGridButton() {
        gridButton.text = if (gridOverlay.isGridEnabled) "▦" else "□"
    }

    private fun updateFlipButton(provider: ProcessCameraProvider) {
        val frontSelector = CameraSelector.Builder()
            .requireLensFacing(CameraSelector.LENS_FACING_FRONT)
            .build()
        flipButton.isEnabled = provider.hasCamera(frontSelector)
        flipButton.alpha = if (flipButton.isEnabled) 1f else 0.35f
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

    private fun matchParentParams(): FrameLayout.LayoutParams {
        return FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }

    private fun topControlButton(value: String, description: String): TextView {
        return TextView(this).apply {
            gravity = Gravity.CENTER
            text = value
            contentDescription = description
            textSize = 20f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            background = circleBackground(0x44FFFFFF)
        }
    }

    private fun roundedBackground(color: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
        }
    }

    private fun circleBackground(color: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).roundToInt()
    }

    private data class ZoomPreset(val label: String, val ratio: Float)

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
        private const val ACCENT_COLOR = -469174
        private val ZOOM_PRESETS = listOf(
            ZoomPreset(".6", 0.6f),
            ZoomPreset("1x", 1f),
            ZoomPreset("2", 2f),
            ZoomPreset("3", 3f),
        )
    }
}

private class GridOverlayView(context: Context) : View(context) {
    var isGridEnabled = true
        set(value) {
            field = value
            invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        alpha = 105
        strokeWidth = 1.2f * resources.displayMetrics.density
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!isGridEnabled) {
            return
        }

        val firstX = width / 3f
        val secondX = width * 2f / 3f
        val firstY = height / 3f
        val secondY = height * 2f / 3f
        canvas.drawLine(firstX, 0f, firstX, height.toFloat(), paint)
        canvas.drawLine(secondX, 0f, secondX, height.toFloat(), paint)
        canvas.drawLine(0f, firstY, width.toFloat(), firstY, paint)
        canvas.drawLine(0f, secondY, width.toFloat(), secondY, paint)
    }
}

private class FocusOverlayView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val focusPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 1.8f * density
    }
    private val yellowStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFCC00.toInt()
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 3f * density
    }
    private val yellowFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFCC00.toInt()
        style = Paint.Style.FILL
    }

    private var centerX = 0f
    private var centerY = 0f
    private var exposureProgress = 0f
    private var isShowing = false

    init {
        isClickable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun show(x: Float, y: Float, exposure: Float) {
        centerX = x
        centerY = y
        exposureProgress = exposure
        isShowing = true
        invalidate()
        removeCallbacks(hideRunnable)
        postDelayed(hideRunnable, 2600)
    }

    fun updateExposure(exposure: Float) {
        if (!isShowing) {
            return
        }

        exposureProgress = exposure
        invalidate()
        removeCallbacks(hideRunnable)
        postDelayed(hideRunnable, 2600)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!isShowing) {
            return
        }

        val radius = 46f * density
        canvas.drawCircle(centerX, centerY, radius, focusPaint)
        canvas.drawLine(centerX - radius, centerY, centerX - 12f * density, centerY, focusPaint)
        canvas.drawLine(centerX + 12f * density, centerY, centerX + radius, centerY, focusPaint)
        canvas.drawLine(centerX, centerY - radius, centerX, centerY - 12f * density, focusPaint)
        canvas.drawLine(centerX, centerY + 12f * density, centerX, centerY + radius, focusPaint)

        val sliderY = centerY + radius + 54f * density
        val sliderHalfWidth = 52f * density
        canvas.drawLine(centerX - sliderHalfWidth, sliderY, centerX + sliderHalfWidth, sliderY, yellowStrokePaint)
        canvas.drawCircle(centerX + exposureProgress * sliderHalfWidth, sliderY, 8f * density, yellowFillPaint)
        canvas.drawCircle(centerX, sliderY - 30f * density, 7f * density, yellowFillPaint)
        canvas.drawLine(centerX - 36f * density, sliderY - 30f * density, centerX - 22f * density, sliderY - 30f * density, yellowStrokePaint)
        canvas.drawLine(centerX + 22f * density, sliderY - 30f * density, centerX + 36f * density, sliderY - 30f * density, yellowStrokePaint)
    }

    private val hideRunnable = Runnable {
        isShowing = false
        invalidate()
    }
}

private class ShutterButton(context: Context) : View(context) {
    private val whitePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.FILL
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xE6FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 4f * resources.displayMetrics.density
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val radius = width.coerceAtMost(height) / 2f - 6f * resources.displayMetrics.density
        canvas.drawCircle(width / 2f, height / 2f, radius, whitePaint)
        canvas.drawCircle(width / 2f, height / 2f, radius + 5f * resources.displayMetrics.density, strokePaint)
    }
}
