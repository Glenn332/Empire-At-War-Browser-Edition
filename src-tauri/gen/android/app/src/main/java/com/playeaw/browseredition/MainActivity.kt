package com.playeaw.browseredition

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Android makes the app's folder in shared storage (Android/data/<package>/files) the
    // first time the app asks for it; the player copies the game in there over USB
    getExternalFilesDir(null)
    super.onCreate(savedInstanceState)
    hideSystemBars()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      hideSystemBars()
      focusPage()
    }
  }

  // a connected keyboard types into the page from the start, not only after the first tap;
  // the page is made once the window is up, so this looks again until it is there
  private fun focusPage(triesLeft: Int = 20) {
    val page = findWebView(window.decorView)
    if (page == null) {
      if (triesLeft > 0) window.decorView.postDelayed({ focusPage(triesLeft - 1) }, 250)
      return
    }
    page.isFocusable = true
    page.isFocusableInTouchMode = true
    if (!page.hasFocus()) page.requestFocus()
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
    }
    return null
  }

  // the game fills the screen: the status and navigation bars stay hidden until swiped in
  private fun hideSystemBars() {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
  }
}
