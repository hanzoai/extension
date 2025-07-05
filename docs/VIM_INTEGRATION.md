# Hanzo MCP Vim/Neovim Integration Guide

This guide explains how to use the Hanzo MCP server with Vim and Neovim for AI-powered development.

## Overview

While Vim/Neovim doesn't have native MCP support like Claude Code or VS Code, you can still leverage Hanzo MCP tools through several integration methods.

## Integration Methods

### 1. Claude.nvim (Recommended)

[Claude.nvim](https://github.com/claudeai/claude.nvim) is a Neovim plugin that integrates Claude AI directly into your editor.

#### Installation

Using [lazy.nvim](https://github.com/folke/lazy.nvim):

```lua
{
  'claudeai/claude.nvim',
  config = function()
    require('claude').setup({
      -- Configure MCP server
      mcp_servers = {
        hanzo = {
          command = 'hanzo-mcp',
          args = { '--anon' }, -- Remove for authenticated mode
          env = {
            HANZO_WORKSPACE = vim.fn.getcwd(),
          }
        }
      }
    })
  end
}
```

Using [packer.nvim](https://github.com/wbthomason/packer.nvim):

```lua
use {
  'claudeai/claude.nvim',
  config = function()
    require('claude').setup({
      mcp_servers = {
        hanzo = {
          command = 'hanzo-mcp',
          args = {},
          env = {
            HANZO_WORKSPACE = vim.fn.getcwd(),
          }
        }
      }
    })
  end
}
```

#### Usage

```vim
" Open Claude chat
:Claude

" Ask Claude with MCP context
:ClaudeAsk Can you analyze this codebase?

" Use specific MCP tool
:ClaudeMCP hanzo.search "function handleAuth"
```

### 2. Shell Integration

You can use the Hanzo MCP server as a command-line tool from within Vim.

#### Setup

First, install the MCP server globally:

```bash
npm install -g @hanzo/mcp
```

#### Vim Commands

Add these to your `.vimrc` or `init.vim`:

```vim
" Search for text using Hanzo MCP
command! -nargs=1 HanzoSearch :!hanzo-mcp search "<args>"

" Read file with Hanzo MCP
command! -nargs=1 HanzoRead :!hanzo-mcp read "<args>"

" Find files
command! -nargs=1 HanzoFind :!hanzo-mcp find_files "<args>"

" Git search
command! -nargs=1 HanzoGitSearch :!hanzo-mcp git_search "<args>"

" Run command
command! -nargs=1 HanzoRun :!hanzo-mcp run_command "<args>"

" Interactive mode
command! HanzoInteractive :terminal hanzo-mcp --interactive
```

### 3. Async Integration with Neovim

For better integration, use Neovim's async capabilities:

```lua
-- ~/.config/nvim/lua/hanzo-mcp.lua
local M = {}

-- Start MCP server
function M.start_server()
  local handle
  local stdout = vim.loop.new_pipe(false)
  local stderr = vim.loop.new_pipe(false)
  
  handle = vim.loop.spawn('hanzo-mcp', {
    args = {'--server'},
    stdio = {nil, stdout, stderr},
    env = {
      HANZO_WORKSPACE = vim.fn.getcwd(),
      MCP_TRANSPORT = 'stdio'
    }
  }, function(code, signal)
    stdout:close()
    stderr:close()
    handle:close()
  end)
  
  -- Handle stdout
  stdout:read_start(function(err, data)
    if data then
      vim.schedule(function()
        -- Process MCP responses
        vim.notify('MCP: ' .. data)
      end)
    end
  end)
  
  return handle
end

-- Send command to MCP server
function M.send_command(cmd, args)
  -- Implementation for sending commands
  -- This would need proper MCP protocol handling
end

-- Search files
function M.search(pattern)
  M.send_command('search', { pattern = pattern })
end

-- Read file
function M.read_file(path)
  M.send_command('read', { path = path })
end

return M
```

Use in your config:

```lua
-- ~/.config/nvim/init.lua
local hanzo = require('hanzo-mcp')

-- Start server on startup
vim.api.nvim_create_autocmd('VimEnter', {
  callback = function()
    hanzo.start_server()
  end
})

-- Create commands
vim.api.nvim_create_user_command('HanzoSearch', function(opts)
  hanzo.search(opts.args)
end, { nargs = 1 })
```

### 4. FZF Integration

Integrate Hanzo MCP with [fzf.vim](https://github.com/junegunn/fzf.vim) for fuzzy searching:

```vim
" ~/.vimrc or ~/.config/nvim/init.vim

" Search files with Hanzo MCP
function! HanzoFiles()
  let files = system('hanzo-mcp find_files "**/*"')
  call fzf#run({
    \ 'source': split(files, '\n'),
    \ 'sink': 'edit',
    \ 'options': '--preview "hanzo-mcp read {}"'
    \ })
endfunction

command! HanzoFiles call HanzoFiles()

" Search content with preview
function! HanzoGrep(pattern)
  let results = system('hanzo-mcp grep "' . a:pattern . '"')
  call fzf#run({
    \ 'source': split(results, '\n'),
    \ 'sink': 'edit',
    \ 'options': '--preview "hanzo-mcp read {1}"'
    \ })
endfunction

command! -nargs=1 HanzoGrep call HanzoGrep(<q-args>)
```

### 5. LSP-Style Integration

For a more integrated experience, you can use Hanzo MCP as a language server:

```lua
-- ~/.config/nvim/lua/lsp/hanzo-mcp.lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- Define Hanzo MCP as a custom LSP
if not configs.hanzo_mcp then
  configs.hanzo_mcp = {
    default_config = {
      cmd = {'hanzo-mcp', '--lsp'},
      filetypes = {'*'}, -- All file types
      root_dir = lspconfig.util.root_pattern('.git', 'package.json', 'Makefile'),
      settings = {
        hanzo = {
          workspace = vim.fn.getcwd(),
          anonymous = false
        }
      }
    }
  }
end

-- Setup
lspconfig.hanzo_mcp.setup({
  on_attach = function(client, bufnr)
    -- Custom keybindings
    local opts = { noremap=true, silent=true, buffer=bufnr }
    vim.keymap.set('n', '<leader>hs', '<cmd>lua vim.lsp.buf.execute_command({command="hanzo.search"})<CR>', opts)
    vim.keymap.set('n', '<leader>hf', '<cmd>lua vim.lsp.buf.execute_command({command="hanzo.find_files"})<CR>', opts)
  end
})
```

## Recommended Setup

For the best experience with Vim/Neovim:

1. **Install Prerequisites**:
   ```bash
   # Install Hanzo MCP globally
   npm install -g @hanzo/mcp
   
   # Install Neovim 0.8+ (for better async support)
   brew install neovim  # macOS
   # or
   sudo apt install neovim  # Ubuntu/Debian
   ```

2. **Basic Configuration**:
   ```vim
   " ~/.vimrc or ~/.config/nvim/init.vim
   
   " Hanzo MCP commands
   command! -nargs=* Hanzo :!hanzo-mcp <args>
   command! -nargs=1 HSearch :!hanzo-mcp search "<args>"
   command! -nargs=1 HFind :!hanzo-mcp find_files "<args>"
   command! -nargs=1 HRead :!hanzo-mcp read "<args>"
   
   " Keybindings
   nnoremap <leader>hs :HSearch <C-R><C-W><CR>
   nnoremap <leader>hf :HFind 
   nnoremap <leader>hr :HRead %<CR>
   
   " Integration with quickfix
   function! HanzoSearchToQuickfix(pattern)
     let results = system('hanzo-mcp grep "' . a:pattern . '" --format=quickfix')
     cgetexpr results
     copen
   endfunction
   command! -nargs=1 HSearchQF call HanzoSearchToQuickfix(<q-args>)
   ```

3. **Advanced Neovim Setup**:
   ```lua
   -- ~/.config/nvim/lua/hanzo.lua
   local M = {}
   
   -- Telescope integration
   function M.setup_telescope()
     local pickers = require "telescope.pickers"
     local finders = require "telescope.finders"
     local conf = require("telescope.config").values
     
     M.search = function(opts)
       opts = opts or {}
       pickers.new(opts, {
         prompt_title = "Hanzo Search",
         finder = finders.new_oneshot_job({
           "hanzo-mcp", "search", opts.pattern or ""
         }),
         sorter = conf.generic_sorter(opts),
       }):find()
     end
   end
   
   return M
   ```

## Tips

1. **Authentication**: For full features, authenticate once:
   ```bash
   hanzo-mcp --login
   ```

2. **Anonymous Mode**: For quick usage without login:
   ```vim
   command! -nargs=* HanzoAnon :!hanzo-mcp --anon <args>
   ```

3. **Project Context**: Always set the workspace:
   ```vim
   let $HANZO_WORKSPACE = getcwd()
   ```

4. **Performance**: Use async methods in Neovim for better performance
5. **Integration**: Combine with existing Vim tools (fzf, telescope, quickfix)

## Troubleshooting

- **Command not found**: Ensure `hanzo-mcp` is in your PATH
- **Authentication issues**: Run `hanzo-mcp --login` in terminal
- **Permission errors**: Check file permissions and workspace settings
- **Async issues**: Use Neovim 0.8+ for better async support

## Future Enhancements

We're working on:
- Native Vim/Neovim plugin
- Better LSP integration
- Telescope.nvim extension
- Direct MCP protocol support

For updates, check: https://github.com/hanzoai/extension