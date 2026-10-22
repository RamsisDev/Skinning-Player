package com.skinningplayer.audio

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.media.audiofx.AudioEffect
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The JS face of [SkinningAudioService] (see index.ts for the contract).
 *
 * The module binds to the service in this process with a local binder, and every call is posted to
 * the main thread, where ExoPlayer lives. Calls made before the service is bound wait for it. The
 * service promotes itself to a foreground service (with the media notification) when playback
 * starts, so it keeps playing when the app is in the background or its JS is gone.
 */
class SkinningAudioModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val treeExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  // Main thread only.
  private var service: SkinningAudioService? = null
  private var boundContext: Context? = null
  private val pending = ArrayList<(SkinningAudioService) -> Unit>()

  @Volatile
  private var observingPlayRequests = false

  @Volatile
  private var observingRemoteCommands = false

  /** Requests and commands from before JS listened, sent when it does. Main thread only. */
  private val held = ArrayList<Pair<String, Map<String, Any?>>>()

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val serviceListener = object : SkinningAudioService.Listener {
    override fun onState(state: Map<String, Any?>) = sendEvent("onState", state)
    override fun onAdvance(id: String) = sendEvent("onAdvance", mapOf("id" to id))
    override fun onRemoteCommand(command: String) =
      sendOrHold("onRemoteCommand", mapOf("command" to command), observingRemoteCommands)

    override fun onPlayRequest(id: String, query: String?) {
      val body = if (query != null) mapOf("id" to id, "query" to query) else mapOf("id" to id)
      sendOrHold("onPlayRequest", body, observingPlayRequests)
    }
  }

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      val connected = (binder as? SkinningAudioService.LocalBinder)?.service ?: return
      service = connected
      connected.listener = serviceListener
      val queued = ArrayList(pending)
      pending.clear()
      queued.forEach { it(connected) }
    }

    override fun onServiceDisconnected(name: ComponentName) {
      // The binding stays; the system connects again when the service is recreated.
      service = null
    }

    override fun onBindingDied(name: ComponentName) {
      service = null
      unbind()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SkinningAudio")

    Events("onState", "onAdvance", "onRemoteCommand", "onPlayRequest")

    OnCreate {
      // Bound from the start, so a request from Android Auto while the app's JS starts comes here
      // (and waits for JS to listen) instead of playing natively.
      main.post { bind() }
    }

    OnStartObserving("onState") {
      // An app opened while the service already plays (from Android Auto, say) hears its state.
      main.post { bind() }
    }

    OnStartObserving("onPlayRequest") {
      observingPlayRequests = true
      main.post { flushHeld("onPlayRequest") }
    }

    OnStopObserving("onPlayRequest") {
      observingPlayRequests = false
    }

    OnStartObserving("onRemoteCommand") {
      observingRemoteCommands = true
      main.post { flushHeld("onRemoteCommand") }
    }

    OnStopObserving("onRemoteCommand") {
      observingRemoteCommands = false
    }

    OnDestroy {
      observingPlayRequests = false
      observingRemoteCommands = false
      main.post {
        service?.listener = null
        unbind()
        pending.clear()
        held.clear()
      }
      treeExecutor.shutdown()
    }

    Function("load") { item: AudioItemRecord, play: Boolean, startAt: Double ->
      val data = item.toData()
      withService { it.load(data, play, startAt) }
    }

    Function("setNext") { item: AudioItemRecord? ->
      val data = item?.toData()
      withService { it.setNext(data) }
    }

    Function("play") {
      withService { it.play() }
    }

    Function("pause") {
      withService { it.pause() }
    }

    Function("seekTo") { seconds: Double ->
      withService { it.seekTo(seconds) }
    }

    Function("setGain") { gainDb: Double ->
      withService { it.setGain(gainDb) }
    }

    Function("setOptions") { options: AudioOptionsRecord ->
      // Persisted, and read by the service when it needs them, so they hold for a service that
      // starts later or restarts.
      Prefs.setOptions(context, options.stopOnTaskRemoved, options.autoplayOnHeadset)
    }

    Function("openEqualizer") {
      openEqualizer()
    }

    Function("hasEqualizer") {
      equalizerIntent(context).resolveActivity(context.packageManager) != null
    }

    Function("setBrowseTree") { roots: List<Map<String, Any?>> ->
      val nodes = roots.mapNotNull { BrowseNodeData.fromMap(it) }
      val ctx = context
      treeExecutor.execute {
        BrowseTreeStore.set(ctx, nodes)
        val tree = BrowseTreeStore.get(ctx)
        main.post { service?.onBrowseTreeChanged(tree) }
      }
    }
  }

  /** Main thread. Only the latest play request is held; a few commands at most. */
  private fun sendOrHold(name: String, body: Map<String, Any?>, observing: Boolean) {
    if (observing) {
      sendEvent(name, body)
      return
    }
    if (name == "onPlayRequest") held.removeAll { it.first == name }
    held.add(name to body)
    while (held.size > MAX_HELD) held.removeAt(0)
  }

  /** Main thread. */
  private fun flushHeld(name: String) {
    val due = held.filter { it.first == name }
    held.removeAll { it.first == name }
    due.forEach { sendEvent(it.first, it.second) }
  }

  private fun withService(block: (SkinningAudioService) -> Unit) {
    main.post {
      val connected = service
      if (connected != null) {
        block(connected)
      } else {
        pending.add(block)
        bind()
      }
    }
  }

  /** Main thread. */
  private fun bind() {
    if (service != null || boundContext != null) return
    val ctx = appContext.reactContext?.applicationContext ?: return
    val intent = Intent(ctx, SkinningAudioService::class.java).setAction(SkinningAudioService.ACTION_LOCAL_BIND)
    if (ctx.bindService(intent, connection, Context.BIND_AUTO_CREATE)) {
      boundContext = ctx
    } else {
      Log.e(TAG, "Could not bind to the playback service")
    }
  }

  /** Main thread. */
  private fun unbind() {
    val ctx = boundContext ?: return
    boundContext = null
    service = null
    try {
      ctx.unbindService(connection)
    } catch (e: IllegalArgumentException) {
      // Already unbound.
    }
  }

  private fun equalizerIntent(ctx: Context): Intent =
    Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL)
      .putExtra(AudioEffect.EXTRA_AUDIO_SESSION, SkinningAudioService.currentAudioSessionId)
      .putExtra(AudioEffect.EXTRA_PACKAGE_NAME, ctx.packageName)
      .putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)

  private fun openEqualizer(): Boolean {
    val ctx = context
    // The player's audio session exists once the service does.
    main.post { bind() }
    val intent = equalizerIntent(ctx)
    if (intent.resolveActivity(ctx.packageManager) == null) return false
    val activity = appContext.currentActivity
    main.post {
      try {
        if (activity != null) {
          // For a result, so the equalizer can tell which app is calling (the system one asks).
          activity.startActivityForResult(intent, EQUALIZER_REQUEST_CODE)
        } else {
          ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
      } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "No equalizer to open", e)
      } catch (e: SecurityException) {
        Log.w(TAG, "The equalizer could not be opened", e)
      }
    }
    return true
  }

  private companion object {
    const val TAG = "SkinningAudio"
    const val EQUALIZER_REQUEST_CODE = 0x5a1
    const val MAX_HELD = 4
  }
}
