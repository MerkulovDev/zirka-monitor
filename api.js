const https = require('https');

/**
 * Отримати CSRF токен зі сторінки
 */
async function getCsrfToken(page) {
  try {
    const csrfToken = await page.evaluate(() => {
      const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
      if (metaToken) return metaToken;
      
      const scripts = document.querySelectorAll('script');
      for (let script of scripts) {
        const text = script.textContent || script.innerText;
        const match = text.match(/csrf[_-]?token['"]?\s*[:=]\s*['"]([^'"]+)['"]/i);
        if (match) return match[1];
      }
      
      if (window.csrfToken) return window.csrfToken;
      if (window.csrf_token) return window.csrf_token;
      return '';
    });
    return csrfToken;
  } catch (e) {
    console.log('CSRF токен не знайдено');
    return '';
  }
}

/**
 * Зробити AJAX запит для отримання групи
 */
async function getGroupViaAPI(page, cookies, headers, city, street, house) {
  try {
    console.log('📡 AJAX запит: отримання групи...');
    
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const csrfToken = await getCsrfToken(page);
    
    console.log(`CSRF токен: ${csrfToken ? '✓' : '✗'}`);
    
    const postData = new URLSearchParams({
      method: 'getHomeNum',
      'data[0][name]': 'city',
      'data[0][value]': city,
      'data[1][name]': 'street',
      'data[1][value]': street,
      'data[2][name]': 'updateFact',
      'data[2][value]': new Date().toLocaleString('uk-UA', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(',', '')
    });
    
    const options = {
      hostname: 'www.dtek-krem.com.ua',
      port: 443,
      path: '/ua/ajax',
      method: 'POST',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'uk-UA,uk;q=0.9',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'cookie': cookieStr,
        'origin': 'https://www.dtek-krem.com.ua',
        'referer': 'https://www.dtek-krem.com.ua/ua/shutdowns',
        'user-agent': headers.userAgent,
        'x-csrf-token': csrfToken,
        'x-requested-with': 'XMLHttpRequest',
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log(`AJAX відповідь (${res.statusCode}):`, data.substring(0, 100) + '...');
          try {
            const json = JSON.parse(data);
            console.log('✓ AJAX відповідь парсед');
            resolve(json);
          } catch (e) {
            console.log('✗ Помилка парсингу AJAX');
            resolve(null);
          }
        });
      });
      
      req.on('error', (e) => {
        console.error('Помилка AJAX запиту:', e.message);
        resolve(null);
      });
      
      req.write(postData.toString());
      req.end();
    });
  } catch (error) {
    console.error('Помилка AJAX:', error.message);
    return null;
  }
}

module.exports = {
  getCsrfToken,
  getGroupViaAPI,
};

