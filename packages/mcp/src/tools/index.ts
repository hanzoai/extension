/**
 * Tool registry for Hanzo MCP
 */

import { Tool } from '../types';
import { registerTool, getAllRegisteredTools } from './tool-registry';

// Import and register all tool categories
import { fileTools } from './file-ops';
import { searchTools } from './search';
import { shellTools } from './shell';
import { editTools } from './edit';
import { vectorTools } from './vector-search';
import { aiTools } from './ai-tools';
import { astTools } from './ast-search';
import { todoTools } from './todo';
import { modePresetTools } from './mode-preset';

// Register all tools
[
  ...fileTools,
  ...searchTools,
  ...shellTools,
  ...editTools,
  ...vectorTools,
  ...aiTools,
  ...astTools,
  ...todoTools,
  ...modePresetTools
].forEach(tool => registerTool(tool));

// Export functions that return current values
export function getAllTools(): Tool[] {
  return getAllRegisteredTools();
}

export function getToolMap(): Map<string, Tool> {
  return new Map(getAllRegisteredTools().map(tool => [tool.name, tool]));
}

// For backward compatibility
export const allTools = getAllTools();
export const toolMap = getToolMap();

// Export individual tool categories
export { fileTools } from './file-ops';
export { searchTools } from './search';
export { shellTools } from './shell';
export { editTools } from './edit';
export { vectorTools } from './vector-search';
export { aiTools } from './ai-tools';
export { astTools } from './ast-search';
export { todoTools } from './todo';
export { modePresetTools, modeUtils } from './mode-preset';

// Export the registry functions
export { registerTool, getAllRegisteredTools } from './tool-registry';