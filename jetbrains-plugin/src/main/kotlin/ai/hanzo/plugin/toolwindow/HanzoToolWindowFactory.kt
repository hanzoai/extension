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
    }
    
    override fun shouldBeAvailable(project: Project): Boolean = true
}