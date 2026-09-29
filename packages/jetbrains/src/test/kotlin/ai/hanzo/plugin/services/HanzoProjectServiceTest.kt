package ai.hanzo.plugin.services

import com.intellij.openapi.project.Project
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import kotlin.test.*

class HanzoProjectServiceTest {
    private lateinit var project: Project
    private lateinit var projectService: HanzoProjectService

    @BeforeEach
    fun setUp() {
        project = mock(Project::class.java)
        `when`(project.name).thenReturn("TestProject")
        projectService = HanzoProjectService(project)
    }
    
    @Test
    fun testChatHistory() {
        assertTrue(projectService.getChatHistory().isEmpty())
        
        // Add messages through actual chat (would be mocked in real test)
        projectService.clearChatHistory()
        
        assertTrue(projectService.getChatHistory().isEmpty())
    }
    
    @Test
    fun testAISymbolResult() {
        val result = HanzoProjectService.AISymbolResult(
            name = "TestClass",
            type = "Class",
            file = "/src/Test.java",
            description = "Test class",
            confidence = 0.95
        )
        
        assertEquals("TestClass", result.name)
        assertEquals("Class", result.type)
        assertEquals("/src/Test.java", result.file)
        assertEquals(0.95, result.confidence)
    }
    
    @Test
    fun testChatMessage() {
        val message = HanzoProjectService.ChatMessage(
            role = "user",
            content = "Hello"
        )
        
        assertEquals("user", message.role)
        assertEquals("Hello", message.content)
        assertTrue(message.timestamp > 0)
    }
}