package ai.hanzo.plugin

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class HanzoPluginTest {
    
    @Test
    fun testPluginConstants() {
        assertEquals("ai.hanzo.intellij", HanzoPlugin.PLUGIN_ID)
        assertEquals("Hanzo AI", HanzoPlugin.PLUGIN_NAME)
        assertEquals("https://api.hanzo.ai", HanzoPlugin.API_BASE_URL)
        assertEquals("https://llm.hanzo.ai", HanzoPlugin.LLM_GATEWAY_URL)
    }
    
    @Test
    fun testDefaultModel() {
        assertEquals("claude-3-5-sonnet-20241022", HanzoPlugin.DEFAULT_MODEL)
    }
    
    @Test
    fun testServices() {
        // Services will be initialized by the platform
        // For unit tests, we just verify the methods exist
        try {
            HanzoPlugin.getAuthService()
            HanzoPlugin.getMCPService()
            HanzoPlugin.getSettings()
        } catch (e: Exception) {
            // Expected in unit test environment without full IDE context
        }
    }
    
    @Test
    fun testVersion() {
        val version = HanzoPlugin.getVersion()
        assertNotNull(version)
        assertEquals("0.1.0", version)
    }
}