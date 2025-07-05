package ai.hanzo.plugin.services

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import ai.hanzo.plugin.HanzoPlugin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

@Service(Service.Level.PROJECT)
class HanzoProjectService(private val project: Project) {
    companion object {
        private val LOG = Logger.getInstance(HanzoProjectService::class.java)
        private const val REQUEST_TIMEOUT = 60L // seconds
    }
    
    private val client = OkHttpClient.Builder()
        .connectTimeout(REQUEST_TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(REQUEST_TIMEOUT, TimeUnit.SECONDS)
        .writeTimeout(REQUEST_TIMEOUT, TimeUnit.SECONDS)
        .build()
    
    private val gson = Gson()
    private val chatHistory = mutableListOf<ChatMessage>()
    
    data class ChatMessage(
        val role: String, // "user" or "assistant"
        val content: String,
        val timestamp: Long = System.currentTimeMillis()
    )
    
    data class AISymbolResult(
        val name: String,
        val type: String,
        val file: String,
        val description: String,
        val confidence: Double
    )
    
    suspend fun getAvailableModels(): List<String> = withContext(Dispatchers.IO) {
        try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return@withContext getDefaultModels()
            
            val request = Request.Builder()
                .url("${HanzoPlugin.LLM_GATEWAY_URL}/v1/models")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
            
            val response = client.newCall(request).execute()
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    val jsonObject = gson.fromJson(body, JsonObject::class.java)
                    val dataArray = jsonObject.getAsJsonArray("data") ?: JsonArray()
                    
                    dataArray.mapNotNull { element ->
                        element.asJsonObject.get("id")?.asString
                    }.sorted()
                } else {
                    LOG.error("Failed to fetch models: ${resp.code}")
                    getDefaultModels()
                }
            }
        } catch (e: Exception) {
            LOG.error("Error fetching models", e)
            getDefaultModels()
        }
    }
    
    suspend fun sendChatMessage(message: String, model: String): String = withContext(Dispatchers.IO) {
        try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: throw Exception("Not authenticated")
            
            // Add user message to history
            chatHistory.add(ChatMessage("user", message))
            
            // Build messages array including history
            val messages = JsonArray()
            chatHistory.takeLast(10).forEach { msg -> // Keep last 10 messages for context
                messages.add(JsonObject().apply {
                    addProperty("role", msg.role)
                    addProperty("content", msg.content)
                })
            }
            
            val requestBody = JsonObject().apply {
                addProperty("model", model)
                add("messages", messages)
                addProperty("max_tokens", HanzoPlugin.MAX_TOKENS)
                addProperty("temperature", HanzoPlugin.TEMPERATURE)
                addProperty("stream", false)
            }
            
            val request = Request.Builder()
                .url("${HanzoPlugin.LLM_GATEWAY_URL}/v1/chat/completions")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .post(gson.toJson(requestBody).toRequestBody("application/json".toMediaType()))
                .build()
            
            val response = client.newCall(request).execute()
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    val jsonResponse = gson.fromJson(body, JsonObject::class.java)
                    
                    val content = jsonResponse
                        .getAsJsonArray("choices")
                        ?.get(0)?.asJsonObject
                        ?.getAsJsonObject("message")
                        ?.get("content")?.asString
                        ?: "No response received"
                    
                    // Add assistant response to history
                    chatHistory.add(ChatMessage("assistant", content))
                    
                    content
                } else {
                    val error = resp.body?.string() ?: "Unknown error"
                    LOG.error("Chat request failed: ${resp.code} - $error")
                    throw Exception("Request failed: ${resp.code}")
                }
            }
        } catch (e: Exception) {
            LOG.error("Error sending chat message", e)
            throw e
        }
    }
    
    suspend fun searchSymbolsWithAI(query: String): List<AISymbolResult> = withContext(Dispatchers.IO) {
        try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return@withContext emptyList()
            
            // Use AI to understand the query and search for symbols
            val prompt = """
                Search for symbols in the project that match this query: "$query"
                
                Consider:
                - Class names, method names, field names, variables
                - Functionality and purpose of symbols
                - Related or similar symbols
                
                Return results in JSON format:
                [
                  {
                    "name": "symbol name",
                    "type": "Class|Method|Field|Variable",
                    "file": "file path",
                    "description": "brief description",
                    "confidence": 0.0-1.0
                  }
                ]
            """.trimIndent()
            
            val requestBody = JsonObject().apply {
                addProperty("model", HanzoPlugin.DEFAULT_MODEL)
                add("messages", JsonArray().apply {
                    add(JsonObject().apply {
                        addProperty("role", "system")
                        addProperty("content", "You are a code analysis assistant. Return only valid JSON.")
                    })
                    add(JsonObject().apply {
                        addProperty("role", "user")
                        addProperty("content", prompt)
                    })
                })
                addProperty("max_tokens", 2048)
                addProperty("temperature", 0.3)
            }
            
            val request = Request.Builder()
                .url("${HanzoPlugin.LLM_GATEWAY_URL}/v1/chat/completions")
                .header("Authorization", "Bearer $token")
                .post(gson.toJson(requestBody).toRequestBody("application/json".toMediaType()))
                .build()
            
            val response = client.newCall(request).execute()
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    val jsonResponse = gson.fromJson(body, JsonObject::class.java)
                    
                    val content = jsonResponse
                        .getAsJsonArray("choices")
                        ?.get(0)?.asJsonObject
                        ?.getAsJsonObject("message")
                        ?.get("content")?.asString
                        ?: return@withContext emptyList()
                    
                    // Parse JSON response
                    try {
                        val resultsArray = gson.fromJson(content, JsonArray::class.java)
                        resultsArray.mapNotNull { element ->
                            try {
                                val obj = element.asJsonObject
                                AISymbolResult(
                                    name = obj.get("name").asString,
                                    type = obj.get("type").asString,
                                    file = obj.get("file").asString,
                                    description = obj.get("description").asString,
                                    confidence = obj.get("confidence").asDouble
                                )
                            } catch (e: Exception) {
                                null
                            }
                        }
                    } catch (e: Exception) {
                        LOG.error("Failed to parse AI response", e)
                        emptyList()
                    }
                } else {
                    LOG.error("Symbol search failed: ${resp.code}")
                    emptyList()
                }
            }
        } catch (e: Exception) {
            LOG.error("Error searching symbols with AI", e)
            emptyList()
        }
    }
    
    fun clearChatHistory() {
        chatHistory.clear()
    }
    
    fun getChatHistory(): List<ChatMessage> {
        return chatHistory.toList()
    }
    
    private fun getDefaultModels(): List<String> {
        return listOf(
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
    }
    
    fun initializeProject() {
        LOG.info("Initializing Hanzo AI for project: ${project.name}")
        // Initialize MCP service if enabled
        val mcpService = HanzoPlugin.getMCPService()
        if (mcpService.isEnabled()) {
            mcpService.connect()
        }
    }
    
    fun cleanupProject() {
        LOG.info("Cleaning up Hanzo AI for project: ${project.name}")
        // Clear chat history
        clearChatHistory()
        // Disconnect MCP if connected
        val mcpService = HanzoPlugin.getMCPService()
        if (mcpService.isConnected()) {
            mcpService.disconnect()
        }
        // Close HTTP client
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}