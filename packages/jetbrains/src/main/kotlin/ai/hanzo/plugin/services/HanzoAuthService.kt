package ai.hanzo.plugin.services

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.ide.BrowserUtil
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import java.io.IOException

/** The signed-in Hanzo IAM session. Tokens live in the IDE's password safe. */
@Service(Service.Level.APP)
class HanzoAuthService {
    companion object {
        private val LOG = Logger.getInstance(HanzoAuthService::class.java)
        private val CREDENTIALS = CredentialAttributes("HanzoAI", "default")
        private const val EMAIL_KEY = "hanzo.user.email"
    }

    private val properties = PropertiesComponent.getInstance()

    @Volatile
    private var tokens: HanzoIam.Tokens? = PasswordSafe.instance.getPassword(CREDENTIALS)?.let(HanzoIam::decode)

    @Volatile
    private var email: String? = properties.getValue(EMAIL_KEY)

    fun isAuthenticated(): Boolean = tokens != null

    fun getUserEmail(): String? = email

    /** The access token, refreshed first when it is about to expire. Null when signed out. */
    @Synchronized
    fun getAuthToken(): String? {
        val current = tokens ?: return null
        if (!current.expired()) return current.access
        val refresh = current.refresh
        if (refresh == null) {
            clear()
            return null
        }
        return try {
            HanzoIam.refresh(refresh).also(::store).access
        } catch (e: HanzoIam.Rejected) {
            LOG.warn("IAM refused the refresh token; signing out", e)
            clear()
            null
        } catch (e: IOException) {
            LOG.warn("Token refresh failed", e)
            null
        }
    }

    /**
     * Signs in through the browser and blocks until IAM redirects back.
     * Returns the account's email when IAM shares it.
     */
    fun login(canceled: () -> Boolean): String? {
        val signedIn = HanzoIam.login(BrowserUtil::browse, canceled)
        val info = HanzoIam.userinfo(signedIn.access)
        store(signedIn)
        email = info.get("email")?.takeIf { it.isJsonPrimitive }?.asString
        properties.setValue(EMAIL_KEY, email)
        LOG.info("Signed in to Hanzo IAM")
        return email
    }

    fun logout() {
        val refresh = tokens?.refresh
        clear()
        if (refresh != null) {
            ApplicationManager.getApplication().executeOnPooledThread {
                try {
                    HanzoIam.revoke(refresh)
                } catch (e: IOException) {
                    LOG.warn("IAM did not revoke the refresh token", e)
                }
            }
        }
        LOG.info("Signed out of Hanzo IAM")
    }

    private fun store(signedIn: HanzoIam.Tokens) {
        tokens = signedIn
        PasswordSafe.instance.setPassword(CREDENTIALS, HanzoIam.encode(signedIn))
    }

    private fun clear() {
        tokens = null
        email = null
        PasswordSafe.instance.setPassword(CREDENTIALS, null)
        properties.unsetValue(EMAIL_KEY)
    }
}
