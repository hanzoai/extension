# Hanzo AI JetBrains Plugin Changelog

## [Unreleased]
### Changed
- Login opens hanzo.id in the browser (OAuth 2.0 with PKCE); the IDE no longer asks for a password or API key
- Sessions refresh themselves, and logout revokes the refresh token
- Chat and model listing use api.hanzo.ai

## [0.1.0] - 2024-01-05
### Added
- Initial release of Hanzo AI JetBrains Plugin
- Basic authentication with Hanzo AI platform
- Chat interface with access to 200+ LLM models
- Symbol search functionality powered by AI
- Model Context Protocol (MCP) server integration
- Tool window UI for interactive chat
- Settings configuration page
- Support for multiple JetBrains IDEs