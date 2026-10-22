package com.skinningplayer.audio

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Timeline
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.MediaSource
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.tanh

/*
 * ReplayGain, applied in the audio pipeline rather than through `player.volume`.
 *
 * Why not the volume: `player.volume` is a single value applied to the AudioTrack. At a gapless
 * transition the next song's first samples are already in the AudioTrack's buffer (hundreds of
 * milliseconds of it) by the time `onMediaItemTransition` reaches the main thread, so changing the
 * volume there is always late or early by that much, and it cannot go above 1 (no positive gain).
 *
 * What this does instead:
 *  - [GainStore] maps each playlist slot (see [Slot]) to its linear gain. The main thread writes
 *    it (on `load`, `setNext`, `setGain`); the playback thread reads it.
 *  - [GainAudioRenderer] is ExoPlayer's MediaCodecAudioRenderer, which also notes, on the playback
 *    thread, which slot each stream belongs to (`onStreamChanged` hands it the MediaPeriodId, and
 *    the renderer's timeline maps that to the MediaItem and its tag). Before every output buffer it
 *    checks the renderer's output stream offset, which MediaCodecRenderer moves exactly when the
 *    first decoded buffer of the next stream comes out, after the last buffer of the one before was
 *    handed to the sink. There it switches [ReplayGainProcessor.activeSlot].
 *  - [ReplayGainProcessor] sits in the DefaultAudioSink's processor chain and scales every sample
 *    by the active slot's gain. Because the switch happens between the two songs' buffers, in the
 *    order the sink takes them, the gain changes on the exact sample where one song meets the next.
 *    Positive gain is allowed, with a soft clipper (a tanh knee above -1 dBFS) instead of
 *    wrapping or hard clipping.
 *
 * Where a slot cannot be resolved (an empty timeline, an unexpected stream) it falls back to
 * [GainStore.fallback], which the main thread keeps at the current item's gain.
 *
 * Changing the gain of the song playing (`setGain`) takes effect on the next buffer processed, so
 * it is heard after what is already in the AudioTrack's buffer (well under a second).
 */

/** Gains by slot, shared between the main thread and the playback thread. */
internal class GainStore {
  private val gains = ConcurrentHashMap<Long, Float>()

  @Volatile
  var fallback: Float = 1f

  fun put(slotId: Long, linear: Float) {
    gains[slotId] = linear
  }

  fun retainOnly(slotIds: Collection<Long>) {
    gains.keys.retainAll(slotIds.toSet())
  }

  fun clear() = gains.clear()

  fun get(slotId: Long): Float? = gains[slotId]

  fun gainFor(slotId: Long?): Float = slotId?.let { gains[it] } ?: fallback
}

@OptIn(UnstableApi::class)
internal class ReplayGainProcessor(private val store: GainStore) : BaseAudioProcessor() {
  /** The slot whose samples are coming in now; written and read on the playback thread. */
  @Volatile
  var activeSlot: Long? = null

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    // DefaultAudioSink hands its processors 16-bit PCM (or float, with float output on). Anything
    // else passes through untouched, with no gain, rather than failing playback.
    return when (inputAudioFormat.encoding) {
      C.ENCODING_PCM_16BIT, C.ENCODING_PCM_FLOAT -> inputAudioFormat
      else -> AudioProcessor.AudioFormat.NOT_SET
    }
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val size = inputBuffer.remaining()
    if (size == 0) return
    val output = replaceOutputBuffer(size)
    val gain = store.gainFor(activeSlot)
    if (gain == 1f) {
      output.put(inputBuffer)
    } else if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
      while (inputBuffer.remaining() >= 4) {
        output.putFloat(shape(inputBuffer.float * gain, gain))
      }
    } else {
      while (inputBuffer.remaining() >= 2) {
        val sample = shape(inputBuffer.short / 32768f * gain, gain)
        output.putShort((sample * 32767f).toInt().coerceIn(-32768, 32767).toShort())
      }
    }
    // An odd trailing byte would be a malformed buffer; drop it rather than loop on it.
    inputBuffer.position(inputBuffer.limit())
    output.flip()
  }

  /** A soft clipper, only where gain could push samples past full scale. */
  private fun shape(x: Float, gain: Float): Float {
    if (gain <= 1f) return x
    val a = abs(x)
    if (a <= KNEE) return x
    val y = KNEE + (1f - KNEE) * tanh((a - KNEE) / (1f - KNEE))
    return if (x < 0) -y else y
  }

  override fun onReset() {
    activeSlot = null
  }

  private companion object {
    /** -1 dBFS. */
    const val KNEE = 0.891f
  }
}

/** MediaCodecAudioRenderer that tells [ReplayGainProcessor] which slot its output belongs to. */
@OptIn(UnstableApi::class)
internal class GainAudioRenderer(
  context: Context,
  codecAdapterFactory: MediaCodecAdapter.Factory,
  mediaCodecSelector: MediaCodecSelector,
  enableDecoderFallback: Boolean,
  eventHandler: Handler?,
  eventListener: AudioRendererEventListener?,
  audioSink: AudioSink,
  private val processor: ReplayGainProcessor
) : MediaCodecAudioRenderer(
  context,
  codecAdapterFactory,
  mediaCodecSelector,
  enableDecoderFallback,
  eventHandler,
  eventListener,
  audioSink
) {
  /** Stream offset (unique per period in the queue) to the period it plays. Playback thread. */
  private val periodsByOffset = object : LinkedHashMap<Long, MediaSource.MediaPeriodId>() {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, MediaSource.MediaPeriodId>?) = size > 8
  }
  private var activeOffsetUs = C.TIME_UNSET
  private var activeResolved = false
  private val period = Timeline.Period()
  private val window = Timeline.Window()

  override fun onStreamChanged(
    formats: Array<out Format>,
    startPositionUs: Long,
    offsetUs: Long,
    mediaPeriodId: MediaSource.MediaPeriodId
  ) {
    periodsByOffset[offsetUs] = mediaPeriodId
    super.onStreamChanged(formats, startPositionUs, offsetUs, mediaPeriodId)
    syncActiveSlot()
  }

  override fun onProcessedStreamChange() {
    super.onProcessedStreamChange()
    syncActiveSlot()
  }

  override fun onPositionReset(positionUs: Long, joining: Boolean, sampleStreamIsResetToKeyFrame: Boolean) {
    super.onPositionReset(positionUs, joining, sampleStreamIsResetToKeyFrame)
    syncActiveSlot()
  }

  override fun onDisabled() {
    periodsByOffset.clear()
    activeOffsetUs = C.TIME_UNSET
    activeResolved = false
    processor.activeSlot = null
    super.onDisabled()
  }

  override fun processOutputBuffer(
    positionUs: Long,
    elapsedRealtimeUs: Long,
    codec: MediaCodecAdapter?,
    buffer: ByteBuffer?,
    bufferIndex: Int,
    bufferFlags: Int,
    sampleCount: Int,
    bufferPresentationTimeUs: Long,
    isDecodeOnlyBuffer: Boolean,
    isLastBuffer: Boolean,
    format: Format
  ): Boolean {
    syncActiveSlot()
    return super.processOutputBuffer(
      positionUs,
      elapsedRealtimeUs,
      codec,
      buffer,
      bufferIndex,
      bufferFlags,
      sampleCount,
      bufferPresentationTimeUs,
      isDecodeOnlyBuffer,
      isLastBuffer,
      format
    )
  }

  private fun syncActiveSlot() {
    val offsetUs = outputStreamOffsetUs
    if (offsetUs == activeOffsetUs && activeResolved) return
    activeOffsetUs = offsetUs
    val slotId = resolveSlot(periodsByOffset[offsetUs])
    activeResolved = slotId != null
    processor.activeSlot = slotId
  }

  private fun resolveSlot(periodId: MediaSource.MediaPeriodId?): Long? {
    periodId ?: return null
    return try {
      val timeline = timeline
      if (timeline.isEmpty) return null
      val periodIndex = timeline.getIndexOfPeriod(periodId.periodUid)
      if (periodIndex == C.INDEX_UNSET) return null
      val windowIndex = timeline.getPeriod(periodIndex, period).windowIndex
      timeline.getWindow(windowIndex, window).mediaItem.slot?.slotId
    } catch (e: RuntimeException) {
      null
    }
  }
}

/** Builds the player's audio renderer and sink with ReplayGain in them, and nothing else. */
@OptIn(UnstableApi::class)
internal class GainRenderersFactory(
  context: Context,
  private val processor: ReplayGainProcessor
) : DefaultRenderersFactory(context) {

  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioOutputPlaybackParams: Boolean
  ): AudioSink = DefaultAudioSink.Builder(context)
    .setEnableFloatOutput(enableFloatOutput)
    .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
    .setAudioProcessors(arrayOf<AudioProcessor>(processor))
    .build()

  override fun buildAudioRenderers(
    context: Context,
    extensionRendererMode: Int,
    mediaCodecSelector: MediaCodecSelector,
    enableDecoderFallback: Boolean,
    audioSink: AudioSink,
    eventHandler: Handler,
    eventListener: AudioRendererEventListener,
    out: ArrayList<Renderer>
  ) {
    // Only the MediaCodec renderer: this app has no decoder extensions, and an extension renderer
    // would bypass the slot tracking above.
    out.add(
      GainAudioRenderer(
        context,
        codecAdapterFactory,
        mediaCodecSelector,
        enableDecoderFallback,
        eventHandler,
        eventListener,
        audioSink,
        processor
      )
    )
  }
}
