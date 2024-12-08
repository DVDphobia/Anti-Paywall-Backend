const express = require('express');
const puppeteer = require('puppeteer');
const Search = require('../models/Search');
const { auth, optionalAuth } = require('../middleware/auth');
const randomUseragent = require('random-useragent');
const router = express.Router();

// Bypass paywall without requiring authentication
router.post('/bypass', async (req, res) => {
  try {
    const { url } = req.body;
    const userId = req.user?.id;

    // Validate URL
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Random delay between 1-3 seconds
    const delay = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Launch puppeteer
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      executablePath: process.env.GOOGLE_CHROME_BIN || null
    });

    try {
      const page = await browser.newPage();
      
      // Get random user agent
      const userAgent = randomUseragent.getRandom(function (ua) {
        return ua.browserName === 'Chrome' || ua.browserName === 'Firefox';
      });
      
      await page.setUserAgent(userAgent);

      // Set additional headers to look more like a real browser
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });

      // Enable JavaScript
      await page.setJavaScriptEnabled(true);
      
      // Random viewport size
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
        { width: 1536, height: 864 }
      ];
      const randomViewport = viewports[Math.floor(Math.random() * viewports.length)];
      await page.setViewport(randomViewport);

      await page.goto(url, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });

      // Extract styles and content
      const content = await page.evaluate(() => {
        // Get all style tags and external stylesheets
        const styleSheets = Array.from(document.styleSheets);
        let styles = '';

        // Extract inline styles
        document.querySelectorAll('style').forEach(style => {
          styles += style.innerHTML;
        });

        // Extract external stylesheets
        styleSheets.forEach(sheet => {
          try {
            if (sheet.href) {
              const rules = Array.from(sheet.cssRules);
              rules.forEach(rule => {
                styles += rule.cssText;
              });
            }
          } catch (e) {
            // Skip cross-origin stylesheets
            console.log('Could not access stylesheet:', e);
          }
        });

        // Remove unwanted elements
        const unwantedSelectors = [
          'script',
          'iframe',
          'nav',
          'header',
          'footer',
          '.ads',
          '#ads',
          '.ad-container',
          '.subscription-wall',
          '.paywall',
          '.newsletter-signup',
          '.popup',
          '.modal'
        ];
        
        unwantedSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Get the main content
        const article = document.querySelector('article') || 
                       document.querySelector('.article') || 
                       document.querySelector('.post-content') || 
                       document.querySelector('.content') ||
                       document.body;
        
        return `
          <style>${styles}</style>
          <div class="bypassed-content">
            ${article.innerHTML}
          </div>
        `;
      });

      // Save search history if user is authenticated
      if (userId) {
        await new Search({
          userId,
          url,
          userAgent: process.env.NODE_ENV === 'development' ? userAgent : undefined
        }).save();
      }

      res.json({ content });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('Bypass error:', error);
    res.status(500).json({ 
      error: 'Failed to bypass paywall',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Protected routes that require authentication
router.get('/history', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const searches = await Search.find({ userId: req.user.id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Search.countDocuments({ userId: req.user.id });

    res.json({
      searches,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        hasMore: skip + searches.length < total
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch search history' });
  }
});

// Delete search history entry (protected route)
router.delete('/history/:id', auth, async (req, res) => {
  try {
    const search = await Search.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!search) {
      return res.status(404).json({ error: 'Search entry not found' });
    }

    res.json({ message: 'Search entry deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete search entry' });
  }
});

module.exports = router; 