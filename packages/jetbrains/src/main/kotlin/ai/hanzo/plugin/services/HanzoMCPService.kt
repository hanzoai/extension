package ai.hanzo.plugin.services

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import ai.hanzo.plugin.HanzoPlugin
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

@Service(Service.Level.APP)
class HanzoMCPService {
    companion object {
        private val LOG = Logger.getInstance(HanzoMCPService::class.java)
        private const val MCP_TIMEOUT = 30L // seconds
    }
    
    private val client = OkHttpClient.Builder()
        .connectTimeout(MCP_TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(MCP_TIMEOUT, TimeUnit.SECONDS)
        .writeTimeout(MCP_TIMEOUT, TimeUnit.SECONDS)
        .build()
    
    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    data class MCPServer(
        val id: String,
        val name: String,
        val description: String,
        val endpoint: String,
        val capabilities: List<String>,
        val status: String
    )
    
    data class MCPTool(
        val name: String,
        val description: String,
        val parameters: JsonObject
    )
    
    private var availableServers = mutableListOf<MCPServer>()
    private var connectedServers = mutableSetOf<String>()
    
    fun initialize() {
        LOG.info("Initializing MCP Service")
        scope.launch {
            loadAvailableServers()
        }
    }
    
    suspend fun getAvailableServers(): List<MCPServer> {
        if (availableServers.isEmpty()) {
            loadAvailableServers()
        }
        return availableServers.toList()
    }
    
    suspend fun connectToServer(serverId: String): Boolean {
        val server = availableServers.find { it.id == serverId } ?: return false
        
        return try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return false
            
            val request = Request.Builder()
                .url("${HanzoPlugin.API_BASE_URL}/api/v1/mcp/servers/$serverId/connect")
                .header("Authorization", "Bearer $token")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .build()
            
            val response = withContext(Dispatchers.IO) {
                client.newCall(request).execute()
            }
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    connectedServers.add(serverId)
                    LOG.info("Connected to MCP server: ${server.name}")
                    true
                } else {
                    LOG.error("Failed to connect to MCP server: ${resp.code}")
                    false
                }
            }
        } catch (e: Exception) {
            LOG.error("Error connecting to MCP server", e)
            false
        }
    }
    
    suspend fun disconnectFromServer(serverId: String): Boolean {
        return try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return false
            
            val request = Request.Builder()
                .url("${HanzoPlugin.API_BASE_URL}/api/v1/mcp/servers/$serverId/disconnect")
                .header("Authorization", "Bearer $token")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .build()
            
            val response = withContext(Dispatchers.IO) {
                client.newCall(request).execute()
            }
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    connectedServers.remove(serverId)
                    LOG.info("Disconnected from MCP server: $serverId")
                    true
                } else {
                    LOG.error("Failed to disconnect from MCP server: ${resp.code}")
                    false
                }
            }
        } catch (e: Exception) {
            LOG.error("Error disconnecting from MCP server", e)
            false
        }
    }
    
    suspend fun getServerTools(serverId: String): List<MCPTool> {
        return try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return emptyList()
            
            val request = Request.Builder()
                .url("${HanzoPlugin.API_BASE_URL}/api/v1/mcp/servers/$serverId/tools")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
            
            val response = withContext(Dispatchers.IO) {
                client.newCall(request).execute()
            }
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    val jsonArray = gson.fromJson(body, JsonArray::class.java)
                    
                    jsonArray.map { element ->
                        val obj = element.asJsonObject
                        MCPTool(
                            name = obj.get("name").asString,
                            description = obj.get("description").asString,
                            parameters = obj.getAsJsonObject("parameters") ?: JsonObject()
                        )
                    }
                } else {
                    LOG.error("Failed to get server tools: ${resp.code}")
                    emptyList()
                }
            }
        } catch (e: Exception) {
            LOG.error("Error getting server tools", e)
            emptyList()
        }
    }
    
    suspend fun executeTool(serverId: String, toolName: String, parameters: JsonObject): JsonObject? {
        return try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return null
            
            val requestBody = JsonObject().apply {
                addProperty("tool", toolName)
                add("parameters", parameters)
            }
            
            val request = Request.Builder()
                .url("${HanzoPlugin.API_BASE_URL}/api/v1/mcp/servers/$serverId/execute")
                .header("Authorization", "Bearer $token")
                .post(gson.toJson(requestBody).toRequestBody("application/json".toMediaType()))
                .build()
            
            val response = withContext(Dispatchers.IO) {
                client.newCall(request).execute()
            }
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    gson.fromJson(body, JsonObject::class.java)
                } else {
                    LOG.error("Failed to execute tool: ${resp.code}")
                    null
                }
            }
        } catch (e: Exception) {
            LOG.error("Error executing tool", e)
            null
        }
    }
    
    fun isServerConnected(serverId: String): Boolean {
        return connectedServers.contains(serverId)
    }
    
    fun getConnectedServers(): Set<String> {
        return connectedServers.toSet()
    }
    
    private suspend fun loadAvailableServers() {
        try {
            val authService = HanzoPlugin.getAuthService()
            val token = authService.getAuthToken() ?: return
            
            val request = Request.Builder()
                .url("${HanzoPlugin.API_BASE_URL}/api/v1/mcp/servers")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
            
            val response = withContext(Dispatchers.IO) {
                client.newCall(request).execute()
            }
            
            response.use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    val jsonArray = gson.fromJson(body, JsonArray::class.java)
                    
                    availableServers.clear()
                    jsonArray.forEach { element ->
                        val obj = element.asJsonObject
                        val server = MCPServer(
                            id = obj.get("id").asString,
                            name = obj.get("name").asString,
                            description = obj.get("description").asString,
                            endpoint = obj.get("endpoint").asString,
                            capabilities = obj.getAsJsonArray("capabilities")?.map { it.asString } ?: emptyList(),
                            status = obj.get("status")?.asString ?: "unknown"
                        )
                        availableServers.add(server)
                    }
                    
                    LOG.info("Loaded ${availableServers.size} MCP servers")
                } else {
                    LOG.error("Failed to load MCP servers: ${resp.code}")
                }
            }
        } catch (e: Exception) {
            LOG.error("Error loading MCP servers", e)
        }
    }
    
    fun dispose() {
        scope.cancel()
    }
    
    fun isEnabled(): Boolean {
        return HanzoPlugin.getSettings()?.enableMCP ?: true
    }
    
    fun isConnected(): Boolean {
        return connectedServers.isNotEmpty()
    }
    
    fun connect() {
        scope.launch {
            // Auto-connect to default MCP servers
            val servers = getAvailableServers()
            servers.filter { it.status == "available" }.forEach { server ->
                connectToServer(server.id)
            }
        }
    }
    
    fun disconnect() {
        scope.launch {
            connectedServers.toList().forEach { serverId ->
                disconnectFromServer(serverId)
            }
        }
    }
}