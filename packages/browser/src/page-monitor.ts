// Page Monitor — Console & Network capture via CDP events
// Captures console logs, errors, warnings and network requests from monitored tabs.
// Uses chrome.debugger CDP domains: Runtime, Network, Log

export interface PageMonitorConfig {
  logLimit: number
  stringSizeLimit: number
  captureRequestHeaders: boolean
  captureResponseHeaders: boolean
}

export interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
  url?: string
  line?: number
  column?: number
  stackTrace?: string
  tabId: number
}

export interface NetworkEntry {
  requestId: string
  url: string
  method: string
  status: number
  statusText: string
  resourceType: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  timestamp: number
  duration?: number
  failed: boolean
  errorText?: string
  tabId: number
}

export class PageMonitor {
  private consoleLogs = new Map<number, ConsoleEntry[]>()
  private networkRequests = new Map<number, Map<string, NetworkEntry>>()
  private monitoredTabs = new Set<number>()
  private config: PageMonitorConfig

  constructor(config?: Partial<PageMonitorConfig>) {
    this.config = {
      logLimit: 50,
      stringSizeLimit: 500,
      captureRequestHeaders: false,
      captureResponseHeaders: false,
      ...config,
    }
  }

  async startMonitoring(tabId: number): Promise<void> {
    if (this.monitoredTabs.has(tabId)) return

    this.monitoredTabs.add(tabId)
    this.consoleLogs.set(tabId, [])
    this.networkRequests.set(tabId, new Map())

    // Attach debugger if not already
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.debugger.attach({ tabId }, '1.3', () => {
          if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message?.includes('Already attached')) {
              resolve()
            } else {
              reject(new Error(chrome.runtime.lastError.message))
            }
          } else {
            resolve()
          }
        })
      })
    } catch (e) {
      console.warn('[PageMonitor] Attach:', (e as Error).message)
    }

    // Enable CDP domains
    const enable = (domain: string) =>
      new Promise<void>((resolve) => {
        chrome.debugger.sendCommand({ tabId }, `${domain}.enable`, {}, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[PageMonitor] ${domain}.enable:`, chrome.runtime.lastError.message)
          }
          resolve()
        })
      })

    await Promise.all([enable('Runtime'), enable('Network'), enable('Log')])
  }

  stopMonitoring(tabId: number): void {
    this.monitoredTabs.delete(tabId)
    this.consoleLogs.delete(tabId)
    this.networkRequests.delete(tabId)
  }

  isMonitoring(tabId: number): boolean {
    return this.monitoredTabs.has(tabId)
  }

  getMonitoredTabs(): number[] {
    return Array.from(this.monitoredTabs)
  }

  // Call this from chrome.debugger.onEvent listener
  handleCDPEvent(tabId: number, method: string, params: any): void {
    if (!this.monitoredTabs.has(tabId)) return

    switch (method) {
      case 'Runtime.consoleAPICalled':
        this.handleConsoleAPI(tabId, params)
        break
      case 'Runtime.exceptionThrown':
        this.handleException(tabId, params)
        break
      case 'Log.entryAdded':
        this.handleLogEntry(tabId, params)
        break
      case 'Network.requestWillBeSent':
        this.handleRequestWillBeSent(tabId, params)
        break
      case 'Network.responseReceived':
        this.handleResponseReceived(tabId, params)
        break
      case 'Network.loadingFinished':
        this.handleLoadingFinished(tabId, params)
        break
      case 'Network.loadingFailed':
        this.handleLoadingFailed(tabId, params)
        break
    }
  }

  // --- Console ---

  private handleConsoleAPI(tabId: number, params: any): void {
    const args = params.args || []
    const message = args.map((a: any) => this.formatRemoteObject(a)).join(' ')

    const entry: ConsoleEntry = {
      level: params.type || 'log',
      message: this.truncate(message),
      timestamp: params.timestamp || Date.now(),
      tabId,
    }

    if (params.stackTrace?.callFrames?.length) {
      const frame = params.stackTrace.callFrames[0]
      entry.url = frame.url
      entry.line = frame.lineNumber
      entry.column = frame.columnNumber
    }

    this.pushLog(tabId, entry)
  }

  private handleException(tabId: number, params: any): void {
    const details = params.exceptionDetails
    if (!details) return

    let message = 'Uncaught exception'
    if (details.exception) {
      message = this.formatRemoteObject(details.exception)
    } else if (details.text) {
      message = details.text
    }

    let stackTrace: string | undefined
    if (details.stackTrace?.callFrames) {
      stackTrace = details.stackTrace.callFrames
        .map(
          (f: any) =>
            `  at ${f.functionName || '(anonymous)'} (${f.url}:${f.lineNumber}:${f.columnNumber})`
        )
        .join('\n')
    }

    this.pushLog(tabId, {
      level: 'error',
      message: this.truncate(message),
      timestamp: details.timestamp || Date.now(),
      url: details.url,
      line: details.lineNumber,
      column: details.columnNumber,
      stackTrace,
      tabId,
    })
  }

  private handleLogEntry(tabId: number, params: any): void {
    const e = params.entry
    if (!e) return
    this.pushLog(tabId, {
      level: e.level || 'info',
      message: this.truncate(e.text || ''),
      timestamp: e.timestamp || Date.now(),
      url: e.url,
      line: e.lineNumber,
      tabId,
    })
  }

  private pushLog(tabId: number, entry: ConsoleEntry): void {
    const logs = this.consoleLogs.get(tabId)
    if (!logs) return
    logs.push(entry)
    while (logs.length > this.config.logLimit) logs.shift()
  }

  // --- Network ---

  private handleRequestWillBeSent(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId)
    if (!requests) return

    const entry: NetworkEntry = {
      requestId: params.requestId,
      url: params.request?.url || '',
      method: params.request?.method || 'GET',
      status: 0,
      statusText: '',
      resourceType: params.type || 'Other',
      timestamp: params.timestamp ? params.timestamp * 1000 : Date.now(),
      failed: false,
      tabId,
    }

    if (this.config.captureRequestHeaders && params.request?.headers) {
      entry.requestHeaders = params.request.headers
    }
    if (params.request?.postData) {
      entry.requestBody = this.truncate(params.request.postData)
    }

    requests.set(params.requestId, entry)

    // Enforce limit
    if (requests.size > this.config.logLimit * 2) {
      const keys = Array.from(requests.keys())
      for (let i = 0; i < keys.length - this.config.logLimit; i++) {
        requests.delete(keys[i])
      }
    }
  }

  private handleResponseReceived(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId)
    const entry = requests?.get(params.requestId)
    if (!entry) return

    const response = params.response || {}
    entry.status = response.status || 0
    entry.statusText = response.statusText || ''
    entry.resourceType = params.type || entry.resourceType

    if (this.config.captureResponseHeaders && response.headers) {
      entry.responseHeaders = response.headers
    }
  }

  private handleLoadingFinished(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId)
    const entry = requests?.get(params.requestId)
    if (!entry) return

    const endTime = params.timestamp ? params.timestamp * 1000 : Date.now()
    entry.duration = endTime - entry.timestamp

    // Get response body for XHR/Fetch
    if (entry.resourceType === 'XHR' || entry.resourceType === 'Fetch') {
      this.getResponseBody(tabId, params.requestId)
        .then((body) => {
          if (body) entry.responseBody = this.truncate(body)
        })
        .catch(() => {})
    }
  }

  private handleLoadingFailed(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId)
    const entry = requests?.get(params.requestId)
    if (!entry) return

    entry.failed = true
    entry.errorText = params.errorText || 'Failed'
    const endTime = params.timestamp ? params.timestamp * 1000 : Date.now()
    entry.duration = endTime - entry.timestamp
  }

  private getResponseBody(tabId: number, requestId: string): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(''), 2000)
      chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }, (result: any) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError || !result) {
          resolve('')
        } else {
          resolve(result.base64Encoded ? atob(result.body) : result.body || '')
        }
      })
    })
  }

  // --- Retrieval ---

  getConsoleLogs(tabId?: number): ConsoleEntry[] {
    if (tabId !== undefined) return this.consoleLogs.get(tabId) || []
    const all: ConsoleEntry[] = []
    for (const logs of this.consoleLogs.values()) all.push(...logs)
    return all.sort((a, b) => a.timestamp - b.timestamp)
  }

  getConsoleErrors(tabId?: number): ConsoleEntry[] {
    return this.getConsoleLogs(tabId).filter((e) => e.level === 'error' || e.level === 'warning')
  }

  getNetworkLogs(tabId?: number): NetworkEntry[] {
    const collect = (tid: number): NetworkEntry[] => {
      const map = this.networkRequests.get(tid)
      return map ? Array.from(map.values()) : []
    }

    if (tabId !== undefined) return collect(tabId).sort((a, b) => a.timestamp - b.timestamp)

    const all: NetworkEntry[] = []
    for (const tid of this.networkRequests.keys()) all.push(...collect(tid))
    return all.sort((a, b) => a.timestamp - b.timestamp)
  }

  getNetworkErrors(tabId?: number): NetworkEntry[] {
    return this.getNetworkLogs(tabId).filter((e) => e.failed || e.status >= 400)
  }

  getNetworkSuccesses(tabId?: number): NetworkEntry[] {
    return this.getNetworkLogs(tabId).filter((e) => !e.failed && e.status > 0 && e.status < 400)
  }

  wipeLogs(tabId?: number): void {
    if (tabId !== undefined) {
      this.consoleLogs.set(tabId, [])
      this.networkRequests.set(tabId, new Map())
    } else {
      for (const tid of this.monitoredTabs) {
        this.consoleLogs.set(tid, [])
        this.networkRequests.set(tid, new Map())
      }
    }
  }

  updateConfig(config: Partial<PageMonitorConfig>): void {
    Object.assign(this.config, config)
  }

  // --- Helpers ---

  private formatRemoteObject(obj: any): string {
    if (!obj) return 'undefined'
    if (obj.value !== undefined) return String(obj.value)
    if (obj.description) return obj.description
    if (obj.type === 'undefined') return 'undefined'
    if (obj.type === 'object' && obj.subtype === 'null') return 'null'
    if (obj.unserializableValue) return obj.unserializableValue
    if (obj.preview) {
      const props = obj.preview.properties || []
      const pairs = props.map((p: any) => `${p.name}: ${p.value ?? p.type}`).join(', ')
      return obj.preview.type === 'object' ? `{${pairs}}` : `[${pairs}]`
    }
    return obj.type || 'unknown'
  }

  private truncate(str: string): string {
    if (str.length <= this.config.stringSizeLimit) return str
    return str.slice(0, this.config.stringSizeLimit) + '... [truncated]'
  }
}
