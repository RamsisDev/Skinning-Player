package com.skinningplayer.audio

import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.DeviceInfo
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Metadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi

/**
 * The player the MediaSession sees (notification, lock screen, headset buttons, Bluetooth, Android
 * Auto). Play, pause and seeking go straight to ExoPlayer. What does not:
 *
 *  - Next and previous: the queue is the app's, and ExoPlayer only holds the song playing and the
 *    one after it, so they are always advertised and are reported to [Host] instead of moving in
 *    ExoPlayer's playlist.
 *  - Setting or adding media items: a controller (Android Auto choosing a song, playback
 *    resumption) only names an item; [Host] decides what to play.
 *  - Jumping to a queue entry is not offered: the two-entry playlist is not the app's queue.
 */
@OptIn(UnstableApi::class)
internal class SessionPlayer(player: Player, private val host: Host) : ForwardingPlayer(player) {

  interface Host {
    fun onRemoteNext()
    fun onRemotePrevious()
    fun onRemoteItems(items: List<MediaItem>, startIndex: Int, startPositionMs: Long)
    /** True for a moment after a controller's items were handed to the app, which loads them itself. */
    fun suppressRemotePlay(): Boolean
  }

  override fun getAvailableCommands(): Player.Commands = withQueueCommands(super.getAvailableCommands())

  override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)

  override fun seekToNext() = host.onRemoteNext()

  override fun seekToNextMediaItem() = host.onRemoteNext()

  override fun seekToPrevious() = host.onRemotePrevious()

  override fun seekToPreviousMediaItem() = host.onRemotePrevious()

  override fun setMediaItem(mediaItem: MediaItem) = host.onRemoteItems(listOf(mediaItem), 0, 0)

  override fun setMediaItem(mediaItem: MediaItem, startPositionMs: Long) =
    host.onRemoteItems(listOf(mediaItem), 0, startPositionMs)

  override fun setMediaItem(mediaItem: MediaItem, resetPosition: Boolean) =
    host.onRemoteItems(listOf(mediaItem), 0, 0)

  override fun setMediaItems(mediaItems: MutableList<MediaItem>) = host.onRemoteItems(mediaItems, 0, 0)

  override fun setMediaItems(mediaItems: MutableList<MediaItem>, resetPosition: Boolean) =
    host.onRemoteItems(mediaItems, 0, 0)

  override fun setMediaItems(mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long) =
    host.onRemoteItems(mediaItems, startIndex, startPositionMs)

  override fun addMediaItem(mediaItem: MediaItem) = host.onRemoteItems(listOf(mediaItem), 0, 0)

  override fun addMediaItem(index: Int, mediaItem: MediaItem) = host.onRemoteItems(listOf(mediaItem), 0, 0)

  override fun addMediaItems(mediaItems: MutableList<MediaItem>) = host.onRemoteItems(mediaItems, 0, 0)

  override fun addMediaItems(index: Int, mediaItems: MutableList<MediaItem>) = host.onRemoteItems(mediaItems, 0, 0)

  // A controller that hands the app items follows with prepare and play (or a seek to the start
  // when the old song had ended); the app is loading the new one, so the old one must not start.
  override fun prepare() {
    if (!host.suppressRemotePlay()) super.prepare()
  }

  override fun play() {
    if (!host.suppressRemotePlay()) super.play()
  }

  override fun setPlayWhenReady(playWhenReady: Boolean) {
    if (!(playWhenReady && host.suppressRemotePlay())) super.setPlayWhenReady(playWhenReady)
  }

  override fun seekToDefaultPosition() {
    if (!host.suppressRemotePlay()) super.seekToDefaultPosition()
  }

  override fun seekToDefaultPosition(mediaItemIndex: Int) {
    if (!host.suppressRemotePlay()) super.seekToDefaultPosition(mediaItemIndex)
  }

  // ForwardingPlayer passes ExoPlayer's own commands to listeners; the session must hear ours.
  override fun addListener(listener: Player.Listener) = super.addListener(CommandsListener(listener))

  override fun removeListener(listener: Player.Listener) = super.removeListener(CommandsListener(listener))

  // Every method spelled out: Kotlin's `by` delegation skips Java default methods, and all of
  // Player.Listener's are.
  @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
  private inner class CommandsListener(val inner: Player.Listener) : Player.Listener {
    override fun onAvailableCommandsChanged(availableCommands: Player.Commands) =
      inner.onAvailableCommandsChanged(withQueueCommands(availableCommands))

    override fun onEvents(player: Player, events: Player.Events) = inner.onEvents(player, events)
    override fun onTimelineChanged(timeline: Timeline, reason: Int) = inner.onTimelineChanged(timeline, reason)
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = inner.onMediaItemTransition(mediaItem, reason)
    override fun onTracksChanged(tracks: Tracks) = inner.onTracksChanged(tracks)
    override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) = inner.onMediaMetadataChanged(mediaMetadata)
    override fun onPlaylistMetadataChanged(mediaMetadata: MediaMetadata) = inner.onPlaylistMetadataChanged(mediaMetadata)
    override fun onIsLoadingChanged(isLoading: Boolean) = inner.onIsLoadingChanged(isLoading)
    override fun onLoadingChanged(isLoading: Boolean) = inner.onLoadingChanged(isLoading)
    override fun onTrackSelectionParametersChanged(parameters: TrackSelectionParameters) =
      inner.onTrackSelectionParametersChanged(parameters)
    override fun onPlayerStateChanged(playWhenReady: Boolean, playbackState: Int) =
      inner.onPlayerStateChanged(playWhenReady, playbackState)
    override fun onPlaybackStateChanged(playbackState: Int) = inner.onPlaybackStateChanged(playbackState)
    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) =
      inner.onPlayWhenReadyChanged(playWhenReady, reason)
    override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) =
      inner.onPlaybackSuppressionReasonChanged(playbackSuppressionReason)
    override fun onIsPlayingChanged(isPlaying: Boolean) = inner.onIsPlayingChanged(isPlaying)
    override fun onRepeatModeChanged(repeatMode: Int) = inner.onRepeatModeChanged(repeatMode)
    override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) =
      inner.onShuffleModeEnabledChanged(shuffleModeEnabled)
    override fun onPlayerError(error: PlaybackException) = inner.onPlayerError(error)
    override fun onPlayerErrorChanged(error: PlaybackException?) = inner.onPlayerErrorChanged(error)
    override fun onPositionDiscontinuity(reason: Int) = inner.onPositionDiscontinuity(reason)
    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) =
      inner.onPositionDiscontinuity(oldPosition, newPosition, reason)
    override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) =
      inner.onPlaybackParametersChanged(playbackParameters)
    override fun onSeekBackIncrementChanged(seekBackIncrementMs: Long) = inner.onSeekBackIncrementChanged(seekBackIncrementMs)
    override fun onSeekForwardIncrementChanged(seekForwardIncrementMs: Long) =
      inner.onSeekForwardIncrementChanged(seekForwardIncrementMs)
    override fun onMaxSeekToPreviousPositionChanged(maxSeekToPreviousPositionMs: Long) =
      inner.onMaxSeekToPreviousPositionChanged(maxSeekToPreviousPositionMs)
    override fun onAudioSessionIdChanged(audioSessionId: Int) = inner.onAudioSessionIdChanged(audioSessionId)
    override fun onAudioAttributesChanged(audioAttributes: AudioAttributes) = inner.onAudioAttributesChanged(audioAttributes)
    override fun onVolumeChanged(volume: Float) = inner.onVolumeChanged(volume)
    override fun onSkipSilenceEnabledChanged(skipSilenceEnabled: Boolean) = inner.onSkipSilenceEnabledChanged(skipSilenceEnabled)
    override fun onDeviceInfoChanged(deviceInfo: DeviceInfo) = inner.onDeviceInfoChanged(deviceInfo)
    override fun onDeviceVolumeChanged(volume: Int, muted: Boolean) = inner.onDeviceVolumeChanged(volume, muted)
    override fun onVideoSizeChanged(videoSize: VideoSize) = inner.onVideoSizeChanged(videoSize)
    override fun onSurfaceSizeChanged(width: Int, height: Int) = inner.onSurfaceSizeChanged(width, height)
    override fun onRenderedFirstFrame() = inner.onRenderedFirstFrame()
    override fun onCues(cues: MutableList<Cue>) = inner.onCues(cues)
    override fun onCues(cueGroup: CueGroup) = inner.onCues(cueGroup)
    override fun onMetadata(metadata: Metadata) = inner.onMetadata(metadata)

    override fun equals(other: Any?) = other is CommandsListener && other.inner == inner

    override fun hashCode() = inner.hashCode()
  }

  private fun withQueueCommands(commands: Player.Commands): Player.Commands = commands.buildUpon()
    .addAll(
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
    )
    .remove(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
    .build()
}
