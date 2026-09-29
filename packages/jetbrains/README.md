# Hanzo AI JetBrains Plugin

<!-- Plugin description -->
Access 200+ AI models directly in your JetBrains IDE with Hanzo AI's unified platform. This plugin provides seamless integration with Hanzo's AI infrastructure, bringing powerful AI capabilities to your development workflow.

## Key Features

- **200+ LLM Models**: Access models from OpenAI, Anthropic, Google, Meta, and more through a single interface
- **Symbol Search**: AI-powered symbol search across your entire project
- **Smart Chat Interface**: Interactive AI assistant in a dedicated tool window
- **Secure Authentication**: Login with your Hanzo AI account for personalized access
- **Multi-IDE Support**: Works with IntelliJ IDEA, PyCharm, WebStorm, GoLand, and other JetBrains IDEs

## Getting Started

1. Install the plugin from JetBrains Marketplace
2. Open the Hanzo AI tool window (View → Tool Windows → Hanzo AI)
3. Hanzo AI → Login to Hanzo AI, and finish signing in at hanzo.id in your browser
4. Start chatting with AI or use the symbol search feature

Visit [hanzo.ai](https://hanzo.ai) to create an account and learn more about our AI platform.
<!-- Plugin description end -->

## Development

Runs on IDE builds 233–243 (2023.3–2024.3). Gradle 8.5 needs a JDK 17–21 to
run; the JDK 17 toolchain it compiles with is downloaded when missing.

From the repo root, `make build target=jetbrains` builds the plugin zip into
`dist/jetbrains` and `make test target=jetbrains` runs the tests. Here:

```bash
./gradlew buildPlugin   # build/distributions/*.zip
./gradlew test
./gradlew runIde        # a sandbox IDE with the plugin installed
```

Sign-in is OAuth 2.0 with PKCE against Hanzo IAM (`HanzoIam.kt`): the browser
authorizes at `hanzo.id`, IAM redirects to a one-shot listener on
`127.0.0.1:<port>/callback` (client `hanzo-jetbrains`), and the token, refresh,
revoke and userinfo calls go to `api.hanzo.ai/v1/iam`. Tokens are kept in the
IDE's password safe.

## License

Copyright (c) 2024 Hanzo AI. All rights reserved.