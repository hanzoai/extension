package ai.hanzo.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.intellij.psi.*
import com.intellij.psi.search.GlobalSearchScope
import com.intellij.psi.search.PsiShortNamesCache
import ai.hanzo.plugin.HanzoPlugin
import ai.hanzo.plugin.services.HanzoProjectService
import kotlinx.coroutines.runBlocking
import javax.swing.Icon

class HanzoSymbolSearchAction : AnAction() {
    
    data class SymbolResult(
        val name: String,
        val type: String,
        val containingFile: String,
        val description: String,
        val psiElement: PsiElement?
    )
    
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
                        searchSymbols(project, searchQuery, projectService)
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
    
    private suspend fun searchSymbols(
        project: Project,
        query: String,
        projectService: HanzoProjectService
    ): List<SymbolResult> {
        val results = mutableListOf<SymbolResult>()
        
        // First, try exact name match
        val cache = PsiShortNamesCache.getInstance(project)
        val scope = GlobalSearchScope.projectScope(project)
        
        // Search classes
        cache.getClassesByName(query, scope).forEach { psiClass ->
            results.add(SymbolResult(
                name = psiClass.name ?: "Unknown",
                type = "Class",
                containingFile = psiClass.containingFile?.virtualFile?.path ?: "Unknown",
                description = "Class ${psiClass.qualifiedName}",
                psiElement = psiClass
            ))
        }
        
        // Search methods
        cache.getMethodsByName(query, scope).forEach { method ->
            results.add(SymbolResult(
                name = method.name,
                type = "Method",
                containingFile = method.containingFile?.virtualFile?.path ?: "Unknown",
                description = buildMethodDescription(method),
                psiElement = method
            ))
        }
        
        // Search fields
        cache.getFieldsByName(query, scope).forEach { field ->
            results.add(SymbolResult(
                name = field.name ?: "Unknown",
                type = "Field",
                containingFile = field.containingFile?.virtualFile?.path ?: "Unknown",
                description = "Field in ${(field.containingClass?.name ?: "Unknown")}",
                psiElement = field
            ))
        }
        
        // If no exact matches or query seems descriptive, use AI
        if (results.isEmpty() || query.contains(" ")) {
            val aiResults = projectService.searchSymbolsWithAI(query)
            results.addAll(aiResults.mapNotNull { aiResult ->
                findPsiElement(project, aiResult)?.let { element ->
                    SymbolResult(
                        name = aiResult.name,
                        type = aiResult.type,
                        containingFile = aiResult.file,
                        description = aiResult.description,
                        psiElement = element
                    )
                }
            })
        }
        
        return results.distinctBy { "${it.name}:${it.containingFile}" }
    }
    
    private fun buildMethodDescription(method: PsiMethod): String {
        val params = method.parameterList.parameters.joinToString(", ") { param ->
            "${param.type.presentableText} ${param.name}"
        }
        val returnType = method.returnType?.presentableText ?: "void"
        val className = method.containingClass?.name ?: "Unknown"
        return "$returnType $className.${method.name}($params)"
    }
    
    private fun findPsiElement(project: Project, aiResult: HanzoProjectService.AISymbolResult): PsiElement? {
        // Implementation to find PSI element from AI result
        // This would need to be more sophisticated in a real implementation
        val cache = PsiShortNamesCache.getInstance(project)
        val scope = GlobalSearchScope.projectScope(project)
        
        return when (aiResult.type.lowercase()) {
            "class" -> cache.getClassesByName(aiResult.name, scope).firstOrNull()
            "method" -> cache.getMethodsByName(aiResult.name, scope).firstOrNull()
            "field" -> cache.getFieldsByName(aiResult.name, scope).firstOrNull()
            else -> null
        }
    }
    
    private fun showResultsPopup(project: Project, results: List<SymbolResult>) {
        val popup = JBPopupFactory.getInstance().createListPopup(
            object : BaseListPopupStep<SymbolResult>("Symbol Search Results", results) {
                override fun getTextFor(value: SymbolResult): String {
                    return "${value.name} - ${value.type} (${value.containingFile.substringAfterLast('/')})"
                }
                
                override fun getIconFor(value: SymbolResult): Icon? {
                    return value.psiElement?.let { getIconForElement(it) }
                }
                
                override fun onChosen(selectedValue: SymbolResult, finalChoice: Boolean): PopupStep<*>? {
                    selectedValue.psiElement?.let { element ->
                        element.navigate(true)
                    }
                    return PopupStep.FINAL_CHOICE
                }
                
                override fun hasSubstep(selectedValue: SymbolResult): Boolean = false
            }
        )
        
        popup.showCenteredInCurrentWindow(project)
    }
    
    private fun getIconForElement(element: PsiElement): Icon? {
        return when (element) {
            is PsiClass -> element.getIcon(0)
            is PsiMethod -> element.getIcon(0)
            is PsiField -> element.getIcon(0)
            else -> null
        }
    }
    
    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        e.presentation.isEnabledAndVisible = project != null
    }
}