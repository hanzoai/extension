# Changelog

All notable changes to the "hanzo" extension will be documented in this file.

## [1.5.4] - 2025-03-17

### Added
- Centralized text content management through JSON files for easier customization
- Enhanced welcome view with larger, centered text focusing on main benefits
- Simplified onboarding experience with focus on core value proposition
- Enhanced status bar indicator for non-logged in users with "Hanzo: Login" text
- Improved visual styling and typography throughout the onboarding experience

## [1.5.3] - 2025-03-17

### Added
- Enhanced metrics visibility with automatic display after first analysis

## [1.5.2] - 2025-03-14

### Added
- Converted refinement process into multi-step API calls
- Added detailed logging for API responses to improve debugging

## [1.5.1] - 2025-03-13

### Added
- Increased global API request timeout to 300 seconds (5 minutes) for better handling of large projects
- Added retry mechanism for specification refinement to improve reliability
- Enhanced error handling for timeout errors with more informative messages

### Changed
- Improved logging during refinement process with detailed timing information
- Better user feedback during refinement operations

## [1.5.0] - 2025-03-13

### Added
- Multi-file specifications
- IDE-specific organization of specification files:
  - For Cursor: Main overview in `.cursorrules` and additional files in `.cursor/rules/`
  - For other IDEs: Main overview in IDE-specific file and additional files in `.hanzo/rules/`

### Changed
- Removed the SPEC.md file approach in favor of IDE-specific rules files

## [1.4.0] - 2025-03-13

### Added
- Enhanced UI with improved progress indicators and responsive feedback
- Optimized chunking system with 4MB chunk size for better performance
- Improved error handling and user feedback during large file uploads

## [1.3.1] - 2025-03-13

### Added
- Implemented gzip compression for API requests to reduce data transfer size
- Enhanced chunking algorithm with intelligent compression ratio analysis
- Improved handling of large projects with adaptive chunk sizing
- Added detailed logging for upload process monitoring

## [1.3.0] - 2025-03-13

### Added
- Enhanced upload reliability for projects of all sizes with optimized chunking algorithm

## [1.2.9] - 2025-03-12

### Added
- Implemented chunking for large file uploads to handle projects of any size
- Improved request handling for large codebases by splitting files into manageable chunks

## [1.2.8] - 2025-03-09

### Changed
- Update readme

## [1.2.7] - 2025-03-09

### Fixed
- Add login wall

## [1.2.6] - 2025-03-08

### Changed
- Reduced frequency of reanalysis reminders to be less intrusive

## [1.2.5] - 2025-02-21

### Added
- Support for Codium (.windsurfrules)

## [1.2.4] - 2025-02-21

### Changed
- Extension name

## [1.2.3] - 2025-02-16

### Fixed
- Fixed "webview is disposed" error during analysis operations by making UI updates optional

## [1.2.2] - 2025-02-16

### Added
- Support for Continue (.continuerules)

## [1.2.1] - 2025-02-16

### Fixed
- Improved Git extension activation handling for better stability
- Enhanced error logging for API requests
- Fixed production initialization issues

## [1.2.0] - 2025-02-16

### Added
- Add authentication
- Comprehensive test suite for authentication and API functionality
- Add reminders

## [1.1.13] - 2025-01-31

### Changed
- Replaced native fetch with axios for improved HTTP request handling
- Enhanced error handling with better TypeScript support
- Improved API communication reliability
- Added better error messages with response data
- Streamlined response processing with automatic JSON parsing

## [1.1.11] - 2025-01-30

### Changed
- Enhanced file collection logging with detailed tree structure output
- Improved directory scanning with better error handling and progress tracking
- Added comprehensive logging of included and ignored files for better debugging

## [1.1.10] - 2025-01-22

### Changed
- Improved reanalysis UX with minimal loading indicators
  - Added status bar progress indicator
  - Enhanced progress tracking with detailed stages
  - Prevented webview from opening during quick reanalysis
- Made reanalysis more streamlined when triggered via command palette or editor icon

## [1.1.9] - 2025-01-20

### Changed
- Enhanced directory size reporting with file counts
- Improved logging with consistent [Hanzo] prefix
- Better error handling with appropriate log levels

## [1.1.8] - 2025-01-18

### Changed
- Ignore additional folders relating to testing, CI/CD, and other non-source code files

## [1.1.7] - 2025-01-16

### Changed
- Allow choice of IDE between Cursor and Copilot
- Ignore additional folders relating to testing, CI/CD, and other non-source code files

## [1.1.6] - 2025-01-13

### Added
- Quick access to "Reanalyze" via command palette
- Always-visible reanalyze button in editor toolbar
- Keyboard shortcut support for reanalyzing projects

### Changed
- Improved project reanalysis workflow with better UI feedback
- Enhanced status updates during reanalysis

## [1.1.5] - 2025-01-05

### Added
- Directory size tracking and reporting for better debugging (now excludes ignored files)
- Additional ignored patterns for common build and module folders:
  - Virtual environments: `.venv`, `venv`, `env`, `.env`
  - Python cache: `__pycache__`, `.pyc` files
  - Common build folders: `out`, `target`, `bin`, `obj`, `.output`, `.nuxt`, `.cache`
  - Static files: images, fonts, media, archives, and more

### Changed
- Enhanced error logging with directory size report when content length is exceeded
- Improved directory size calculation to exclude ignored files
- Better directory size reporting with cleaner output format

## [1.1.4] - 2025-01-05

### Changed
- Ignore files greater than 50KB during analysis

## [1.1.3] - 2025-01-05

### Changed
- Enhanced error logging with detailed API request/response information
- Added '[Hanzo]' prefix to all logs for better filtering
- Improved error messages with more context and stack traces
- Better handling of API response parsing errors

## [1.1.2] - 2025-01-04

### Added
- Improved UI with better button states and transitions

### Changed
- Improved error handling and user feedback
- Enhanced file collection service with better logging

## [1.1.1] - 2025-01-02

### Changed
- Improved file filtering to ignore media files during analysis
- Add "refinement" to SPEC.md generation
- Add "reanalyze" button

## [1.1.0] - 2025-01-02

### Added
- Intelligent project analysis system
  - Automatic detection of project type (new vs existing)
  - Smart codebase scanning with selective file filtering
  - Comprehensive SPEC.md generation

- Improved UI/UX
  - Single unified "Analyze Project" action
  - Better loading states and error handling
  - Cleaner project details input

### Changed
- Simplified project initialization flow
- More descriptive user feedback messages
- Better error handling and recovery

### Technical Improvements
- Modular code architecture
- Better type safety
- Improved file filtering system
- DRY code improvements

## [1.0.0] - 2024-12-30

### Added
- Initial release
- Project overview panel
- Basic knowledge management features