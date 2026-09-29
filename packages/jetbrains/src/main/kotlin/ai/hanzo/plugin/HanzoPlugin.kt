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
    
    // Models, chat and MCP. Sign-in is HanzoIam.
    const val API_BASE_URL = "https://api.hanzo.ai"
    
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
}