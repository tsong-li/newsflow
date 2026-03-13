import { useState, useEffect, useRef } from "react"
import { SkipBack, Play, Pause, SkipForward, Headphones, Mic, Minus, X } from "lucide-react"

interface Article { title: string; summary?: string; source?: string; keyPoints?: string[] }
interface Props { articles: Article[]; startIdx?: number; onClose: () => void }

export default function PodcastPlayer({ articles, startIdx = 0, onClose }: Props) {
  const [idx, setIdx] = useState(startIdx)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [expanded, setExpanded] = useState(true)
const audioRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { setIdx(startIdx); setProgress(0); window.speechSynthesis.cancel(); setPlaying(false) }, [startIdx])
  useEffect(() => { if (playing) doPlay() }, [idx])

  const current = articles[idx]
  if (!current) return null

  function buildScript(a: Article, i: number, total: number): string {
    const intro = i === 0 ? "Welcome to NewsFlow Radio. " : ""
    const body = a.keyPoints?.length ? a.title + ". " + a.keyPoints.join(". ") : a.title + ". " + (a.summary || "")
    const src = a.source ? " From " + a.source + "." : ""
    const outro = i < total - 1 ? " Next story." : " Done!"
    return intro + body + src + outro
  }

  const script = buildScript(current, idx, articles.length)

function doStop() {
  window.speechSynthesis.cancel()
  if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
  setPlaying(false)
}

  function doPlay() {
    window.speechSynthesis.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setPlaying(true)
    const url = "/api/tts?text=" + encodeURIComponent(script.slice(0, 2000))
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => { if (idx < articles.length - 1) setIdx(i => i + 1); else setPlaying(false) }
    audio.ontimeupdate = () => { if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100) }
    audio.play().catch(() => setPlaying(false))
  }

  function togglePlay() { playing ? doStop() : doPlay() }
  function next() { doStop(); if (idx < articles.length - 1) setIdx(i => i + 1) }
  function prev() { doStop(); if (idx > 0) setIdx(i => i - 1) }

  const mb: React.CSSProperties = { background:"none",border:"none",color:"#fff",opacity:0.5,cursor:"pointer",fontSize:14,padding:0 }
  const cb: React.CSSProperties = { background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center" }

  if (!expanded) {
    return (
      <div onClick={() => setExpanded(true)} style={{
        position:"fixed", bottom:20, right:20, zIndex:9999, width:60, height:60, borderRadius:"50%",
        background: playing ? "linear-gradient(135deg,#e74c3c,#c0392b)" : "linear-gradient(135deg,#1a1a2e,#16213e)",
        color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
        cursor:"pointer", boxShadow:"0 4px 20px rgba(0,0,0,0.3)", fontSize:14, fontWeight:600
      }}>
        {playing ? "ON" : "TTS"}
      </div>
    )
  }
return (
    <div style={{ position:"fixed", bottom:20, right:20, zIndex:9999, width:320, borderRadius:16, background:"linear-gradient(135deg,#1a1a2e,#16213e)", color:"#fff", padding:"16px 20px", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", fontFamily:"Outfit,sans-serif" }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:11,opacity:0.5,textTransform:"uppercase",letterSpacing:2}}>NewsFlow Radio</span>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setExpanded(false)} style={mb}><Minus size={14} /></button>
          <button onClick={()=>{doStop();onClose()}} style={mb}><X size={14} /></button>
        </div>
      </div>
      <div style={{fontSize:13,fontWeight:600,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{current.title}</div>
      <div style={{fontSize:11,opacity:0.4,marginBottom:10}}>{idx+1} / {articles.length}</div>
      <div style={{height:3,background:"rgba(255,255,255,0.1)",borderRadius:2,marginBottom:12}}>
        <div style={{height:"100%",width:progress+"%",background:"#e74c3c",borderRadius:2,transition:"width 0.3s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:16,alignItems:"center"}}>
        <button onClick={prev} style={cb}><SkipBack size={16} /></button>
        <button onClick={togglePlay} style={{...cb,width:44,height:44,fontSize:14}}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button onClick={next} style={cb}><SkipForward size={16} /></button>
      </div>
    </div>
  )
}