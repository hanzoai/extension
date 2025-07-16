package ai.hanzo.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.intellij.openapi.vfs.LocalFileSystem
import ai.hanzo.plugin.HanzoPlugin
import ai.hanzo.plugin.services.HanzoProjectService
import kotlinx.coroutines.runBlocking
import java.io.File
import javax.swing.Icon

class HanzoSymbolSearchAction : AnAction() {
    
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        
        if (!HanzoPlugin.isInitialized()) {
            Messages.showWarningDialog(
                project,
                "Please login to Hanzo AI first.\nGo to Tools → Hanzo AI → Login",
                "Hanzo AI Not Connected"
            )
            return
        }
        
        val searchQuery = Messages.showInputDialog(
            project,
            "Enter symbol name or description to search:",
            "Search Symbols with AI",
            Messages.getQuestionIcon()
        ) ?: return
        
        if (searchQuery.isBlank()) return
        
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Searching symbols with AI...", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                
                try {
                    val projectService = project.getService(HanzoProjectService::class.java)
                    val results = runBlocking {
                        projectService.searchSymbolsWithAI(searchQuery)
                    }
                    
                    ApplicationManager.getApplication().invokeLater {
                        if (results.isEmpty()) {
                            Messages.showInfoMessage(
                                project,
                                "No symbols found matching: $searchQuery",
                                "Symbol Search"
                            )
                        } else {
                            showResultsPopup(project, results)
                        }
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            "Error searching symbols: ${e.message}",
                            "Symbol Search Error"
                        )
                    }
                }
            }
        })
    }
    
    private fun showResultsPopup(project: Project, results: List<HanzoProjectService.AISymbolResult>) {
        val popup = JBPopupFactory.getInstance().createListPopup(
            object : BaseListPopupStep<HanzoProjectService.AISymbolResult>("Symbol Search Results", results) {
                override fun getTextFor(value: HanzoProjectService.AISymbolResult): String {
                    return "${value.name} - ${value.type} (${value.file.substringAfterLast('/')})"
                }
                
                override fun onChosen(selectedValue: HanzoProjectService.AISymbolResult, finalChoice: Boolean): PopupStep<*>? {
                    // Try to open the file
                    val file = File(selectedValue.file)
                    if (file.exists()) {
                        val virtualFile = LocalFileSystem.getInstance().findFileByPath(selectedValue.file)
                        if (virtualFile != null) {
                            FileEditorManager.getInstance(project).openFile(virtualFile, true)
                        }
                    }
                    return PopupStep.FINAL_CHOICE
                }
                
                override fun hasSubstep(selectedValue: HanzoProjectService.AISymbolResult): Boolean = false
            }
        )
        
        popup.showCenteredInCurrentWindow(project)
    }
    
    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        e.presentation.isEnabledAndVisible = project != null
    }
}