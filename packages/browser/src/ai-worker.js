// Hanzo AI Worker — stub for WebGPU AI inference in web worker context
// This file is referenced by browser-control.ts and loaded as a web-accessible resource.

self.onmessage = function(event) {
  const { type, payload } = event.data;

  switch (type) {
    case 'init':
      self.postMessage({ type: 'ready', payload: { status: 'initialized' } });
      break;

    case 'inference':
      // Stub — actual inference runs through background.ts WebGPU pipeline
      self.postMessage({
        type: 'result',
        payload: { output: '', error: 'AI worker: use background script for inference' },
      });
      break;

    default:
      self.postMessage({ type: 'error', payload: { error: `Unknown message type: ${type}` } });
  }
};
