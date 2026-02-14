package ai.hanzo.plugin.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import ai.hanzo.plugin.HanzoPlugin
import ai.hanzo.plugin.services.HanzoProjectService
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.*

class HanzoChatPanel(private val project: Project) {
    private val panel = JPanel(BorderLayout())
    private val chatHistory = JBTextArea()
    private val inputField = JBTextArea(3, 0)
    private val modelSelector = ComboBox<String>()
    private val sendButton = JButton("Send")
    private val clearButton = JButton("Clear")
    
    private val projectService = project.getService(HanzoProjectService::class.java)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    
    init {
        setupUI()
        loadModels()
    }
    
    private fun setupUI() {
        // Chat history
        chatHistory.isEditable = false
        chatHistory.lineWrap = true
        chatHistory.wrapStyleWord = true
        chatHistory.border = JBUI.Borders.empty(10)
        
        val scrollPane = JBScrollPane(chatHistory)
        scrollPane.border = JBUI.Borders.customLine(JBUI.CurrentTheme.ToolWindow.borderColor(), 1)
        
        // Top panel with model selector
        val topPanel = JPanel(FlowLayout(FlowLayout.LEFT))
        topPanel.add(JLabel("Model:"))
        modelSelector.maximumSize = JBUI.size(300, 30)
        topPanel.add(modelSelector)
        topPanel.add(clearButton)
        
        // Input panel
        val inputPanel = JPanel(BorderLayout())
        inputField.lineWrap = true
        inputField.wrapStyleWord = true
        inputField.border = JBUI.Borders.empty(5)
        
        val inputScroll = JBScrollPane(inputField)
        inputScroll.border = JBUI.Borders.customLine(JBUI.CurrentTheme.ToolWindow.borderColor(), 1)
        inputScroll.preferredSize = JBUI.size(-1, 80)
        
        inputPanel.add(inputScroll, BorderLayout.CENTER)
        inputPanel.add(sendButton, BorderLayout.EAST)
        inputPanel.border = JBUI.Borders.empty(5)
        
        // Main panel layout
        panel.add(topPanel, BorderLayout.NORTH)
        panel.add(scrollPane, BorderLayout.CENTER)
        panel.add(inputPanel, BorderLayout.SOUTH)
        
        // Event listeners
        sendButton.addActionListener { sendMessage() }
        clearButton.addActionListener { clearChat() }
        
        // Enter key to send (Ctrl+Enter for new line)
        inputField.addKeyListener(object : java.awt.event.KeyAdapter() {
            override fun keyPressed(e: java.awt.event.KeyEvent) {
                if (e.keyCode == java.awt.event.KeyEvent.VK_ENTER && !e.isControlDown) {
                    e.consume()
                    sendMessage()
                }
            }
        })
    }
    
    private fun loadModels() {
        scope.launch {
            try {
                val models = projectService.getAvailableModels()
                SwingUtilities.invokeLater {
                    modelSelector.removeAllItems()
                    models.forEach { modelSelector.addItem(it) }
                    
                    // Select default model
                    val defaultModel = models.find { it.contains("claude") } ?: models.firstOrNull()
                    defaultModel?.let { modelSelector.selectedItem = it }
                }
            } catch (e: Exception) {
                showError("Failed to load models: ${e.message}")
            }
        }
    }
    
    private fun sendMessage() {
        val message = inputField.text.trim()
        if (message.isEmpty()) return
        
        val selectedModel = modelSelector.selectedItem as? String ?: HanzoPlugin.DEFAULT_MODEL
        
        // Clear input and disable send button
        inputField.text = ""
        sendButton.isEnabled = false
        
        // Add user message to chat
        appendToChat("You: $message\n\n")
        
        // Send message asynchronously
        scope.launch {
            try {
                val response = projectService.sendChatMessage(message, selectedModel)
                SwingUtilities.invokeLater {
                    appendToChat("AI: $response\n\n")
                    sendButton.isEnabled = true
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    appendToChat("Error: ${e.message}\n\n")
                    sendButton.isEnabled = true
                }
            }
        }
    }
    
    private fun clearChat() {
        chatHistory.text = ""
        projectService.clearChatHistory()
    }
    
    private fun appendToChat(text: String) {
        chatHistory.append(text)
        chatHistory.caretPosition = chatHistory.document.length
    }
    
    private fun showError(message: String) {
        SwingUtilities.invokeLater {
            JOptionPane.showMessageDialog(panel, message, "Error", JOptionPane.ERROR_MESSAGE)
        }
    }
    
    fun getComponent(): JComponent = panel
    
    fun dispose() {
        scope.cancel()
    }
}