const FEEDS = {
  All: [
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
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