package ai.hanzo.plugin.settings

import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JPanel

class HanzoSettingsComponent {
    private val apiEndpointField = JBTextField()
    private val enableMCPCheckBox = JBCheckBox("Enable Model Context Protocol (MCP)")
    private val enableSymbolSearchCheckBox = JBCheckBox("Enable AI-powered symbol search")

    val panel: JPanel = FormBuilder.createFormBuilder()
        .addLabeledComponent("API Endpoint:", apiEndpointField, 1, false)
        .addComponent(enableMCPCheckBox, 1)
        .addComponent(enableSymbolSearchCheckBox, 1)
        .addComponentFillVertically(JPanel(), 0)
        .panel

    var apiEndpoint: String
        get() = apiEndpointField.text
        set(value) {
            apiEndpointField.text = value
        }

    var enableMCP: Boolean
        get() = enableMCPCheckBox.isSelected
        set(value) {
            enableMCPCheckBox.isSelected = value
        }

    var enableSymbolSearch: Boolean
        get() = enableSymbolSearchCheckBox.isSelected
        set(value) {
            enableSymbolSearchCheckBox.isSelected = value
        }
}