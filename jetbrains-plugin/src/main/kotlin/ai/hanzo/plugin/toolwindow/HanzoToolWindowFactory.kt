package ai.hanzo.plugin.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import javax.swing.JComponent

class HanzoToolWindowFactory : ToolWindowFactory {
    
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()
        
        // Create main chat panel
        val chatPanel = HanzoChatPanel(project)
        val chatContent = contentFactory.createContent(chatPanel.getComponent(), "Chat", false)
        toolWindow.contentManager.addContent(chatContent)
        
        // Create MCP server panel
        val mcpPanel = HanzoMCPPanel(project)
        val mcpContent = contentFactory.createContent(mcpPanel.getComponent(), "MCP Servers", false)
        toolWindow.contentManager.addContent(mcpContent)
        
        // Create settings panel
        val settingsPanel = HanzoSettingsPanel(project)
        val settingsContent = contentFactory.createContent(settingsPanel.getComponent(), "Settings", false)
        toolWindow.contentManager.addContent(settingsContent)
    }
    
    override fun shouldBeAvailable(project: Project): Boolean = true
}