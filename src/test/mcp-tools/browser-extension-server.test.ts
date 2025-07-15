import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserExtensionServer } from '../../mcp-tools/browser-extension-server';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';

describe('BrowserExtensionServer Coverage', () => {
  let server: BrowserExtensionServer;
  let ws: WebSocket;
  const TEST_PORT = 3003;
  
  beforeEach(async () => {
    server = new BrowserExtensionServer(TEST_PORT, process.cwd());
    await new Promise(resolve => setTimeout(resolve, 100));
    ws = new WebSocket(`ws://localhost:${TEST_PORT}/browser-extension`);
    await new Promise(resolve => ws.on('open', resolve));
  });
  
  afterEach(() => {
    ws.close();
    server.close();
  });
  
  describe('Edge cases', () => {
    it('should handle file paths that cannot be resolved', async () => {
      const elementSelected = new Promise((resolve) => {
        server.on('elementSelected', resolve);
      });
      
      // Send event with unresolvable path
      ws.send(JSON.stringify({
        event: 'elementSelected',
        framework: 'unknown',
        domPath: 'div > span',
        source: {
          file: '/non/existent/path/component.js',
          line: 1
        }
      }));
      
      const result = await elementSelected;
      
      // Should still return the path even if it doesn't exist
      expect(result).toMatchObject({
        file: '/non/existent/path/component.js',
        line: 1
      });
    });
    
    it('should handle lookupByHanzoId when file does not exist', async () => {
      const elementSelected = new Promise((resolve, reject) => {
        let timeout = setTimeout(() => {
          resolve(null);
        }, 200);
        
        server.on('elementSelected', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });
      
      // Send event with only fallbackId
      ws.send(JSON.stringify({
        event: 'elementSelected',
        framework: null,
        domPath: 'body > div',
        fallbackId: 'hanzo-xyz789'
      }));
      
      const result = await elementSelected;
      
      // Should return null when ID not found
      expect(result).toBeNull();
    });
    
    it('should handle error reading ID map file', async () => {
      // Create .hanzo directory but make map file unreadable
      const hanzoDir = path.join(process.cwd(), '.hanzo');
      const mapFile = path.join(hanzoDir, 'id-map.json');
      
      if (!fs.existsSync(hanzoDir)) {
        fs.mkdirSync(hanzoDir, { recursive: true });
      }
      
      // Write invalid JSON
      fs.writeFileSync(mapFile, 'invalid json content');
      
      const elementSelected = new Promise((resolve, reject) => {
        let timeout = setTimeout(() => {
          resolve(null);
        }, 200);
        
        server.on('elementSelected', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });
      
      ws.send(JSON.stringify({
        event: 'elementSelected',
        framework: null,
        domPath: 'body > div',
        fallbackId: 'hanzo-error123'
      }));
      
      const result = await elementSelected;
      expect(result).toBeNull();
      
      // Cleanup
      if (fs.existsSync(mapFile)) {
        fs.unlinkSync(mapFile);
      }
    });
  });
});