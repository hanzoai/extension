package ai.hanzo.plugin.services

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.util.concurrent.CancellationException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HanzoIamTest {
    private lateinit var iam: FakeIam

    @BeforeEach
    fun start() {
        iam = FakeIam()
    }

    @AfterEach
    fun stop() {
        iam.server.stop(0)
    }

    @Test
    fun `endpoints are hanzo id for the person and api hanzo ai for the API`() {
        assertEquals("https://hanzo.id", HanzoIam.LOGIN_URL)
        assertEquals("https://api.hanzo.ai", HanzoIam.API_URL)
        assertEquals("hanzo-jetbrains", HanzoIam.CLIENT_ID)
    }

    @Test
    fun `challenge is RFC 7636 appendix B`() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            HanzoIam.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
        val verifier = HanzoIam.verifier()
        assertEquals(43, verifier.length)
        assertTrue(verifier.all { it.isLetterOrDigit() || it == '-' || it == '_' })
    }

    @Test
    fun `authorize url carries the PKCE code request`() {
        val url = HanzoIam.authorizeUrl("CH", "ST", "http://127.0.0.1:5555/callback").toHttpUrl()
        assertEquals("hanzo.id", url.host)
        assertEquals("/v1/iam/oauth/authorize", url.encodedPath)
        assertEquals("code", url.queryParameter("response_type"))
        assertEquals("hanzo-jetbrains", url.queryParameter("client_id"))
        assertEquals("http://127.0.0.1:5555/callback", url.queryParameter("redirect_uri"))
        assertEquals("openid profile email offline_access", url.queryParameter("scope"))
        assertEquals("ST", url.queryParameter("state"))
        assertEquals("CH", url.queryParameter("code_challenge"))
        assertEquals("S256", url.queryParameter("code_challenge_method"))
    }

    @Test
    fun `login trades the loopback code for tokens`() {
        val before = System.currentTimeMillis()
        val tokens = HanzoIam.login(::browse, { false }, api = iam.base, login = iam.base)
        assertEquals("A1", tokens.access)
        assertEquals("R1", tokens.refresh)
        assertTrue(tokens.expiresAt!! >= before + 3_600_000)
        assertFalse(tokens.expired())
        assertEquals("person@hanzo.ai", HanzoIam.userinfo(tokens.access, iam.base).get("email").asString)
    }

    @Test
    fun `login refuses a callback with another state`() {
        iam.state = "forged"
        val e = assertFailsWith<IOException> { HanzoIam.login(::browse, { false }, api = iam.base, login = iam.base) }
        assertEquals("sign-in callback carried the wrong state", e.message)
    }

    @Test
    fun `login reports the error IAM redirects with`() {
        iam.error = "access_denied"
        val e = assertFailsWith<IOException> { HanzoIam.login(::browse, { false }, api = iam.base, login = iam.base) }
        assertEquals("IAM refused sign-in: the person said no", e.message)
    }

    @Test
    fun `login stops when canceled or out of time`() {
        assertFailsWith<CancellationException> { HanzoIam.login({}, { true }, api = iam.base, login = iam.base) }
        val e = assertFailsWith<IOException> {
            HanzoIam.login({}, { false }, api = iam.base, login = iam.base, timeoutMillis = 300)
        }
        assertEquals("sign-in timed out", e.message)
    }

    @Test
    fun `an HTML answer is an error, not a token`() {
        val e = assertFailsWith<IOException> { HanzoIam.exchange("C1", "v", "r", api = "${iam.base}/html") }
        assertTrue(e.message!!.contains("not JSON"), e.message)
    }

    @Test
    fun `refresh keeps the refresh token IAM did not rotate`() {
        val tokens = HanzoIam.refresh("R1", iam.base)
        assertEquals("A2", tokens.access)
        assertEquals("R1", tokens.refresh)
        val e = assertFailsWith<HanzoIam.Rejected> { HanzoIam.refresh("revoked", iam.base) }
        assertEquals(400, e.status)
    }

    @Test
    fun `revoke posts the refresh token`() {
        HanzoIam.revoke("R1", iam.base)
        assertEquals("R1", iam.revoked)
    }

    @Test
    fun `stored tokens round trip and anything else reads as signed out`() {
        val tokens = HanzoIam.Tokens("A", "R", 42L)
        assertEquals(tokens, HanzoIam.decode(HanzoIam.encode(tokens)))
        assertEquals(HanzoIam.Tokens("A"), HanzoIam.decode(HanzoIam.encode(HanzoIam.Tokens("A"))))
        assertNull(HanzoIam.decode("eyJhbGciOiJSUzI1NiJ9.e30.sig"))
        assertNull(HanzoIam.decode("""{"access_token":""}"""))
        assertNull(HanzoIam.decode(""))
    }

    @Test
    fun `a token is expired a minute early and never without a lifetime`() {
        assertFalse(HanzoIam.Tokens("A").expired())
        assertFalse(HanzoIam.Tokens("A", expiresAt = 200_000).expired(now = 139_999))
        assertTrue(HanzoIam.Tokens("A", expiresAt = 200_000).expired(now = 140_000))
    }

    /** What the browser does: GET the authorize page and follow IAM's redirect to the loopback. */
    private fun browse(url: String) {
        OkHttpClient().newCall(Request.Builder().url(url).build()).execute().close()
    }

    /** IAM's authorize, token, revoke and userinfo endpoints, as far as a public PKCE client sees them. */
    private class FakeIam {
        val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val base = "http://127.0.0.1:${server.address.port}"
        var state: String? = null
        var error: String? = null
        var revoked: String? = null
        private var challenge = ""
        private var redirect = ""

        init {
            server.createContext("/v1/iam/oauth/authorize") { ex ->
                val q = "$base${ex.requestURI}".toHttpUrl()
                check(q.queryParameter("client_id") == "hanzo-jetbrains")
                check(q.queryParameter("code_challenge_method") == "S256")
                challenge = q.queryParameter("code_challenge")!!
                redirect = q.queryParameter("redirect_uri")!!
                check(Regex("""http://127\.0\.0\.1:\d+/callback""").matches(redirect))
                val back = redirect.toHttpUrl().newBuilder()
                    .addQueryParameter("state", state ?: q.queryParameter("state"))
                if (error != null) {
                    back.addQueryParameter("error", error).addQueryParameter("error_description", "the person said no")
                } else {
                    back.addQueryParameter("code", "C1")
                }
                ex.responseHeaders.add("Location", back.build().toString())
                ex.sendResponseHeaders(302, -1)
                ex.close()
            }
            server.createContext("/v1/iam/oauth/token") { ex ->
                val f = form(ex)
                val ok = f["client_id"] == "hanzo-jetbrains" && when (f["grant_type"]) {
                    "authorization_code" -> f["code"] == "C1" && f["redirect_uri"] == redirect &&
                        HanzoIam.challenge(f["code_verifier"].orEmpty()) == challenge
                    "refresh_token" -> f["refresh_token"] == "R1"
                    else -> false
                }
                when {
                    !ok -> json(ex, 400, """{"error":"invalid_grant"}""")
                    f["grant_type"] == "refresh_token" -> json(ex, 200, """{"access_token":"A2","expires_in":3600}""")
                    else -> json(ex, 200, """{"access_token":"A1","refresh_token":"R1","expires_in":3600,"token_type":"Bearer"}""")
                }
            }
            server.createContext("/v1/iam/oauth/revoke") { ex ->
                revoked = form(ex)["token"]
                json(ex, 200, "{}")
            }
            server.createContext("/v1/iam/oauth/userinfo") { ex ->
                if (ex.requestHeaders.getFirst("Authorization") == "Bearer A1") {
                    json(ex, 200, """{"sub":"u1","email":"person@hanzo.ai"}""")
                } else {
                    json(ex, 401, """{"error":"invalid_token"}""")
                }
            }
            server.createContext("/html/v1/iam/oauth/token") { ex ->
                val page = "<!doctype html><html></html>".toByteArray()
                ex.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
                ex.sendResponseHeaders(200, page.size.toLong())
                ex.responseBody.use { it.write(page) }
            }
            server.start()
        }

        private fun form(ex: HttpExchange): Map<String, String> =
            ex.requestBody.readBytes().toString(Charsets.UTF_8).split('&').filter { it.isNotEmpty() }.associate {
                val (k, v) = it.split('=', limit = 2)
                URLDecoder.decode(k, Charsets.UTF_8) to URLDecoder.decode(v, Charsets.UTF_8)
            }

        private fun json(ex: HttpExchange, status: Int, body: String) {
            val bytes = body.toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
    }
}
