export const config = { runtime: 'edge' }

const ANALYSIS_PROMPT = `당신은 학생 발명품 경진대회 심사 지원 전문가입니다.
아래 발명품 설명서를 분석하여 반드시 유효한 JSON 객체 하나만 반환하세요. 다른 텍스트는 절대 포함하지 마세요.

반환할 JSON 스키마:
{
  "inventionTitle": "작품 제목 (설명서에서 추출, 없으면 내용 기반 추정)",
  "summary": "핵심 아이디어 요약 (3~5문장, 해결하는 문제·핵심 아이디어·작동 방식 포함)",
  "keywords": {
    "patent": ["특허 검색용 키워드 5~8개"],
    "award": ["전국학생과학발명품경진대회 수상작 검색용 키워드 5~8개"],
    "product": ["시판 제품 검색용 키워드 5~8개"]
  },
  "similarityAnalysis": {
    "patents": "기존 특허와의 유사 가능성 분석 (구체적 기술 분야 언급, '유사 가능성'·'추가 검토 필요' 수준으로 서술, 150~250자)",
    "awards": "기존 수상작과의 유사 가능성 분석 (전국학생과학발명품경진대회 기준, 150~250자)",
    "products": "시판 제품과의 유사 가능성 분석 (150~250자)"
  },
  "specificMatches": {
    "patents": [
      {
        "title": "유사 가능성이 있는 특허 제목 또는 기술 명칭",
        "searchQuery": "Google Patents / KIPRIS 검색에 효과적인 한국어+영어 혼합 검색어",
        "reason": "어느 부분이 왜 유사한지 구체적으로 1~2문장"
      }
    ],
    "awards": [
      {
        "title": "유사 가능성이 있는 수상작 제목 또는 유형",
        "year": "추정 연도 범위 (예: 2018~2023)",
        "searchQuery": "전국학생과학발명품경진대회 검색어",
        "reason": "어느 부분이 왜 유사한지 구체적으로 1~2문장"
      }
    ],
    "products": [
      {
        "name": "유사 시판 제품명 또는 카테고리",
        "searchQuery": "쇼핑몰 검색에 효과적인 한국어 제품 검색어",
        "reason": "어느 부분이 왜 유사한지 구체적으로 1~2문장"
      }
    ]
  },
  "scores": {
    "problem":   { "score": 0, "reason": "점수 근거 (1~2문장)" },
    "function":  { "score": 0, "reason": "점수 근거 (1~2문장)" },
    "structure": { "score": 0, "reason": "점수 근거 (1~2문장)" },
    "principle": { "score": 0, "reason": "점수 근거 (1~2문장)" },
    "usage":     { "score": 0, "reason": "점수 근거 (1~2문장)" }
  },
  "differentiation": "기존 특허·수상작·제품과의 차별점 분석 (200~350자)",
  "improvements": "심사자·지도교사를 위한 보완 지도 방향 3~5가지 (각 항목 줄바꿈 구분)",
  "finalReport": "심사자 참고용 최종 보고서 전문 (작품 개요, 유사도 종합 의견, 차별성 평가, 심사 시 주안점 순서로 서술, 400~600자)"
}

점수 기준 (각 항목별로 기존 선행 자료와의 유사도):
0~3: 유사 가능성 낮음 / 4~6: 유사 가능성 중간 / 7~10: 유사 가능성 높음
specificMatches는 실제 검색으로 찾을 수 있을 만한 구체적인 항목을 제시하세요. 없다면 빈 배열로 두세요.
법적 특허 침해 여부는 절대 단정하지 말 것.`

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const { text } = await req.json()

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      stream: true,
      system: ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: `다음은 학생 발명품 설명서 내용입니다:\n\n${text}` }],
    }),
  })

  if (!upstream.ok) {
    const err = await upstream.json()
    return new Response(
      JSON.stringify({ error: err?.error?.message || 'API 오류' }),
      { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
