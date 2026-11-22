package app.mirna.macdiscovery

import android.content.Context
import android.net.ConnectivityManager
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
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val SERVICE_TYPE = "_mirna._tcp."

class MacDiscoveryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MirnaMacDiscovery")

    Function("isOnLocalNetwork") {
      val connectivity =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
      capabilities != null &&
        (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
          capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
    }

    AsyncFunction("discover") { timeoutMs: Int, promise: Promise ->
      Discovery(context, timeoutMs.toLong().coerceIn(500, 15_000), promise).start()
    }
  }
}

/** One Bonjour browse: collects every Mirna Mac that resolves before the timeout. */
private class Discovery(
  context: Context,
  private val timeoutMs: Long,
  private val promise: Promise,
) {
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val handler = Handler(Looper.getMainLooper())
  private val executor = Executors.newSingleThreadExecutor()
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
    executor.shutdown()
    val found = synchronized(results) { results.values.toList() }
    promise.resolve(found)
  }
}
