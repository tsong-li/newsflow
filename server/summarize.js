// AI Summarizer using GitHub Copilot / OpenAI compatible endpoint
// Falls back to simple extraction if no API available

async function summarize(title, content, category) {
  const prompt = `你是一个新闻摘要助手。用最直白简洁的大白话帮用户概括新闻，节省阅读时间。

新闻标题：${title}
新闻内容：${content || '(无正文，仅根据标题摘要)'}
分类：${category}

请返回JSON格式（不要markdown代码块）：
{
  "summary": "用2-3句大白话概括，像跟朋友聊天一样",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "oneLiner": "一句话总结"
}`

  // Try using the GitHub Copilot model via openclaw's proxy or direct API
  try {
    const res = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN || ''}`,
      },
      body: JSON.stringify({
        model: 'claude-opus-4.6',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content || ''
      return JSON.parse(text)
    }
  } catch (e) {
    // fallback
  }

  // Fallback: simple extraction
  const plainContent = (content || '').replace(/<[^>]+>/g, '').slice(0, 200)
  return {
    summary: plainContent || `${title}——点击查看详情。`,
    keyPoints: [title],
    oneLiner: title,
  }
}

module.exports = { summarize }
