import PodcastPlayer from './PodcastPlayer'
import React, { useState, useEffect } from 'react'
import { BookOpen, Headphones, Play, Brain, Sparkles, Loader2 } from 'lucide-react'

interface NewsItem {
  id: string; category: string; title: string; summary: string
  keyPoints: string[]; image: string | null; source: string; time: string; link: string
}

const CATEGORIES = ['All', 'Tech', 'Business', 'Sports', 'World', 'Science']
const API = '/api'
function getImage(item: any): string {
  if (item.image) return item.image
  const s = Math.abs([...item.title].reduce((a: number, c: string) => a + c.charCodeAt(0), 0))
  return `https://picsum.photos/seed/${s}/800/600`
}
const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

function Modes({ onClick, onListen, onDeep, onRead }: { onClick?: React.MouseEventHandler; onListen?: () => void; onDeep?: () => void; onRead?: () => void }) {
  return (
    <div className="modes" onClick={onClick}>
      <button className="mode-btn" onClick={(e) => { e.stopPropagation(); onRead?.() }}><BookOpen size={10} /> Read</button>
      <button className="mode-btn" onClick={(e) => { e.stopPropagation(); onListen?.() }}><Headphones size={10} /> Listen</button>
      <button className="mode-btn"><Play size={10} /> Watch</button>
     <button className="mode-btn" onClick={(e) => { e.stopPropagation(); onDeep?.() }}><Brain size={10} /> Deep</button>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState('All')
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showPodcast, setShowPodcast] = useState(false)
  const [podcastIdx, setPodcastIdx] = useState(0)
  const [readArticle, setReadArticle] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>(null)

  async function deepAnalyze(item: any, idx: number) {
    setAnalysis(null)
    try {
      const r = await fetch("/api/analyze?title=" + encodeURIComponent(item.title) + "&summary=" + encodeURIComponent(item.summary || "") + "&source=" + encodeURIComponent(item.source || ""))
      const d = await r.json()
      setAnalysis({ idx, ...d })
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/news?category=${encodeURIComponent(tab)}`)
      .then(r => r.json()).then(setNews).catch(() => setNews([]))
      .finally(() => setLoading(false))
  }, [tab])

  const open = (url: string) => window.open(url, '_blank')
  const hero = news[0]
  const pair = news.slice(1, 3)
  const middle = news.slice(3, 7)
  const rest = news.slice(7)

  // Find a good editorial quote from keyPoints
  const quoteItem = news.find(n => n.keyPoints?.[0]?.length > 20)

  return (
    <div>
      {/* Masthead */}
      <header className="masthead">
        <p className="masthead-kicker">AI · Curated · Daily</p>
        <h1 className="masthead-title">NEWSFLOW</h1>
        <p className="masthead-date">{TODAY}</p>
      <button onClick={() => setShowPodcast(true)} style={{ position:"fixed", bottom: 20, right: 20, zIndex: 9998, background:"linear-gradient(135deg,#e74c3c,#c0392b)", color:"#fff", border:"none", borderRadius:"50%", width:56, height:56, fontSize:24, cursor:"pointer", boxShadow:"0 4px 20px rgba(0,0,0,0.3)", display:"flex", alignItems:"center", justifyContent:"center" }} title="Listen">🎙️</button></header>

      {/* Nav */}
      <nav className="nav">
        {CATEGORIES.map(c => (
          <button key={c} className={`nav-item ${tab === c ? 'active' : ''}`} onClick={() => setTab(c)}>
            {c}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="loading-center">
          <Loader2 size={24} style={{ animation: 'spin 1.2s linear infinite', color: '#999' }} />
          <p>Loading</p>
        </div>
      ) : (
        <>
          {/* HERO */}
          {hero && (
            <div className="wrapper">
              <section className="hero-section" onClick={() => open(hero.link)}>
                {getImage(hero) && (
                  <div className="hero-img"><img src={getImage(hero)} alt="" /></div>
                )}
                <div className="hero-text">
                  <p className="hero-cat">{hero.category}</p>
                  <h2 className="hero-title">{hero.title}</h2>
                  <p className="hero-summary">{hero.summary?.slice(0, 180)}</p>
                  <p className="hero-meta-line">{hero.source} · {hero.time}</p>
                  <Modes onClick={e => e.stopPropagation()} onListen={() => { setPodcastIdx(0); setShowPodcast(true) }} onDeep={() => deepAnalyze(news[0], 0)} onRead={() => setReadArticle(news[0])} />
                </div>
              </section>
            </div>
          )}

          <hr className="section-rule" />

          {/* TWO-UP */}
          {pair.length > 0 && (
            <div className="wrapper">
              <div className="two-up">
                {pair.map(item => (
                  <article key={item.id} className="two-up-item" onClick={() => open(item.link)}>
                    {getImage(item) && (
                      <div className="two-up-img"><img src={getImage(item)} alt="" /></div>
                    )}
                    <p className="item-cat">{item.category}</p>
                    <h3 className="item-title">{item.title}</h3>
                    <p className="item-excerpt">{item.summary?.slice(0, 120)}</p>
                    <p className="item-meta">{item.source} · {item.time}</p>
                    <Modes onClick={e => e.stopPropagation()} onListen={() => { setPodcastIdx(news.indexOf(item)); setShowPodcast(true) }} onDeep={() => deepAnalyze(item, news.indexOf(item))} onRead={() => setReadArticle(item)} />
                  </article>
                ))}
              </div>
            </div>
          )}

          {/* Editorial Break */}
          {quoteItem && (
            <div className="editorial-break">
              <p className="editorial-break-text">"{quoteItem.keyPoints[0]}"</p>
              <p className="editorial-break-attr">— {quoteItem.source} · AI Summary</p>
            </div>
          )}

          {/* Story Rows (alternating image side) */}
          {middle.length > 0 && (
            <div className="wrapper story-list">
              {middle.map(item => (
                <article key={item.id} className="story-row" onClick={() => open(item.link)}>
                  {getImage(item) ? (
                    <div className="story-row-img"><img src={getImage(item)} alt="" /></div>
                  ) : <div />}
                  <div className="story-row-text">
                    <p className="item-cat">{item.category}</p>
                    <h3 className="item-title">{item.title}</h3>
                    <p className="item-excerpt">{item.summary?.slice(0, 140)}</p>
                    <p className="item-meta">{item.source} · {item.time}</p>
                    <Modes onClick={e => e.stopPropagation()} onListen={() => { setPodcastIdx(news.indexOf(item)); setShowPodcast(true) }} onDeep={() => deepAnalyze(item, news.indexOf(item))} onRead={() => setReadArticle(item)} />
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Tail List */}
          {rest.length > 0 && (
            <div className="tail-list">
              {rest.map((item, i) => (
                <article key={item.id} className="tail-item" onClick={() => open(item.link)}>
                  <p className="tail-number">{String(i + 1).padStart(2, '0')}</p>
                  <p className="item-cat">{item.category}</p>
                  <h3 className="item-title" style={{ fontSize: 22 }}>{item.title}</h3>
                  <p className="item-excerpt">{item.summary?.slice(0, 100)}</p>
                  <p className="item-meta">{item.source} · {item.time}</p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    {readArticle && (
      <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'#faf8f5', zIndex:9997, overflowY:'auto' }}>
        <div style={{ maxWidth:680, margin:'0 auto', padding:'20px 24px 60px' }}>
          <button onClick={() => setReadArticle(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#888', marginBottom:20, fontFamily:"Outfit,sans-serif" }}>← Back</button>
          {readArticle.image && <img src={readArticle.image} style={{ width:'100%', borderRadius:12, marginBottom:24, maxHeight:400, objectFit:'cover' }} />}
          <div style={{ display:'flex', gap:12, marginBottom:12, alignItems:'center' }}>
            <span style={{ fontSize:12, fontWeight:600, color:'#e74c3c', textTransform:'uppercase', letterSpacing:1, fontFamily:"Outfit,sans-serif" }}>{readArticle.source}</span>
            <span style={{ fontSize:12, color:'#999' }}>{readArticle.time}</span>
          </div>
          <h1 style={{ fontSize:28, fontWeight:700, lineHeight:1.3, marginBottom:16, color:'#1a1a2e', fontFamily:"Outfit,sans-serif" }}>{readArticle.title}</h1>
          <p style={{ fontSize:16, lineHeight:1.8, color:'#444', marginBottom:24, fontFamily:"Inter,sans-serif", fontWeight:300 }}>{readArticle.summary}</p>
          {readArticle.keyPoints?.length > 0 && (
            <div style={{ background:'#f0ede8', borderRadius:12, padding:20, marginBottom:24 }}>
              <div style={{ fontSize:13, fontWeight:600, textTransform:'uppercase', letterSpacing:1, marginBottom:12, color:'#1a1a2e', fontFamily:"Outfit,sans-serif" }}>Key Points</div>
              {readArticle.keyPoints.map((p, i) => (
                <div key={i} style={{ fontSize:14, color:'#555', marginBottom:8, paddingLeft:14, borderLeft:'3px solid #e74c3c', lineHeight:1.6, fontFamily:"Inter,sans-serif" }}>{p}</div>
              ))}
            </div>
          )}
          <a href={readArticle.link} target="_blank" rel="noopener" style={{ display:'inline-block', background:'#1a1a2e', color:'#fff', padding:'10px 24px', borderRadius:8, textDecoration:'none', fontSize:14, fontFamily:"Outfit,sans-serif", fontWeight:500 }}>Read Full Article →</a>
        </div>
      </div>
    )}
    {analysis && (<div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.7)", zIndex:9998, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setAnalysis(null)}><div style={{ background:"#1a1a2e", color:"#fff", borderRadius:16, padding:32, maxWidth:500, width:"100%", fontFamily:"Outfit,sans-serif" }} onClick={e => e.stopPropagation()}><div style={{ fontSize:11, opacity:0.5, textTransform:"uppercase", letterSpacing:2, marginBottom:8 }}>AI Deep Analysis</div><div style={{ fontSize:18, fontWeight:700, marginBottom:16 }}>{news[analysis.idx]?.title}</div><div style={{ display:"flex", gap:12, marginBottom:16 }}><span style={{ background:"rgba(255,255,255,0.1)", padding:"4px 12px", borderRadius:20, fontSize:12 }}>{analysis.sentiment}</span><span style={{ background:"rgba(255,255,255,0.1)", padding:"4px 12px", borderRadius:20, fontSize:12 }}>{analysis.readTime}</span></div><div style={{ fontSize:13, opacity:0.7, marginBottom:16 }}>{analysis.tldr}</div><div style={{ fontSize:12, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>Key Points</div>{analysis.keyPoints?.map((p: string, i: number) => (<div key={i} style={{ fontSize:13, opacity:0.8, marginBottom:6, paddingLeft:12, borderLeft:"2px solid #e74c3c" }}>{p}</div>))}<div style={{ fontSize:12, fontWeight:600, marginBottom:8, marginTop:16, textTransform:"uppercase", letterSpacing:1 }}>Context</div><div style={{ fontSize:13, opacity:0.7 }}>{analysis.context}</div><button onClick={() => setAnalysis(null)} style={{ marginTop:20, background:"#e74c3c", color:"#fff", border:"none", padding:"8px 24px", borderRadius:8, cursor:"pointer", fontSize:13 }}>Close</button></div></div>)}
    {showPodcast && <PodcastPlayer articles={news} startIdx={podcastIdx} onClose={() => setShowPodcast(false)} />}
    </div>
  )
}

export default App
