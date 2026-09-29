package ai.hanzo.plugin.settings

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.util.NlsContexts
import javax.swing.JComponent
import javax.swing.JPanel

class HanzoSettingsConfigurable : Configurable {
    private var settingsComponent: HanzoSettingsComponent? = null

    @NlsContexts.ConfigurableName
    override fun getDisplayName(): String = "Hanzo AI"

    override fun createComponent(): JComponent {
        settingsComponent = HanzoSettingsComponent()
        return settingsComponent!!.panel
    }

    override fun isModified(): Boolean {
        val settings = HanzoSettings.instance
        return settingsComponent?.apiEndpoint != settings.apiEndpoint ||
               settingsComponent?.enableSymbolSearch != settings.enableSymbolSearch
    }

    override fun apply() {
        val settings = HanzoSettings.instance
        settingsComponent?.let {
            settings.apiEndpoint = it.apiEndpoint
            settings.enableSymbolSearch = it.enableSymbolSearch
        }
    }

    override fun reset() {
        val settings = HanzoSettings.instance
        settingsComponent?.let {
            it.apiEndpoint = settings.apiEndpoint
            it.enableSymbolSearch = settings.enableSymbolSearch
        }
    }

    override fun disposeUIResources() {
        settingsComponent = null
    }
}