#!/usr/bin/env node

const { spawn } = require('child_process');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

console.log(chalk.bold.cyan('\n🚀 Dev CLI Test Demo\n'));
console.log(chalk.gray('='.repeat(60)));
console.log();

// Test scenarios
const tests = [
    {
        name: '📋 Show Help',
        cmd: 'echo',
        args: ['dev --help'],
        demo: `
Usage: dev [options] [command]

Dev - Meta AI development tool

Options:
  -V, --version                  output the version number
  -h, --help                     display help for command

Commands:
  login                          Login to Hanzo AI platform
  logout                         Logout from Hanzo AI platform  
  init [options]                 Initialize Dev in current directory
  run <tool> [task...]           Run a specific AI tool
  workflow <name> [task...]      Run predefined AI workflow
  review [files...]              Run AI code review
  multi <task>                   Run task with multiple AI agents
  compare <task>                 Compare results from multiple tools
  status [jobId]                 Check status of async jobs
  worktree                       Manage git worktrees
  interactive                    Start interactive mode
        `.trim()
    },
    {
        name: '🔄 List Workflows',
        cmd: 'echo',
        args: ['dev workflow list'],
        demo: `
Available Workflows:

code-review - Comprehensive code review with multiple perspectives
  Steps: initial-review → synthesize

implement-feature - Implement a feature with code, tests, and documentation  
  Steps: design → implement → review

optimize - Optimize code for performance
  Steps: analyze → implement

debug - Debug and fix issues
  Steps: diagnose → fix
        `.trim()
    },
    {
        name: '🤖 Run Claude',
        cmd: 'echo',
        args: ['dev run claude "explain this code"'],
        demo: `
✓ Starting claude...

[Claude Response]
I'll analyze this code for you. The code appears to implement:

1. A calculateSum function that adds two numbers
2. A calculateProduct function that multiplies two numbers

Both functions follow clean coding practices with:
- Clear, descriptive function names
- Simple, focused functionality
- Module exports for reusability

The code is well-structured for a math utility module.
        `.trim()
    },
    {
        name: '🤝 Multi-Agent Task',
        cmd: 'echo',
        args: ['dev multi "optimize database query" --coder claude --reviewer gemini --critic codex'],
        demo: `
✓ Running multi-agent task...

Results from each agent:

coder-claude:
I'll optimize this database query by:
1. Adding appropriate indexes
2. Using query hints for better execution plans
3. Implementing connection pooling

--------------------------------------------------------------------------------

reviewer-gemini:
The optimization approach is solid. Consider also:
- Caching frequently accessed data
- Using prepared statements
- Monitoring query performance metrics

--------------------------------------------------------------------------------

critic-codex:
Potential issues to address:
- N+1 query problems in loops
- Missing error handling for connection failures
- Consider read replicas for scaling
        `.trim()
    },
    {
        name: '📝 Code Review',
        cmd: 'echo',
        args: ['dev review'],
        demo: `
✓ Starting code review...

### reviewer-gemini

Code Quality Assessment:
- ✓ Functions are well-named and focused
- ✓ Exports are properly structured
- ⚠️ Missing input validation
- ⚠️ No error handling for edge cases

### critic-codex

Security & Performance:
- No immediate security concerns
- Consider memoization for repeated calculations
- Add JSDoc comments for better documentation

### architect-claude

Synthesized Recommendations:
1. **High Priority**: Add input validation
2. **Medium Priority**: Implement error handling
3. **Low Priority**: Add comprehensive tests
        `.trim()
    },
    {
        name: '⚡ Async Job Status',
        cmd: 'echo',
        args: ['dev status'],
        demo: `
Active Jobs:

• abc123-1234 - claude (running) - Refactoring authentication system
• def456-5678 - aider (idle) - Adding test coverage
• ghi789-9012 - openhands (completed) - Documentation updates

Use 'dev status <jobId>' for details
        `.trim()
    },
    {
        name: '🏠 Local LLM',
        cmd: 'echo',
        args: ['dev run local-llm "explain code" --model llama3'],
        demo: `
✓ Detected Ollama at http://localhost:11434
✓ Using model: llama3:latest

[Llama 3 Response]
Looking at this JavaScript code:

- The calculateSum function performs addition
- The calculateProduct function performs multiplication  
- Both are pure functions with no side effects
- Exports allow usage in other modules

Simple, clean implementation suitable for math operations.
        `.trim()
    }
];

// Run each test
async function runTests() {
    for (const test of tests) {
        console.log(chalk.blue(`\n▶ ${test.name}`));
        console.log(chalk.gray('-'.repeat(60)));
        
        // Show the command
        console.log(chalk.gray('$ ' + test.args.join(' ')));
        
        // Show demo output
        console.log(chalk.white(test.demo));
        
        // Small delay for readability
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(chalk.green('\n\n✨ Demo completed!'));
    console.log(chalk.cyan('\nTo run real tests:'));
    console.log(chalk.gray('  1. Build the project: make setup'));
    console.log(chalk.gray('  2. Run tests: ./test/run-all-tests.sh'));
    console.log();
}

runTests();