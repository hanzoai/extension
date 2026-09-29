package ai.hanzo.plugin

import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import ai.hanzo.plugin.services.HanzoAuthService
import ai.hanzo.plugin.settings.HanzoSettings

object HanzoPlugin {
    private val LOG = Logger.getInstance(HanzoPlugin::class.java)
    
    const val PLUGIN_ID = "ai.hanzo.intellij"
    const val PLUGIN_NAME = "Hanzo AI"
    
    // Models and chat. Sign-in is HanzoIam.
    const val API_BASE_URL = "https://api.hanzo.ai"
    
    // The model the Hanzo catalog marks as its default (catalog.hanzo.ai/v1/pricing: "Zen5 (Default)").
    const val DEFAULT_MODEL = "zen5"
    const val MAX_TOKENS = 4096
    const val TEMPERATURE = 0.7
    
    fun initialize() {
        LOG.info("Initializing Hanzo AI Plugin")
        
        if (service<HanzoAuthService>().isAuthenticated()) {
            LOG.info("User is authenticated")
        } else {
            LOG.info("User is not authenticated")
        }
    }

    /** DEFAULT_MODEL when the catalog lists it, else the first model listed. */
    fun defaultModel(models: List<String>): String? = DEFAULT_MODEL.takeIf { it in models } ?: models.firstOrNull()

    fun getAuthService(): HanzoAuthService = service()
    fun getSettings(): HanzoSettings = HanzoSettings.instance
    
    fun isInitialized(): Boolean {
        return getAuthService().isAuthenticated()
    }
}