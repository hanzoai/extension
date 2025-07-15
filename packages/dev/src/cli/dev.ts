#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('@hanzo/dev')
  .description('Hanzo Dev - Meta AI development CLI')
  .version('1.0.0');

program
  .command('claude [query...]')
  .description('Run Claude AI')
  .action((query) => {
    console.log(chalk.blue('🤖 Running Claude AI...'));
    console.log('Query:', query.join(' '));
  });

program
  .command('codex [query...]')
  .description('Run OpenAI Codex')
  .action((query) => {
    console.log(chalk.green('🤖 Running OpenAI Codex...'));
    console.log('Query:', query.join(' '));
  });

program
  .command('gemini [query...]')
  .description('Run Google Gemini')
  .action((query) => {
    console.log(chalk.yellow('🤖 Running Google Gemini...'));
    console.log('Query:', query.join(' '));
  });

program.parse();