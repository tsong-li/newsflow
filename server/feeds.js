function isBloombergVideoItem(item) {
  const title = String(item?.title || '')
  const link = String(item?.link || '')
  return /\(video\)/i.test(title) || /\/news\/videos\//i.test(link)
}

const FEEDS = {
  All: [
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', categoryLabel: 'Tech' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', categoryLabel: 'Tech' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', categoryLabel: 'Tech' },
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', categoryLabel: 'Business', rankBias: 6 },
    { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', categoryLabel: 'Sports', rankBias: 12 },
    { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news', categoryLabel: 'Sports', rankBias: 6 },
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', categoryLabel: 'World', rankBias: 8 },
    { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', categoryLabel: 'Science', articleImageLimit: 4, imageFetchConcurrency: 3, feedItemLimit: 8, rankBias: 8 },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', categoryLabel: 'Science', articleImageLimit: 0, imageFetchConcurrency: 2, feedItemLimit: 5, rankBias: -16 },
    { name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', categoryLabel: 'Finance', skipIf: isBloombergVideoItem, articleImageLimit: 4, imageFetchConcurrency: 2, feedItemLimit: 2, rankBias: 30 },
    { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', categoryLabel: 'Finance', articleImageLimit: 4, imageFetchConcurrency: 2, feedItemLimit: 2, rankBias: 26 },
  ],
  Tech: [
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  ],
  Business: [
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', articleImageLimit: 5, imageFetchConcurrency: 4 },
    { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', articleImageLimit: 3, imageFetchConcurrency: 3 },
  ],
  Finance: [
    { name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', skipIf: isBloombergVideoItem, articleImageLimit: 8, imageFetchConcurrency: 3, feedItemLimit: 10, rankBias: 40 },
    { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', articleImageLimit: 8, imageFetchConcurrency: 3, feedItemLimit: 10, rankBias: 34 },
  ],
  Sports: [
    { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
    { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  ],
  World: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Reuters', url: 'https://feeds.reuters.com/reuters/worldNews' },
  ],
  Science: [
    { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', articleImageLimit: 4, imageFetchConcurrency: 3, feedItemLimit: 8 },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', articleImageLimit: 0, imageFetchConcurrency: 2, feedItemLimit: 5, rankBias: -22 },
  ],
}

module.exports = FEEDS