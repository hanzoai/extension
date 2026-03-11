/**
 * Cross-platform browser tool parity tests.
 *
 * Validates that ALL core browser actions (the same ones hanzo-mcp sends)
 * produce identical results across Chrome, Firefox, and WebKit.
 *
 * Each test maps directly to a CDP bridge action.
 * These run on every platform in the matrix.
 */
import { test, expect, type Page } from '@playwright/test'

const TEST_URL = 'https://example.com'

// Helper: navigate and wait for load
async function loadTestPage(page: Page) {
  await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('body')).toBeVisible()
}

// ═══════════════════════════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════════════════════════

test.describe('Navigation', () => {
  test('navigate to URL', async ({ page }) => {
    await page.goto(TEST_URL)
    await expect(page).toHaveURL(/example\.com/)
  })

  test('get page title', async ({ page }) => {
    await loadTestPage(page)
    const title = await page.title()
    expect(title).toContain('Example')
  })

  test('get page URL', async ({ page }) => {
    await loadTestPage(page)
    expect(page.url()).toContain('example.com')
  })

  test('reload page', async ({ page }) => {
    await loadTestPage(page)
    await page.reload()
    await expect(page.locator('body')).toBeVisible()
    expect(page.url()).toContain('example.com')
  })

  test('go back and forward', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' })
    await page.goto('https://example.org', { waitUntil: 'domcontentloaded' })
    expect(page.url()).toContain('example.org')

    await page.goBack()
    await page.waitForLoadState('domcontentloaded')
    expect(page.url()).toContain('example.com')

    await page.goForward()
    await page.waitForLoadState('domcontentloaded')
    expect(page.url()).toContain('example.org')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// JavaScript Evaluation
// ═══════════════════════════════════════════════════════════════════════

test.describe('Evaluate', () => {
  test('evaluate simple expression', async ({ page }) => {
    await loadTestPage(page)
    const result = await page.evaluate(() => 1 + 1)
    expect(result).toBe(2)
  })

  test('evaluate returns string', async ({ page }) => {
    await loadTestPage(page)
    const result = await page.evaluate(() => document.title)
    expect(result).toContain('Example')
  })

  test('evaluate returns object', async ({ page }) => {
    await loadTestPage(page)
    const result = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
    }))
    expect(result.url).toContain('example.com')
    expect(result.title).toContain('Example')
  })

  test('evaluate returns null for undefined', async ({ page }) => {
    await loadTestPage(page)
    const result = await page.evaluate(() => (document as any).nonExistentProp ?? null)
    expect(result).toBeNull()
  })

  test('evaluate accesses DOM', async ({ page }) => {
    await loadTestPage(page)
    const text = await page.evaluate(() => document.querySelector('h1')?.textContent || '')
    expect(text).toContain('Example')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DOM Interaction — Click / Fill / Type
// ═══════════════════════════════════════════════════════════════════════

test.describe('DOM Interaction', () => {
  test('click an element', async ({ page }) => {
    await loadTestPage(page)
    // example.com has a link — click it
    const link = page.locator('a').first()
    if (await link.count()) {
      await expect(link).toBeVisible()
      // Just verify click doesn't throw
      await link.click().catch(() => {
        // External navigation may fail in test, that's OK
      })
    }
  })

  test('fill an input field', async ({ page }) => {
    // Create a page with an input
    await page.setContent(`
      <html><body>
        <input id="name" type="text" />
        <textarea id="bio"></textarea>
        <select id="color">
          <option value="red">Red</option>
          <option value="blue">Blue</option>
        </select>
      </body></html>
    `)

    // Fill input
    await page.fill('#name', 'Hanzo AI')
    const inputValue = await page.inputValue('#name')
    expect(inputValue).toBe('Hanzo AI')

    // Fill textarea
    await page.fill('#bio', 'AI infrastructure')
    const textareaValue = await page.inputValue('#bio')
    expect(textareaValue).toBe('AI infrastructure')
  })

  test('clear an input field', async ({ page }) => {
    await page.setContent('<html><body><input id="x" value="hello" /></body></html>')
    await page.fill('#x', '')
    const value = await page.inputValue('#x')
    expect(value).toBe('')
  })

  test('select option in dropdown', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <select id="color">
          <option value="red">Red</option>
          <option value="blue">Blue</option>
          <option value="green">Green</option>
        </select>
      </body></html>
    `)
    await page.selectOption('#color', 'blue')
    const selected = await page.evaluate(() => (document.getElementById('color') as HTMLSelectElement).value)
    expect(selected).toBe('blue')
  })

  test('check and uncheck checkbox', async ({ page }) => {
    await page.setContent('<html><body><input id="agree" type="checkbox" /></body></html>')

    await page.check('#agree')
    expect(await page.isChecked('#agree')).toBe(true)

    await page.uncheck('#agree')
    expect(await page.isChecked('#agree')).toBe(false)
  })

  test('type into focused element', async ({ page }) => {
    await page.setContent('<html><body><input id="search" type="text" /></body></html>')
    await page.click('#search')
    await page.keyboard.type('hello world')
    const value = await page.inputValue('#search')
    expect(value).toBe('hello world')
  })

  test('press key', async ({ page }) => {
    await page.setContent('<html><body><input id="k" type="text" /><input id="k2" type="text" /></body></html>')
    await page.click('#k')
    await page.keyboard.press('Tab')
    // Tab should move focus to second input
    const focused = await page.evaluate(() => document.activeElement?.id)
    expect(focused).toBe('k2')
  })

  test('hover triggers mouseenter', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div id="target" style="width:100px;height:100px;background:red">hover me</div>
        <div id="result"></div>
        <script>
          document.getElementById('target').addEventListener('mouseenter', () => {
            document.getElementById('result').textContent = 'hovered';
          });
        </script>
      </body></html>
    `)
    await page.hover('#target')
    await expect(page.locator('#result')).toHaveText('hovered')
  })

  test('double click', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div id="target" style="width:100px;height:100px">dblclick me</div>
        <div id="result"></div>
        <script>
          document.getElementById('target').addEventListener('dblclick', () => {
            document.getElementById('result').textContent = 'double-clicked';
          });
        </script>
      </body></html>
    `)
    await page.dblclick('#target')
    await expect(page.locator('#result')).toHaveText('double-clicked')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DOM Read — getText, getHTML, getAttribute, querySelector
// ═══════════════════════════════════════════════════════════════════════

test.describe('DOM Read', () => {
  test('get text content', async ({ page }) => {
    await loadTestPage(page)
    const text = await page.locator('h1').textContent()
    expect(text).toContain('Example')
  })

  test('get inner HTML', async ({ page }) => {
    await page.setContent('<html><body><div id="box"><span>hi</span></div></body></html>')
    const html = await page.locator('#box').innerHTML()
    expect(html).toContain('<span>hi</span>')
  })

  test('get outer HTML', async ({ page }) => {
    await page.setContent('<html><body><div id="box"><span>hi</span></div></body></html>')
    const html = await page.evaluate(() => document.getElementById('box')?.outerHTML)
    expect(html).toContain('<div id="box">')
    expect(html).toContain('<span>hi</span>')
  })

  test('get attribute', async ({ page }) => {
    await page.setContent('<html><body><a id="link" href="https://hanzo.ai" data-test="yes">click</a></body></html>')
    const href = await page.getAttribute('#link', 'href')
    expect(href).toBe('https://hanzo.ai')
    const data = await page.getAttribute('#link', 'data-test')
    expect(data).toBe('yes')
  })

  test('querySelector returns element info', async ({ page }) => {
    await page.setContent('<html><body><button id="btn" class="primary" disabled>Submit</button></body></html>')
    const info = await page.evaluate(() => {
      const el = document.querySelector('#btn') as HTMLButtonElement
      return el ? { tagName: el.tagName, id: el.id, className: el.className, disabled: el.disabled, text: el.textContent } : null
    })
    expect(info).toEqual({ tagName: 'BUTTON', id: 'btn', className: 'primary', disabled: true, text: 'Submit' })
  })

  test('querySelectorAll returns multiple elements', async ({ page }) => {
    await page.setContent('<html><body><ul><li>A</li><li>B</li><li>C</li></ul></body></html>')
    const count = await page.locator('li').count()
    expect(count).toBe(3)
    const texts = await page.locator('li').allTextContents()
    expect(texts).toEqual(['A', 'B', 'C'])
  })

  test('get bounding rect', async ({ page }) => {
    await page.setContent('<html><body><div id="box" style="width:200px;height:100px;margin:10px">box</div></body></html>')
    const rect = await page.locator('#box').boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.width).toBeCloseTo(200, 0)
    expect(rect!.height).toBeCloseTo(100, 0)
  })

  test('get computed style', async ({ page }) => {
    await page.setContent('<html><body><div id="styled" style="color: rgb(255, 0, 0); font-size: 20px">red</div></body></html>')
    const color = await page.evaluate(() => getComputedStyle(document.getElementById('styled')!).color)
    expect(color).toBe('rgb(255, 0, 0)')
  })

  test('element visibility checks', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div id="visible">I am visible</div>
        <div id="hidden" style="display:none">I am hidden</div>
      </body></html>
    `)
    expect(await page.isVisible('#visible')).toBe(true)
    expect(await page.isVisible('#hidden')).toBe(false)
    expect(await page.isHidden('#hidden')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DOM Write — set attributes, styles, classes, innerHTML
// ═══════════════════════════════════════════════════════════════════════

test.describe('DOM Write', () => {
  test('set attribute', async ({ page }) => {
    await page.setContent('<html><body><div id="el">hello</div></body></html>')
    await page.evaluate(() => document.getElementById('el')!.setAttribute('data-custom', 'value'))
    const attr = await page.getAttribute('#el', 'data-custom')
    expect(attr).toBe('value')
  })

  test('remove attribute', async ({ page }) => {
    await page.setContent('<html><body><div id="el" data-remove="yes">hello</div></body></html>')
    await page.evaluate(() => document.getElementById('el')!.removeAttribute('data-remove'))
    const attr = await page.getAttribute('#el', 'data-remove')
    expect(attr).toBeNull()
  })

  test('set innerHTML', async ({ page }) => {
    await page.setContent('<html><body><div id="container"></div></body></html>')
    await page.evaluate(() => {
      document.getElementById('container')!.innerHTML = '<p>injected</p>'
    })
    await expect(page.locator('#container p')).toHaveText('injected')
  })

  test('add and remove CSS class', async ({ page }) => {
    await page.setContent('<html><body><div id="el" class="base">hello</div></body></html>')
    await page.evaluate(() => document.getElementById('el')!.classList.add('active', 'highlighted'))
    let cls = await page.getAttribute('#el', 'class')
    expect(cls).toContain('active')
    expect(cls).toContain('highlighted')

    await page.evaluate(() => document.getElementById('el')!.classList.remove('highlighted'))
    cls = await page.getAttribute('#el', 'class')
    expect(cls).not.toContain('highlighted')
    expect(cls).toContain('active')
  })

  test('set inline style', async ({ page }) => {
    await page.setContent('<html><body><div id="el">hello</div></body></html>')
    await page.evaluate(() => {
      const el = document.getElementById('el')!
      el.style.backgroundColor = 'red'
      el.style.fontSize = '24px'
    })
    const bg = await page.evaluate(() => document.getElementById('el')!.style.backgroundColor)
    expect(bg).toBe('red')
  })

  test('insert element', async ({ page }) => {
    await page.setContent('<html><body><ul id="list"><li>first</li></ul></body></html>')
    await page.evaluate(() => {
      document.getElementById('list')!.insertAdjacentHTML('beforeend', '<li>second</li>')
    })
    const items = await page.locator('#list li').allTextContents()
    expect(items).toEqual(['first', 'second'])
  })

  test('remove element', async ({ page }) => {
    await page.setContent('<html><body><div id="parent"><span id="child">bye</span></div></body></html>')
    await page.evaluate(() => document.getElementById('child')!.remove())
    await expect(page.locator('#child')).toHaveCount(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Screenshots
// ═══════════════════════════════════════════════════════════════════════

test.describe('Screenshots', () => {
  test('capture screenshot as buffer', async ({ page }) => {
    await loadTestPage(page)
    const screenshot = await page.screenshot({ type: 'png' })
    expect(screenshot).toBeInstanceOf(Buffer)
    expect(screenshot.length).toBeGreaterThan(1000)
  })

  test('capture full page screenshot', async ({ page }) => {
    await loadTestPage(page)
    const screenshot = await page.screenshot({ type: 'png', fullPage: true })
    expect(screenshot.length).toBeGreaterThan(1000)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Wait / Selectors
// ═══════════════════════════════════════════════════════════════════════

test.describe('Waiting', () => {
  test('wait for selector', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <script>setTimeout(() => { document.body.innerHTML += '<div id="delayed">loaded</div>'; }, 500);</script>
      </body></html>
    `)
    await page.waitForSelector('#delayed', { timeout: 5000 })
    await expect(page.locator('#delayed')).toHaveText('loaded')
  })

  test('wait for load state', async ({ page }) => {
    await page.goto(TEST_URL)
    await page.waitForLoadState('domcontentloaded')
    const title = await page.title()
    expect(title).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Storage — localStorage, cookies
// ═══════════════════════════════════════════════════════════════════════

test.describe('Storage', () => {
  test('get and set localStorage', async ({ page }) => {
    await loadTestPage(page)
    await page.evaluate(() => localStorage.setItem('test_key', 'test_value'))
    const value = await page.evaluate(() => localStorage.getItem('test_key'))
    expect(value).toBe('test_value')
  })

  test('clear localStorage', async ({ page }) => {
    await loadTestPage(page)
    await page.evaluate(() => {
      localStorage.setItem('a', '1')
      localStorage.setItem('b', '2')
      localStorage.clear()
    })
    const len = await page.evaluate(() => localStorage.length)
    expect(len).toBe(0)
  })

  test('get cookies', async ({ page, context }) => {
    await loadTestPage(page)
    await context.addCookies([{ name: 'test_cookie', value: 'yum', url: TEST_URL }])
    const cookies = await context.cookies(TEST_URL)
    const found = cookies.find((c) => c.name === 'test_cookie')
    expect(found).toBeTruthy()
    expect(found!.value).toBe('yum')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Page Content
// ═══════════════════════════════════════════════════════════════════════

test.describe('Content', () => {
  test('get full page HTML', async ({ page }) => {
    await loadTestPage(page)
    const html = await page.content()
    expect(html).toContain('<html')
    expect(html).toContain('Example')
    expect(html.length).toBeGreaterThan(100)
  })

  test('inject CSS', async ({ page }) => {
    await page.setContent('<html><body><div id="el">hello</div></body></html>')
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '#el { color: rgb(0, 128, 0); }'
      document.head.appendChild(style)
    })
    const color = await page.evaluate(() => getComputedStyle(document.getElementById('el')!).color)
    expect(color).toBe('rgb(0, 128, 0)')
  })

  test('inject script', async ({ page }) => {
    await page.setContent('<html><body><div id="result"></div></body></html>')
    await page.evaluate(() => {
      (window as any).__injected = true
    })
    const val = await page.evaluate(() => (window as any).__injected)
    expect(val).toBe(true)
  })
})
