import { useState, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

// ── Constants ──────────────────────────────────────────────────────────────

const SCORE_LABELS = {
  problem:   '해결 문제',
  function:  '핵심 기능',
  structure: '구조',
  principle: '작동 원리',
  usage:     '사용 상황',
}

const makeDeepLinks = {
  patent: (q) => [
    { label: 'KIPRIS 검색',     url: `https://patent.kipris.or.kr/patent/searchLogina.do?word=${encodeURIComponent(q)}` },
    { label: 'Google Patents',  url: `https://patents.google.com/?q=${encodeURIComponent(q)}&hl=ko` },
    { label: '특허청 검색',     url: `https://www.kipo.go.kr/search/result?query=${encodeURIComponent(q)}` },
  ],
  award: (q) => [
    { label: '수상작 구글 검색',   url: `https://www.google.com/search?q=${encodeURIComponent(q + ' 전국학생과학발명품경진대회 수상')}` },
    { label: '과학창의재단',       url: 'https://www.kofac.re.kr/' },
    { label: '수상작 네이버 검색', url: `https://search.naver.com/search.naver?query=${encodeURIComponent(q + ' 학생발명 수상')}` },
  ],
  product: (q) => [
    { label: '네이버 쇼핑', url: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}` },
    { label: '쿠팡',        url: `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}` },
    { label: 'Google 쇼핑', url: `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=shop` },
  ],
}

// ── PDF extraction ─────────────────────────────────────────────────────────

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const texts = []
  const maxPages = Math.min(pdf.numPages, 30)
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    texts.push(content.items.map(item => item.str).join(' '))
  }
  return texts.join('\n').slice(0, 50000)
}

// ── JSON repair ────────────────────────────────────────────────────────────

function repairJson(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  const str = raw.slice(start, end + 1)
  try {
    JSON.parse(str)
    return str
  } catch {
    let depth = 0, inString = false, escape = false, lastRootClose = -1
    for (let i = 0; i < str.length; i++) {
      const c = str[i]
      if (escape)               { escape = false; continue }
      if (c === '\\' && inString) { escape = true; continue }
      if (c === '"')             { inString = !inString; continue }
      if (!inString) {
        if (c === '{' || c === '[') depth++
        else if (c === '}' || c === ']') { depth--; if (depth === 0) lastRootClose = i }
      }
    }
    if (lastRootClose > 0) {
      const trimmed = str.slice(0, lastRootClose + 1)
      try { JSON.parse(trimmed); return trimmed } catch {}
    }
    return null
  }
}

// ── API calls via Netlify Functions ───────────────────────────────────────

async function analyzeWithClaude(text) {
  const res = await fetch('/.netlify/functions/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `분석 서버 오류 (${res.status})`)

  const raw = data.content?.[0]?.text || ''
  const repaired = repairJson(raw)
  if (!repaired) {
    const preview = raw.slice(0, 300) || '(빈 응답)'
    throw new Error(`JSON 파싱 불가. 응답 앞부분:\n${preview}`)
  }
  return JSON.parse(repaired)
}

async function fetchSearchResults(query, type) {
  try {
    const res = await fetch('/.netlify/functions/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, type }),
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

async function runAllSearches(specificMatches, onProgress) {
  const results = { patents: [], awards: [], products: [] }
  const tasks = [
    ...(specificMatches.patents  || []).slice(0, 2).map((m, i) => ({ type: 'patents',  idx: i, query: m.searchQuery })),
    ...(specificMatches.awards   || []).slice(0, 2).map((m, i) => ({ type: 'awards',   idx: i, query: m.searchQuery })),
    ...(specificMatches.products || []).slice(0, 2).map((m, i) => ({ type: 'products', idx: i, query: m.searchQuery })),
  ]
  for (const task of tasks) {
    onProgress(`"${task.query}" 검색 중...`)
    const typeKey = task.type === 'patents' ? 'patent' : task.type === 'awards' ? 'award' : 'product'
    results[task.type][task.idx] = await fetchSearchResults(task.query, typeKey)
  }
  return results
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ScoreBar({ label, score, reason }) {
  const pct = (score / 10) * 100
  const colorClass = score <= 3 ? 'score-low' : score <= 6 ? 'score-mid' : 'score-high'
  const levelText  = score <= 3 ? '낮음' : score <= 6 ? '중간' : '높음'
  return (
    <div className="score-item">
      <div className="score-header">
        <span className="score-label">{label}</span>
        <span className={`score-badge ${colorClass}`}>유사도 {score}/10 ({levelText})</span>
      </div>
      <div className="score-track">
        <div className={`score-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="score-reason">{reason}</p>
    </div>
  )
}

function SearchResultItem({ item }) {
  if (item.isImage) {
    return (
      <a className="search-result-card" href={item.link} target="_blank" rel="noreferrer">
        <div className="search-thumb-wrap">
          <img src={item.imageUrl} alt={item.title} className="search-thumb" loading="lazy"
            onError={e => { e.target.style.display = 'none' }} />
        </div>
        <div className="search-result-body">
          <p className="search-result-title">{item.title}</p>
          <p className="search-result-domain">{item.displayLink}</p>
        </div>
      </a>
    )
  }
  return (
    <a className="search-result-card" href={item.link} target="_blank" rel="noreferrer">
      {item.imageUrl ? (
        <div className="search-thumb-wrap">
          <img src={item.imageUrl} alt={item.title} className="search-thumb" loading="lazy"
            onError={e => { e.target.parentElement.style.display = 'none' }} />
        </div>
      ) : (
        <div className="search-thumb-wrap search-thumb-empty">
          <span className="search-thumb-icon">🔗</span>
        </div>
      )}
      <div className="search-result-body">
        <p className="search-result-title">{item.title}</p>
        <p className="search-result-snippet">{item.snippet}</p>
        <p className="search-result-domain">{item.displayLink}</p>
      </div>
    </a>
  )
}

function MatchCard({ match, deepLinkType, searchItems }) {
  const links = makeDeepLinks[deepLinkType](match.searchQuery)
  const hasResults = Array.isArray(searchItems) && searchItems.length > 0
  return (
    <div className="match-card">
      <div className="match-header">
        <div className="match-title-row">
          <span className="match-type-badge">
            {deepLinkType === 'patent' ? '특허' : deepLinkType === 'award' ? '수상작' : '제품'}
          </span>
          <span className="match-title">{match.title || match.name}</span>
          {match.year && <span className="match-year">{match.year}</span>}
        </div>
        <p className="match-reason">
          <span className="match-reason-label">유사 이유</span> {match.reason}
        </p>
      </div>
      <div className="match-links">
        <span className="match-links-label">직접 검색</span>
        {links.map(l => (
          <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="deep-link-btn">
            {l.label} ↗
          </a>
        ))}
      </div>
      {hasResults && (
        <div className="search-results-area">
          <p className="search-results-label">"{match.searchQuery}" 검색 결과</p>
          <div className="search-results-grid">
            {searchItems.map((item, i) => <SearchResultItem key={i} item={item} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function SimilaritySection({ title, analysis, matches, searchResults, deepLinkType, keywords }) {
  const hasMatches = matches && matches.length > 0
  return (
    <div className="similarity-section">
      <h4 className="similarity-title">{title}</h4>
      <p className="similarity-analysis">{analysis}</p>
      {!hasMatches && (
        <div className="match-links" style={{ marginTop: 12 }}>
          <span className="match-links-label">키워드 검색</span>
          {(keywords || []).slice(0, 2).map(kw =>
            makeDeepLinks[deepLinkType](kw).map(l => (
              <a key={l.label + kw} href={l.url} target="_blank" rel="noreferrer" className="deep-link-btn">
                {l.label} ↗
              </a>
            ))
          )}
        </div>
      )}
      {hasMatches && (
        <div className="match-list">
          {matches.map((m, i) => (
            <MatchCard key={i} match={m} deepLinkType={deepLinkType} searchItems={searchResults?.[i]} />
          ))}
        </div>
      )}
    </div>
  )
}

function ResultView({ result, searchResults, onPrint }) {
  const totalScore  = Object.values(result.scores).reduce((s, v) => s + v.score, 0)
  const avgScore    = (totalScore / 5).toFixed(1)
  const overallClass = avgScore <= 3 ? 'score-low' : avgScore <= 6 ? 'score-mid' : 'score-high'

  return (
    <div className="result-wrapper">
      <div className="result-header">
        <div>
          <h2 className="result-title">{result.inventionTitle}</h2>
          <p className="result-sub">분석 완료 · 유사 가능성 항목은 심사자 별도 확인 권장</p>
        </div>
        <button className="btn-print" onClick={onPrint}>보고서 인쇄</button>
      </div>

      <div className={`overall-score ${overallClass}`}>
        <span className="overall-label">종합 유사도 지수</span>
        <span className="overall-value">{avgScore} / 10</span>
        <span className="overall-desc">
          {avgScore <= 3 ? '유사 가능성 낮음 — 높은 독창성'
           : avgScore <= 6 ? '유사 가능성 중간 — 추가 검토 필요'
           : '유사 가능성 높음 — 심사자 확인 필요'}
        </span>
      </div>

      <section className="card">
        <h3 className="card-title">① 핵심 아이디어 요약</h3>
        <p className="card-body">{result.summary}</p>
      </section>

      <section className="card">
        <h3 className="card-title">② 검색 키워드</h3>
        <div className="keyword-grid">
          {[
            { title: '특허 검색용',     kws: result.keywords.patent,  hint: 'KIPRIS · Google Patents' },
            { title: '수상작 검색용',   kws: result.keywords.award,   hint: '전국학생과학발명품경진대회' },
            { title: '시판 제품 검색용', kws: result.keywords.product, hint: '네이버 쇼핑 · 쿠팡' },
          ].map(({ title, kws, hint }) => (
            <div key={title} className="keyword-group">
              <h4 className="keyword-title">{title}</h4>
              <div className="keyword-chips">
                {kws.map((kw, i) => <span key={i} className="chip">{kw}</span>)}
              </div>
              <p className="keyword-hint">{hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">③ 유사 가능성 분석 및 검색 결과</h3>
        <div className="similarity-grid">
          <SimilaritySection title="기존 특허"   analysis={result.similarityAnalysis.patents}  matches={result.specificMatches?.patents}  searchResults={searchResults?.patents}  deepLinkType="patent"  keywords={result.keywords.patent} />
          <SimilaritySection title="기존 수상작" analysis={result.similarityAnalysis.awards}   matches={result.specificMatches?.awards}   searchResults={searchResults?.awards}   deepLinkType="award"   keywords={result.keywords.award} />
          <SimilaritySection title="시판 제품"   analysis={result.similarityAnalysis.products} matches={result.specificMatches?.products} searchResults={searchResults?.products} deepLinkType="product" keywords={result.keywords.product} />
        </div>
        <p className="disclaimer">
          ※ 이 분석은 법적 특허 침해 여부를 판단하지 않습니다. 유사 가능성 수준의 참고 정보이며 최종 판단은 심사자가 해야 합니다.
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">④ 항목별 유사도 점수</h3>
        <p className="score-guide">0~3 <span className="badge-low">낮음</span> · 4~6 <span className="badge-mid">중간</span> · 7~10 <span className="badge-high">높음</span></p>
        <div className="score-list">
          {Object.entries(result.scores).map(([key, val]) => (
            <ScoreBar key={key} label={SCORE_LABELS[key]} score={val.score} reason={val.reason} />
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">⑤ 차별점 분석</h3>
        <p className="card-body">{result.differentiation}</p>
      </section>

      <section className="card">
        <h3 className="card-title">⑥ 보완 지도 방향</h3>
        <div className="improvements">
          {result.improvements.split('\n').filter(Boolean).map((line, i) => (
            <div key={i} className="improvement-item">
              <span className="improvement-num">{i + 1}</span>
              <p>{line.replace(/^[-•·\d.]\s*/, '')}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card report-card" id="final-report">
        <h3 className="card-title">⑦ 심사자 참고용 최종 보고서</h3>
        <div className="report-meta">
          <span>작품명: {result.inventionTitle}</span>
          <span>분석일: {new Date().toLocaleDateString('ko-KR')}</span>
          <span>종합 유사도: {avgScore}/10</span>
        </div>
        <div className="report-body">{result.finalReport}</div>
        <p className="disclaimer">
          ※ 본 보고서는 AI 분석 도구로 생성된 참고 자료입니다. 법적 효력이 없으며 심사자의 전문적 판단을 대체하지 않습니다.
        </p>
      </section>
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [file,          setFile]          = useState(null)
  const [dragging,      setDragging]      = useState(false)
  const [status,        setStatus]        = useState('idle')
  const [progress,      setProgress]      = useState('')
  const [result,        setResult]        = useState(null)
  const [searchResults, setSearchResults] = useState(null)
  const [error,         setError]         = useState('')
  const fileInputRef = useRef(null)

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.type === 'application/pdf') { setFile(dropped); setError('') }
    else setError('PDF 파일만 업로드할 수 있습니다.')
  }, [])

  const onFileChange = (e) => {
    const picked = e.target.files[0]
    if (picked) { setFile(picked); setError(''); setResult(null); setSearchResults(null); setStatus('idle') }
  }

  const handleAnalyze = async () => {
    if (!file) { setError('PDF 파일을 선택하세요.'); return }
    setError(''); setResult(null); setSearchResults(null)

    try {
      setStatus('extracting')
      setProgress('PDF에서 텍스트를 추출하는 중...')
      const text = await extractTextFromPDF(file)
      if (!text.trim()) throw new Error('PDF에서 텍스트를 추출하지 못했습니다. 스캔 이미지 PDF의 경우 텍스트 추출이 불가능합니다.')

      setStatus('analyzing')
      setProgress('Claude AI가 발명품 내용을 분석하는 중... (30~60초 소요)')
      const data = await analyzeWithClaude(text)
      setResult(data)

      setStatus('searching')
      const sr = await runAllSearches(
        data.specificMatches || { patents: [], awards: [], products: [] },
        (msg) => setProgress(msg)
      )
      setSearchResults(sr)

      setStatus('done')
      setProgress('')
    } catch (err) {
      setStatus('error')
      setError(err.message || '분석 중 오류가 발생했습니다.')
      setProgress('')
    }
  }

  const canAnalyze = file && !['extracting', 'analyzing', 'searching'].includes(status)

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <h1 className="app-title">학생 발명품 유사도 검토 툴</h1>
          <p className="app-desc">발명품 설명서 PDF → 핵심 아이디어 요약 · 검색 키워드 · 유사 항목 분석 · 심사 보고서 자동 생성</p>
        </div>
      </header>

      <main className="app-main">
        <section className="setup-card">
          <h2 className="setup-title">발명품 설명서 업로드</h2>
          <p className="setup-desc">텍스트 레이어가 있는 PDF만 지원됩니다. 스캔 이미지 PDF는 텍스트 추출 불가.</p>
          <div
            className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
              className="hidden-input" onChange={onFileChange} />
            {file ? (
              <div className="file-info">
                <span className="file-icon">📄</span>
                <div>
                  <p className="file-name">{file.name}</p>
                  <p className="file-size">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button className="btn-remove" onClick={e => {
                  e.stopPropagation()
                  setFile(null); setResult(null); setSearchResults(null); setStatus('idle'); setError('')
                }}>✕</button>
              </div>
            ) : (
              <div className="dropzone-placeholder">
                <span className="drop-icon">📁</span>
                <p className="drop-text">PDF 파일을 드래그하거나 클릭하여 선택</p>
              </div>
            )}
          </div>
        </section>

        <button className="btn-analyze" onClick={handleAnalyze} disabled={!canAnalyze}>
          {['extracting', 'analyzing', 'searching'].includes(status) ? '분석 중...' : '유사도 분석 시작'}
        </button>

        {progress && (
          <div className="progress-bar">
            <div className="progress-spinner" />
            <p className="progress-text">{progress}</p>
          </div>
        )}

        {error && <div className="error-box"><strong>오류:</strong> {error}</div>}

        {status === 'done' && result && (
          <ResultView result={result} searchResults={searchResults} onPrint={() => window.print()} />
        )}
      </main>

      <footer className="app-footer">
        <p>본 툴은 참고용 분석 도구입니다. 법적 특허 침해 여부를 판단하지 않으며, 최종 심사는 전문가가 수행해야 합니다.</p>
      </footer>
    </div>
  )
}
