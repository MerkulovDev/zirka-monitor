const puppeteer = require('puppeteer');

const URL = 'https://www.dtek-krem.com.ua/ua/shutdowns';
// Адреса для пошуку групи: місто, вулиця, будинок
const ADDRESS_CITY = 'м. Вишгород';
const ADDRESS_STREET = 'вул. Кургузова';
const ADDRESS_HOUSE = '1А';

async function testGetRequest() {
  let browser;
  
  try {
    console.log('🔍 Крок 1: Тестуємо GET запит через Puppeteer до', URL);
    console.log('⏳ Запускаємо браузер...\n');
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    
    // Встановлюємо User-Agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('🌐 Переходимо на сторінку...');
    await page.goto(URL, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    // Чекаємо трохи, щоб Incapsula встигла пройти перевірку
    console.log('⏳ Чекаємо завантаження контенту (чекаємо 5 секунд)...');
    await page.waitForTimeout(5000);
    
    // Отримуємо HTML сторінки
    const html = await page.content();
    
    console.log('✅ Сторінка завантажена!');
    console.log('📏 Розмір HTML:', html.length, 'символів');
    
    // Витягуємо DisconSchedule.fact з глобального об'єкта браузера
    console.log('\n🔍 Витягуємо DisconSchedule.fact з глобального контексту браузера...');
    
    try {
      // Використовуємо page.evaluate для доступу до глобальних об'єктів
      const factData = await page.evaluate(() => {
        if (typeof DisconSchedule !== 'undefined' && DisconSchedule.fact) {
          return DisconSchedule.fact;
        }
        return null;
      });
      
      if (factData) {
        console.log('✅ Успішно витягнуто DisconSchedule.fact!');
        console.log('\n📊 Структура даних:');
        console.log('  - today:', factData.today);
        console.log('  - update:', factData.update);
        console.log('  - Кількість днів в data:', Object.keys(factData.data || {}).length);
        
        // Функції для обробки графіку
        function getTimeRange(hour) {
          // Година 1 = 00-01, година 2 = 01-02, ..., година 24 = 23-24
          const startHour = String(hour - 1).padStart(2, '0');
          const endHour = String(hour).padStart(2, '0');
          return `${startHour}:00-${endHour}:00`;
        }
        
        function interpretHourValue(hour, value) {
          // Година 1 = проміжок 00-01, година 2 = 01-02, ..., година 24 = 23-24
          const startHour = hour - 1;
          const endHour = hour;
          const startStr = String(startHour).padStart(2, '0');
          const endStr = String(endHour).padStart(2, '0');
          
          switch(value) {
            case 'yes':
              return `✅ Світло є (${startStr}:00-${endStr}:00)`;
            case 'no':
              return `❌ Відключення весь проміжок ${startStr}:00-${endStr}:00`;
            case 'first':
              return `⚠️ Відключення з ${startStr}:00 до ${startStr}:30`;
            case 'second':
              return `⚠️ Відключення з ${startStr}:30 до ${endStr}:00`;
            default:
              return `❓ Невідоме значення "${value}"`;
          }
        }
        
        // Крок 2: Витягуємо CSRF токен та cookies для другого запиту
        console.log('\n🔍 Крок 2: Витягуємо CSRF токен та cookies...');
        
        const csrfToken = await page.evaluate(() => {
          const metaTag = document.querySelector('meta[name="csrf-token"]');
          return metaTag ? metaTag.getAttribute('content') : null;
        });
        
        const cookies = await page.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        console.log('✅ CSRF токен:', csrfToken ? csrfToken.substring(0, 20) + '...' : 'не знайдено');
        console.log('✅ Cookies:', cookies.length, 'шт');
        
        if (!csrfToken) {
          console.log('⚠️  CSRF токен не знайдено, спробуємо продовжити...');
        }
        
        // Крок 3: Робимо POST запит для пошуку адреси та отримання групи
        const fullAddress = `${ADDRESS_CITY}, ${ADDRESS_STREET}, ${ADDRESS_HOUSE}`;
        console.log('\n🔍 Крок 3: Шукаємо групу для адреси:', fullAddress);
        console.log('  - Місто:', ADDRESS_CITY);
        console.log('  - Вулиця:', ADDRESS_STREET);
        console.log('  - Будинок:', ADDRESS_HOUSE);
        console.log('  - Update:', factData.update);
        
        try {
          // Використовуємо page.evaluate для виконання fetch в контексті браузера
          const searchResult = await page.evaluate(async (city, street, update, csrf) => {
            const ajaxUrl = document.querySelector('meta[name="ajaxUrl"]')?.getAttribute('content') || '/ua/ajax';
            const fullUrl = ajaxUrl.startsWith('http') ? ajaxUrl : `${window.location.origin}${ajaxUrl}`;
            
            // Формуємо body згідно curl запиту
            const params = new URLSearchParams();
            params.append('method', 'getHomeNum');
            params.append('data[0][name]', 'city');
            params.append('data[0][value]', city);
            params.append('data[1][name]', 'street');
            params.append('data[1][value]', street);
            params.append('data[2][name]', 'updateFact');
            params.append('data[2][value]', update);
            
            try {
              const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                  'accept': 'application/json, text/javascript, */*; q=0.01',
                  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'x-csrf-token': csrf,
                  'x-requested-with': 'XMLHttpRequest',
                  'referer': window.location.href
                },
                body: params.toString()
              });
              
              const data = await response.json();
              return data;
            } catch (error) {
              return { error: error.message };
            }
          }, ADDRESS_CITY, ADDRESS_STREET, factData.update, csrfToken);
          
          console.log('📥 Відповідь від сервера:', JSON.stringify(searchResult, null, 2));
          
          if (searchResult.error) {
            console.error('❌ Помилка при пошуку адреси:', searchResult.error);
          } else if (searchResult.result && searchResult.data) {
            // Шукаємо будинок в даних
            // Спробуємо різні варіанти написання
            const houseKey = ADDRESS_HOUSE.toUpperCase(); // 1А -> 1А
            const houseKeyAlt1 = houseKey.replace('А', '-А'); // 1-А
            const houseKeyAlt2 = houseKey.replace('А', 'A'); // 1A (латинська A)
            const houseKeyAlt3 = houseKey.replace(/А/g, 'А'); // залишаємо як є
            
            console.log('🔍 Шукаємо будинок серед доступних ключів...');
            console.log('  Шукаємо:', houseKey);
            console.log('  Альтернативи:', houseKeyAlt1, houseKeyAlt2);
            console.log('  Перші 5 доступних ключів:', Object.keys(searchResult.data).slice(0, 5).join(', '));
            
            let houseData = searchResult.data[houseKey];
            let foundKey = houseKey;
            
            if (!houseData) {
              houseData = searchResult.data[houseKeyAlt1];
              if (houseData) foundKey = houseKeyAlt1;
            }
            
            if (!houseData) {
              houseData = searchResult.data[houseKeyAlt2];
              if (houseData) foundKey = houseKeyAlt2;
            }
            
            if (!houseData) {
              // Шукаємо частковий збіг (наприклад "1А" може бути в ключі "1АКОРП.1")
              const matchingKey = Object.keys(searchResult.data).find(key => 
                key === houseKey || key === houseKeyAlt1 || key === houseKeyAlt2 ||
                key.startsWith(houseKey) || key.includes(houseKey) ||
                key.startsWith(houseKeyAlt1) || key.includes(houseKeyAlt1)
              );
              if (matchingKey) {
                houseData = searchResult.data[matchingKey];
                foundKey = matchingKey;
                console.log('📌 Знайдено частковий збіг для ключа:', matchingKey);
              }
            }
            
            if (houseData && houseData.sub_type_reason && houseData.sub_type_reason.length > 0) {
              // Беремо першу групу з масиву
              const group = houseData.sub_type_reason[0];
              console.log('✅ Знайдено будинок "' + foundKey + '" з групою:', group);
              
              if (houseData.sub_type_reason.length > 1) {
                console.log('ℹ️  Також доступні групи:', houseData.sub_type_reason.slice(1).join(', '));
              }
              
              // Крок 4: Витягуємо графік відключень для знайденої групи
              console.log('\n🔍 Крок 4: Витягуємо графік відключень для групи', group);
              
              const firstDayKey = Object.keys(factData.data || {})[0];
              if (firstDayKey && factData.data[firstDayKey][group]) {
                const groupSchedule = factData.data[firstDayKey][group];
                console.log('✅ Графік знайдено!');
                console.log('\n📅 Графік відключень для групи', group, 'на', new Date(parseInt(firstDayKey) * 1000).toLocaleDateString('uk-UA'));
                
                // Формуємо детальний графік
                const schedule = [];
                for (let hour = 1; hour <= 24; hour++) {
                  const value = groupSchedule[String(hour)];
                  const range = getTimeRange(hour);
                  const interpretation = interpretHourValue(hour, value);
                  if (value !== 'yes') {
                    schedule.push({ hour, range, value, interpretation });
                  }
                }
                
                if (schedule.length > 0) {
                  console.log('\n⚡ Періоди відключення:');
                  schedule.forEach(({ hour, range, interpretation }) => {
                    console.log(`  ${range}: ${interpretation}`);
                  });
                } else {
                  console.log('\n✅ Відключень не заплановано - світло буде весь день!');
                }
              } else {
                console.log('⚠️  Графік для групи', group, 'не знайдено в даних');
                if (firstDayKey) {
                  console.log('Доступні групи:', Object.keys(factData.data[firstDayKey] || {}).join(', '));
                }
              }
            } else {
              console.log('⚠️  Будинок', ADDRESS_HOUSE, '(варіанти:', houseKey, houseKeyAlt1, houseKeyAlt2 + ') не знайдено в списку доступних будинків.');
              console.log('Доступні будинки (перші 15):', Object.keys(searchResult.data || {}).slice(0, 15).join(', '));
            }
          } else {
            console.log('⚠️  Неочікуваний формат відповіді від сервера.');
          }
        } catch (error) {
          console.error('❌ Помилка при пошуку адреси:', error.message);
          console.error(error.stack);
        }
        
        // Показуємо приклад першого дня з детальною інформацією
        const firstDayKey = Object.keys(factData.data || {})[0];
        if (firstDayKey) {
          console.log('\n📅 Приклад даних для першого дня (timestamp:', firstDayKey, '):');
          const firstDay = factData.data[firstDayKey];
          const firstGroup = Object.keys(firstDay)[0];
          if (firstGroup) {
            console.log('  - Група:', firstGroup);
            console.log('  - Кількість годин:', Object.keys(firstDay[firstGroup]).length);
            
          }
        }
        
        // Зберігаємо повний об'єкт
        const fs = require('fs');
        fs.writeFileSync('discon_fact.json', JSON.stringify(factData, null, 2));
        console.log('\n💾 Дані збережено в discon_fact.json');
      } else {
        console.log('⚠️  DisconSchedule.fact не знайдено в глобальному контексті');
        console.log('Перевіряємо чи DisconSchedule взагалі існує...');
        
        const hasDisconSchedule = await page.evaluate(() => {
          return typeof DisconSchedule !== 'undefined';
        });
        
        if (hasDisconSchedule) {
          console.log('✅ DisconSchedule існує, але DisconSchedule.fact =', await page.evaluate(() => DisconSchedule.fact));
        } else {
          console.log('⚠️  DisconSchedule не знайдено. Можливо потрібно чекати довше...');
          console.log('Шукаємо в HTML напряму...');
          const scriptMatch = html.match(/DisconSchedule\.fact\s*=\s*\{/);
          if (scriptMatch) {
            console.log('✅ Знайдено DisconSchedule.fact в HTML, але не виконався скрипт');
          }
        }
      }
    } catch (error) {
      console.error('❌ Помилка при витягуванні DisconSchedule.fact:', error.message);
      console.error(error.stack);
    }
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Помилка при виконанні запиту:');
    console.error('  Помилка:', error.message);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

// Запускаємо тест
testGetRequest();

