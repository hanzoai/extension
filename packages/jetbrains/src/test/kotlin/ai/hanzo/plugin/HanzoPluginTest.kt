package ai.hanzo.plugin

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class HanzoPluginTest {

    @Test
    fun testPluginConstants() {
        assertEquals("ai.hanzo.intellij", HanzoPlugin.PLUGIN_ID)
        assertEquals("Hanzo AI", HanzoPlugin.PLUGIN_NAME)
        assertEquals("https://api.hanzo.ai", HanzoPlugin.API_BASE_URL)
    }

    @Test
    fun testDefaultModel() {
        assertEquals("claude-3-5-sonnet-20241022", HanzoPlugin.DEFAULT_MODEL)
    }
}
