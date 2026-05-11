export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const gKey = process.env.GOOGLE_API_KEY
  const gCx  = process.env.GOOGLE_CX

  if (!gKey || !gCx) {
    return res.status(200).json([])
  }

  try {
    const { query, type } = req.body
    const isProduct = type === 'product'
    const params = new URLSearchParams({ key: gKey, cx: gCx, q: query, num: '4' })
    if (isProduct) params.set('searchType', 'image')

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`)
    const data = await response.json()

    if (!response.ok) {
      console.warn('[Google Search error]', data?.error?.message)
      return res.status(200).json([])
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

    return res.status(200).json(items)
  } catch (err) {
    console.warn('[Search function error]', err.message)
    return res.status(200).json([])
  }
}
