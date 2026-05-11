exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const gKey = process.env.GOOGLE_API_KEY
  const gCx  = process.env.GOOGLE_CX

  // Google 환경변수 미설정 시 빈 결과 반환 (기능 비활성화)
  if (!gKey || !gCx) {
    return { statusCode: 200, body: JSON.stringify([]) }
  }

  try {
    const { query, type } = JSON.parse(event.body)
    const isProduct = type === 'product'
    const params = new URLSearchParams({ key: gKey, cx: gCx, q: query, num: '4' })
    if (isProduct) params.set('searchType', 'image')

    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`)
    const data = await res.json()

    if (!res.ok) {
      console.warn('[Google Search error]', data?.error?.message)
      return { statusCode: 200, body: JSON.stringify([]) }
    }

    const items = (data.items || []).map(item => {
      if (isProduct) {
        return {
          title: item.title,
          link: item.image?.contextLink || item.link,
          imageUrl: item.link,
          snippet: item.title,
          displayLink: item.displayLink,
          isImage: true,
        }
      }
      return {
        title: item.title,
        link: item.link,
        imageUrl: item.pagemap?.cse_thumbnail?.[0]?.src || item.pagemap?.cse_image?.[0]?.src || null,
        snippet: item.snippet,
        displayLink: item.displayLink,
        isImage: false,
      }
    })

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    }
  } catch (err) {
    console.warn('[Search function error]', err.message)
    return { statusCode: 200, body: JSON.stringify([]) }
  }
}
