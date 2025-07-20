package ai.hanzo.plugin.listeners

import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManagerListener
import ai.hanzo.plugin.services.HanzoProjectService

class HanzoProjectManagerListener : ProjectManagerListener {
    override fun projectOpened(project: Project) {
        // Initialize project-specific services
        project.getService(HanzoProjectService::class.java)?.initializeProject()
    }

    override fun projectClosing(project: Project) {
        // Clean up project-specific resources
        project.getService(HanzoProjectService::class.java)?.cleanupProject()
    }
}