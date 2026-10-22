package com.skinningplayer.audio

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONObject
import kotlin.math.pow

/** `AudioItem` from index.ts, as JS sends it. */
class AudioItemRecord : Record {
  @Field val id: String = ""
  @Field val uri: String = ""
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val album: String = ""
  @Field val artworkUri: String? = null
  @Field val gainDb: Double = 0.0

  fun toData() = AudioItemData(id, uri, title, artist, album, artworkUri, gainDb)
}

/** `AudioOptions` from index.ts. */
class AudioOptionsRecord : Record {
  @Field val stopOnTaskRemoved: Boolean = false
  @Field val autoplayOnHeadset: Boolean = false
}

data class AudioItemData(
  val id: String,
  val uri: String,
  val title: String,
  val artist: String,
  val album: String,
  val artworkUri: String?,
  val gainDb: Double
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("uri", uri)
    .put("title", title)
    .put("artist", artist)
    .put("album", album)
    .put("artworkUri", artworkUri)
    .put("gainDb", gainDb)

  companion object {
    fun fromJson(json: JSONObject) = AudioItemData(
      id = json.optString("id"),
      uri = json.optString("uri"),
      title = json.optString("title"),
      artist = json.optString("artist"),
      album = json.optString("album"),
      artworkUri = if (json.isNull("artworkUri")) null else json.optString("artworkUri").ifEmpty { null },
      gainDb = json.optDouble("gainDb", 0.0).takeUnless { it.isNaN() } ?: 0.0
    )
  }
}

/**
 * What every ExoPlayer [MediaItem] of ours carries as its tag: the app's item, and a slot number
 * unique to this one entry in the playlist. Two entries of the same song (repeat-one) get two slots,
 * so each has its own gain and its own transition.
 */
data class Slot(val slotId: Long, val item: AudioItemData)

internal val MediaItem.slot: Slot?
  get() = localConfiguration?.tag as? Slot

internal fun Slot.toMediaItem(): MediaItem = MediaItem.Builder()
  .setMediaId(item.id)
  .setUri(Uri.parse(item.uri))
  .setTag(this)
  .setMediaMetadata(
    MediaMetadata.Builder()
      .setTitle(item.title)
      .setDisplayTitle(item.title)
      .setArtist(item.artist)
      .setAlbumTitle(item.album)
      .setArtworkUri(item.artworkUri?.takeIf { it.isNotEmpty() }?.let(Uri::parse))
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
      .build()
  )
  .build()

/** ReplayGain dB to a linear factor, limited to -60..+12 dB. */
internal fun gainToLinear(gainDb: Double): Float {
  if (gainDb.isNaN() || gainDb == 0.0) return 1f
  return 10.0.pow(gainDb.coerceIn(-60.0, 12.0) / 20.0).toFloat()
}

/**
 * Options and the last item played, in SharedPreferences, so the service sees them even when it
 * starts in a process the JS side never ran in (Android Auto, a restart after being killed).
 */
internal object Prefs {
  private const val FILE = "skinning_audio"
  private const val KEY_STOP_ON_TASK_REMOVED = "stopOnTaskRemoved"
  private const val KEY_AUTOPLAY_ON_HEADSET = "autoplayOnHeadset"
  private const val KEY_LAST_ITEM = "lastItem"
  private const val KEY_LAST_POSITION = "lastPositionMs"

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun setOptions(context: Context, stopOnTaskRemoved: Boolean, autoplayOnHeadset: Boolean) {
    prefs(context).edit()
      .putBoolean(KEY_STOP_ON_TASK_REMOVED, stopOnTaskRemoved)
      .putBoolean(KEY_AUTOPLAY_ON_HEADSET, autoplayOnHeadset)
      .apply()
  }

  fun stopOnTaskRemoved(context: Context) = prefs(context).getBoolean(KEY_STOP_ON_TASK_REMOVED, false)

  fun autoplayOnHeadset(context: Context) = prefs(context).getBoolean(KEY_AUTOPLAY_ON_HEADSET, false)

  fun setLastItem(context: Context, item: AudioItemData, positionMs: Long) {
    prefs(context).edit()
      .putString(KEY_LAST_ITEM, item.toJson().toString())
      .putLong(KEY_LAST_POSITION, positionMs)
      .apply()
  }

  fun setLastPosition(context: Context, positionMs: Long) {
    prefs(context).edit().putLong(KEY_LAST_POSITION, positionMs).apply()
  }

  fun lastItem(context: Context): Pair<AudioItemData, Long>? {
    val p = prefs(context)
    val json = p.getString(KEY_LAST_ITEM, null) ?: return null
    return try {
      AudioItemData.fromJson(JSONObject(json)) to p.getLong(KEY_LAST_POSITION, 0L)
    } catch (e: Exception) {
      null
    }
  }
}
