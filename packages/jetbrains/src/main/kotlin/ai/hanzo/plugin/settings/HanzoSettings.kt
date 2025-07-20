package ai.hanzo.plugin.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

@State(
    name = "ai.hanzo.plugin.settings.HanzoSettings",
    storages = [Storage("HanzoSettings.xml")]
)
class HanzoSettings : PersistentStateComponent<HanzoSettings> {
    var apiEndpoint = "https://api.hanzo.ai"
    var enableMCP = true
    var enableSymbolSearch = true

    override fun getState(): HanzoSettings = this

    override fun loadState(state: HanzoSettings) {
        XmlSerializerUtil.copyBean(state, this)
    }

    companion object {
        val instance: HanzoSettings
            get() = ApplicationManager.getApplication().getService(HanzoSettings::class.java)
    }
}