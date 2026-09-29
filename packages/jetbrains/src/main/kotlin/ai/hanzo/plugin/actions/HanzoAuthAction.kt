package ai.hanzo.plugin.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.ui.Messages
import ai.hanzo.plugin.HanzoPlugin
import java.io.IOException
import java.util.concurrent.CancellationException

/** Login opens hanzo.id in the browser; the IDE never sees a password. */
class HanzoAuthAction : AnAction() {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        val authService = HanzoPlugin.getAuthService()

        if (authService.isAuthenticated()) {
            val result = Messages.showYesNoDialog(
                project,
                "You are logged in as ${authService.getUserEmail() ?: "an unknown account"}.\n\nLog out?",
                "Hanzo AI",
                "Logout",
                "Cancel",
                Messages.getQuestionIcon()
            )
            if (result == Messages.YES) authService.logout()
            return
        }

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Logging in to Hanzo AI", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = "Finish logging in in your browser"
                val email = try {
                    authService.login { indicator.isCanceled }
                } catch (ex: CancellationException) {
                    return
                } catch (ex: IOException) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, "Login failed: ${ex.message}", "Hanzo AI")
                    }
                    return
                }
                ApplicationManager.getApplication().invokeLater {
                    Messages.showInfoMessage(project, "Logged in to Hanzo AI${email?.let { " as $it" } ?: ""}.", "Hanzo AI")
                }
            }
        })
    }

    override fun update(e: AnActionEvent) {
        e.presentation.text =
            if (HanzoPlugin.getAuthService().isAuthenticated()) "Logout from Hanzo AI" else "Login to Hanzo AI"
    }
}
