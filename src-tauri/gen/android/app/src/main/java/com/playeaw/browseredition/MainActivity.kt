package com.playeaw.browseredition

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Android makes the app's folder in shared storage (Android/data/<package>/files) the
    // first time the app asks for it; the player copies the game in there over USB
    getExternalFilesDir(null)
    super.onCreate(savedInstanceState)
  }
}
