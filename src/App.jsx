import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY      = 'pricer-v1-items'
const ANTHROPIC_STORE  = 'pricer-v1-apikey'
const SERPER_STORE     = 'pricer-v1-serperkey'
const CLAUDE_MODEL     = 'claude-sonnet-4-20250514'

const IVA_RATES = [
  { value: 0,  label: '0% — Exento',        color: '#7a7570', desc: 'Productos exentos' },
  { value: 4,  label: '4% — Superreducido',  color: '#5b9cf6', desc: 'Alimentos básicos, libros, medicamentos' },
  { value: 10, label: '10% — Reducido',       color: '#4caf82', desc: 'Alimentos, hostelería, agua, transporte' },
  { value: 21, label: '21% — General',        color: '#e8b84b', desc: 'Bebidas alcohólicas, tabaco, resto' },
]

const IVA_CATEGORIES = {
  'Refrescos':10,'Soft Drinks':10,'Agua':10,'Water':10,
  'Cerveza':21,'Beer':21,'Spirits':21,'Bebidas Espirituosas':21,
  'Vino':21,'Wine':21,'Cava':21,'Champagne':21,
  'Alimentación':10,'Food':10,'Snacks':10,'Tapas':10,
  'Tabaco':21,'Tobacco':21,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt         = (n) => `€${parseFloat(n||0).toFixed(2)}`
const fmtIva      = (r) => IVA_RATES.find(x => x.value === r) || IVA_RATES[3]
const withIva     = (p, r) => p * (1 + r/100)
const guessIva    = (cat) => { for (const [k,v] of Object.entries(IVA_CATEGORIES)) { if (cat?.toLowerCase().includes(k.toLowerCase())) return v } return 21 }
const groupBy     = (arr, key) => arr.reduce((a,i) => { const k=i[key]||'Sin categoría'; if(!a[k])a[k]=[]; a[k].push(i); return a }, {})

async function fileToBase64(file) {
  return new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file) })
}

async function callClaude(apiKey, messages, system='') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true' },
    body: JSON.stringify({ model:CLAUDE_MODEL, max_tokens:2000, system, messages })
  })
  if (!r.ok) { const e=await r.json().catch(()=>{}); throw new Error(e?.error?.message||`Error ${r.status}`) }
  const d = await r.json()
  return d.content?.map(b=>b.text||'').join('')||''
}

async function serperSearch(serperKey, query) {
  const r = await fetch('https://google.serper.dev/search', {
    method:'POST',
    headers:{ 'Content-Type':'application/json','X-API-KEY':serperKey },
    body: JSON.stringify({ q: query, gl:'es', hl:'es', num:10 })
  })
  if (!r.ok) throw new Error(`Serper error ${r.status}`)
  return r.json()
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [items,       setItems]       = useState([])
  const [tab,         setTab]         = useState('list')
  const [search,      setSearch]      = useState('')
  const [showIva,     setShowIva]     = useState(false)
  const [apiKey,      setApiKey]      = useState('')
  const [serperKey,   setSerperKey]   = useState('')
  const [showSettings,setShowSettings]= useState(false)
  const [settingsForm,setSettingsForm]= useState({ anthropic:'', serper:'' })

  // Scan
  const [scanning,    setScanning]    = useState(false)
  const [scanResult,  setScanResult]  = useState(null)
  const [scanError,   setScanError]   = useState(null)
  const scanCamRef    = useRef()
  const scanGalleryRef= useRef()

  // Compare
  const [comparing,   setComparing]   = useState(false)
  const [compareResult,setCompareResult]=useState(null)
  const [compareError,setCompareError]= useState(null)
  const cmpCamRef     = useRef()
  const cmpGalleryRef = useRef()

  // Ask
  const [chat,        setChat]        = useState([])
  const [chatInput,   setChatInput]   = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef    = useRef()

  // Add/Edit modal
  const [modal,       setModal]       = useState(null)
  const [editTarget,  setEditTarget]  = useState(null)
  const [form,        setForm]        = useState({ name:'',price:'',category:'',supplier:'',unit:'',iva:21 })

  // Market lookup
  const [marketItem,  setMarketItem]  = useState(null)   // item being looked up
  const [marketData,  setMarketData]  = useState(null)   // parsed results
  const [marketLoading,setMarketLoading]=useState(false)
  const [marketError, setMarketError] = useState(null)
  const [detailItem,  setDetailItem]  = useState(null)   // slide-up sheet item

  // ── Persist ──
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY); if (s) setItems(JSON.parse(s))
      const a = localStorage.getItem(ANTHROPIC_STORE); if (a) setApiKey(a)
      const p = localStorage.getItem(SERPER_STORE);    if (p) setSerperKey(p)
    } catch {}
  }, [])

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch {} }, [items])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [chat])

  // Keep a ref in sync so callbacks always see latest key
  const apiKeyRef = useRef(apiKey)
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])
  const serperKeyRef = useRef(serperKey)
  useEffect(() => { serperKeyRef.current = serperKey }, [serperKey])

  const requireApiKey = () => { if (!apiKeyRef.current) { setShowSettings(true); return false } return true }

  const saveSettings = () => {
    const a = settingsForm.anthropic.trim(), p = settingsForm.serper.trim()
    if (a) { 
      setApiKey(a)
      apiKeyRef.current = a
      localStorage.setItem(ANTHROPIC_STORE, a) 
    }
    if (p) { 
      setSerperKey(p)
      serperKeyRef.current = p
      localStorage.setItem(SERPER_STORE, p) 
    }
    setShowSettings(false)
    setSettingsForm({ anthropic:'', serper:'' })
  }

  // ── Items CRUD ──
  const upsertItems = (newItems) => {
    setItems(prev => {
      const merged = [...prev]
      for (const ni of newItems) {
        const idx = merged.findIndex(x => x.name.toLowerCase().replace(/\s+/g,'') === ni.name.toLowerCase().replace(/\s+/g,''))
        if (idx>=0) merged[idx] = { ...merged[idx], ...ni, id:merged[idx].id }
        else merged.push({ ...ni, id:`${Date.now()}-${Math.random()}`, addedAt:new Date().toISOString() })
      }
      return merged
    })
  }

  const deleteItem = (id) => setItems(prev => prev.filter(i => i.id !== id))

  const openAdd = () => { setEditTarget(null); setForm({ name:'',price:'',category:'',supplier:'',unit:'',iva:21 }); setModal('add') }
  const openEdit = (item) => { setEditTarget(item); setForm({ name:item.name, price:item.price, category:item.category||'', supplier:item.supplier||'', unit:item.unit||'', iva:item.iva??21 }); setModal('edit') }

  const saveForm = () => {
    if (!form.name || !form.price) return
    const item = { ...form, price:parseFloat(form.price), iva:parseInt(form.iva) }
    if (modal==='edit' && editTarget) setItems(prev => prev.map(i => i.id===editTarget.id ? { ...i,...item } : i))
    else setItems(prev => [...prev, { ...item, id:`${Date.now()}`, addedAt:new Date().toISOString() }])
    setModal(null)
  }

  // ── Scan ──
  const handleScan = useCallback(async (file) => {
    if (!requireApiKey()) return
    setScanning(true); setScanResult(null); setScanError(null)
    try {
      const b64 = await fileToBase64(file)
      const prompt = `You are an expert in Spanish tax law (IVA). Analyse this supplier invoice carefully.

Extract every line item. For each product determine the correct Spanish IVA rate by checking:
1. Any IVA % printed next to the item on the invoice (most reliable)
2. Tax columns showing base imponible / cuota IVA
3. Product type using Spanish IVA rules:
   - 21% General: alcohol (beer/wine/spirits/cava), tobacco, electronics, cleaning products
   - 10% Reducido: soft drinks, water, juices, food/restaurant supplies, packaging, hosteleria
   - 4% Superreducido: bread, flour, milk, eggs, fruit, vegetables, legumes, books, medicines
   - 0%: exempt products

A single invoice CAN have items at different IVA rates - assign each item individually.
If prices shown include IVA set priceIncludesIva true, if NET/base imponible set false.

Return ONLY a valid JSON array, no markdown, no explanation, no code fences.
Each object: name (string), price (number), priceIncludesIva (boolean), category (string), supplier (string from invoice header), unit (string e.g. caja/24 botella barril kg unidad), iva (number - exactly 0 4 10 or 21).`

      const text = await callClaude(apiKeyRef.current, [{
        role:'user', content:[
          { type:'image', source:{ type:'base64', media_type:file.type||'image/jpeg', data:b64 } },
          { type:'text', text:prompt }
        ]
      }])
      setScanResult(JSON.parse(text.replace(/```json|```/g,'').trim()))
    } catch(e) { setScanError(e.message||'No se pudo leer la factura. Comprueba tu API key en Ajustes.') }
    setScanning(false)
  }, [])

  const acceptScan = () => {
    if (!scanResult) return
    upsertItems(scanResult.map(i => ({ ...i, price: i.priceIncludesIva ? i.price/(1+(i.iva||21)/100) : i.price, iva: i.iva??guessIva(i.category) })))
    setScanResult(null); setTab('list')
  }

  // ── Compare ──
  const handleCompare = useCallback(async (file) => {
    if (!requireApiKey()) return
    setComparing(true); setCompareResult(null); setCompareError(null)
    try {
      const b64 = await fileToBase64(file)
      const text = await callClaude(apiKeyRef.current, [{
        role:'user', content:[
          { type:'image', source:{ type:'base64', media_type:file.type||'image/jpeg', data:b64 } },
          { type:'text', text:`Extract all products and prices from this price offer. Return ONLY a valid JSON array, no markdown. Each object: name (string), price (number), priceIncludesIva (boolean), unit (string), supplier (string), iva (number: 0/4/10/21).` }
        ]
      }])
      const offerItems = JSON.parse(text.replace(/```json|```/g,'').trim())
      const results = offerItems.map(offer => {
        const offerNet = offer.priceIncludesIva ? offer.price/(1+(offer.iva||21)/100) : offer.price
        const offerWords = offer.name.toLowerCase().split(/\s+/)
        const match = items.find(i => { const iw=i.name.toLowerCase().split(/\s+/); return offerWords.filter(w=>w.length>2&&iw.some(x=>x.includes(w)||w.includes(x))).length >= Math.min(2,offerWords.length) })
        const diff = match ? offerNet - parseFloat(match.price) : null
        return { offerName:offer.name, offerNet, offerUnit:offer.unit, offerSupplier:offer.supplier, offerIva:offer.iva||21,
          myPrice:match?parseFloat(match.price):null, myName:match?.name||null, myIva:match?.iva??21,
          diff, status:!match?'new':diff<-0.005?'cheaper':diff>0.005?'dearer':'same' }
      })
      setCompareResult(results)
    } catch(e) { setCompareError(e.message||'No se pudo comparar.') }
    setComparing(false)
  }, [apiKey, items])

  // ── Ask ──
  const handleAsk = async () => {
    if (!chatInput.trim()||chatLoading||!requireApiKey()) return
    const q = chatInput.trim(); setChatInput('')
    const newChat = [...chat, { role:'user', text:q }]; setChat(newChat); setChatLoading(true)
    const priceList = items.length>0 ? items.map(i=>`${i.name} | sin IVA: ${fmt(i.price)} | con IVA(${i.iva??21}%): ${fmt(withIva(i.price,i.iva??21))} | ${i.unit||''} | ${i.supplier||''} | ${i.category||''}`).join('\n') : 'Sin productos.'
    try {
      const answer = await callClaude(apiKeyRef.current, [{ role:'user', content:q }],
        `Eres un asistente para un negocio en España. El usuario consulta precios de proveedores.\nLista actual:\n${priceList}\nMuestra siempre sin IVA y con IVA. Responde en español, de forma concisa.`)
      setChat([...newChat, { role:'ai', text:answer }])
    } catch(e) { setChat([...newChat, { role:'ai', text:`Error: ${e.message}` }]) }
    setChatLoading(false)
  }

  // ── Market Lookup ──
  const openDetail = (item) => {
    setDetailItem(item)
    setMarketData(null)
    setMarketError(null)
    setMarketLoading(false)
  }

  const runMarketLookup = async () => {
    if (!detailItem) return
    if (!requireApiKey()) return
    if (!serperKey) { setShowSettings(true); return }

    setMarketLoading(true); setMarketData(null); setMarketError(null)
    try {
      // Build search queries
      const productName = detailItem.name
      const queries = [
        `comprar "${productName}" precio proveedor hostelería España`,
        `"${productName}" precio mayorista distribuidor España`,
      ]

      // Run both searches in parallel
      const [res1, res2] = await Promise.all(queries.map(q => serperSearch(serperKey, q)))

      // Combine organic results
      const allResults = [
        ...(res1.organic||[]),
        ...(res2.organic||[]),
        ...(res1.shopping||[]),
        ...(res2.shopping||[]),
      ].slice(0, 20)

      const resultsText = allResults.map((r,i) =>
        `[${i+1}] ${r.title||''}\n${r.snippet||r.description||''}\nURL: ${r.link||r.source||''}\nPrecio: ${r.price||'no especificado'}`
      ).join('\n\n')

      const myPrice = parseFloat(detailItem.price)
      const myIva   = detailItem.iva ?? 21
      const myGross = withIva(myPrice, myIva)

      const analysis = await callClaude(apiKey, [{
        role:'user',
        content: `I run a bar/restaurant in Spain and I currently pay ${fmt(myPrice)} sin IVA (${fmt(myGross)} con IVA ${myIva}%) for "${productName}" (${detailItem.unit||'unidad'}) from ${detailItem.supplier||'mi proveedor actual'}.

Here are web search results for this product from Spanish suppliers:

${resultsText}

Based on these results, return ONLY a valid JSON object (no markdown) with this structure:
{
  "suppliers": [
    {
      "name": "Supplier name",
      "priceNet": number or null,
      "priceGross": number or null,
      "iva": number,
      "unit": "unit description",
      "difference": number or null (vs my net price, negative = cheaper),
      "differencePercent": number or null,
      "minOrder": "minimum order requirement or null",
      "deliveryTime": "delivery time description or null",
      "deliveryZones": "coverage areas or null",
      "website": "URL or null",
      "notes": "any important notes, conditions, or caveats",
      "confidence": "high|medium|low"
    }
  ],
  "summary": "2-3 sentence summary of findings in Spanish",
  "bestDeal": "supplier name with best price or null",
  "dataQuality": "high|medium|low",
  "searchDate": "${new Date().toLocaleDateString('es-ES')}"
}

Only include suppliers where you found actual pricing evidence. If no clear prices found for a supplier, still include them if they seem relevant but set priceNet to null. Focus on suppliers that deliver to Spain. Be honest about confidence levels.`
      }])

      const parsed = JSON.parse(analysis.replace(/```json|```/g,'').trim())
      setMarketData(parsed)
    } catch(e) {
      setMarketError(e.message||'Error buscando precios de mercado.')
    }
    setMarketLoading(false)
  }

  // ── Derived ──
  const filtered = items.filter(i => !search || [i.name,i.category,i.supplier].some(f=>f?.toLowerCase().includes(search.toLowerCase())))
  const grouped  = groupBy(filtered, 'category')

  const tabs = [
    { id:'list',    icon:'▤', label:'Lista'    },
    { id:'scan',    icon:'⊡', label:'Escanear' },
    { id:'compare', icon:'⇄', label:'Comparar' },
    { id:'ask',     icon:'◎', label:'Consultar'},
  ]

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <span className="logo">PRICER</span>
          <span className="logo-sub">España · IVA</span>
        </div>
        <div className="header-right">
          <button className={`iva-toggle ${showIva?'active':''}`} onClick={()=>setShowIva(v=>!v)}>
            {showIva ? 'Con IVA' : 'Sin IVA'}
          </button>
          <button className="icon-btn" onClick={()=>{ setSettingsForm({ anthropic:'', serper:'' }); setShowSettings(true) }}>⚙</button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav className="tabbar">
        {tabs.map(t => (
          <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="body">

        {/* ═══ LIST ═══ */}
        {tab==='list' && (
          <div className="tab-content">
            <div className="search-row">
              <input className="search" placeholder="Buscar producto, categoría, proveedor…" value={search} onChange={e=>setSearch(e.target.value)} />
              <button className="btn-primary" onClick={openAdd}>＋</button>
            </div>

            {items.length===0 ? (
              <div className="empty">
                <div className="empty-icon">◈</div>
                <p>Sin productos todavía</p>
                <p className="empty-sub">Escanea una factura o añade manualmente</p>
              </div>
            ) : filtered.length===0 ? (
              <div className="empty"><p>Sin resultados para "{search}"</p></div>
            ) : (
              Object.entries(grouped).map(([cat, catItems]) => (
                <div key={cat} className="category-group">
                  <div className="category-header">
                    <span>{cat}</span>
                    <span className="category-count">{catItems.length}</span>
                  </div>
                  {catItems.map(item => {
                    const rate = item.iva??21
                    const net  = parseFloat(item.price)
                    const gross= withIva(net, rate)
                    const disp = showIva ? gross : net
                    const ivaInfo = fmtIva(rate)
                    return (
                      <div key={item.id} className="item-card" onClick={()=>openDetail(item)}>
                        <div className="item-main">
                          <div className="item-info">
                            <div className="item-name">{item.name}</div>
                            <div className="item-meta">
                              {item.unit && <span>{item.unit}</span>}
                              {item.supplier && <span className="supplier-badge">{item.supplier}</span>}
                            </div>
                            <div className="item-iva-badge" style={{color:ivaInfo.color}}>IVA {rate}%</div>
                          </div>
                          <div className="item-price-col">
                            <div className="item-price">{fmt(disp)}</div>
                            <div className="item-price-sub">{showIva ? `sin IVA ${fmt(net)}` : `con IVA ${fmt(gross)}`}</div>
                            <div className="item-actions" onClick={e=>e.stopPropagation()}>
                              <button className="btn-market" onClick={()=>openDetail(item)}>🌐 Mercado</button>
                              <button className="btn-edit"   onClick={()=>openEdit(item)}>Editar</button>
                              <button className="btn-delete" onClick={()=>deleteItem(item.id)}>✕</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
            {items.length>0 && (
              <div className="list-footer">
                <span>{items.length} productos</span>
                <span>{Object.keys(grouped).length} categorías</span>
              </div>
            )}
          </div>
        )}

        {/* ═══ SCAN ═══ */}
        {tab==='scan' && (
          <div className="tab-content">
            <div className="section-title">Escanear Factura</div>
            <p className="section-desc">Fotografía una factura o lista de precios. La IA extrae todos los productos con IVA correcto.</p>
            <input ref={scanCamRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>e.target.files?.[0]&&handleScan(e.target.files[0])} />
            <input ref={scanGalleryRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>e.target.files?.[0]&&handleScan(e.target.files[0])} />
            <div className="camera-actions">
              <button className="btn-camera" onClick={()=>scanCamRef.current?.click()} disabled={scanning}>
                <span className="camera-icon">📷</span>
                <span className="camera-label">Abrir Cámara</span>
                <span className="camera-sub">Fotografía la factura</span>
              </button>
              <button className="btn-gallery" onClick={()=>scanGalleryRef.current?.click()} disabled={scanning}>🖼 Elegir de la Galería</button>
            </div>
            {scanning && <div className="loading-card"><div className="spinner"/>Leyendo factura con IA…</div>}
            {scanError && <div className="error-card">{scanError}</div>}
            {scanResult && !scanError && (
              <div className="results-section">
                <div className="results-header"><span className="section-title">Productos encontrados ({scanResult.length})</span></div>
                {scanResult.map((item,i) => {
                  const net  = item.priceIncludesIva ? item.price/(1+(item.iva||21)/100) : item.price
                  const gross= withIva(net, item.iva||21)
                  const ivaInfo = fmtIva(item.iva||21)
                  return (
                    <div key={i} className="scan-item">
                      <div className="scan-item-left">
                        <div className="item-name">{item.name}</div>
                        <div className="item-meta">
                          {item.unit && <span>{item.unit}</span>}
                          {item.supplier && <span className="supplier-badge">{item.supplier}</span>}
                          <span className="iva-badge" style={{color:ivaInfo.color}}>IVA {item.iva||21}%</span>
                        </div>
                      </div>
                      <div className="scan-item-prices">
                        <div className="price-row"><span className="price-label">sin IVA</span><span className="price-val">{fmt(net)}</span></div>
                        <div className="price-row"><span className="price-label">con IVA</span><span className="price-val accent">{fmt(gross)}</span></div>
                      </div>
                    </div>
                  )
                })}
                <div className="scan-actions">
                  <button className="btn-primary full" onClick={acceptScan}>✓ Añadir todos a la lista</button>
                  <button className="btn-ghost full" onClick={()=>setScanResult(null)}>Descartar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ COMPARE ═══ */}
        {tab==='compare' && (
          <div className="tab-content">
            <div className="section-title">Comparar Oferta</div>
            <p className="section-desc">Fotografía una oferta de proveedor. Comparamos contra tus precios actuales sin guardar nada.</p>
            <input ref={cmpCamRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>e.target.files?.[0]&&handleCompare(e.target.files[0])} />
            <input ref={cmpGalleryRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>e.target.files?.[0]&&handleCompare(e.target.files[0])} />
            <div className="camera-actions">
              <button className="btn-camera outline" onClick={()=>cmpCamRef.current?.click()} disabled={comparing}>
                <span className="camera-icon">🔎</span>
                <span className="camera-label">Abrir Cámara</span>
                <span className="camera-sub">No guarda nada</span>
              </button>
              <button className="btn-gallery" onClick={()=>cmpGalleryRef.current?.click()} disabled={comparing}>🖼 Elegir de la Galería</button>
            </div>
            {comparing && <div className="loading-card"><div className="spinner"/>Comparando precios…</div>}
            {compareError && <div className="error-card">{compareError}</div>}
            {compareResult && !compareError && (() => {
              const cheaper = compareResult.filter(r=>r.status==='cheaper')
              const dearer  = compareResult.filter(r=>r.status==='dearer')
              const same    = compareResult.filter(r=>r.status==='same')
              const newOnes = compareResult.filter(r=>r.status==='new')
              const saving  = cheaper.reduce((s,r)=>s+Math.abs(r.diff),0)
              return (
                <>
                  <div className="compare-summary">
                    {cheaper.length>0 && <div className="summary-chip success">✓ {cheaper.length} más barato · ahorra {fmt(saving)}</div>}
                    {dearer.length>0  && <div className="summary-chip danger">✗ {dearer.length} más caro</div>}
                    {same.length>0    && <div className="summary-chip muted">= {same.length} igual</div>}
                    {newOnes.length>0 && <div className="summary-chip accent">★ {newOnes.length} nuevo</div>}
                  </div>
                  {compareResult.map((row,i) => {
                    const isGood=row.status==='cheaper', isBad=row.status==='dearer', isNew=row.status==='new'
                    const col = isGood?'var(--success)':isBad?'var(--danger)':isNew?'var(--gold)':'var(--border)'
                    return (
                      <div key={i} className="compare-card" style={{'--card-accent':col}}>
                        <div className="compare-card-top">
                          <div className="compare-icon" style={{color:col}}>{isGood?'↓':isBad?'↑':isNew?'★':'='}</div>
                          <div className="compare-name">
                            <div className="item-name">{row.offerName}</div>
                            {row.offerUnit && <div className="item-meta">{row.offerUnit}</div>}
                            {row.myName && row.myName!==row.offerName && <div className="matched-name">↳ {row.myName}</div>}
                          </div>
                        </div>
                        <div className="compare-prices">
                          {row.myPrice!==null && (
                            <div className="compare-price-col">
                              <div className="price-col-label">TU PRECIO</div>
                              <div className="compare-price-net">{fmt(row.myPrice)}</div>
                              <div className="compare-price-gross">+IVA {fmt(withIva(row.myPrice,row.myIva))}</div>
                            </div>
                          )}
                          <div className="compare-price-col highlight" style={{'--hl':col}}>
                            <div className="price-col-label">OFERTA</div>
                            <div className="compare-price-net" style={{color:col}}>{fmt(row.offerNet)}</div>
                            <div className="compare-price-gross">+IVA {fmt(withIva(row.offerNet,row.offerIva))}</div>
                          </div>
                          {row.diff!==null && Math.abs(row.diff)>0.005 && (
                            <div className="compare-diff" style={{color:col}}>{isGood?'−':'+'}{fmt(Math.abs(row.diff))}</div>
                          )}
                        </div>
                        {isNew && <div className="new-badge">No está en tu lista</div>}
                      </div>
                    )
                  })}
                  <button className="btn-ghost full" style={{marginTop:'16px'}} onClick={()=>setCompareResult(null)}>Limpiar y comparar otra</button>
                </>
              )
            })()}
          </div>
        )}

        {/* ═══ ASK ═══ */}
        {tab==='ask' && (
          <div className="tab-content ask-tab">
            <div className="chat-messages">
              {chat.length===0 && (
                <div className="empty">
                  <div className="empty-icon">◎</div>
                  <p>Consulta tus precios</p>
                  <div className="ask-examples">
                    {['¿Cuánto cuesta una Coca-Cola?','¿Cuál es la cerveza más barata?','Lista precios de Makro','¿Cuánto me cuesta una caja con IVA?'].map(q=>(
                      <button key={q} className="example-chip" onClick={()=>setChatInput(q)}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {chat.map((msg,i) => (
                <div key={i} className={`chat-bubble ${msg.role}`}>
                  <div className="bubble-label">{msg.role==='ai'?'PRICER':'TÚ'}</div>
                  <div className="bubble-text">{msg.text}</div>
                </div>
              ))}
              {chatLoading && (
                <div className="chat-bubble ai loading">
                  <div className="bubble-label">PRICER</div>
                  <div className="typing-dots"><span/><span/><span/></div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
            <div className="chat-input-row">
              <textarea className="chat-input" placeholder="¿Cuánto cuesta…?" value={chatInput}
                onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); handleAsk() } }} rows={1} />
              <button className="btn-send" onClick={handleAsk} disabled={chatLoading}>↑</button>
            </div>
          </div>
        )}

      </main>

      {/* ══════════════════════════════════════════════
          PRODUCT DETAIL + MARKET LOOKUP SHEET
      ══════════════════════════════════════════════ */}
      {detailItem && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setDetailItem(null)}>
          <div className="modal market-modal">

            {/* Header */}
            <div className="market-header">
              <div>
                <div className="market-product-name">{detailItem.name}</div>
                <div className="market-product-meta">
                  {detailItem.unit && <span>{detailItem.unit}</span>}
                  {detailItem.supplier && <span className="supplier-badge">{detailItem.supplier}</span>}
                  <span className="iva-badge" style={{color:fmtIva(detailItem.iva??21).color}}>IVA {detailItem.iva??21}%</span>
                </div>
              </div>
              <button className="sheet-close" onClick={()=>setDetailItem(null)}>✕</button>
            </div>

            {/* My current price */}
            <div className="my-price-banner">
              <div className="my-price-label">TU PRECIO ACTUAL</div>
              <div className="my-price-row">
                <div>
                  <div className="my-price-net">{fmt(detailItem.price)}</div>
                  <div className="my-price-gross">con IVA {fmt(withIva(parseFloat(detailItem.price), detailItem.iva??21))}</div>
                </div>
                <div className="my-price-actions">
                  <button className="btn-edit" onClick={()=>{ openEdit(detailItem); setDetailItem(null) }}>Editar</button>
                </div>
              </div>
            </div>

            {/* Market lookup */}
            <div className="market-section">
              <div className="market-section-title">Precios de Mercado</div>

              {!marketData && !marketLoading && !marketError && (
                <div className="market-cta">
                  <p className="market-cta-desc">Busca precios reales en Makro, Transgourmet, Gursa, Costco y otros distribuidores que sirven en España.</p>
                  {!serperKey && (
                    <div className="market-warn">
                      ⚠ Necesitas configurar tu Serper API key en ⚙ Ajustes para activar búsqueda en vivo.
                    </div>
                  )}
                  <button className="btn-market-search" onClick={runMarketLookup} disabled={!serperKey}>
                    <span>🌐</span> Buscar Precios en Vivo
                  </button>
                </div>
              )}

              {marketLoading && (
                <div className="market-loading">
                  <div className="market-loading-steps">
                    <div className="market-step active">🔍 Buscando en Google España…</div>
                    <div className="market-step">🤖 Analizando resultados con IA…</div>
                    <div className="market-step">📊 Comparando precios…</div>
                  </div>
                </div>
              )}

              {marketError && (
                <div className="error-card" style={{marginTop:0}}>
                  {marketError}
                  <button className="btn-ghost" style={{marginTop:'10px',width:'100%'}} onClick={runMarketLookup}>Reintentar</button>
                </div>
              )}

              {marketData && !marketLoading && (
                <div className="market-results">

                  {/* Summary */}
                  <div className="market-summary-box">
                    <div className="market-summary-text">{marketData.summary}</div>
                    {marketData.bestDeal && (
                      <div className="market-best-deal">
                        🏆 Mejor precio encontrado: <strong>{marketData.bestDeal}</strong>
                      </div>
                    )}
                    <div className="market-meta-row">
                      <span className={`quality-badge ${marketData.dataQuality}`}>{marketData.dataQuality==='high'?'✓ Alta fiabilidad':marketData.dataQuality==='medium'?'◎ Fiabilidad media':'⚠ Baja fiabilidad'}</span>
                      <span className="market-date">Búsqueda: {marketData.searchDate}</span>
                    </div>
                  </div>

                  {/* Supplier cards */}
                  {(marketData.suppliers||[]).map((s,i) => {
                    const myNet = parseFloat(detailItem.price)
                    const diff  = s.priceNet !== null ? s.priceNet - myNet : null
                    const pct   = diff !== null ? (diff / myNet * 100) : null
                    const isCheaper = diff !== null && diff < -0.01
                    const isDearer  = diff !== null && diff > 0.01
                    const accentCol = isCheaper ? 'var(--success)' : isDearer ? 'var(--danger)' : 'var(--border)'

                    return (
                      <div key={i} className="market-supplier-card" style={{'--accent':accentCol}}>
                        <div className="msc-top">
                          <div className="msc-name-col">
                            <div className="msc-name">{s.name}</div>
                            {s.unit && <div className="msc-unit">{s.unit}</div>}
                            <div className={`msc-confidence ${s.confidence}`}>
                              {s.confidence==='high'?'● Alta confianza':s.confidence==='medium'?'◉ Media confianza':'○ Baja confianza'}
                            </div>
                          </div>
                          <div className="msc-price-col">
                            {s.priceNet !== null ? (
                              <>
                                <div className="msc-price-net" style={{color:accentCol}}>{fmt(s.priceNet)}</div>
                                <div className="msc-price-gross">con IVA {fmt(s.priceGross ?? withIva(s.priceNet, s.iva??21))}</div>
                                {diff !== null && Math.abs(diff) > 0.01 && (
                                  <div className="msc-diff" style={{color:accentCol}}>
                                    {isCheaper?'−':'+'}{fmt(Math.abs(diff))} ({Math.abs(pct).toFixed(1)}% {isCheaper?'más barato':'más caro'})
                                  </div>
                                )}
                                {diff !== null && Math.abs(diff) <= 0.01 && (
                                  <div className="msc-diff" style={{color:'var(--text-muted)'}}>Precio similar</div>
                                )}
                              </>
                            ) : (
                              <div className="msc-no-price">Precio no disponible</div>
                            )}
                          </div>
                        </div>

                        <div className="msc-details">
                          {s.minOrder && (
                            <div className="msc-detail-row">
                              <span className="msc-detail-icon">📦</span>
                              <span><strong>Pedido mínimo:</strong> {s.minOrder}</span>
                            </div>
                          )}
                          {s.deliveryTime && (
                            <div className="msc-detail-row">
                              <span className="msc-detail-icon">🚚</span>
                              <span><strong>Entrega:</strong> {s.deliveryTime}</span>
                            </div>
                          )}
                          {s.deliveryZones && (
                            <div className="msc-detail-row">
                              <span className="msc-detail-icon">📍</span>
                              <span><strong>Zona:</strong> {s.deliveryZones}</span>
                            </div>
                          )}
                          {s.notes && (
                            <div className="msc-detail-row">
                              <span className="msc-detail-icon">ℹ</span>
                              <span>{s.notes}</span>
                            </div>
                          )}
                          {s.website && (
                            <a href={s.website} target="_blank" rel="noreferrer" className="msc-link">
                              Ver proveedor →
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  <button className="btn-ghost full" style={{marginTop:'12px'}} onClick={runMarketLookup}>
                    🔄 Actualizar búsqueda
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          ADD / EDIT MODAL
      ══════════════════════════════════════════════ */}
      {modal && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal">
            <div className="modal-title">{modal==='edit'?'Editar producto':'Añadir producto'}</div>
            <div className="form-row">
              <label className="form-label">Nombre *</label>
              <input className="form-input" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Coca-Cola 33cl" />
            </div>
            <div className="form-row">
              <label className="form-label">Precio sin IVA (€) *</label>
              <input className="form-input" type="number" step="0.01" value={form.price} onChange={e=>setForm(p=>({...p,price:e.target.value}))} placeholder="8.50" />
            </div>
            <div className="form-row">
              <label className="form-label">IVA</label>
              <div className="iva-selector">
                {IVA_RATES.map(r=>(
                  <button key={r.value} className={`iva-btn ${parseInt(form.iva)===r.value?'selected':''}`} style={{'--iva-color':r.color}} onClick={()=>setForm(p=>({...p,iva:r.value}))}>
                    <span className="iva-btn-rate">{r.value}%</span>
                    <span className="iva-btn-desc">{r.desc}</span>
                  </button>
                ))}
              </div>
              {form.price && (
                <div className="iva-preview">
                  sin IVA <strong>{fmt(form.price)}</strong> → con IVA <strong>{fmt(withIva(parseFloat(form.price)||0,parseInt(form.iva)))}</strong>
                </div>
              )}
            </div>
            {['category','supplier','unit'].map(f=>(
              <div key={f} className="form-row">
                <label className="form-label">{f==='category'?'Categoría':f==='supplier'?'Proveedor':'Unidad'}</label>
                <input className="form-input" value={form[f]} onChange={e=>setForm(p=>({...p,[f]:e.target.value}))}
                  placeholder={f==='category'?'Refrescos, Cerveza, Vino…':f==='supplier'?'Makro, Sysco…':'caja/24, botella, barril…'} />
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn-primary" onClick={saveForm}>{modal==='edit'?'Guardar':'Añadir'}</button>
              <button className="btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          SETTINGS MODAL
      ══════════════════════════════════════════════ */}
      {showSettings && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowSettings(false)}>
          <div className="modal">
            <div className="modal-title">Ajustes</div>

            <div className="settings-section">
              <div className="settings-section-label">🤖 Anthropic (Claude AI)</div>
              <p className="modal-desc">Para escanear facturas y consultar precios. <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{color:'var(--gold)'}}>console.anthropic.com</a></p>
              {apiKey && <div className="api-current">✓ Configurada</div>}
              <div className="form-row">
                <label className="form-label">API Key</label>
                <input className="form-input" type="password" value={settingsForm.anthropic} onChange={e=>setSettingsForm(p=>({...p,anthropic:e.target.value}))} placeholder="sk-ant-..." />
              </div>
            </div>

            <div className="settings-divider"/>

            <div className="settings-section">
              <div className="settings-section-label">🌐 Serper (Búsqueda en vivo)</div>
              <p className="modal-desc">Para buscar precios reales de proveedores online. 2.500 búsquedas gratis. <a href="https://serper.dev" target="_blank" rel="noreferrer" style={{color:'var(--gold)'}}>serper.dev</a></p>
              {serperKey && <div className="api-current">✓ Configurada</div>}
              <div className="form-row">
                <label className="form-label">Serper API Key</label>
                <input className="form-input" type="password" value={settingsForm.serper} onChange={e=>setSettingsForm(p=>({...p,serper:e.target.value}))} placeholder="xxxxxxxx..." />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={saveSettings}>Guardar</button>
              <button className="btn-ghost" onClick={()=>setShowSettings(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
