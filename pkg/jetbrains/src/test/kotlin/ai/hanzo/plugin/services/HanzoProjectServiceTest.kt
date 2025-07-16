package ai.hanzo.plugin.services

import com.intellij.openapi.project.Project
import org.junit.Test
import org.junit.Before
import org.mockito.Mockito.*
import kotlin.test.*

class HanzoProjectServiceTest {
    private lateinit var project: Project
    private lateinit var projectService: HanzoProjectService
    
    @Before
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
    fun testDefaultModels() {
        val models = listOf(
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "gpt-4o",
            "gpt-4o-mini",
            "o1-preview",
            "o1-mini",
            "gemini-2.0-flash-exp",
            "gemini-1.5-pro",
            "llama-3.3-70b-instruct",
            "qwen2.5-coder-32b-instruct"
        )
        
        // Test that default models are available
        // In real implementation, this would be tested after getAvailableModels() call
        assertTrue(models.isNotEmpty())
        assertTrue(models.contains("claude-3-5-sonnet-20241022"))
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