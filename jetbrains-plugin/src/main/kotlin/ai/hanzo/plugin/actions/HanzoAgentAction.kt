package ai.hanzo.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import ai.hanzo.plugin.HanzoPlugin
import ai.hanzo.plugin.services.HanzoProjectService
import kotlinx.coroutines.runBlocking
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.*

class HanzoAgentAction : AnAction() {
    
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        
        if (!HanzoPlugin.isInitialized()) {
            Messages.showWarningDialog(
                project,
                "Please login to Hanzo AI first.\nGo to Tools → Hanzo AI → Login",
                "Hanzo AI Not Connected"
            )
            return
        }
        
        val selectedText = editor.selectionModel.selectedText
        if (selectedText.isNullOrBlank()) {
            Messages.showWarningDialog(
                project,
                "Please select some code first",
                "No Selection"
            )
            return
        }
        
        val dialog = AgentDialog(project, selectedText)
        if (dialog.showAndGet()) {
            val prompt = dialog.getPrompt()
            if (prompt.isNotBlank()) {
                executeAgent(project, editor, selectedText, prompt)
            }
        }
    }
    
    private fun executeAgent(
        project: Project,
        editor: Editor,
        selectedText: String,
        prompt: String
    ) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Processing with Hanzo AI...", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                
                try {
                    val projectService = project.getService(HanzoProjectService::class.java)
                    val fullPrompt = buildFullPrompt(selectedText, prompt)
                    
                    val response = runBlocking {
                        projectService.sendChatMessage(fullPrompt, HanzoPlugin.DEFAULT_MODEL)
                    }
                    
                    ApplicationManager.getApplication().invokeLater {
                        showResponseDialog(project, editor, selectedText, response)
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            "Error processing with AI: ${e.message}",
                            "Hanzo AI Error"
                        )
                    }
                }
            }
        })
    }
    
    private fun buildFullPrompt(code: String, userPrompt: String): String {
        return """
            Please help me with the following code:
            
            ```
            $code
            ```
            
            User request: $userPrompt
            
            Please provide a clear and helpful response. If you're suggesting code changes, please provide the complete updated code.
        """.trimIndent()
    }
    
    private fun showResponseDialog(
        project: Project,
        editor: Editor,
        originalCode: String,
        response: String
    ) {
        val dialog = ResponseDialog(project, response)
        if (dialog.showAndGet()) {
            // Check if response contains code to replace
            val codeMatch = Regex("```(?:\\w+)?\\n(.*?)\\n```", RegexOption.DOT_MATCHES_ALL)
                .find(response)
            
            if (codeMatch != null && dialog.shouldReplaceCode()) {
                val newCode = codeMatch.groupValues[1]
                replaceSelectedCode(project, editor, newCode)
            }
        }
    }
    
    private fun replaceSelectedCode(project: Project, editor: Editor, newCode: String) {
        WriteCommandAction.runWriteCommandAction(project) {
            val selectionModel = editor.selectionModel
            val document = editor.document
            
            document.replaceString(
                selectionModel.selectionStart,
                selectionModel.selectionEnd,
                newCode
            )
        }
    }
    
    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        val editor = e.getData(CommonDataKeys.EDITOR)
        e.presentation.isEnabledAndVisible = project != null && editor != null
    }
    
    private class AgentDialog(project: Project, private val selectedCode: String) : DialogWrapper(project) {
        private val promptField = JBTextArea(5, 50)
        
        init {
            title = "Ask Hanzo AI"
            init()
        }
        
        override fun createCenterPanel(): JComponent {
            val panel = JPanel(BorderLayout())
            panel.preferredSize = Dimension(600, 400)
            
            // Selected code preview
            val codeArea = JBTextArea(selectedCode)
            codeArea.isEditable = false
            codeArea.font = editor.font
            val codeScroll = JBScrollPane(codeArea)
            codeScroll.preferredSize = Dimension(600, 200)
            codeScroll.border = BorderFactory.createTitledBorder("Selected Code")
            
            // Prompt input
            promptField.lineWrap = true
            promptField.wrapStyleWord = true
            promptField.text = "Explain this code"
            val promptScroll = JBScrollPane(promptField)
            promptScroll.preferredSize = Dimension(600, 150)
            promptScroll.border = BorderFactory.createTitledBorder("Your Question")
            
            panel.add(codeScroll, BorderLayout.NORTH)
            panel.add(promptScroll, BorderLayout.CENTER)
            
            return panel
        }
        
        fun getPrompt(): String = promptField.text
        
        override fun getPreferredFocusedComponent(): JComponent = promptField
    }
    
    private class ResponseDialog(project: Project, private val response: String) : DialogWrapper(project) {
        private var replaceCode = false
        
        init {
            title = "Hanzo AI Response"
            init()
        }
        
        override fun createCenterPanel(): JComponent {
            val panel = JPanel(BorderLayout())
            panel.preferredSize = Dimension(700, 500)
            
            val responseArea = JBTextArea(response)
            responseArea.isEditable = false
            responseArea.lineWrap = true
            responseArea.wrapStyleWord = true
            responseArea.font = editor.font
            
            val scrollPane = JBScrollPane(responseArea)
            scrollPane.border = JBUI.Borders.empty(10)
            
            panel.add(scrollPane, BorderLayout.CENTER)
            
            // Add replace button if code is detected
            if (response.contains("```")) {
                val buttonPanel = JPanel()
                val replaceButton = JButton("Replace Selected Code")
                replaceButton.addActionListener {
                    replaceCode = true
                    close(OK_EXIT_CODE)
                }
                buttonPanel.add(replaceButton)
                panel.add(buttonPanel, BorderLayout.SOUTH)
            }
            
            return panel
        }
        
        fun shouldReplaceCode(): Boolean = replaceCode
    }
    
    companion object {
        private val editor = UIManager.getFont("EditorPane.font")
    }
}