// content_x.js — scrape X search results for token signals

(function () {
  'use strict';

  function scrapeXSearch() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    const results = [];
    let totalLikes = 0;
    let totalReplies = 0;
    let totalRetweets = 0;
    let latestTime = 0;

    tweets.forEach((tweet, idx) => {
      if (idx >= 20) return;
      const timeEl = tweet.querySelector('time');
      const textEl = tweet.querySelector('div[data-testid="tweetText"]');
      const likeEl = tweet.querySelector('button[data-testid="like"]');
      const replyEl = tweet.querySelector('button[data-testid="reply"]');
      const retweetEl = tweet.querySelector('button[data-testid="retweet"]');

      const text = textEl ? textEl.innerText : '';
      const timeStr = timeEl ? timeEl.getAttribute('datetime') : null;
      const timestamp = timeStr ? new Date(timeStr).getTime() : 0;
      if (timestamp > latestTime) latestTime = timestamp;

      const parseCount = (el) => {
        if (!el) return 0;
        const txt = el.innerText || '';
        const num = parseFloat(txt.replace(/[^0-9.KM]/g, '').replace('K', '000').replace('M', '000000'));
        return isNaN(num) ? 0 : num;
      };

      const likes = parseCount(likeEl);
      const replies = parseCount(replyEl);
      const retweets = parseCount(retweetEl);
      totalLikes += likes;
      totalReplies += replies;
      totalRetweets += retweets;

      results.push({ text: text.slice(0, 200), timestamp, likes, replies, retweets });
    });

    // Also grab the "People are posting about this" or trending indicator
    const trendingIndicator = !!document.querySelector('[data-testid="trend"]');
    const searchCountEl = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('posts') || s.innerText.includes('K posts'));
    const searchCountText = searchCountEl ? searchCountEl.innerText : '';

    return {
      tweetCount: tweets.length,
      parsedCount: results.length,
      latestTweetTime: latestTime,
      totalLikes,
      totalReplies,
      totalRetweets,
      trendingIndicator,
      searchCountText,
      tweets: results.slice(0, 10),
      url: location.href,
      scrapedAt: Date.now()
    };
  }

  // Listen for scrape request from sidepanel
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SCRAPE_X') {
      // Wait a moment for dynamic content
      setTimeout(() => {
        const data = scrapeXSearch();
        sendResponse(data);
      }, 800);
      return true;
    }
  });
})();
