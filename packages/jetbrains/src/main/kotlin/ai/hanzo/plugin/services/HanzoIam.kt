package ai.hanzo.plugin.services

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.sun.net.httpserver.HttpServer
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CancellationException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Sign-in against Hanzo IAM: OAuth 2.0 authorization code with PKCE (RFC 7636)
 * and a loopback redirect (RFC 8252 section 7.3).
 *
 * A person authorizes at hanzo.id; token, refresh, revoke and userinfo go to
 * api.hanzo.ai, where the IAM API is served. iam.hanzo.ai serves only the IAM
 * web app and answers every request with HTML.
 */
object HanzoIam {
    const val LOGIN_URL = "https://hanzo.id"
    const val API_URL = "https://api.hanzo.ai"

    // Registered in IAM with redirect http://127.0.0.1/callback, any port.
    const val CLIENT_ID = "hanzo-jetbrains"
    const val SCOPES = "openid profile email offline_access"

    private const val LOOPBACK = "127.0.0.1"
    private val http = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
    private val random = SecureRandom()

    /** expiresAt is epoch milliseconds, or null when IAM gave no lifetime. */
    data class Tokens(val access: String, val refresh: String? = null, val expiresAt: Long? = null) {
        /** True within a minute of expiry, so no request leaves with a token about to lapse. */
        fun expired(now: Long = System.currentTimeMillis()): Boolean =
            expiresAt != null && now >= expiresAt - 60_000
    }

    /** IAM answered with a status outside 2xx. */
    class Rejected(val status: Int, message: String) : IOException(message)

    fun verifier(): String = base64url(ByteArray(32).also(random::nextBytes))

    fun challenge(verifier: String): String =
        base64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    fun authorizeUrl(challenge: String, state: String, redirect: String, login: String = LOGIN_URL): String =
        "$login/v1/iam/oauth/authorize".toHttpUrl().newBuilder()
            .addQueryParameter("response_type", "code")
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("redirect_uri", redirect)
            .addQueryParameter("scope", SCOPES)
            .addQueryParameter("state", state)
            .addQueryParameter("code_challenge", challenge)
            .addQueryParameter("code_challenge_method", "S256")
            .build().toString()

    /**
     * Opens the authorize page with [browse], waits for IAM to redirect back to a
     * one-shot loopback listener, and trades the code for tokens. Blocks until
     * then, [canceled] answers true, or [timeoutMillis] passes.
     */
    fun login(
        browse: (String) -> Unit,
        canceled: () -> Boolean,
        api: String = API_URL,
        login: String = LOGIN_URL,
        timeoutMillis: Long = 300_000,
    ): Tokens {
        val verifier = verifier()
        val state = base64url(ByteArray(16).also(random::nextBytes))
        val callback = CompletableFuture<HttpUrl>()
        val server = HttpServer.create(InetSocketAddress(LOOPBACK, 0), 0)
        server.createContext("/callback") { exchange ->
            val url = "http://$LOOPBACK${exchange.requestURI}".toHttpUrl()
            val ok = url.queryParameter("state") == state && url.queryParameter("code") != null
            val page = (if (ok) "Signed in to Hanzo AI. You can close this tab."
                        else "Hanzo AI sign-in did not finish. Return to the IDE.").toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/plain; charset=utf-8")
            exchange.sendResponseHeaders(200, page.size.toLong())
            exchange.responseBody.use { it.write(page) }
            callback.complete(url)
        }
        server.start()
        try {
            val redirect = "http://$LOOPBACK:${server.address.port}/callback"
            browse(authorizeUrl(challenge(verifier), state, redirect, login))
            val url = await(callback, canceled, timeoutMillis)
            url.queryParameter("error")?.let {
                throw IOException("IAM refused sign-in: ${url.queryParameter("error_description") ?: it}")
            }
            if (url.queryParameter("state") != state) throw IOException("sign-in callback carried the wrong state")
            val code = url.queryParameter("code") ?: throw IOException("sign-in callback carried no code")
            return exchange(code, verifier, redirect, api)
        } finally {
            server.stop(0)
        }
    }

    fun exchange(code: String, verifier: String, redirect: String, api: String = API_URL): Tokens =
        tokens(
            post(
                "$api/v1/iam/oauth/token",
                FormBody.Builder()
                    .add("grant_type", "authorization_code")
                    .add("client_id", CLIENT_ID)
                    .add("code", code)
                    .add("code_verifier", verifier)
                    .add("redirect_uri", redirect)
                    .build(),
            ),
            refresh = null,
        )

    /** IAM may rotate the refresh token; when it does not, the old one stays. */
    fun refresh(refresh: String, api: String = API_URL): Tokens =
        tokens(
            post(
                "$api/v1/iam/oauth/token",
                FormBody.Builder()
                    .add("grant_type", "refresh_token")
                    .add("client_id", CLIENT_ID)
                    .add("refresh_token", refresh)
                    .build(),
            ),
            refresh,
        )

    /** RFC 7009: IAM answers 200 whether or not it knew the token. */
    fun revoke(refresh: String, api: String = API_URL) {
        post(
            "$api/v1/iam/oauth/revoke",
            FormBody.Builder()
                .add("client_id", CLIENT_ID)
                .add("token", refresh)
                .add("token_type_hint", "refresh_token")
                .build(),
        )
    }

    fun userinfo(access: String, api: String = API_URL): JsonObject =
        call(Request.Builder().url("$api/v1/iam/oauth/userinfo").header("Authorization", "Bearer $access").build())

    /** The stored form of [Tokens]; the inverse of [decode]. */
    fun encode(tokens: Tokens): String = JsonObject().apply {
        addProperty("access_token", tokens.access)
        tokens.refresh?.let { addProperty("refresh_token", it) }
        tokens.expiresAt?.let { addProperty("expires_at", it) }
    }.toString()

    /** Null for anything [encode] did not write. */
    fun decode(stored: String): Tokens? = try {
        val o = JsonParser.parseString(stored).asJsonObject
        Tokens(
            access = o.get("access_token").asString.ifEmpty { return null },
            refresh = o.get("refresh_token")?.asString,
            expiresAt = o.get("expires_at")?.asLong,
        )
    } catch (e: RuntimeException) {
        null
    }

    private fun tokens(o: JsonObject, refresh: String?, now: Long = System.currentTimeMillis()): Tokens {
        val access = o.get("access_token")?.takeIf { it.isJsonPrimitive }?.asString
        if (access.isNullOrEmpty()) throw IOException("IAM token response carried no access_token")
        return Tokens(
            access = access,
            refresh = o.get("refresh_token")?.takeIf { it.isJsonPrimitive }?.asString ?: refresh,
            expiresAt = o.get("expires_in")?.takeIf { it.isJsonPrimitive }?.asLong?.let { now + it * 1000 },
        )
    }

    private fun post(url: String, form: FormBody): JsonObject = call(Request.Builder().url(url).post(form).build())

    private fun call(request: Request): JsonObject = http.newCall(request).execute().use { resp ->
        val path = request.url.encodedPath
        val body = resp.body?.string().orEmpty()
        if (!resp.isSuccessful) throw Rejected(resp.code, "$path answered ${resp.code}: ${body.take(200)}")
        try {
            JsonParser.parseString(body).asJsonObject
        } catch (e: RuntimeException) {
            throw IOException("$path answered ${resp.header("Content-Type")}, not JSON: ${body.take(80)}")
        }
    }

    private fun <T> await(future: CompletableFuture<T>, canceled: () -> Boolean, timeoutMillis: Long): T {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (true) {
            if (canceled()) throw CancellationException("sign-in canceled")
            try {
                return future.get(250, TimeUnit.MILLISECONDS)
            } catch (e: TimeoutException) {
                if (System.currentTimeMillis() >= deadline) throw IOException("sign-in timed out")
            }
        }
    }

    private fun base64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
