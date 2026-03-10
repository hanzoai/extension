// Audit Runner — CDP-based page audits
// Accessibility, Performance, SEO, and Best Practices audits
// using Chrome DevTools Protocol. No Lighthouse/Puppeteer needed.

export interface AuditResult {
  score: number
  category: string
  timestamp: number
  url: string
  issues: AuditIssue[]
  metrics?: Record<string, any>
  summary: string
}

export interface AuditIssue {
  severity: 'critical' | 'serious' | 'moderate' | 'minor'
  message: string
  selector?: string
  recommendation?: string
}

function cdpCommand(tabId: number, method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(result)
      }
    })
  })
}

async function evaluate(tabId: number, expression: string): Promise<any> {
  const result = await cdpCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Evaluation failed')
  }
  return result?.result?.value
}

function scoreFromIssues(issues: AuditIssue[]): number {
  const critical = issues.filter((i) => i.severity === 'critical').length
  const serious = issues.filter((i) => i.severity === 'serious').length
  const moderate = issues.filter((i) => i.severity === 'moderate').length
  const minor = issues.filter((i) => i.severity === 'minor').length
  return Math.max(0, Math.round(100 - critical * 25 - serious * 15 - moderate * 5 - minor * 2))
}

// --- Accessibility ---

export async function runAccessibilityAudit(tabId: number): Promise<AuditResult> {
  const url = await evaluate(tabId, 'window.location.href')
  const issues: AuditIssue[] = []

  // Images without alt
  const imgIssues = await evaluate(
    tabId,
    `Array.from(document.querySelectorAll('img')).filter(i=>!i.alt&&!i.getAttribute('role')).map(i=>({src:i.src?.slice(0,80),sel:i.id?'#'+i.id:i.className?'.'+i.className.split(' ')[0]:'img'})).slice(0,10)`
  )
  for (const img of imgIssues || []) {
    issues.push({
      severity: 'serious',
      message: `Image missing alt text: ${img.src}`,
      selector: img.sel,
      recommendation: 'Add descriptive alt text',
    })
  }

  // Inputs without labels
  const inputIssues = await evaluate(
    tabId,
    `Array.from(document.querySelectorAll('input,select,textarea')).filter(el=>{if(el.type==='hidden'||el.type==='submit'||el.type==='button')return false;const id=el.id;return!id||!document.querySelector('label[for="'+id+'"]')&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.closest('label')}).map(el=>({type:el.type||el.tagName.toLowerCase(),name:el.name||'',sel:el.id?'#'+el.id:el.name?'[name='+el.name+']':el.tagName.toLowerCase()})).slice(0,10)`
  )
  for (const inp of inputIssues || []) {
    issues.push({
      severity: 'serious',
      message: `Form ${inp.type} "${inp.name}" missing label`,
      selector: inp.sel,
      recommendation: 'Add <label> or aria-label',
    })
  }

  // Landmarks
  const landmarks = await evaluate(
    tabId,
    `({main:!!document.querySelector('main,[role="main"]'),nav:!!document.querySelector('nav,[role="navigation"]')})`
  )
  if (landmarks && !landmarks.main)
    issues.push({ severity: 'moderate', message: 'Missing <main> landmark', recommendation: 'Wrap primary content in <main>' })
  if (landmarks && !landmarks.nav)
    issues.push({ severity: 'minor', message: 'Missing <nav> landmark', recommendation: 'Wrap navigation in <nav>' })

  // Heading hierarchy
  const headingIssues = await evaluate(
    tabId,
    `(()=>{const h=Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')),r=[];const h1=h.filter(e=>e.tagName==='H1');if(!h1.length)r.push('No h1');if(h1.length>1)r.push(h1.length+' h1 elements');let l=0;for(const e of h){const n=+e.tagName[1];if(n>l+1&&l>0)r.push('Skip: h'+l+' -> h'+n);l=n}return r})()`
  )
  for (const msg of headingIssues || []) {
    issues.push({ severity: 'moderate', message: msg, recommendation: 'Use sequential heading levels' })
  }

  // Empty interactive elements
  const emptyCount = await evaluate(
    tabId,
    `Array.from(document.querySelectorAll('button,a[href]')).filter(el=>!(el.textContent||'').trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('title')&&!el.querySelector('img[alt]')).length`
  )
  if (emptyCount > 0) {
    issues.push({
      severity: 'serious',
      message: `${emptyCount} interactive element(s) without accessible text`,
      recommendation: 'Add text, aria-label, or title',
    })
  }

  // Contrast sampling
  const lowContrast = await evaluate(
    tabId,
    `(()=>{function lum(r,g,b){const[rs,gs,bs]=[r,g,b].map(c=>{c=c/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)});return 0.2126*rs+0.7152*gs+0.0722*bs}function pc(c){const m=c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);return m?[+m[1],+m[2],+m[3]]:null}let n=0;for(const el of Array.from(document.querySelectorAll('p,span,a,li,td,th,label,h1,h2,h3,h4,h5,h6')).slice(0,40)){const s=getComputedStyle(el);const fg=pc(s.color),bg=pc(s.backgroundColor);if(fg&&bg&&bg[0]+bg[1]+bg[2]>0){const l1=lum(...fg),l2=lum(...bg);if((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)<4.5)n++}}return n})()`
  )
  if (lowContrast > 0) {
    issues.push({
      severity: 'serious',
      message: `${lowContrast} element(s) with insufficient contrast (< 4.5:1)`,
      recommendation: 'Increase text/background contrast ratio',
    })
  }

  // Positive tabindex
  const posTabindex = await evaluate(
    tabId,
    `Array.from(document.querySelectorAll('[tabindex]')).filter(e=>+e.getAttribute('tabindex')>0).length`
  )
  if (posTabindex > 0) {
    issues.push({
      severity: 'moderate',
      message: `${posTabindex} element(s) with positive tabindex`,
      recommendation: 'Use tabindex="0" or "-1" instead',
    })
  }

  // Lang attribute
  const hasLang = await evaluate(tabId, `!!document.documentElement.lang`)
  if (!hasLang) {
    issues.push({ severity: 'serious', message: 'Missing lang on <html>', recommendation: 'Add lang="en" to <html>' })
  }

  const score = scoreFromIssues(issues)
  return {
    score,
    category: 'accessibility',
    timestamp: Date.now(),
    url,
    issues,
    summary: `Accessibility: ${score}/100. ${issues.length} issue(s).`,
  }
}

// --- Performance ---

export async function runPerformanceAudit(tabId: number): Promise<AuditResult> {
  const url = await evaluate(tabId, 'window.location.href')
  const issues: AuditIssue[] = []

  await cdpCommand(tabId, 'Performance.enable')
  const metricsResult = await cdpCommand(tabId, 'Performance.getMetrics')
  const raw = metricsResult?.metrics || []
  const m: Record<string, number> = {}
  for (const x of raw) m[x.name] = x.value

  const timing = await evaluate(
    tabId,
    `(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{dcl:n.domContentLoadedEventEnd-n.startTime,load:n.loadEventEnd-n.startTime,ttfb:n.responseStart-n.requestStart,di:n.domInteractive-n.startTime}:null})()`
  )

  const paint = await evaluate(
    tabId,
    `(()=>{const r={};for(const e of performance.getEntriesByType('paint'))r[e.name]=e.startTime;return r})()`
  )

  const resources = await evaluate(
    tabId,
    `(()=>{const r=performance.getEntriesByType('resource');const bt={};let ts=0,tc=0;for(const x of r){const t=x.initiatorType||'other';if(!bt[t])bt[t]={count:0,size:0};bt[t].count++;bt[t].size+=x.transferSize||0;ts+=x.transferSize||0;tc++}return{byType:bt,totalSize:ts,totalRequests:tc}})()`
  )

  const lcp = await evaluate(
    tabId,
    `new Promise(r=>{const o=new PerformanceObserver(l=>{const e=l.getEntries();r(e.length?e[e.length-1].startTime:null);o.disconnect()});try{o.observe({type:'largest-contentful-paint',buffered:true});setTimeout(()=>{o.disconnect();r(null)},1000)}catch(e){r(null)}})`
  )

  const cls = await evaluate(
    tabId,
    `new Promise(r=>{let v=0;const o=new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)v+=e.value});try{o.observe({type:'layout-shift',buffered:true});setTimeout(()=>{o.disconnect();r(v)},500)}catch(e){r(null)}})`
  )

  const metrics: Record<string, any> = {
    fcp: paint?.['first-contentful-paint'] ? Math.round(paint['first-contentful-paint']) + 'ms' : 'N/A',
    lcp: lcp ? Math.round(lcp) + 'ms' : 'N/A',
    cls: cls !== null ? cls.toFixed(3) : 'N/A',
    ttfb: timing?.ttfb ? Math.round(timing.ttfb) + 'ms' : 'N/A',
    domContentLoaded: timing?.dcl ? Math.round(timing.dcl) + 'ms' : 'N/A',
    load: timing?.load ? Math.round(timing.load) + 'ms' : 'N/A',
    totalRequests: resources?.totalRequests || 0,
    totalSize: resources?.totalSize ? Math.round(resources.totalSize / 1024) + 'KB' : 'N/A',
    resourcesByType: resources?.byType || {},
    jsHeapSize: m.JSHeapUsedSize ? Math.round(m.JSHeapUsedSize / 1048576) + 'MB' : 'N/A',
    domNodes: m.Nodes || 'N/A',
    layoutCount: m.LayoutCount || 0,
  }

  // Threshold checks
  const fcp = paint?.['first-contentful-paint']
  if (fcp > 2500)
    issues.push({ severity: 'serious', message: `FCP: ${Math.round(fcp)}ms (> 2500ms)`, recommendation: 'Reduce render-blocking resources' })
  if (lcp && lcp > 2500)
    issues.push({ severity: 'serious', message: `LCP: ${Math.round(lcp)}ms (> 2500ms)`, recommendation: 'Optimize largest content element' })
  if (cls !== null && cls > 0.1)
    issues.push({ severity: 'serious', message: `CLS: ${cls.toFixed(3)} (> 0.1)`, recommendation: 'Set explicit dimensions on images/embeds' })
  if (timing?.ttfb > 800)
    issues.push({ severity: 'moderate', message: `TTFB: ${Math.round(timing.ttfb)}ms (> 800ms)`, recommendation: 'Optimize server response time' })
  if (resources?.totalRequests > 100)
    issues.push({ severity: 'moderate', message: `${resources.totalRequests} requests`, recommendation: 'Bundle resources, use HTTP/2' })
  if (resources?.totalSize > 3 * 1024 * 1024)
    issues.push({
      severity: 'moderate',
      message: `Page size ${Math.round(resources.totalSize / 1024)}KB`,
      recommendation: 'Compress images, minify JS/CSS',
    })
  if (m.Nodes > 1500)
    issues.push({ severity: 'moderate', message: `${m.Nodes} DOM nodes (> 1500)`, recommendation: 'Reduce DOM complexity' })

  const score = scoreFromIssues(issues)
  return {
    score,
    category: 'performance',
    timestamp: Date.now(),
    url,
    issues,
    metrics,
    summary: `Performance: ${score}/100. FCP: ${metrics.fcp}, LCP: ${metrics.lcp}, CLS: ${metrics.cls}.`,
  }
}

// --- SEO ---

export async function runSEOAudit(tabId: number): Promise<AuditResult> {
  const url = await evaluate(tabId, 'window.location.href')
  const issues: AuditIssue[] = []

  const d = await evaluate(
    tabId,
    `(()=>{const gm=n=>{const e=document.querySelector('meta[name="'+n+'"],meta[property="'+n+'"]');return e?e.getAttribute('content'):null};return{title:document.title,tl:document.title?.length||0,desc:gm('description'),dl:(gm('description')||'').length,canonical:document.querySelector('link[rel="canonical"]')?.href||null,viewport:gm('viewport'),ogTitle:gm('og:title'),ogDesc:gm('og:description'),ogImage:gm('og:image'),twCard:gm('twitter:card'),h1:document.querySelectorAll('h1').length,jsonld:document.querySelectorAll('script[type="application/ld+json"]').length,brokenImg:Array.from(document.querySelectorAll('img')).filter(i=>!i.complete||!i.naturalWidth).length}})()`
  )

  if (!d.title) issues.push({ severity: 'critical', message: 'Missing page title', recommendation: 'Add <title>' })
  else if (d.tl < 10) issues.push({ severity: 'moderate', message: `Title too short (${d.tl} chars)`, recommendation: '10-60 chars' })
  else if (d.tl > 60) issues.push({ severity: 'minor', message: `Title long (${d.tl} chars)`, recommendation: 'Under 60 chars' })

  if (!d.desc)
    issues.push({ severity: 'serious', message: 'Missing meta description', recommendation: 'Add meta description' })
  else if (d.dl < 50) issues.push({ severity: 'moderate', message: `Description short (${d.dl} chars)`, recommendation: '50-160 chars' })
  else if (d.dl > 160) issues.push({ severity: 'minor', message: `Description long (${d.dl} chars)`, recommendation: 'Under 160 chars' })

  if (!d.viewport) issues.push({ severity: 'serious', message: 'Missing viewport meta', recommendation: 'Add viewport meta tag' })
  if (!d.canonical) issues.push({ severity: 'moderate', message: 'Missing canonical URL', recommendation: 'Add rel="canonical"' })
  if (d.h1 === 0) issues.push({ severity: 'serious', message: 'No H1 heading', recommendation: 'Add one H1' })
  else if (d.h1 > 1) issues.push({ severity: 'moderate', message: `${d.h1} H1 elements`, recommendation: 'Use one H1' })

  if (!d.ogTitle) issues.push({ severity: 'moderate', message: 'Missing og:title', recommendation: 'Add Open Graph title' })
  if (!d.ogDesc) issues.push({ severity: 'moderate', message: 'Missing og:description', recommendation: 'Add OG description' })
  if (!d.ogImage) issues.push({ severity: 'moderate', message: 'Missing og:image', recommendation: 'Add OG image for sharing' })
  if (!d.twCard) issues.push({ severity: 'minor', message: 'Missing twitter:card', recommendation: 'Add Twitter Card tags' })
  if (!d.jsonld)
    issues.push({ severity: 'moderate', message: 'No structured data', recommendation: 'Add JSON-LD for rich results' })
  if (d.brokenImg > 0)
    issues.push({ severity: 'moderate', message: `${d.brokenImg} broken image(s)`, recommendation: 'Fix image URLs' })

  const score = scoreFromIssues(issues)
  return {
    score,
    category: 'seo',
    timestamp: Date.now(),
    url,
    issues,
    metrics: d,
    summary: `SEO: ${score}/100. ${issues.length} issue(s). Title: "${(d.title || '').slice(0, 50)}"`,
  }
}

// --- Best Practices ---

export async function runBestPracticesAudit(tabId: number): Promise<AuditResult> {
  const url = await evaluate(tabId, 'window.location.href')
  const issues: AuditIssue[] = []

  const d = await evaluate(
    tabId,
    `(()=>({https:location.protocol==='https:',doctype:document.doctype!==null,charset:!!document.querySelector('meta[charset],meta[http-equiv="Content-Type"]'),deprecated:(()=>{const d=[];for(const t of['applet','marquee','blink','font','center'])if(document.querySelector(t))d.push(t);return d})(),mixed:document.querySelectorAll('img[src^="http:"],script[src^="http:"],link[href^="http:"]').length,pwdHttp:location.protocol!=='https:'&&document.querySelectorAll('input[type="password"]').length>0,noopener:Array.from(document.querySelectorAll('a[target="_blank"]')).filter(a=>{const r=a.getAttribute('rel')||'';return!r.includes('noopener')&&!r.includes('noreferrer')}).length,imgLegacy:(()=>{let n=0;for(const i of document.querySelectorAll('img[src]'))if(i.src.match(/\\.(jpg|jpeg|png|gif|bmp)/i))n++;return n})()}))()`
  )

  if (!d.https) issues.push({ severity: 'critical', message: 'Not HTTPS', recommendation: 'Enable HTTPS' })
  if (!d.doctype) issues.push({ severity: 'moderate', message: 'Missing DOCTYPE', recommendation: 'Add <!DOCTYPE html>' })
  if (!d.charset) issues.push({ severity: 'moderate', message: 'No charset', recommendation: 'Add <meta charset="UTF-8">' })
  if (d.deprecated?.length)
    issues.push({
      severity: 'moderate',
      message: `Deprecated elements: ${d.deprecated.join(', ')}`,
      recommendation: 'Use modern alternatives',
    })
  if (d.mixed > 0)
    issues.push({ severity: 'serious', message: `${d.mixed} mixed content resource(s)`, recommendation: 'Use HTTPS for all' })
  if (d.pwdHttp)
    issues.push({ severity: 'critical', message: 'Password field on HTTP', recommendation: 'Serve login over HTTPS' })
  if (d.noopener > 0)
    issues.push({
      severity: 'moderate',
      message: `${d.noopener} link(s) missing rel="noopener"`,
      recommendation: 'Add rel="noopener noreferrer"',
    })
  if (d.imgLegacy > 5)
    issues.push({
      severity: 'minor',
      message: `${d.imgLegacy} legacy format images`,
      recommendation: 'Use WebP/AVIF for better compression',
    })

  const score = scoreFromIssues(issues)
  return {
    score,
    category: 'best-practices',
    timestamp: Date.now(),
    url,
    issues,
    metrics: d,
    summary: `Best Practices: ${score}/100. ${issues.length} issue(s).`,
  }
}

// --- Next.js Audit ---

export async function runNextJSAudit(tabId: number): Promise<AuditResult> {
  const url = await evaluate(tabId, 'window.location.href')
  const issues: AuditIssue[] = []

  // Detect Next.js
  const isNextJS = await evaluate(
    tabId,
    `!!(window.__NEXT_DATA__ || document.querySelector('script[src*="/_next/"]') || document.querySelector('script#__NEXT_DATA__'))`
  )

  if (!isNextJS) {
    return {
      score: -1,
      category: 'nextjs',
      timestamp: Date.now(),
      url,
      issues: [],
      summary: 'Not a Next.js application',
    }
  }

  // Next.js metadata
  const nextData = await evaluate(
    tabId,
    `(()=>{const nd=window.__NEXT_DATA__;if(!nd)return null;return{page:nd.page,buildId:nd.buildId,runtimeConfig:!!nd.runtimeConfig,locale:nd.locale,props:!!nd.props}})()`,
  )

  // Full meta tag check
  const meta = await evaluate(
    tabId,
    `(()=>{const gm=(n,a)=>{const s=a||'name';const e=document.querySelector('meta['+s+'="'+n+'"]');return e?e.getAttribute('content'):null};return{title:document.title,titleLen:document.title?.length||0,desc:gm('description'),descLen:(gm('description')||'').length,keywords:gm('keywords'),robots:gm('robots'),viewport:gm('viewport'),charset:!!document.querySelector('meta[charset]'),ogSiteName:gm('og:site_name','property'),ogLocale:gm('og:locale','property'),ogTitle:gm('og:title','property'),ogDesc:gm('og:description','property'),ogImage:gm('og:image','property'),ogUrl:gm('og:url','property'),ogType:gm('og:type','property'),twCard:gm('twitter:card'),twTitle:gm('twitter:title'),twDesc:gm('twitter:description'),twImage:gm('twitter:image'),canonical:document.querySelector('link[rel="canonical"]')?.href||null,jsonld:Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s=>{try{return JSON.parse(s.textContent)}catch{return null}}).filter(Boolean)}})()`
  )

  // Title
  if (!meta.title) issues.push({ severity: 'critical', message: 'Missing page title', recommendation: 'Add title via next/head or metadata API' })
  else if (meta.titleLen < 10) issues.push({ severity: 'moderate', message: `Title too short (${meta.titleLen} chars)`, recommendation: 'Use 10-60 characters' })
  else if (meta.titleLen > 60) issues.push({ severity: 'minor', message: `Title long (${meta.titleLen} chars)`, recommendation: 'Keep under 60 chars' })

  // Description
  if (!meta.desc) issues.push({ severity: 'serious', message: 'Missing meta description', recommendation: 'Add description via metadata API or next/head' })
  else if (meta.descLen < 50) issues.push({ severity: 'moderate', message: `Description short (${meta.descLen} chars)`, recommendation: '50-160 characters recommended' })
  else if (meta.descLen > 160) issues.push({ severity: 'minor', message: `Description long (${meta.descLen} chars)`, recommendation: 'Keep under 160 chars' })

  if (!meta.keywords) issues.push({ severity: 'minor', message: 'Missing meta keywords', recommendation: 'Add keywords meta tag' })
  if (!meta.robots) issues.push({ severity: 'moderate', message: 'Missing robots meta', recommendation: 'Add robots meta tag (index, follow)' })
  if (!meta.viewport) issues.push({ severity: 'serious', message: 'Missing viewport meta', recommendation: 'Add viewport meta tag' })
  if (!meta.charset) issues.push({ severity: 'moderate', message: 'Missing charset', recommendation: 'Add <meta charset="UTF-8">' })

  // Open Graph
  if (!meta.ogTitle) issues.push({ severity: 'moderate', message: 'Missing og:title', recommendation: 'Add Open Graph title' })
  if (!meta.ogDesc) issues.push({ severity: 'moderate', message: 'Missing og:description', recommendation: 'Add OG description' })
  if (!meta.ogImage) issues.push({ severity: 'moderate', message: 'Missing og:image', recommendation: 'Add OG image (1200x630 recommended)' })
  if (!meta.ogUrl) issues.push({ severity: 'minor', message: 'Missing og:url', recommendation: 'Add og:url for canonical sharing URL' })
  if (!meta.ogType) issues.push({ severity: 'minor', message: 'Missing og:type', recommendation: 'Add og:type (website, article, etc.)' })
  if (!meta.ogSiteName) issues.push({ severity: 'minor', message: 'Missing og:site_name', recommendation: 'Add site name for branding' })
  if (!meta.ogLocale) issues.push({ severity: 'minor', message: 'Missing og:locale', recommendation: 'Add og:locale (e.g., en_US)' })

  // Twitter Card
  if (!meta.twCard) issues.push({ severity: 'moderate', message: 'Missing twitter:card', recommendation: 'Add twitter:card (summary_large_image)' })
  if (!meta.twTitle) issues.push({ severity: 'minor', message: 'Missing twitter:title', recommendation: 'Add twitter:title' })
  if (!meta.twDesc) issues.push({ severity: 'minor', message: 'Missing twitter:description', recommendation: 'Add twitter:description' })
  if (!meta.twImage) issues.push({ severity: 'minor', message: 'Missing twitter:image', recommendation: 'Add twitter:image' })

  // Canonical
  if (!meta.canonical) issues.push({ severity: 'moderate', message: 'Missing canonical URL', recommendation: 'Add <link rel="canonical"> or use metadata API' })

  // JSON-LD
  if (!meta.jsonld || !meta.jsonld.length) {
    issues.push({ severity: 'moderate', message: 'No JSON-LD structured data', recommendation: 'Add structured data for rich search results' })
  }

  // Sitemap check (try /sitemap.xml)
  const origin = await evaluate(tabId, 'window.location.origin')
  let hasSitemap = false
  let hasRobots = false
  try {
    const sitemapResp = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(3000) })
    hasSitemap = sitemapResp.ok && (sitemapResp.headers.get('content-type') || '').includes('xml')
  } catch { /* unreachable from extension */ }
  if (!hasSitemap) {
    // Check via page eval
    hasSitemap = await evaluate(tabId,
      `fetch('/sitemap.xml',{method:'HEAD'}).then(r=>r.ok).catch(()=>false)`
    ).catch(() => false)
  }
  if (!hasSitemap) issues.push({ severity: 'moderate', message: 'No sitemap.xml found', recommendation: 'Generate sitemap via next-sitemap or metadata API' })

  try {
    hasRobots = await evaluate(tabId,
      `fetch('/robots.txt',{method:'HEAD'}).then(r=>r.ok).catch(()=>false)`
    ).catch(() => false)
  } catch { /* */ }
  if (!hasRobots) issues.push({ severity: 'moderate', message: 'No robots.txt found', recommendation: 'Add robots.txt in public/ directory' })

  const score = scoreFromIssues(issues)
  return {
    score,
    category: 'nextjs',
    timestamp: Date.now(),
    url,
    issues,
    metrics: {
      ...meta,
      nextData,
      hasSitemap,
      hasRobots,
    },
    summary: `Next.js SEO: ${score}/100. ${issues.length} issue(s). Page: ${nextData?.page || 'unknown'}`,
  }
}

// --- Debugger Mode ---

export interface DebugReport {
  possibleSources: string[]
  consoleErrors: { level: string; text: string; url?: string }[]
  networkErrors: { url: string; status: number; method: string; error?: string }[]
  performanceIssues: string[]
  recommendations: string[]
  timestamp: number
  pageUrl: string
}

export async function runDebuggerMode(tabId: number): Promise<DebugReport> {
  const pageUrl = await evaluate(tabId, 'window.location.href')

  // Collect console errors via Runtime
  const consoleErrors: DebugReport['consoleErrors'] = []
  const jsErrors = await evaluate(
    tabId,
    `(()=>{const e=[];const orig=console.error;return e})()` // Can't retroactively get console - use page error events
  )
  // Check for JS errors via error event and page errors
  const pageErrors = await evaluate(
    tabId,
    `(()=>{const r=[];for(const e of performance.getEntriesByType('resource'))if(e.transferSize===0&&e.duration>0)r.push({url:e.name.slice(0,200),type:'failed-resource'});return r.slice(0,20)})()`
  )

  // Check for uncaught errors
  const errorElements = await evaluate(
    tabId,
    `(()=>{const errors=[];const ow=document.querySelector('#__next-error,#__next-error-overlay,.nextjs-container-errors-header,[data-nextjs-error]');if(ow)errors.push({level:'error',text:'Next.js error overlay detected'});const re=document.querySelector('[class*="error"],[class*="Error"],[id*="error"]');if(re&&re.textContent)errors.push({level:'error',text:re.textContent.slice(0,200)});return errors})()`
  )
  consoleErrors.push(...(errorElements || []))

  // Network errors - check for failed resources
  const networkErrors: DebugReport['networkErrors'] = []
  const failedResources = await evaluate(
    tabId,
    `(()=>{const r=[];for(const e of performance.getEntriesByType('resource')){if(e.responseStatus&&e.responseStatus>=400)r.push({url:e.name.slice(0,200),status:e.responseStatus,method:'GET'})}return r.slice(0,20)})()`
  )
  networkErrors.push(...(failedResources || []))

  // Failed fetch requests visible in page
  for (const pe of pageErrors || []) {
    if (pe.type === 'failed-resource') {
      networkErrors.push({ url: pe.url, status: 0, method: 'GET', error: 'Transfer failed' })
    }
  }

  // Performance issues
  const performanceIssues: string[] = []
  const perfData = await evaluate(
    tabId,
    `(()=>{const n=performance.getEntriesByType('navigation')[0];const r={};if(n){if(n.domContentLoadedEventEnd-n.startTime>3000)r.slowDCL=Math.round(n.domContentLoadedEventEnd-n.startTime)+'ms';if(n.loadEventEnd-n.startTime>5000)r.slowLoad=Math.round(n.loadEventEnd-n.startTime)+'ms';if(n.responseStart-n.requestStart>800)r.slowTTFB=Math.round(n.responseStart-n.requestStart)+'ms'}const res=performance.getEntriesByType('resource');const slow=res.filter(e=>e.duration>2000).length;if(slow>0)r.slowResources=slow;const large=res.filter(e=>e.transferSize>500000).length;if(large>0)r.largeResources=large;r.totalResources=res.length;r.domNodes=document.querySelectorAll('*').length;return r})()`
  )
  if (perfData?.slowDCL) performanceIssues.push(`Slow DOM Content Loaded: ${perfData.slowDCL}`)
  if (perfData?.slowLoad) performanceIssues.push(`Slow page load: ${perfData.slowLoad}`)
  if (perfData?.slowTTFB) performanceIssues.push(`Slow TTFB: ${perfData.slowTTFB}`)
  if (perfData?.slowResources) performanceIssues.push(`${perfData.slowResources} resources took > 2s to load`)
  if (perfData?.largeResources) performanceIssues.push(`${perfData.largeResources} resources > 500KB`)
  if (perfData?.domNodes > 2000) performanceIssues.push(`Large DOM: ${perfData.domNodes} nodes`)

  // Build possible sources based on collected data
  const possibleSources: string[] = []
  if (consoleErrors.length) possibleSources.push(`JavaScript errors detected (${consoleErrors.length} found)`)
  if (networkErrors.length) possibleSources.push(`Failed network requests (${networkErrors.length} found)`)
  if (performanceIssues.length) possibleSources.push(`Performance bottlenecks (${performanceIssues.length} found)`)

  // Check for common issues
  const commonIssues = await evaluate(
    tabId,
    `(()=>{const r=[];if(!document.doctype)r.push('Missing DOCTYPE');if(!document.querySelector('meta[charset]'))r.push('Missing charset');if(document.querySelectorAll('script:not([async]):not([defer]):not([type="module"])[src]').length>2)r.push('Multiple render-blocking scripts');if(document.querySelectorAll('link[rel="stylesheet"]').length>5)r.push('Many external stylesheets ('+document.querySelectorAll('link[rel="stylesheet"]').length+')');const mixed=document.querySelectorAll('img[src^="http:"],script[src^="http:"]').length;if(mixed>0)r.push('Mixed content ('+mixed+' HTTP resources on HTTPS)');if(!document.querySelector('meta[name="viewport"]'))r.push('Missing viewport meta tag');return r})()`
  )
  possibleSources.push(...(commonIssues || []))

  // Pad to at least 5 suggestions
  const generic = [
    'Check browser console for runtime errors',
    'Inspect network tab for failed API calls',
    'Look for CORS issues in cross-origin requests',
    'Check for unhandled promise rejections',
    'Verify API endpoints return expected data',
    'Check for CSS layout issues causing visual bugs',
    'Look for event listener conflicts or race conditions',
  ]
  while (possibleSources.length < 5) {
    possibleSources.push(generic[possibleSources.length] || 'Review application logs')
  }

  // Recommendations
  const recommendations: string[] = []
  if (consoleErrors.length) recommendations.push('Fix JavaScript errors first — they often cascade into other failures')
  if (networkErrors.length) recommendations.push('Investigate failed network requests — check API endpoints, CORS config, and auth tokens')
  if (performanceIssues.length) recommendations.push('Address performance issues — slow loads compound debugging difficulty')
  recommendations.push('Add targeted console.log statements near suspected problem areas')
  recommendations.push('Use browser DevTools Network tab to trace request/response cycles')
  if (networkErrors.some(e => e.status === 401 || e.status === 403)) {
    recommendations.push('Auth errors detected — verify tokens and session state')
  }
  if (networkErrors.some(e => e.status >= 500)) {
    recommendations.push('Server errors detected — check server logs for stack traces')
  }

  return {
    possibleSources: possibleSources.slice(0, 7),
    consoleErrors,
    networkErrors,
    performanceIssues,
    recommendations,
    timestamp: Date.now(),
    pageUrl,
  }
}

// --- Full Audit ---

export async function runFullAudit(
  tabId: number
): Promise<{ overall: number; audits: AuditResult[]; summary: string }> {
  const [a11y, perf, seo, bp] = await Promise.all([
    runAccessibilityAudit(tabId),
    runPerformanceAudit(tabId),
    runSEOAudit(tabId),
    runBestPracticesAudit(tabId),
  ])

  const audits = [a11y, perf, seo, bp]
  let scoreSum = a11y.score + perf.score + seo.score + bp.score
  let count = 4

  // Include Next.js audit if applicable
  try {
    const nextjs = await runNextJSAudit(tabId)
    if (nextjs.score >= 0) {
      audits.push(nextjs)
      scoreSum += nextjs.score
      count++
    }
  } catch {
    // Not a Next.js app or audit failed
  }

  const overall = Math.round(scoreSum / count)
  return {
    overall,
    audits,
    summary: audits.map(a => `${a.category}: ${a.score}`).join(' | ') + ` | Overall: ${overall}/100`,
  }
}
