package ai.hanzo.plugin

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HanzoPluginTest {

    @Test
    fun testPluginConstants() {
        assertEquals("ai.hanzo.intellij", HanzoPlugin.PLUGIN_ID)
        assertEquals("Hanzo AI", HanzoPlugin.PLUGIN_NAME)
        assertEquals("https://api.hanzo.ai", HanzoPlugin.API_BASE_URL)
    }

    @Test
    fun `the default model is the one the catalog marks as default`() {
        assertEquals("zen5", HanzoPlugin.DEFAULT_MODEL)
    }

    @Test
    fun `the chat preselects the default when the catalog lists it, else the first model`() {
        assertEquals("zen5", HanzoPlugin.defaultModel(listOf("enso", "zen5", "zen5-coder")))
        assertEquals("enso", HanzoPlugin.defaultModel(listOf("enso", "zen6")))
        assertNull(HanzoPlugin.defaultModel(emptyList()))
    }
}
