# Technical Specification

## System Overview
The system is a Visual Studio Code (VS Code) extension designed to facilitate project analysis and management. It integrates with external APIs for authentication and data processing, and provides a user interface within VS Code for interaction. The main components include services for analysis, file collection, reminders, and status updates, as well as authentication management and API client functionalities.

## Core Functionality

### Authentication Management
- **`AuthManager` (src/auth/manager.ts)**
  - **Singleton Pattern**: Ensures a single instance is used throughout the application.
  - **Key Methods**:
    - `generateRandomToken`: Generates a random token using `crypto.randomBytes`.
    - `getOrCreateClientId`: Retrieves or creates a client ID stored in VSCode's secrets.
    - `getStoredToken`, `storeToken`, `clearToken`: Manages the authentication token storage.
    - `isAuthenticated`, `getAuthToken`: Checks and retrieves the authentication token.
    - `startPolling`: Polls an external authentication service to check for a valid token.
    - `initiateAuth`: Initiates the authentication process, including generating auth state, opening an external browser for auth, and starting the polling process.
    - `logout`: Clears the stored token and stops any ongoing polling.

### API Client
- **`ApiClient` (src/api/client.ts)**
  - **`makeAuthenticatedRequest`**: Handles making authenticated API requests.
    - **Token Retrieval**: Attempts to get an auth token from `AuthManager`.
    - **Body Stringification and Compression**: Stringifies the request body and compresses it if `shouldGzip` is `true`.
    - **Request Execution**: Makes the API request with appropriate headers and handles errors.
    - **Progress Handling**: Optionally shows a progress indicator during the request.

### Project Analysis
- **`AnalysisService` (src/services/AnalysisService.ts)**
  - **`analyze(details?: string): Promise<void>`**: Core function that triggers the analysis process. It uses `ProjectManager` to handle the project operation and catches any errors to display them in the status bar and VS Code message window.
  - **Integration**: Singleton pattern, integration with `StatusBarService` for status updates, and error handling with detailed logging and user notifications.

### File Collection
- **`FileCollectionService` (src/services/FileCollectionService.ts)**
  - **`collectFiles(): Promise<FileNode[]>`**: Main function to collect files from the workspace, respecting ignore patterns and size limits.
  - **`getDirectorySizeReport(): string`**: Generates a report of directory sizes.
  - **`getTotalSize(): number`**: Returns the total size of collected files.
  - **Integration**: Uses async generators for efficient directory scanning, integrates with `.gitignore` and `.hanzoignore` for custom ignore patterns, and provides detailed logging and summarization of included and ignored files.

### Reminder Service
- **`ReminderService` (src/services/ReminderService.ts)**
  - **`triggerManually(): void`**: Manually triggers the reminder check.
  - **`dispose(): void`**: Cleans up resources and timers.
  - **Core Logic**: Periodic checks for significant changes in the workspace to prompt reanalysis. Uses both Git and file system tracking based on availability.
  - **Integration**: Debounced event handling, cooldown and forced reminder mechanisms, and integration with `StatusBarService` and `AnalysisService` for status updates and reanalysis.

### Status Bar Updates
- **`StatusBarService` (src/services/StatusBarService.ts)**
  - **`setAnalyzing(message: string = 'Analyzing project...'): void`**
  - **`setIdle(): void`**
  - **`setError(message: string = 'Analysis failed'): void`**
  - **`setSuccess(message: string = 'Analysis complete'): void`**
  - **`dispose(): void`**
  - **Integration**: Singleton pattern to manage the VS Code status bar item, with different states for analyzing, idle, error, and success with appropriate tooltips and commands.

### Configuration Management
- **`getConfig` (src/config.ts)**
  - **`getConfig(): Config`**: Retrieves the appropriate configuration based on the environment. It defaults to 'production' if the environment variable `VSCODE_ENV` is not set. This function is critical as it ensures the application uses the correct configuration for its operations, directly impacting its functionality and security.

### Extension Activation
- **`activate` (src/extension.ts)**
  - **Description**: Initializes the extension, registers commands, and sets up the main functionality. It initializes the `AuthManager`, registers immediate commands, and initializes the extension API.
  - **Core Behavior**:
    - Registers commands like `hanzo.openManager`, `hanzo.login`, and others.
    - Initializes the `AuthManager` and stores the extension API for command access.
    - Calls `initializeExtension` to set up services and panel creation.

### Project Management
- **`ProjectManager` (src/extension.ts)**
  - **Description**: Manages project-related operations, including file updates, UI updates, and project analysis.
  - **Core Methods**:
    - `updateProjectFiles`: Writes project specification and IDE-specific rules to files.
    - `updateUI`: Updates the webview panel UI based on the operation status.
    - `showNotification`: Displays notifications in VS Code.
    - `determineProjectType`: Determines whether to analyze or initialize a project.
    - `handleProjectOperation`: Handles the main project operation, including file collection, API calls, and specification refinement.

## Architecture
The system is structured to facilitate seamless interaction between the VS Code extension and external APIs. Data flows from the user’s workspace through the `FileCollectionService`, which gathers and processes files. This data is then sent to the `AnalysisService` for project analysis, utilizing the `ApiClient` for authenticated API requests. The `AuthManager` handles all authentication-related operations, ensuring secure communication with external services. The `StatusBarService` provides real-time feedback to the user within VS Code, while the `ReminderService` ensures that users are prompted to reanalyze their projects when significant changes occur. The `ProjectManager` orchestrates the core project-related operations, integrating all services to provide a cohesive user experience.