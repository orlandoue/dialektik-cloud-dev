package com.dialektik.dialektik

import android.app.Activity
import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingImage: ByteArray? = null
    private var pendingResult: MethodChannel.Result? = null
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dialektik/image_export").setMethodCallHandler { call, result ->
            if (call.method != "savePng") { result.notImplemented(); return@setMethodCallHandler }
            val bytes = call.arguments as? ByteArray
            if (bytes == null || pendingResult != null) { result.error("unavailable", "No se puede guardar la imagen", null); return@setMethodCallHandler }
            pendingImage = bytes
            pendingResult = result
            try {
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/png"
                    putExtra(Intent.EXTRA_TITLE, "dialektik-sintesis.png")
                }
                startActivityForResult(intent, 5124)
            } catch (e: Exception) { pendingImage = null; pendingResult = null; result.error("save_failed", e.message, null) }
        }
    }
    @Deprecated("Android activity result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 5124) return
        val result = pendingResult
        try {
            if (resultCode == Activity.RESULT_OK && data?.data != null && pendingImage != null) {
                val stream = contentResolver.openOutputStream(data.data!!) ?: throw IllegalStateException("No se pudo abrir el archivo")
                stream.use { it.write(pendingImage!!) }
            }
            result?.success(null)
        } catch (e: Exception) { result?.error("save_failed", e.message, null) }
        finally { pendingImage = null; pendingResult = null }
    }
}
