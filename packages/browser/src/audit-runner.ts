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

  const overall = Math.round((a11y.score + perf.score + seo.score + bp.score) / 4)
  return {
    overall,
    audits: [a11y, perf, seo, bp],
    summary: `Overall: ${overall}/100 | A11y: ${a11y.score} | Perf: ${perf.score} | SEO: ${seo.score} | Best Practices: ${bp.score}`,
  }
}
