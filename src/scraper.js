const puppeteer = require('puppeteer');
const { CONFIG } = require('./config');

// Функція для очікування завантаження DisconSchedule.fact
async function waitForFactData(page, maxRetries = 15) {
  let factData = null;
  let retries = 0;
  
  while (!factData && retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      factData = await page.evaluate(() => {
        if (typeof DisconSchedule !== 'undefined' && DisconSchedule.fact) {
          return DisconSchedule.fact;
        }
        return null;
      });
    } catch (error) {
      console.log(`⚠️  Помилка при спробі ${retries + 1}: ${error.message}`);
      // Якщо контекст знищений, спробуємо перезавантажити сторінку
      if (error.message.includes('context was destroyed') || error.message.includes('navigation')) {
        console.log('🔄 Перезавантажуємо сторінку...');
        await page.goto(CONFIG.URL, {
          waitUntil: 'networkidle0',
          timeout: 60000
        });
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    retries++;
    if (!factData) {
      console.log(`⏳ Спроба ${retries}/${maxRetries}...`);
    }
  }
  
  if (!factData) {
    // Остання спроба після довшого очікування
    console.log('⏳ Остання спроба після 10 секунд...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    try {
      factData = await page.evaluate(() => {
        if (typeof DisconSchedule !== 'undefined' && DisconSchedule.fact) {
          return DisconSchedule.fact;
        }
        return null;
      });
    } catch (error) {
      console.error('❌ Помилка в останній спробі:', error.message);
    }
  }
  
  return factData;
}

// Функція для пошуку групи для адреси
async function findGroupForAddress(page, factData, csrfToken) {
  console.log('🔍 Шукаємо групу для адреси...');
  
  const searchResult = await page.evaluate(async (city, street, update, csrf) => {
    const ajaxUrl = document.querySelector('meta[name="ajaxUrl"]')?.getAttribute('content') || '/ua/ajax';
    const fullUrl = ajaxUrl.startsWith('http') ? ajaxUrl : `${window.location.origin}${ajaxUrl}`;
    
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
      
      return await response.json();
    } catch (error) {
      return { error: error.message };
    }
  }, CONFIG.ADDRESS_CITY, CONFIG.ADDRESS_STREET, factData.update, csrfToken);
  
  if (searchResult.error) {
    throw new Error('Помилка пошуку адреси: ' + searchResult.error);
  }
  
  // Діагностика: виводимо що отримали від сервера
  if (!searchResult.result || !searchResult.data) {
    console.error('❌ Неочікуваний формат відповіді від сервера');
    console.error('Відповідь сервера:', JSON.stringify(searchResult, null, 2));
    throw new Error('Неочікуваний формат відповіді від сервера');
  }
  
  // Шукаємо будинок
  const houseKey = CONFIG.ADDRESS_HOUSE.toUpperCase();
  const houseKeyAlt1 = houseKey.replace('А', '-А');
  const houseKeyAlt2 = houseKey.replace('А', 'A');
  
  let houseData = searchResult.data[houseKey] || 
                 searchResult.data[houseKeyAlt1] || 
                 searchResult.data[houseKeyAlt2];
  
  if (!houseData) {
    const matchingKey = Object.keys(searchResult.data).find(key => 
      key === houseKey || key === houseKeyAlt1 || key === houseKeyAlt2 ||
      key.startsWith(houseKey) || key.includes(houseKey) ||
      key.startsWith(houseKeyAlt1) || key.includes(houseKeyAlt1)
    );
    if (matchingKey) {
      houseData = searchResult.data[matchingKey];
    }
  }
  
  if (!houseData || !houseData.sub_type_reason || houseData.sub_type_reason.length === 0) {
    throw new Error(`Будинок ${CONFIG.ADDRESS_HOUSE} не знайдено або група не визначена`);
  }
  
  const group = houseData.sub_type_reason[0];
  console.log(`✅ Знайдено групу: ${group}`);

  const updateTimestamp = searchResult.updateTimestamp || null;
  const subType = (houseData.sub_type || '').trim();
  const hasSubType = subType.length > 0;
  const normalizedSubType = subType.toLowerCase();
  const isEmergency = normalizedSubType.includes('екстрен') && normalizedSubType.includes('відключ');
  const isStabilization = normalizedSubType.includes('стабілізаційне відключення');

  const outageUpdateKey = updateTimestamp || null;
  let outageMessage = null;
  let outageMessageBase = null;
  let outageSignature = null;
  let outageStatus = 'none';
  if (!hasSubType) {
    outageStatus = 'cleared';
  } else if (isEmergency) {
    outageStatus = 'active';
  } else if (isStabilization) {
    outageStatus = 'stabilization';
  } else {
    outageStatus = 'unknown';
  }

  // Повідомлення в ТГ тільки для екстрених; стабілізаційні поки не відправляємо
  if (searchResult.showCurOutageParam && hasSubType && isEmergency) {
    const startDate = houseData.start_date || '';
    const endDate = houseData.end_date || '';
    const messageLines = [
      subType,
      startDate ? `Час початку – ${startDate}` : null,
      endDate ? `Орієнтовний час відновлення електроенергії – до ${endDate}` : null,
      updateTimestamp ? `Дата оновлення інформації – ${updateTimestamp}` : null,
    ];
    if (isEmergency) {
      messageLines.push(
        '',
        'Увага!',
        'Графіки стабілізаційних відключень не діють. Час відновлення світла може змінюватись відповідно до ситуації в енергосистемі та команд НЕК Укренерго'
      );
    }
    const filteredLines = messageLines.filter((line) => line !== null);
    outageMessage = filteredLines.join('\n');
    const updateLinePrefix = 'Дата оновлення інформації – ';
    outageMessageBase = filteredLines
      .map((line) => line.trim())
      .filter((line) => !line.startsWith(updateLinePrefix))
      .join('\n');
    outageSignature = JSON.stringify({
      subType,
      startDate,
      endDate
    });
    console.log('⚠️  Виявлено екстрене відключення для адреси');
  } else if (hasSubType && isStabilization) {
    console.log('ℹ️  Стабілізаційне відключення (повідомлення в ТГ вимкнено)');
  }
  
  return { group, outageMessage, outageMessageBase, outageSignature, outageUpdateKey, outageStatus };
}

// Основна функція скрапінгу
async function scrapeSchedule() {
  let browser;
  
  try {
    console.log('🌐 Завантажуємо сторінку...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    // Чекаємо додатково, щоб Incapsula встигла пройти перевірку
    console.log('⏳ Чекаємо стабілізації сторінки (10 секунд)...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Чекаємо, поки DisconSchedule.fact завантажиться
    console.log('⏳ Чекаємо завантаження DisconSchedule.fact...');
    const factData = await waitForFactData(page);
    
    if (!factData) {
      throw new Error('Не вдалося витягти DisconSchedule.fact після очікування');
    }
    
    console.log('✅ Графік отримано (оновлено:', factData.update + ')');
    
    // Отримуємо CSRF токен
    const csrfToken = await page.evaluate(() => {
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      return metaTag ? metaTag.getAttribute('content') : null;
    });
    
    if (!csrfToken) {
      throw new Error('CSRF токен не знайдено');
    }
    
    // Шукаємо групу для адреси
    const { group, outageMessage, outageMessageBase, outageSignature, outageUpdateKey, outageStatus } = await findGroupForAddress(page, factData, csrfToken);
    
    // Витягуємо графік для групи (сьогодні та завтра)
    const dayKeys = Object.keys(factData.data || {}).sort();
    if (dayKeys.length === 0) {
      throw new Error('Графіки не знайдено в factData.data');
    }
    
    const todayKey = dayKeys[0];
    const tomorrowKey = dayKeys.length > 1 ? dayKeys[1] : null;
    
    if (!factData.data[todayKey] || !factData.data[todayKey][group]) {
      throw new Error(`Графік для групи ${group} не знайдено`);
    }
    
    const groupSchedule = factData.data[todayKey][group];
    
    // Отримуємо графік на завтра, якщо він є
    let tomorrowSchedule = null;
    if (tomorrowKey && factData.data[tomorrowKey] && factData.data[tomorrowKey][group]) {
      tomorrowSchedule = {};
      const tomorrowGroupSchedule = factData.data[tomorrowKey][group];
      for (let hour = 1; hour <= 24; hour++) {
        tomorrowSchedule[String(hour)] = tomorrowGroupSchedule[String(hour)] || 'yes';
      }
      console.log('📅 Графік на завтра знайдено');
    }
    
    await browser.close();
    
    return {
      factData,
      group,
      groupSchedule,
      tomorrowSchedule,
      outageMessage,
      outageMessageBase,
      outageSignature,
      outageUpdateKey,
      outageStatus,
    };
    
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

module.exports = {
  scrapeSchedule,
};

