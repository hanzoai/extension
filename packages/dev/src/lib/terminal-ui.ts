import chalk from 'chalk';
import ora, { Ora } from 'ora';
import * as readline from 'readline';

export interface UITheme {
  primary: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  info: (text: string) => string;
  muted: (text: string) => string;
  highlight: (text: string) => string;
}

export class TerminalUI {
  private static instance: TerminalUI;
  public theme: UITheme;
  private currentSpinner: Ora | null = null;
  private width: number;

  private constructor() {
    this.width = process.stdout.columns || 80;
    
    // Initialize default theme (can be customized)
    this.theme = {
      primary: (text: string) => chalk.bold.cyan(text),
      success: (text: string) => chalk.green(text),
      warning: (text: string) => chalk.yellow(text),
      error: (text: string) => chalk.red(text),
      info: (text: string) => chalk.blue(text),
      muted: (text: string) => chalk.gray(text),
      highlight: (text: string) => chalk.bold.yellow(text)
    };

    // Handle terminal resize
    process.stdout.on('resize', () => {
      this.width = process.stdout.columns || 80;
    });
  }

  static getInstance(): TerminalUI {
    if (!TerminalUI.instance) {
      TerminalUI.instance = new TerminalUI();
    }
    return TerminalUI.instance;
  }

  // Box drawing methods
  drawBox(content: string[], title?: string): void {
    const maxLength = Math.max(...content.map(line => line.length), title?.length || 0);
    const boxWidth = Math.min(maxLength + 4, this.width - 4);

    // Top border
    if (title) {
      const padding = Math.max(0, boxWidth - title.length - 4);
      const leftPad = Math.floor(padding / 2);
      const rightPad = Math.ceil(padding / 2);
      console.log(this.theme.primary(`╔${'═'.repeat(leftPad + 1)} ${title} ${'═'.repeat(rightPad + 1)}╗`));
    } else {
      console.log(this.theme.primary(`╔${'═'.repeat(boxWidth - 2)}╗`));
    }

    // Content
    content.forEach(line => {
      const padding = boxWidth - line.length - 4;
      console.log(this.theme.primary('║') + ` ${line}${' '.repeat(padding)} ` + this.theme.primary('║'));
    });

    // Bottom border
    console.log(this.theme.primary(`╚${'═'.repeat(boxWidth - 2)}╝`));
  }

  drawDivider(char: string = '─', width?: number): void {
    const dividerWidth = width || Math.min(64, this.width - 4);
    console.log(this.theme.muted(char.repeat(dividerWidth)));
  }

  // Welcome screen
  showWelcome(version: string): void {
    console.clear();
    this.drawBox([
      '🤖 Hanzo Dev - Universal AI Development CLI',
      '',
      `Version ${version}`,
      '',
      'Type commands or questions naturally',
      'Use /help for available commands'
    ], 'Welcome');
    console.log();
  }

  // Status indicators
  showSuccess(message: string): void {
    console.log(this.theme.success(`✅ ${message}`));
  }

  showError(message: string): void {
    console.log(this.theme.error(`❌ ${message}`));
  }

  showWarning(message: string): void {
    console.log(this.theme.warning(`⚠️  ${message}`));
  }

  showInfo(message: string): void {
    console.log(this.theme.info(`ℹ️  ${message}`));
  }

  showProgress(message: string): void {
    console.log(this.theme.info(`▶ ${message}`));
  }

  // Spinner management
  startSpinner(text: string): Ora {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
    }
    
    this.currentSpinner = ora({
      text,
      spinner: {
        interval: 80,
        frames: ['⬜', '⬜⬜', '⬜⬜⬜', '⬜⬜⬜⬜', '⬜⬜⬜', '⬜⬜', '⬜']
      },
      color: 'gray'
    }).start();
    
    return this.currentSpinner;
  }

  updateSpinner(text: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.text = text;
    }
  }

  succeedSpinner(text?: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.succeed(text);
      this.currentSpinner = null;
    }
  }

  failSpinner(text?: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.fail(text);
      this.currentSpinner = null;
    }
  }

  stopSpinner(): void {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      this.currentSpinner = null;
    }
  }

  // Code block rendering
  renderCodeBlock(code: string, language?: string): void {
    const lines = code.split('\n');
    const maxLineLength = Math.max(...lines.map(l => l.length));
    const boxWidth = Math.min(maxLineLength + 6, this.width - 4);

    // Top border with language label
    if (language) {
      console.log(this.theme.muted(`┌─ ${language} ${'─'.repeat(boxWidth - language.length - 5)}┐`));
    } else {
      console.log(this.theme.muted(`┌${'─'.repeat(boxWidth - 2)}┐`));
    }

    // Code lines with line numbers
    lines.forEach((line, index) => {
      const lineNum = this.theme.muted(`${(index + 1).toString().padStart(3)} │`);
      console.log(`${lineNum} ${line}`);
    });

    // Bottom border
    console.log(this.theme.muted(`└${'─'.repeat(boxWidth - 2)}┘`));
  }

  // Task list rendering
  renderTaskList(tasks: Array<{name: string, status: 'pending' | 'running' | 'success' | 'failed'}>): void {
    console.log(this.theme.primary('\n📋 Tasks:\n'));
    
    tasks.forEach(task => {
      let icon: string;
      let color: (text: string) => string;
      
      switch (task.status) {
        case 'pending':
          icon = '⏳';
          color = this.theme.muted;
          break;
        case 'running':
          icon = '🔄';
          color = this.theme.info;
          break;
        case 'success':
          icon = '✅';
          color = this.theme.success;
          break;
        case 'failed':
          icon = '❌';
          color = this.theme.error;
          break;
      }
      
      console.log(`  ${icon} ${color(task.name)}`);
    });
  }

  // Results summary
  renderSummary(data: Record<string, any>): void {
    console.log(this.theme.primary('\n📊 Summary\n'));
    
    Object.entries(data).forEach(([key, value]) => {
      const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
      console.log(`  ${this.theme.muted(formattedKey + ':')} ${this.theme.highlight(String(value))}`);
    });
  }

  // Interactive prompt
  createPrompt(promptText: string = 'dev> '): readline.Interface {
    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.theme.primary(promptText)
    });
  }

  // Tab interface for multiple panes
  renderTabs(tabs: Array<{id: string, title: string, active: boolean}>): void {
    const tabStrings = tabs.map(tab => {
      if (tab.active) {
        return this.theme.highlight(`[${tab.title}]`);
      }
      return this.theme.muted(`[${tab.title}]`);
    });
    
    console.log('\n' + tabStrings.join(' ') + '\n');
  }

  // Progress bar
  renderProgressBar(current: number, total: number, label?: string): void {
    const percentage = Math.round((current / total) * 100);
    const barWidth = Math.min(30, this.width - 20);
    const filled = Math.round(barWidth * (current / total));
    const empty = barWidth - filled;
    
    const bar = `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
    const progress = `${current}/${total} (${percentage}%)`;
    
    const line = label 
      ? `${label}: ${bar} ${progress}`
      : `${bar} ${progress}`;
      
    console.log(this.theme.info(line));
  }

  // Error formatting
  renderError(error: Error, context?: string): void {
    console.log(this.theme.error('\n❌ Error occurred:\n'));
    
    if (context) {
      console.log(this.theme.muted(`Context: ${context}`));
    }
    
    console.log(this.theme.error(error.message));
    
    if (error.stack && process.env.DEBUG) {
      console.log(this.theme.muted('\nStack trace:'));
      console.log(this.theme.muted(error.stack));
    }
  }

  // Command help
  renderCommandHelp(commands: Array<{name: string, description: string, usage?: string}>): void {
    console.log(this.theme.primary('\n📚 Available Commands:\n'));
    
    const maxNameLength = Math.max(...commands.map(c => c.name.length));
    
    commands.forEach(cmd => {
      const paddedName = cmd.name.padEnd(maxNameLength + 2);
      console.log(`  ${this.theme.highlight(paddedName)} ${this.theme.muted(cmd.description)}`);
      
      if (cmd.usage) {
        console.log(`  ${' '.repeat(maxNameLength + 2)} ${this.theme.muted(`Usage: ${cmd.usage}`)}`);
      }
    });
  }

  // Agent status
  renderAgentStatus(agents: Array<{id: string, status: string, task?: string}>): void {
    console.log(this.theme.primary('\n🤖 Agent Status:\n'));
    
    agents.forEach(agent => {
      const statusColor = agent.status === 'busy' ? this.theme.warning : this.theme.success;
      console.log(`  ${this.theme.muted(agent.id)}: ${statusColor(agent.status)}${agent.task ? ` - ${agent.task}` : ''}`);
    });
  }

  // Clear screen with header
  clearWithHeader(title: string): void {
    console.clear();
    this.drawDivider('═');
    console.log(this.theme.primary(title));
    this.drawDivider('═');
    console.log();
  }

  // AI response streaming display
  renderAIResponse(content: string, isComplete: boolean = false): void {
    if (!isComplete) {
      // Show streaming indicator
      process.stdout.write(this.theme.muted('▌'));
    } else {
      // Clear streaming indicator
      process.stdout.write('\r');
    }
  }

  // Thought display (similar to Claude Code)
  renderThought(thought: string): void {
    const lines = thought.split('\n');
    console.log(this.theme.muted('┌─ Thinking...'));
    lines.forEach(line => {
      console.log(this.theme.muted('│ ') + this.theme.muted(line));
    });
    console.log(this.theme.muted('└─'));
  }

  // Action display
  renderAction(action: string, tool?: string): void {
    const icon = '⚡';
    if (tool) {
      console.log(this.theme.info(`${icon} ${action} [${tool}]`));
    } else {
      console.log(this.theme.info(`${icon} ${action}`));
    }
  }

  // File change display
  renderFileChange(file: string, changeType: 'created' | 'modified' | 'deleted'): void {
    const icons = {
      created: '✨',
      modified: '📝',
      deleted: '🗑️'
    };
    const colors = {
      created: this.theme.success,
      modified: this.theme.warning,
      deleted: this.theme.error
    };
    
    console.log(colors[changeType](`${icons[changeType]} ${file}`));
  }
}