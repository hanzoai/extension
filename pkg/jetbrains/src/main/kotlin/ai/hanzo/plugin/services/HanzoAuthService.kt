package ai.hanzo.plugin.services

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import ai.hanzo.plugin.HanzoPlugin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.CompletableFuture

@Service(Service.Level.APP)
class HanzoAuthService {
    companion object {
        private val LOG = Logger.getInstance(HanzoAuthService::class.java)
        private const val SERVICE_NAME = "HanzoAI"
        private const val ACCOUNT_NAME = "default"
        private const val USER_ID_KEY = "hanzo.user.id"
        private const val USER_EMAIL_KEY = "hanzo.user.email"
    }
    
    private val client = OkHttpClient()
    private val gson = Gson()
    private val properties = PropertiesComponent.getInstance()
    
    private var authToken: String? = null
    private var userId: String? = null
    private var userEmail: String? = null
    
    init {
        loadStoredCredentials()
    }
    
    fun isAuthenticated(): Boolean {
        return authToken != null
    }
    
    fun getAuthToken(): String? = authToken
    
    fun getUserId(): String? = userId
    
    fun getUserEmail(): String? = userEmail
    
    fun login(email: String, password: String): CompletableFuture<Boolean> {
        val future = CompletableFuture<Boolean>()
        
        val json = JsonObject().apply {
            addProperty("email", email)
            addProperty("password", password)
        }
        
        val requestBody = gson.toJson(json).toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${HanzoPlugin.AUTH_URL}/api/v1/login")
            .post(requestBody)
            .build()
        
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                LOG.error("Login failed", e)
                future.complete(false)
            }
            
            override fun onResponse(call: Call, response: Response) {
                response.use { resp ->
                    if (resp.isSuccessful) {
                        try {
                            val body = resp.body?.string()
                            val jsonResponse = gson.fromJson(body, JsonObject::class.java)
                            
                            authToken = jsonResponse.get("access_token")?.asString
                            userId = jsonResponse.get("user_id")?.asString
                            userEmail = email
                            
                            if (authToken != null) {
                                saveCredentials()
                                LOG.info("Login successful for user: $email")
                                future.complete(true)
                            } else {
                                LOG.error("No auth token in response")
                                future.complete(false)
                            }
                        } catch (e: Exception) {
                            LOG.error("Failed to parse login response", e)
                            future.complete(false)
                        }
                    } else {
                        LOG.error("Login failed with status: ${resp.code}")
                        future.complete(false)
                    }
                }
            }
        })
        
        return future
    }
    
    fun loginWithApiKey(apiKey: String): CompletableFuture<Boolean> {
        val future = CompletableFuture<Boolean>()
        
        // Validate API key format
        if (!apiKey.startsWith("hzk_")) {
            future.complete(false)
            return future
        }
        
        authToken = apiKey
        
        // Verify the API key by making a test request
        val request = Request.Builder()
            .url("${HanzoPlugin.API_BASE_URL}/api/v1/user/profile")
            .header("Authorization", "Bearer $apiKey")
            .get()
            .build()
        
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                LOG.error("API key validation failed", e)
                authToken = null
                future.complete(false)
            }
            
            override fun onResponse(call: Call, response: Response) {
                response.use { resp ->
                    if (resp.isSuccessful) {
                        try {
                            val body = resp.body?.string()
                            val jsonResponse = gson.fromJson(body, JsonObject::class.java)
                            
                            userId = jsonResponse.get("id")?.asString
                            userEmail = jsonResponse.get("email")?.asString
                            
                            saveCredentials()
                            LOG.info("API key login successful")
                            future.complete(true)
                        } catch (e: Exception) {
                            LOG.error("Failed to parse user profile", e)
                            authToken = null
                            future.complete(false)
                        }
                    } else {
                        LOG.error("API key validation failed with status: ${resp.code}")
                        authToken = null
                        future.complete(false)
                    }
                }
            }
        })
        
        return future
    }
    
    fun logout() {
        authToken = null
        userId = null
        userEmail = null
        clearStoredCredentials()
        LOG.info("User logged out")
    }
    
    private fun saveCredentials() {
        if (authToken != null) {
            val credentialAttributes = CredentialAttributes(SERVICE_NAME, ACCOUNT_NAME)
            val credentials = Credentials(ACCOUNT_NAME, authToken)
            PasswordSafe.instance.set(credentialAttributes, credentials)
            
            // Save user info
            userId?.let { properties.setValue(USER_ID_KEY, it) }
            userEmail?.let { properties.setValue(USER_EMAIL_KEY, it) }
        }
    }
    
    private fun loadStoredCredentials() {
        val credentialAttributes = CredentialAttributes(SERVICE_NAME, ACCOUNT_NAME)
        val credentials = PasswordSafe.instance.get(credentialAttributes)
        
        if (credentials != null) {
            authToken = credentials.getPasswordAsString()
            userId = properties.getValue(USER_ID_KEY)
            userEmail = properties.getValue(USER_EMAIL_KEY)
            
            LOG.info("Loaded stored credentials for user: $userEmail")
        }
    }
    
    private fun clearStoredCredentials() {
        val credentialAttributes = CredentialAttributes(SERVICE_NAME, ACCOUNT_NAME)
        PasswordSafe.instance.set(credentialAttributes, null)
        
        properties.unsetValue(USER_ID_KEY)
        properties.unsetValue(USER_EMAIL_KEY)
    }
}