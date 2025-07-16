package ai.hanzo.plugin

import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import ai.hanzo.plugin.services.HanzoAuthService
import ai.hanzo.plugin.services.HanzoMCPService
import ai.hanzo.plugin.settings.HanzoSettings

object HanzoPlugin {
    private val LOG = Logger.getInstance(HanzoPlugin::class.java)
    
    const val PLUGIN_ID = "ai.hanzo.intellij"
    const val PLUGIN_NAME = "Hanzo AI"
    
    // API Endpoints
    const val API_BASE_URL = "https://api.hanzo.ai"
    const val LLM_GATEWAY_URL = "https://llm.hanzo.ai"
    const val AUTH_URL = "https://auth.hanzo.ai"
    
    // Configuration
    const val DEFAULT_MODEL = "claude-3-5-sonnet-20241022"
    const val MAX_TOKENS = 4096
    const val TEMPERATURE = 0.7
    
    fun initialize() {
        LOG.info("Initializing Hanzo AI Plugin")
        
        // Initialize services
        val authService = service<HanzoAuthService>()
        val mcpService = service<HanzoMCPService>()
        
        // Check authentication status
        if (authService.isAuthenticated()) {
            LOG.info("User is authenticated")
            mcpService.initialize()
        } else {
            LOG.info("User is not authenticated")
        }
    }
    
    fun getAuthService(): HanzoAuthService = service()
    fun getMCPService(): HanzoMCPService = service()
    fun getSettings(): HanzoSettings = HanzoSettings.instance
    
    fun isInitialized(): Boolean {
        return getAuthService().isAuthenticated()
    }
    
    fun getVersion(): String {
        return javaClass.`package`.implementationVersion ?: "0.1.0"
    }
}