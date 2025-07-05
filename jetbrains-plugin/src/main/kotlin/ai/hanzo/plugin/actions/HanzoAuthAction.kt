package ai.hanzo.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import ai.hanzo.plugin.HanzoPlugin
import java.awt.BorderLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.*

class HanzoAuthAction : AnAction() {
    
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        val authService = HanzoPlugin.getAuthService()
        
        if (authService.isAuthenticated()) {
            // Show logout confirmation
            val userEmail = authService.getUserEmail() ?: "Unknown"
            val result = Messages.showYesNoDialog(
                project,
                "You are currently logged in as: $userEmail\n\nDo you want to logout?",
                "Hanzo AI",
                "Logout",
                "Cancel",
                Messages.getQuestionIcon()
            )
            
            if (result == Messages.YES) {
                authService.logout()
                Messages.showInfoMessage(project, "Successfully logged out from Hanzo AI", "Logout Successful")
                updateActionText()
            }
        } else {
            // Show login dialog
            val dialog = LoginDialog(project)
            if (dialog.showAndGet()) {
                performLogin(e, dialog.getEmail(), dialog.getPassword(), dialog.isUsingApiKey())
            }
        }
    }
    
    private fun performLogin(e: AnActionEvent, credential: String, password: String?, isApiKey: Boolean) {
        val project = e.project
        
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Logging in to Hanzo AI...", false) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val authService = HanzoPlugin.getAuthService()
                    val success = if (isApiKey) {
                        authService.loginWithApiKey(credential).get()
                    } else {
                        authService.login(credential, password!!).get()
                    }
                    
                    SwingUtilities.invokeLater {
                        if (success) {
                            Messages.showInfoMessage(
                                project,
                                "Successfully logged in to Hanzo AI!",
                                "Login Successful"
                            )
                            updateActionText()
                            
                            // Initialize MCP service after successful login
                            HanzoPlugin.getMCPService().initialize()
                        } else {
                            Messages.showErrorDialog(
                                project,
                                "Invalid credentials. Please check your ${if (isApiKey) "API key" else "email and password"} and try again.",
                                "Login Failed"
                            )
                        }
                    }
                } catch (ex: Exception) {
                    SwingUtilities.invokeLater {
                        Messages.showErrorDialog(
                            project,
                            "Failed to connect to Hanzo AI: ${ex.message}",
                            "Connection Error"
                        )
                    }
                }
            }
        })
    }
    
    override fun update(e: AnActionEvent) {
        super.update(e)
        updateActionText()
    }
    
    private fun updateActionText() {
        val authService = HanzoPlugin.getAuthService()
        val text = if (authService.isAuthenticated()) {
            "Logout from Hanzo AI"
        } else {
            "Login to Hanzo AI"
        }
        templatePresentation.text = text
    }
    
    private class LoginDialog(project: com.intellij.openapi.project.Project?) : DialogWrapper(project) {
        private val tabbedPane = JTabbedPane()
        private val emailField = JBTextField(30)
        private val passwordField = JBPasswordField()
        private val apiKeyField = JBTextField(30)
        
        init {
            title = "Login to Hanzo AI"
            init()
        }
        
        override fun createCenterPanel(): JComponent {
            val panel = JPanel(BorderLayout())
            
            // Email/Password tab
            val emailPasswordPanel = createEmailPasswordPanel()
            tabbedPane.addTab("Email & Password", emailPasswordPanel)
            
            // API Key tab
            val apiKeyPanel = createApiKeyPanel()
            tabbedPane.addTab("API Key", apiKeyPanel)
            
            panel.add(tabbedPane, BorderLayout.CENTER)
            
            // Info panel
            val infoPanel = JPanel()
            infoPanel.layout = BoxLayout(infoPanel, BoxLayout.Y_AXIS)
            infoPanel.border = JBUI.Borders.empty(10, 0, 0, 0)
            
            val infoLabel = JLabel("<html><center>Don't have an account? Visit <a href='https://hanzo.ai'>hanzo.ai</a> to sign up</center></html>")
            infoLabel.horizontalAlignment = SwingConstants.CENTER
            infoPanel.add(infoLabel)
            
            panel.add(infoPanel, BorderLayout.SOUTH)
            
            return panel
        }
        
        private fun createEmailPasswordPanel(): JPanel {
            val panel = JPanel(GridBagLayout())
            val gbc = GridBagConstraints()
            gbc.fill = GridBagConstraints.HORIZONTAL
            gbc.insets = JBUI.insets(5)
            
            // Email
            gbc.gridx = 0
            gbc.gridy = 0
            panel.add(JLabel("Email:"), gbc)
            
            gbc.gridx = 1
            gbc.weightx = 1.0
            panel.add(emailField, gbc)
            
            // Password
            gbc.gridx = 0
            gbc.gridy = 1
            gbc.weightx = 0.0
            panel.add(JLabel("Password:"), gbc)
            
            gbc.gridx = 1
            gbc.weightx = 1.0
            panel.add(passwordField, gbc)
            
            return panel
        }
        
        private fun createApiKeyPanel(): JPanel {
            val panel = JPanel(GridBagLayout())
            val gbc = GridBagConstraints()
            gbc.fill = GridBagConstraints.HORIZONTAL
            gbc.insets = JBUI.insets(5)
            
            // API Key
            gbc.gridx = 0
            gbc.gridy = 0
            panel.add(JLabel("API Key:"), gbc)
            
            gbc.gridx = 1
            gbc.weightx = 1.0
            apiKeyField.emptyText.text = "hzk_..."
            panel.add(apiKeyField, gbc)
            
            // Info
            gbc.gridx = 0
            gbc.gridy = 1
            gbc.gridwidth = 2
            val infoLabel = JLabel("<html><small>Get your API key from the Hanzo AI dashboard</small></html>")
            panel.add(infoLabel, gbc)
            
            return panel
        }
        
        override fun doValidate(): ValidationInfo? {
            return when (tabbedPane.selectedIndex) {
                0 -> { // Email/Password tab
                    when {
                        emailField.text.isBlank() -> ValidationInfo("Email cannot be empty", emailField)
                        !emailField.text.contains("@") -> ValidationInfo("Please enter a valid email", emailField)
                        passwordField.password.isEmpty() -> ValidationInfo("Password cannot be empty", passwordField)
                        else -> null
                    }
                }
                1 -> { // API Key tab
                    when {
                        apiKeyField.text.isBlank() -> ValidationInfo("API key cannot be empty", apiKeyField)
                        !apiKeyField.text.startsWith("hzk_") -> ValidationInfo("API key should start with 'hzk_'", apiKeyField)
                        else -> null
                    }
                }
                else -> null
            }
        }
        
        fun getEmail(): String = if (isUsingApiKey()) apiKeyField.text else emailField.text
        fun getPassword(): String? = if (isUsingApiKey()) null else String(passwordField.password)
        fun isUsingApiKey(): Boolean = tabbedPane.selectedIndex == 1
        
        override fun getPreferredFocusedComponent(): JComponent {
            return if (isUsingApiKey()) apiKeyField else emailField
        }
    }
}