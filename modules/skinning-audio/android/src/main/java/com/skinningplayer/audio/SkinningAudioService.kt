package com.skinningplayer.audio

import android.app.PendingIntent
import android.content.Intent
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.audiofx.AudioEffect
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/**
 * The playback service: one ExoPlayer, a MediaLibrarySession for the notification, the lock
 * screen, headset buttons and Android Auto, and the browse tree.
 *
 * The queue is the app's. ExoPlayer holds the item playing and, after `setNext`, the one after it,
 * so it can run from one into the other without a gap. When it does (an AUTO transition) the
 * finished item is dropped, [Listener.onAdvance] tells the app, and the next slot stays empty until
 * the app calls `setNext` again.
 *
 * Every method here runs on the main thread, ExoPlayer's application thread.
 */
@OptIn(UnstableApi::class)
class SkinningAudioService : MediaLibraryService(), SessionPlayer.Host {

  /** The module, while the JS side is running. Called on the main thread. */
  interface Listener {
    fun onState(state: Map<String, Any?>)
    fun onAdvance(id: String)
    fun onRemoteCommand(command: String)
    /** [id] is a browse tree id, or '' for "resume what the app had"; [query] for a search. */
    fun onPlayRequest(id: String, query: String?)
  }

  inner class LocalBinder : Binder() {
    val service: SkinningAudioService get() = this@SkinningAudioService
  }

  private val binder = LocalBinder()
  private val handler = Handler(Looper.getMainLooper())
  private val browseExecutor: ListeningExecutorService =
    MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor())

  private val gains = GainStore()
  private val gainProcessor = ReplayGainProcessor(gains)
  private lateinit var player: ExoPlayer
  private lateinit var sessionPlayer: SessionPlayer
  private var session: MediaLibrarySession? = null
  private lateinit var audioManager: AudioManager

  private var nextSlotId = 1L
  /** Set when the service plays a list of its own (Android Auto with no JS); `load` ends it. */
  private var nativeQueue = false
  /** A `setNext` that came after the song had already ended: held, not started; re-armed by a seek or play back into the ended song. */
  private var pendingNext: AudioItemData? = null
  private var suppressPlayUntil = 0L
  private var released = false
  private var audioSessionId = C.AUDIO_SESSION_ID_UNSET
  private var headsetCallbackReady = false
  private var ticks = 0

  var listener: Listener? = null
    set(value) {
      field = value
      if (value != null && !released) emitState()
    }

  // region Lifecycle

  override fun onCreate() {
    super.onCreate()
    audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
    player = ExoPlayer.Builder(this, GainRenderersFactory(this, gainProcessor))
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        /* handleAudioFocus= */ true
      )
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .build()
    player.addListener(playerListener)
    sessionPlayer = SessionPlayer(player, this)
    ensureSession()

    audioSessionId = player.audioSessionId
    currentAudioSessionId = audioSessionId
    openEffectSession(audioSessionId)

    audioManager.registerAudioDeviceCallback(deviceCallback, handler)
    // Registering reports every device already connected; those are not connections.
    handler.postDelayed({ headsetCallbackReady = true }, HEADSET_SETTLE_MS)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onBind(intent: Intent?): IBinder? =
    if (intent?.action == ACTION_LOCAL_BIND) binder else super.onBind(intent)

  override fun onTaskRemoved(rootIntent: Intent?) {
    if (Prefs.stopOnTaskRemoved(this)) {
      stopPlaybackAndSession()
      stopSelf()
    } else {
      // Media3's own: keeps playing if playing, and stops the service otherwise.
      super.onTaskRemoved(rootIntent)
    }
  }

  override fun onDestroy() {
    if (!released) {
      persistPosition()
      released = true
      handler.removeCallbacksAndMessages(null)
      audioManager.unregisterAudioDeviceCallback(deviceCallback)
      closeEffectSession(audioSessionId)
      if (currentAudioSessionId == audioSessionId) currentAudioSessionId = C.AUDIO_SESSION_ID_UNSET
      session?.let {
        removeSession(it)
        it.release()
      }
      session = null
      player.removeListener(playerListener)
      player.release()
      browseExecutor.shutdown()
    }
    super.onDestroy()
  }

  /** Stops, drops the notification and the session; a later `load` brings them back. */
  private fun stopPlaybackAndSession() {
    persistPosition()
    player.pause()
    player.stop()
    player.clearMediaItems()
    gains.clear()
    pendingNext = null
    nativeQueue = false
    session?.let {
      removeSession(it)
      it.release()
    }
    session = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    emitState()
  }

  private fun ensureSession() {
    if (session != null || released) return
    val built = MediaLibrarySession.Builder(this, sessionPlayer, LibraryCallback())
      .apply { sessionActivity()?.let { setSessionActivity(it) } }
      .build()
    session = built
    // Controllers that connect add it themselves; the app's own calls do not connect, so add it
    // here for the notification to follow it from the start.
    addSession(built)
  }

  private fun sessionActivity(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  // endregion

  // region Commands from the app

  fun load(item: AudioItemData, play: Boolean, startAtSeconds: Double) {
    ensureSession()
    nativeQueue = false
    pendingNext = null
    suppressPlayUntil = 0L
    val slot = newSlot(item)
    val linear = gainToLinear(item.gainDb)
    gains.clear()
    gains.put(slot.slotId, linear)
    gains.fallback = linear
    val startMs = (startAtSeconds * 1000).toLong().coerceAtLeast(0L)
    player.setMediaItem(slot.toMediaItem(), startMs)
    player.prepare()
    player.playWhenReady = play
    Prefs.setLastItem(this, item, startMs)
  }

  fun setNext(item: AudioItemData?) {
    if (player.mediaItemCount == 0) return
    nativeQueue = false
    if (player.playbackState == Player.STATE_ENDED) {
      // The song already ended with nothing after it: adding one now would start it on its own,
      // and the app loads the next song itself then. Only held, for a seek back into this one.
      pendingNext = item
      return
    }
    pendingNext = null
    val index = player.currentMediaItemIndex
    if (player.mediaItemCount > index + 1) player.removeMediaItems(index + 1, player.mediaItemCount)
    if (item != null) {
      val slot = newSlot(item)
      gains.put(slot.slotId, gainToLinear(item.gainDb))
      player.addMediaItem(slot.toMediaItem())
    }
    retainGainsForPlaylist()
  }

  fun play() {
    ensureSession()
    if (player.mediaItemCount == 0) return
    if (player.playbackState == Player.STATE_ENDED) {
      // Plays the ended song again; a next one held while it was ended is armed again behind it.
      player.seekToDefaultPosition(player.currentMediaItemIndex)
      pendingNext?.let {
        pendingNext = null
        setNext(it)
      }
    }
    if (player.playbackState == Player.STATE_IDLE) player.prepare()
    player.play()
  }

  fun pause() {
    player.pause()
    persistPosition()
  }

  fun seekTo(seconds: Double) {
    if (player.mediaItemCount == 0) return
    val wasEnded = player.playbackState == Player.STATE_ENDED
    player.seekTo((seconds * 1000).toLong().coerceAtLeast(0L))
    val next = pendingNext
    if (wasEnded && next != null) {
      pendingNext = null
      setNext(next)
    }
  }

  fun setGain(gainDb: Double) {
    val linear = gainToLinear(gainDb)
    player.currentMediaItem?.slot?.let { gains.put(it.slotId, linear) }
    gains.fallback = linear
  }

  fun onBrowseTreeChanged(tree: BrowseTree) {
    val session = session ?: return
    session.notifyChildrenChanged(BrowseTree.ROOT_ID, tree.roots.size, null)
    tree.roots.forEach { root ->
      root.children?.let { session.notifyChildrenChanged(root.id, it.size, null) }
    }
  }

  // endregion

  // region Player

  private val playerListener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      val slot = mediaItem?.slot
      gains.fallback = slot?.let { gains.get(it.slotId) ?: gainToLinear(it.item.gainDb) } ?: 1f
      if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO ||
        reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT
      ) {
        if (!nativeQueue) dropFinishedItems()
        if (slot != null) {
          Prefs.setLastItem(this@SkinningAudioService, slot.item, 0L)
          listener?.onAdvance(slot.item.id)
        }
      }
    }

    override fun onEvents(player: Player, events: Player.Events) {
      emitState()
      updateTicker()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (!isPlaying) persistPosition()
    }

    override fun onPlayerError(error: PlaybackException) {
      // The player stops in STATE_IDLE with the error; the service stays, and the app skips on.
      Log.w(TAG, "Playback error: ${error.errorCodeName}", error)
    }

    override fun onAudioSessionIdChanged(audioSessionId: Int) {
      if (audioSessionId == this@SkinningAudioService.audioSessionId) return
      closeEffectSession(this@SkinningAudioService.audioSessionId)
      this@SkinningAudioService.audioSessionId = audioSessionId
      currentAudioSessionId = audioSessionId
      openEffectSession(audioSessionId)
    }
  }

  /** After a gapless step: the item that finished leaves the playlist. */
  private fun dropFinishedItems() {
    val index = player.currentMediaItemIndex
    if (index > 0) player.removeMediaItems(0, index)
    retainGainsForPlaylist()
  }

  private fun retainGainsForPlaylist() {
    val slots = (0 until player.mediaItemCount).mapNotNull { player.getMediaItemAt(it).slot?.slotId }
    gains.retainOnly(slots)
  }

  private fun newSlot(item: AudioItemData) = Slot(nextSlotId++, item)

  private val ticker = object : Runnable {
    override fun run() {
      if (released) return
      emitState()
      if (++ticks % 10 == 0) persistPosition()
      if (player.isPlaying) handler.postDelayed(this, TICK_MS)
    }
  }

  private fun updateTicker() {
    handler.removeCallbacks(ticker)
    if (player.isPlaying) handler.postDelayed(ticker, TICK_MS)
  }

  private fun emitState() {
    val listener = listener ?: return
    listener.onState(stateMap())
  }

  private fun stateMap(): Map<String, Any?> {
    val state = player.playbackState
    val error = player.playerError
    val current = player.currentMediaItem
    val status = when {
      error != null -> "error"
      current == null -> "idle"
      state == Player.STATE_BUFFERING -> "loading"
      state == Player.STATE_READY || state == Player.STATE_ENDED -> "readyToPlay"
      else -> "idle"
    }
    val playing = error == null &&
      player.playWhenReady &&
      player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE &&
      (state == Player.STATE_READY || state == Player.STATE_BUFFERING)
    val duration = player.duration
    return mapOf(
      "playing" to playing,
      "status" to status,
      "currentTime" to player.currentPosition.coerceAtLeast(0L) / 1000.0,
      "duration" to if (duration == C.TIME_UNSET || duration < 0) 0.0 else duration / 1000.0,
      "ended" to (state == Player.STATE_ENDED),
      "itemId" to (current?.slot?.item?.id ?: current?.mediaId?.takeIf { it.isNotEmpty() })
    )
  }

  private fun persistPosition() {
    if (released || player.currentMediaItem == null) return
    Prefs.setLastPosition(this, player.currentPosition.coerceAtLeast(0L))
  }

  // endregion

  // region Session player host: what the notification, headset and Android Auto ask for

  override fun onRemoteNext() {
    val js = listener
    if (nativeQueue || js == null) {
      if (player.hasNextMediaItem()) player.seekToNextMediaItem()
      return
    }
    js.onRemoteCommand("next")
  }

  override fun onRemotePrevious() {
    val js = listener
    if (nativeQueue || js == null) {
      if (player.currentPosition > RESTART_THRESHOLD_MS || !player.hasPreviousMediaItem()) {
        player.seekTo(0L)
      } else {
        player.seekToPreviousMediaItem()
      }
      return
    }
    js.onRemoteCommand("previous")
  }

  override fun suppressRemotePlay(): Boolean = SystemClock.uptimeMillis() < suppressPlayUntil

  override fun onRemoteItems(items: List<MediaItem>, startIndex: Int, startPositionMs: Long) {
    val chosen = items.getOrNull(startIndex.coerceAtLeast(0)) ?: items.firstOrNull() ?: return
    val query = chosen.requestMetadata.searchQuery?.trim().orEmpty()
    // A resumption item (the song played last, from onPlaybackResumption) carries its file; any
    // other item is a browse tree id, or nothing ("play", or a search).
    val resumption = chosen.slot != null
    val named = !resumption && chosen.mediaId.isNotEmpty()
    if (!named && query.isEmpty() && player.mediaItemCount > 0) {
      // "Play" with nothing named: what is loaded resumes, through the play that follows.
      return
    }
    // The controller follows this with prepare and play; hold those back until the right song
    // is loaded, by the app or below.
    suppressPlayUntil = SystemClock.uptimeMillis() + SUPPRESS_PLAY_MS

    val js = listener
    if (js != null) {
      // The app owns the queue: it is told, and loads. '' asks it to resume what it had.
      when {
        named -> js.onPlayRequest(chosen.mediaId, null)
        query.isNotEmpty() -> browseExecutor.execute {
          val id = BrowseTreeStore.get(this).search(query, 1).firstOrNull()?.id ?: ""
          handler.post { if (!released) listener?.onPlayRequest(id, query) }
        }
        else -> js.onPlayRequest("", null)
      }
      return
    }

    // No JS in this process: play natively.
    val startMs = if (startPositionMs == C.TIME_UNSET || startPositionMs < 0) 0L else startPositionMs
    browseExecutor.execute {
      val tree = BrowseTreeStore.get(this)
      var target = chosen
      var startAt = startMs
      val id = when {
        resumption || named -> chosen.mediaId
        query.isNotEmpty() -> tree.search(query, 1).firstOrNull()?.id
        // "Play" with nothing loaded: what played last, else the first song.
        else -> Prefs.lastItem(this)?.let { (item, positionMs) ->
          target = Slot(0L, item).toMediaItem()
          startAt = positionMs
          item.id
        } ?: tree.firstLeaf()?.id
      }
      handler.post {
        if (released) return@post
        suppressPlayUntil = 0L
        if (id != null) playNatively(id, target, tree, startAt)
      }
    }
  }

  /**
   * With no JS to ask: plays the chosen leaf and the playable leaves beside it, in order, as a
   * playlist of the service's own. The app's next `load` takes over from it.
   */
  private fun playNatively(id: String, chosen: MediaItem, tree: BrowseTree, startMs: Long) {
    val resumed = chosen.slot?.item?.takeIf { it.id == id }
    val (list, index) = if (resumed != null) {
      listOf(resumed) to 0
    } else {
      val (leaves, at) = tree.siblingsOf(id) ?: run {
        Log.w(TAG, "Nothing to play natively for $id")
        return
      }
      val playable = leaves.mapIndexedNotNull { i, node -> node.toAudioItem()?.let { i to it } }
      val start = playable.indexOfFirst { it.first == at }
      if (start < 0) {
        Log.w(TAG, "$id has no uri to play without the app")
        return
      }
      playable.map { it.second } to start
    }
    ensureSession()
    pendingNext = null
    gains.clear()
    val slots = list.map { newSlot(it) }
    slots.forEach { gains.put(it.slotId, gainToLinear(it.item.gainDb)) }
    gains.fallback = gains.get(slots[index].slotId) ?: 1f
    nativeQueue = true
    player.setMediaItems(slots.map { it.toMediaItem() }, index, if (resumed != null) startMs else 0L)
    player.prepare()
    player.play()
    Prefs.setLastItem(this, list[index], 0L)
  }

  // endregion

  // region Android Auto: the browse tree

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<MediaItem>> {
      if (params?.isRecent == true) {
        // System UI's resumption card asks for what played last.
        return browseExecutor.submit<LibraryResult<MediaItem>> {
          if (Prefs.lastItem(this@SkinningAudioService) != null) {
            LibraryResult.ofItem(folderItem(BrowseTree.RECENT_ROOT_ID, "Recent"), params)
          } else {
            LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED)
          }
        }
      }
      return Futures.immediateFuture(LibraryResult.ofItem(folderItem(BrowseTree.ROOT_ID, "Skinning Player"), params))
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = browseExecutor.submit<LibraryResult<ImmutableList<MediaItem>>> {
      if (page < 0 || pageSize < 1) return@submit LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      if (parentId == BrowseTree.RECENT_ROOT_ID) {
        val last = Prefs.lastItem(this@SkinningAudioService)?.first
        val items = if (last != null && page == 0) listOf(Slot(0, last).toMediaItem()) else emptyList()
        return@submit LibraryResult.ofItemList(items, params)
      }
      val children = BrowseTreeStore.get(this@SkinningAudioService).children(parentId)
        ?: return@submit LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      LibraryResult.ofItemList(page(children, page, pageSize).map { it.toMediaItem() }, params)
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String
    ): ListenableFuture<LibraryResult<MediaItem>> = browseExecutor.submit<LibraryResult<MediaItem>> {
      if (mediaId == BrowseTree.ROOT_ID) return@submit LibraryResult.ofItem(folderItem(mediaId, "Skinning Player"), null)
      val node = BrowseTreeStore.get(this@SkinningAudioService).node(mediaId)
        ?: return@submit LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      LibraryResult.ofItem(node.toMediaItem(), null)
    }

    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<Void>> = browseExecutor.submit<LibraryResult<Void>> {
      val count = BrowseTreeStore.get(this@SkinningAudioService).search(query).size
      handler.post { if (!released) this@SkinningAudioService.session?.notifySearchResultChanged(browser, query, count, params) }
      LibraryResult.ofVoid(params)
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = browseExecutor.submit<LibraryResult<ImmutableList<MediaItem>>> {
      if (page < 0 || pageSize < 1) return@submit LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      val results = BrowseTreeStore.get(this@SkinningAudioService).search(query)
      LibraryResult.ofItemList(page(results, page, pageSize).map { it.toMediaItem() }, params)
    }

    // Controllers name items by id only; hand them on as they are, and SessionPlayer passes them
    // to onRemoteItems (the app's onPlayRequest, or native playback).
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>
    ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(mediaItems)

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val (item, positionMs) = Prefs.lastItem(this@SkinningAudioService)
        ?: return Futures.immediateFailedFuture(UnsupportedOperationException("Nothing played yet"))
      return Futures.immediateFuture(
        MediaSession.MediaItemsWithStartPosition(listOf(newSlot(item).toMediaItem()), 0, positionMs)
      )
    }
  }

  private fun <T> page(list: List<T>, page: Int, pageSize: Int): List<T> {
    val from = page.toLong() * pageSize
    if (from >= list.size) return emptyList()
    val to = minOf(list.size.toLong(), from + pageSize).toInt()
    return list.subList(from.toInt(), to)
  }

  private fun folderItem(id: String, title: String): MediaItem = MediaItem.Builder()
    .setMediaId(id)
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle(title)
        .setIsBrowsable(true)
        .setIsPlayable(false)
        .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
        .build()
    )
    .build()

  // endregion

  // region Equalizer apps and headphones

  private fun openEffectSession(sessionId: Int) {
    if (sessionId == C.AUDIO_SESSION_ID_UNSET) return
    sendBroadcast(effectIntent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION, sessionId))
  }

  private fun closeEffectSession(sessionId: Int) {
    if (sessionId == C.AUDIO_SESSION_ID_UNSET) return
    sendBroadcast(effectIntent(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION, sessionId))
  }

  private fun effectIntent(action: String, sessionId: Int) = Intent(action)
    .putExtra(AudioEffect.EXTRA_AUDIO_SESSION, sessionId)
    .putExtra(AudioEffect.EXTRA_PACKAGE_NAME, packageName)
    .putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
      if (!headsetCallbackReady || released) return
      if (addedDevices.none { it.isSink && it.type in headsetTypes }) return
      if (!Prefs.autoplayOnHeadset(this@SkinningAudioService)) return
      // Give the system a moment to route to the new device before starting.
      handler.postDelayed({ autoplayIfPaused() }, HEADSET_ROUTE_DELAY_MS)
    }
  }

  private fun autoplayIfPaused() {
    if (released || player.mediaItemCount == 0 || player.playWhenReady) return
    if (player.playerError != null || player.playbackState == Player.STATE_ENDED) return
    play()
  }

  private val headsetTypes: Set<Int> = buildSet {
    add(AudioDeviceInfo.TYPE_WIRED_HEADSET)
    add(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
    add(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) add(AudioDeviceInfo.TYPE_USB_HEADSET)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      add(AudioDeviceInfo.TYPE_BLE_HEADSET)
      add(AudioDeviceInfo.TYPE_BLE_SPEAKER)
    }
  }

  // endregion

  companion object {
    private const val TAG = "SkinningAudio"
    const val ACTION_LOCAL_BIND = "com.skinningplayer.audio.LOCAL_BIND"
    private const val TICK_MS = 500L
    private const val SUPPRESS_PLAY_MS = 2000L
    private const val RESTART_THRESHOLD_MS = 3000L
    private const val HEADSET_SETTLE_MS = 1000L
    private const val HEADSET_ROUTE_DELAY_MS = 400L

    /** The player's audio session, for the equalizer; read from any thread. */
    @Volatile
    var currentAudioSessionId: Int = C.AUDIO_SESSION_ID_UNSET
      private set
  }
}
