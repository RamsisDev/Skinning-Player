package com.skinningplayer.audio

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** `BrowseNode` from index.ts. `uri` and `gainDb` let the service play a leaf with no JS running. */
data class BrowseNodeData(
  val id: String,
  val title: String,
  val subtitle: String?,
  val artworkUri: String?,
  val uri: String?,
  val gainDb: Double,
  val children: List<BrowseNodeData>?
) {
  val isFolder get() = children != null

  fun toMediaItem(): MediaItem = MediaItem.Builder()
    .setMediaId(id)
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle(title)
        .setDisplayTitle(title)
        .setSubtitle(subtitle)
        .apply { if (!isFolder) setArtist(subtitle) }
        .setArtworkUri(artworkUri?.takeIf { it.isNotEmpty() }?.let(Uri::parse))
        .setIsBrowsable(isFolder)
        .setIsPlayable(!isFolder)
        .setMediaType(if (isFolder) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_MUSIC)
        .build()
    )
    .build()

  /** What the service plays for this leaf when it plays it on its own. */
  fun toAudioItem(): AudioItemData? {
    val uri = uri?.takeIf { it.isNotEmpty() } ?: return null
    return AudioItemData(id, uri, title, subtitle ?: "", "", artworkUri, gainDb)
  }

  fun toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    subtitle?.let { put("subtitle", it) }
    artworkUri?.let { put("artworkUri", it) }
    uri?.let { put("uri", it) }
    if (gainDb != 0.0) put("gainDb", gainDb)
    children?.let { kids -> put("children", JSONArray().apply { kids.forEach { put(it.toJson()) } }) }
  }

  companion object {
    @Suppress("UNCHECKED_CAST")
    fun fromMap(map: Map<*, *>): BrowseNodeData? {
      val id = map["id"] as? String ?: return null
      val children = (map["children"] as? List<*>)?.mapNotNull { child -> (child as? Map<*, *>)?.let(::fromMap) }
      return BrowseNodeData(
        id = id,
        title = map["title"] as? String ?: "",
        subtitle = map["subtitle"] as? String,
        artworkUri = map["artworkUri"] as? String,
        uri = map["uri"] as? String,
        gainDb = (map["gainDb"] as? Number)?.toDouble() ?: 0.0,
        children = children
      )
    }

    fun fromJson(json: JSONObject): BrowseNodeData {
      val kids = json.optJSONArray("children")
      return BrowseNodeData(
        id = json.getString("id"),
        title = json.optString("title"),
        subtitle = json.optString("subtitle").takeIf { json.has("subtitle") },
        artworkUri = json.optString("artworkUri").takeIf { json.has("artworkUri") },
        uri = json.optString("uri").takeIf { json.has("uri") },
        gainDb = json.optDouble("gainDb", 0.0).takeUnless { it.isNaN() } ?: 0.0,
        children = kids?.let { array -> List(array.length()) { fromJson(array.getJSONObject(it)) } }
      )
    }
  }
}

/** The tree with its lookups, immutable once built. */
class BrowseTree(val roots: List<BrowseNodeData>) {
  private val byId = HashMap<String, BrowseNodeData>()
  private val parentById = HashMap<String, BrowseNodeData>()

  init {
    fun index(node: BrowseNodeData, parent: BrowseNodeData?) {
      // The same song can sit in several folders under one id; the first one found wins.
      if (byId.putIfAbsent(node.id, node) == null && parent != null) parentById[node.id] = parent
      node.children?.forEach { index(it, node) }
    }
    roots.forEach { index(it, null) }
  }

  fun node(id: String): BrowseNodeData? = byId[id]

  fun children(parentId: String): List<BrowseNodeData>? =
    if (parentId == ROOT_ID) roots else byId[parentId]?.children

  /** The playable leaves beside [id] (itself included), in order, and its index among them. */
  fun siblingsOf(id: String): Pair<List<BrowseNodeData>, Int>? {
    val leaves = (parentById[id]?.children ?: roots).filter { !it.isFolder }
    val index = leaves.indexOfFirst { it.id == id }
    return if (index < 0) null else leaves to index
  }

  fun firstLeaf(): BrowseNodeData? {
    fun find(nodes: List<BrowseNodeData>): BrowseNodeData? {
      for (node in nodes) {
        if (!node.isFolder) return node
        find(node.children!!)?.let { return it }
      }
      return null
    }
    return find(roots)
  }

  /** Leaves matching [query] (every word, in title or subtitle), best first. */
  fun search(query: String, limit: Int = 200): List<BrowseNodeData> {
    val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return emptyList()
    val seen = HashSet<String>()
    val titleMatches = ArrayList<BrowseNodeData>()
    val otherMatches = ArrayList<BrowseNodeData>()
    for (node in byId.values) {
      if (node.isFolder || !seen.add(node.id)) continue
      val title = node.title.lowercase()
      val all = "$title ${node.subtitle?.lowercase() ?: ""}"
      if (words.all { all.contains(it) }) {
        if (words.all { title.contains(it) }) titleMatches += node else otherMatches += node
      }
    }
    // Folders whose title matches (an album, an artist) bring their songs after direct matches.
    val folderMatches = byId.values
      .filter { it.isFolder && words.all { w -> it.title.lowercase().contains(w) } }
      .flatMap { folder -> folder.children!!.filter { !it.isFolder && seen.add(it.id) } }
    return (titleMatches + otherMatches + folderMatches).take(limit)
  }

  companion object {
    const val ROOT_ID = "__skinning_root__"
    const val RECENT_ROOT_ID = "__skinning_recent__"
  }
}

/**
 * The process-wide tree: set by the module from JS, read by the service. Persisted to a file in
 * the app's files dir, so Android Auto can browse a process the JS side has not started.
 */
internal object BrowseTreeStore {
  private const val TAG = "SkinningAudio"
  private const val FILE_NAME = "skinning-audio-browse-tree.json"

  @Volatile
  private var tree: BrowseTree? = null
  private val lock = Any()

  /** The tree, read from the file the first time when JS has not sent one. Off the main thread. */
  fun get(context: Context): BrowseTree {
    tree?.let { return it }
    synchronized(lock) {
      tree?.let { return it }
      val loaded = try {
        val file = File(context.filesDir, FILE_NAME)
        if (file.exists()) {
          val array = JSONArray(file.readText())
          BrowseTree(List(array.length()) { BrowseNodeData.fromJson(array.getJSONObject(it)) })
        } else {
          BrowseTree(emptyList())
        }
      } catch (e: Exception) {
        Log.w(TAG, "Could not read the saved browse tree", e)
        BrowseTree(emptyList())
      }
      tree = loaded
      return loaded
    }
  }

  /** Replaces the tree and writes it to the file. Off the main thread. */
  fun set(context: Context, roots: List<BrowseNodeData>) {
    val newTree = BrowseTree(roots)
    synchronized(lock) { tree = newTree }
    try {
      val json = JSONArray().apply { roots.forEach { put(it.toJson()) } }.toString()
      val file = File(context.filesDir, FILE_NAME)
      val tmp = File(context.filesDir, "$FILE_NAME.tmp")
      tmp.writeText(json)
      if (!tmp.renameTo(file)) {
        file.delete()
        tmp.renameTo(file)
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not save the browse tree", e)
    }
  }
}
