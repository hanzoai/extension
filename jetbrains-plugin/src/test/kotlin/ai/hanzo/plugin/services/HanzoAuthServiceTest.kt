package ai.hanzo.plugin.services

import org.junit.Test
import org.junit.Before
import kotlin.test.*

class HanzoAuthServiceTest {
    private lateinit var authService: HanzoAuthService
    
    @Before
    fun setUp() {
        authService = HanzoAuthService()
    }
    
    @Test
    fun testInitialState() {
        assertFalse(authService.isAuthenticated())
        assertNull(authService.getAuthToken())
        assertNull(authService.getUserEmail())
    }
    
    @Test
    fun testLogin() {
        val token = "test_token_123"
        val email = "test@hanzo.ai"
        val refreshToken = "refresh_123"
        
        val result = authService.saveAuthData(token, refreshToken, email)
        
        assertTrue(result)
        assertTrue(authService.isAuthenticated())
        assertEquals(token, authService.getAuthToken())
        assertEquals(email, authService.getUserEmail())
    }
    
    @Test
    fun testLogout() {
        // First login
        authService.saveAuthData("token", "refresh", "email@test.com")
        assertTrue(authService.isAuthenticated())
        
        // Then logout
        authService.logout()
        assertFalse(authService.isAuthenticated())
        assertNull(authService.getAuthToken())
        assertNull(authService.getUserEmail())
    }
    
    @Test
    fun testInvalidToken() {
        authService.saveAuthData("", "", "")
        assertFalse(authService.isAuthenticated())
    }
}