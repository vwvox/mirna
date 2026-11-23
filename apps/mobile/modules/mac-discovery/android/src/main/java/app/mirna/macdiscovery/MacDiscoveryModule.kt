package app.mirna.macdiscovery

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.nio.channels.SelectionKey
import java.nio.channels.Selector
import java.nio.channels.SocketChannel
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

private const val SERVICE_TYPE = "_mirna._tcp."

class MacDiscoveryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MirnaMacDiscovery")

    Function("isOnLocalNetwork") {
      localNetwork(context) != null || hotspotSubnets(context).isNotEmpty()
    }

    Function("currentNetworkKey") {
      currentNetworkKey(context)
    }

    // --- This phone's own hotspot ----------------------------------------

    /** Subnets this phone serves as a hotspot (Wi-Fi, USB or Bluetooth). */
    Function("hotspotSubnets") {
      hotspotSubnets(context).map {
        mapOf(
          "interface" to it.name,
          "address" to it.address.hostAddress,
          "prefix_length" to it.prefixLength,
        )
      }
    }

    /** Which of these addresses accept a connection on the port, all tried at once. */
    AsyncFunction("probe") { hosts: List<String>, port: Int, timeoutMs: Int ->
      probe(hosts, port, timeoutMs.toLong().coerceIn(200, 5_000))
    }

    AsyncFunction("discover") { timeoutMs: Int, promise: Promise ->
      Discovery(context, timeoutMs.toLong().coerceIn(500, 15_000), promise).start()
    }

    // --- Running in the background ----------------------------------------

    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Shows Android's "Let Mirna run in the background?" dialog. */
    Function("requestIgnoreBatteryOptimizations") {
      @SuppressLint("BatteryLife")
      val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:${context.packageName}"),
      )
      openOrFallBack(context, intent)
    }

    /** App info, where phones like OPPO keep "Allow background activity". */
    Function("openAppSettings") {
      openOrFallBack(
        context,
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
      )
    }

    // --- Live Updates (Android 16) ----------------------------------------

    /** Whether Android may show Mirna's recording as a Live Update. */
    Function("canPostPromotedNotifications") {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      try {
        manager.javaClass.getMethod("canPostPromotedNotifications").invoke(manager) as? Boolean ?: false
      } catch (_: Exception) {
        false
      }
    }

    Function("openPromotedNotificationSettings") {
      val promoted = Intent("android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS")
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      if (promoted.resolveActivity(context.packageManager) != null) {
        openOrFallBack(context, promoted)
      } else {
        openOrFallBack(
          context,
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )
      }
    }
  }
}

/** Opens a system screen; falls back to the app's info page. */
private fun openOrFallBack(context: Context, intent: Intent): Boolean {
  return try {
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (_: Exception) {
    try {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (_: Exception) {}
    false
  }
}

private fun connectivity(context: Context) =
  context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

/** The active network when it is Wi-Fi or Ethernet, else null. */
private fun localNetwork(context: Context): Network? {
  val connectivity = connectivity(context)
  val network = connectivity.activeNetwork ?: return null
  val capabilities = connectivity.getNetworkCapabilities(network) ?: return null
  val local = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  return if (local) network else null
}

/**
 * A rough fingerprint of the Wi-Fi the phone is on: its router's address and
 * subnet. Good enough to tell "home" from "café" without the location
 * permission that reading the Wi-Fi name needs.
 */
private fun currentNetworkKey(context: Context): String? {
  val network = localNetwork(context)
    ?: return if (hotspotSubnets(context).isNotEmpty()) PHONE_HOTSPOT else null
  val link: LinkProperties = connectivity(context).getLinkProperties(network) ?: return null
  val gateway = link.routes
    .firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }
    ?.gateway?.hostAddress
  val subnet = link.linkAddresses
    .firstOrNull { it.address is Inet4Address }
    ?.let { subnetOf(it.address as Inet4Address, it.prefixLength) }
  return listOfNotNull(gateway, subnet).joinToString("|").ifEmpty { null }
}

private fun subnetOf(address: Inet4Address, prefixLength: Int): String {
  val bytes = address.address
  val masked = ByteArray(4) { index ->
    val bits = (prefixLength - index * 8).coerceIn(0, 8)
    val mask = if (bits == 0) 0 else (0xFF shl (8 - bits)) and 0xFF
    (bytes[index].toInt() and mask).toByte()
  }
  return (Inet4Address.getByAddress(masked).hostAddress ?: "") + "/" + prefixLength
}

/** The network key while the phone is the hotspot: the same one every time. */
private const val PHONE_HOTSPOT = "phone-hotspot"

private data class Subnet(val name: String, val address: Inet4Address, val prefixLength: Int)

// Interfaces that are never a hotspot: mobile data, VPNs, tunnels, Wi-Fi Direct.
private val NOT_A_HOTSPOT = listOf(
  "lo", "rmnet", "ccmni", "v4-", "clat", "tun", "ppp", "ipsec", "dummy",
  "ip6", "sit", "gre", "ifb", "p2p", "radio", "seth",
)

/**
 * Subnets the phone serves to other devices: its Wi-Fi hotspot, or USB or
 * Bluetooth tethering. Android doesn't list these as networks the phone is
 * on, so they're the interfaces with a private IPv4 address that aren't one
 * of its networks.
 */
private fun hotspotSubnets(context: Context): List<Subnet> {
  val connectivity = connectivity(context)
  val own = try {
    @Suppress("DEPRECATION")
    connectivity.allNetworks
      .mapNotNull { connectivity.getLinkProperties(it)?.interfaceName }
      .toSet()
  } catch (_: Exception) {
    emptySet()
  }
  val interfaces = try {
    NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
  } catch (_: Exception) {
    emptyList()
  }
  return interfaces.flatMap { candidate ->
    val name = candidate.name ?: return@flatMap emptyList()
    val usable = try {
      candidate.isUp && !candidate.isLoopback && !candidate.isPointToPoint
    } catch (_: Exception) {
      false
    }
    if (!usable || name in own || NOT_A_HOTSPOT.any { name.startsWith(it) }) {
      return@flatMap emptyList()
    }
    candidate.interfaceAddresses.mapNotNull { entry ->
      val address = entry.address as? Inet4Address ?: return@mapNotNull null
      if (!address.isSiteLocalAddress) return@mapNotNull null
      Subnet(name, address, entry.networkPrefixLength.toInt())
    }
  }
}

/**
 * Tries a TCP connection to every host at once and returns those that
 * accepted. Nothing is sent: the connections close straight away.
 */
private fun probe(hosts: List<String>, port: Int, timeoutMs: Long): List<String> {
  val open = mutableListOf<String>()
  val channels = mutableListOf<SocketChannel>()
  val selector = Selector.open()
  try {
    var waiting = 0
    for (host in hosts.distinct().take(1024)) {
      try {
        val channel = SocketChannel.open()
        channels.add(channel)
        channel.configureBlocking(false)
        if (channel.connect(InetSocketAddress(host, port))) {
          open.add(host)
        } else {
          channel.register(selector, SelectionKey.OP_CONNECT, host)
          waiting += 1
        }
      } catch (_: Exception) {}
    }
    val deadline = System.currentTimeMillis() + timeoutMs
    while (waiting > 0) {
      val left = deadline - System.currentTimeMillis()
      if (left <= 0) break
      if (selector.select(left) == 0) continue
      val ready = selector.selectedKeys().iterator()
      while (ready.hasNext()) {
        val key = ready.next()
        ready.remove()
        waiting -= 1
        try {
          if ((key.channel() as SocketChannel).finishConnect()) open.add(key.attachment() as String)
        } catch (_: Exception) {}
        key.cancel()
      }
    }
  } finally {
    for (channel in channels) {
      try {
        channel.close()
      } catch (_: Exception) {}
    }
    try {
      selector.close()
    } catch (_: Exception) {}
  }
  return open
}

/** One Bonjour browse: collects every Mirna Mac that resolves before the timeout. */
private class Discovery(
  context: Context,
  private val timeoutMs: Long,
  private val promise: Promise,
) {
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val handler = Handler(Looper.getMainLooper())
  // Android delivers some callbacks after they are unregistered, so this
  // executor must never shut down: a closed one makes NsdManager throw on its
  // own thread and crashes the app (it could end a recording mid-way).
  private val executor = Executor { command -> handler.post(command) }
  private val finished = AtomicBoolean(false)
  private val results = LinkedHashMap<String, Map<String, Any?>>()
  private val pending = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private val infoCallbacks = mutableListOf<Any>()

  private val discoveryListener = object : NsdManager.DiscoveryListener {
    override fun onDiscoveryStarted(serviceType: String) {}
    override fun onDiscoveryStopped(serviceType: String) {}
    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = finish()
    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
    override fun onServiceFound(serviceInfo: NsdServiceInfo) = resolve(serviceInfo)
  }

  fun start() {
    try {
      nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
    } catch (error: Exception) {
      finish()
      return
    }
    handler.postDelayed({ finish() }, timeoutMs)
  }

  private fun resolve(serviceInfo: NsdServiceInfo) {
    if (finished.get()) return
    if (Build.VERSION.SDK_INT >= 34) {
      val callback = object : NsdManager.ServiceInfoCallback {
        override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {}
        override fun onServiceLost() {}
        override fun onServiceInfoCallbackUnregistered() {}
        override fun onServiceUpdated(info: NsdServiceInfo) {
          record(info, info.hostAddresses.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress })
        }
      }
      try {
        nsd.registerServiceInfoCallback(serviceInfo, executor, callback)
        synchronized(infoCallbacks) { infoCallbacks.add(callback) }
      } catch (_: Exception) {}
    } else {
      // Older Android resolves one service at a time.
      synchronized(pending) {
        pending.addLast(serviceInfo)
        if (!resolving) resolveNextLegacy()
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun resolveNextLegacy() {
    val next = synchronized(pending) {
      val item = pending.removeFirstOrNull()
      resolving = item != null
      item
    } ?: return
    try {
      nsd.resolveService(next, object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
          resolveNextLegacy()
        }

        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
          val host = (serviceInfo.host as? Inet4Address)?.hostAddress
          record(serviceInfo, listOfNotNull(host))
          resolveNextLegacy()
        }
      })
    } catch (_: Exception) {
      resolveNextLegacy()
    }
  }

  private fun record(info: NsdServiceInfo, hosts: List<String>) {
    if (hosts.isEmpty() || finished.get()) return
    val id = info.attributes["id"]?.let { String(it, Charsets.UTF_8) }
    synchronized(results) {
      results[info.serviceName] = mapOf(
        "name" to info.serviceName,
        "hosts" to hosts,
        "port" to info.port,
        "id" to id,
      )
    }
  }

  private fun finish() {
    if (!finished.compareAndSet(false, true)) return
    handler.removeCallbacksAndMessages(null)
    try {
      nsd.stopServiceDiscovery(discoveryListener)
    } catch (_: Exception) {}
    if (Build.VERSION.SDK_INT >= 34) {
      synchronized(infoCallbacks) {
        for (callback in infoCallbacks) {
          try {
            nsd.unregisterServiceInfoCallback(callback as NsdManager.ServiceInfoCallback)
          } catch (_: Exception) {}
        }
        infoCallbacks.clear()
      }
    }
    val found = synchronized(results) { results.values.toList() }
    promise.resolve(found)
  }
}
