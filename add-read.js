const fs = require('fs')
const f = process.env.HOME + '/.openclaw/workspace-dev/newsflow/src/App.tsx'
let c = fs.readFileSync(f, 'utf8')

if (!c.includes('readArticle')) {
  // 1. Add state
  c = c.replace(
    'const [analysis, setAnalysis]',
    'const [readArticle, setReadArticle] = useState<any>(null)\n  const [analysis, setAnalysis]'
  )

  // 2. Add onRead to Modes signature
  c = c.replace('onDeep?: () => void }', 'onDeep?: () => void; onRead?: () => void }')
  c = c.replace('{ onClick, onListen, onDeep }', '{ onClick, onListen, onDeep, onRead }')

  // 3. Update Read button
  c = c.replace(
    '<button className="mode-btn"><BookOpen size={10} /> Read</button>',
    '<button className="mode-btn" onClick={(e) => { e.stopPropagation(); onRead?.() }}><BookOpen size={10} /> Read</button>'
  )

  // 4. Add onRead to each Modes call (find onDeep and append onRead)
  let count = 0
  c = c.replace(/onDeep=\{[^}]+\}\s*\/>/g, (match) => {
    count++
    if (count === 1) return match.replace(' />', ' onRead={() => setReadArticle(news[0])} />')
    return match.replace(' />', ' onRead={() => setReadArticle(item)} />')
  })

  // 5. Add Read overlay before analysis modal
  const readModal = `{readArticle && (
      <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'#faf8f5', zIndex:9997, overflowY:'auto' }}>
        <div style={{ maxWidth:680, margin:'0 auto', padding:'20px 24px 60px' }}>
          <button onClick={() => setReadArticle(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#888', marginBottom:20, fontFamily:"Outfit,sans-serif" }}>\u2190 Back</button>
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
          <a href={readArticle.link} target="_blank" rel="noopener" style={{ display:'inline-block', background:'#1a1a2e', color:'#fff', padding:'10px 24px', borderRadius:8, textDecoration:'none', fontSize:14, fontFamily:"Outfit,sans-serif", fontWeight:500 }}>Read Full Article \u2192</a>
        </div>
      </div>
    )}\n    `

  c = c.replace('{analysis &&', readModal + '{analysis &&')
  fs.writeFileSync(f, c)
  console.log('read mode done')
} else {
  console.log('read mode already exists')
}