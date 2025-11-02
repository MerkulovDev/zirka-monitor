// AJAX запит для тесту в консолі браузера
// Відкрий https://www.dtek-krem.com.ua/ua/shutdowns і відкрий DevTools -> Console

(async function testAJAX() {
  console.log('🚀 Початок AJAX тесту...');
  
  try {
    // Отримуємо всі cookies
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const [name, value] = cookie.trim().split('=');
      acc[name] = value;
      return acc;
    }, {});
    
    // Формуємо cookie string
    const cookieStr = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    
    console.log('Cookies:', cookieStr.substring(0, 100) + '...');
    
    // Знаходимо CSRF токен з HTML
    let csrfToken = '';
    try {
      // Шукаємо в meta тегах
      const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
      if (metaToken) {
        csrfToken = metaToken;
      }
    } catch (e) {}
    
    // Якщо не знайшли в meta, шукаємо в скрипті або інших місцях
    if (!csrfToken) {
      try {
        // Шукаємо в window object
        if (window.csrfToken) {
          csrfToken = window.csrfToken;
        }
      } catch (e) {}
    }
    
    console.log('CSRF token:', csrfToken || 'не знайдено');
    
    // Отримуємо значення updateFact з форми
    const updateFactInput = document.querySelector('input[name="updateFact"]');
    const updateFact = updateFactInput ? updateFactInput.value : new Date().toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(',', '');
    
    console.log('UpdateFact:', updateFact);
    
    // Формуємо параметри запиту
    const params = new URLSearchParams();
    params.append('method', 'getHomeNum');
    params.append('data[0][name]', 'city');
    params.append('data[0][value]', 'м. Вишгород');
    params.append('data[1][name]', 'street');
    params.append('data[1][value]', 'вул. Шолуденка');
    params.append('data[2][name]', 'updateFact');
    params.append('data[2][value]', updateFact);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 Відправка AJAX запиту...');
    
    // Виконуємо AJAX запит
    const response = await fetch('/ua/ajax', {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'uk-UA,uk;q=0.9',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'cookie': cookieStr,
        'origin': 'https://www.dtek-krem.com.ua',
        'referer': 'https://www.dtek-krem.com.ua/ua/shutdowns',
        'user-agent': navigator.userAgent,
        'x-csrf-token': csrfToken,
        'x-requested-with': 'XMLHttpRequest',
      },
      body: params.toString()
    });
    
    const responseText = await response.text();
    console.log('📥 Відповідь статус:', response.status, response.statusText);
    console.log('📥 Відповідь текст:', responseText.substring(0, 300));
    
    // Парсимо JSON
    try {
      const json = JSON.parse(responseText);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ РЕЗУЛЬТАТ:');
      console.log(JSON.stringify(json, null, 2));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } catch (e) {
      console.error('❌ Не вдалося парсити JSON:', e.message);
    }
    
  } catch (error) {
    console.error('❌ Помилка:', error);
  }
})();

