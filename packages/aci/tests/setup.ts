// Mock native dependencies that aren't available in test environment
import { vi } from 'vitest';

// Mock jsautogui
vi.mock('jsautogui', () => ({
  default: {
    moveTo: vi.fn(),
    click: vi.fn(),
    mouseDown: vi.fn(),
    mouseUp: vi.fn(),
    dragTo: vi.fn(),
    scroll: vi.fn(),
    write: vi.fn(),
    keyTap: vi.fn(),
    keyDown: vi.fn(),
    keyUp: vi.fn(),
    hotkey: vi.fn(),
    screenshot: vi.fn(() => ({
      width: 1920,
      height: 1080,
      data: Buffer.alloc(1920 * 1080 * 4)
    })),
    getScreenSize: vi.fn(() => ({ width: 1920, height: 1080 })),
    locateOnScreen: vi.fn(),
    locateAllOnScreen: vi.fn(() => []),
    pixelMatchesColor: vi.fn(() => true),
    getPixelColor: vi.fn(() => [255, 255, 255])
  }
}));

// Mock @nut-tree-fork/nut-js
vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: {
    move: vi.fn(),
    setPosition: vi.fn(),
    leftClick: vi.fn(),
    rightClick: vi.fn(),
    click: vi.fn(),
    doubleClick: vi.fn(),
    drag: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn()
  },
  keyboard: {
    type: vi.fn(),
    pressKey: vi.fn(),
    releaseKey: vi.fn()
  },
  screen: {
    width: vi.fn(() => 1920),
    height: vi.fn(() => 1080),
    grab: vi.fn(() => ({
      toBuffer: vi.fn(() => Buffer.alloc(100))
    })),
    grabRegion: vi.fn(() => ({
      toBuffer: vi.fn(() => Buffer.alloc(100))
    })),
    find: vi.fn(),
    findAll: vi.fn(() => [])
  },
  imageResource: vi.fn((path) => ({ path }))
}));

// Mock robotjs
vi.mock('robotjs', () => ({
  moveMouse: vi.fn(),
  mouseClick: vi.fn(),
  mouseToggle: vi.fn(),
  dragMouse: vi.fn(),
  scrollMouse: vi.fn(),
  keyTap: vi.fn(),
  keyToggle: vi.fn(),
  typeString: vi.fn(),
  getScreenSize: vi.fn(() => ({ width: 1920, height: 1080 })),
  screen: {
    capture: vi.fn(() => ({
      width: 1920,
      height: 1080,
      image: Buffer.alloc(1920 * 1080 * 4),
      byteWidth: 1920 * 4,
      bitsPerPixel: 32,
      bytesPerPixel: 4
    }))
  }
}));

// Mock sharp
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(() => Buffer.alloc(100))
  }))
}));

// Mock tesseract.js
vi.mock('tesseract.js', () => ({
  default: {
    createWorker: vi.fn(async () => ({
      recognize: vi.fn(async () => ({
        data: {
          text: 'Sample OCR text',
          words: [
            {
              text: 'Sample',
              bbox: { x0: 10, y0: 10, x1: 50, y1: 30 }
            },
            {
              text: 'OCR',
              bbox: { x0: 60, y0: 10, x1: 90, y1: 30 }
            },
            {
              text: 'text',
              bbox: { x0: 100, y0: 10, x1: 130, y1: 30 }
            }
          ]
        }
      })),
      terminate: vi.fn()
    }))
  }
}));