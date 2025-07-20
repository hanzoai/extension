#!/usr/bin/env node

import { TerminalUI } from '../lib/terminal-ui';
import { CommandRegistry } from '../lib/command-registry';
import chalk from 'chalk';

async function demo() {
  const ui = TerminalUI.getInstance();

  // Show welcome screen
  ui.showWelcome('2.2.0');
  
  await sleep(1000);

  // Show different status messages
  ui.showInfo('Loading project files...');
  await sleep(500);
  
  ui.showSuccess('Successfully loaded 42 files');
  await sleep(500);
  
  ui.showWarning('Found 3 potential issues');
  await sleep(500);

  // Show a spinner
  const spinner = ui.startSpinner('Analyzing codebase...');
  await sleep(2000);
  ui.succeedSpinner('Analysis complete!');
  
  await sleep(500);

  // Show code block
  console.log('\n');
  ui.renderCodeBlock(`function hello(name: string): string {
  return \`Hello, \${name}!\`;
}`, 'typescript');
  
  await sleep(1000);

  // Show task list
  ui.renderTaskList([
    { name: 'Load configuration', status: 'success' },
    { name: 'Initialize agent', status: 'success' },
    { name: 'Connect to MCP servers', status: 'running' },
    { name: 'Start browser automation', status: 'pending' }
  ]);
  
  await sleep(1000);

  // Show progress bar
  console.log('\n');
  for (let i = 0; i <= 10; i++) {
    process.stdout.write('\r');
    ui.renderProgressBar(i, 10, 'Processing files');
    await sleep(200);
  }
  console.log('\n');
  
  // Show summary
  ui.renderSummary({
    files_processed: 42,
    issues_found: 3,
    time_taken: '2.3s',
    memory_used: '128MB'
  });
  
  await sleep(1000);

  // Show AI thinking
  ui.renderThought('Analyzing the request...\nIdentifying relevant files...\nPlanning approach...');
  await sleep(1000);

  // Show actions
  ui.renderAction('Searching for configuration files', 'search_files');
  await sleep(500);
  ui.renderAction('Reading package.json', 'view_file');
  await sleep(500);
  
  // Show file changes
  ui.renderFileChange('src/config.ts', 'created');
  ui.renderFileChange('src/index.ts', 'modified');
  ui.renderFileChange('src/old-config.js', 'deleted');
  
  await sleep(1000);

  // Show agent status
  ui.renderAgentStatus([
    { id: 'agent-1', status: 'idle' },
    { id: 'agent-2', status: 'busy', task: 'Editing files' },
    { id: 'agent-3', status: 'busy', task: 'Running tests' }
  ]);

  console.log(chalk.green('\n✨ Demo complete!\n'));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demo
demo().catch(console.error);