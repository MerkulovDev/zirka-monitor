const puppeteer = require('puppeteer');

/**
 * Запустити браузер
 */
async function launchBrowser() {
  console.log('🚀 Запуск браузера...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

/**
 * Створити нову сторінку
 */
async function createPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  return page;
}

/**
 * Завантажити сторінку та зачекати поки Incapsula завантажиться
 */
async function loadPage(page, url) {
  console.log('🌐 Завантаження сторінки...');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForIncapsula(page);
  return page;
}

/**
 * Зачекати поки Incapsula завантажиться
 */
async function waitForIncapsula(page) {
  try {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const modalOverlay = await page.$('.modal__overlay');
    if (modalOverlay) {
      console.log('Закриваю модалку...');
      const closeButtons = ['.modal__close.m-attention__close', '.modal__close', 'button.modal__close'];
      for (const selector of closeButtons) {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log('✓ Модалку закрито');
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✓ Сторінка готова');
  } catch (error) {
    console.log('⚠️ Помилка очікування');
  }
}

/**
 * Заповнити форму адреси
 */
async function fillAddressForm(page, city, street, house) {
  console.log(`📝 Заповнення форми: ${city}, ${street}, ${house}`);
  
  try {
    // Заповнюємо місто
    const cityInput = await page.$('#city');
    if (!cityInput) {
      throw new Error('Поле міста не знайдено');
    }
    
    await cityInput.click({ clickCount: 3 }); // Виділяємо текст якщо є
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.evaluate((cityVal) => {
      const input = document.getElementById('city');
      if (input) {
        input.value = cityVal;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, city);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Клікаємо автокомпліт
    const cityAutocomplete = await page.$('#cityautocomplete-list');
    if (cityAutocomplete) {
      const firstOption = await cityAutocomplete.$('li:first-child');
      if (firstOption) {
        await firstOption.click();
        console.log('✓ Місто вибрано');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Заповнюємо вулицю
    const streetInput = await page.$('#street');
    if (!streetInput) {
      throw new Error('Поле вулиці не знайдено');
    }
    
    await streetInput.click({ clickCount: 3 }); // Виділяємо текст якщо є
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.evaluate((streetVal) => {
      const input = document.getElementById('street');
      if (input) {
        input.value = streetVal;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, street);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Клікаємо автокомпліт
    const streetAutocomplete = await page.$('#streetautocomplete-list');
    if (streetAutocomplete) {
      const firstOption = await streetAutocomplete.$('li:first-child');
      if (firstOption) {
        await firstOption.click();
        console.log('✓ Вулиця вибрано');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Заповнюємо будинок
    const houseInput = await page.$('#house_num');
    if (!houseInput) {
      throw new Error('Поле будинку не знайдено');
    }
    
    await houseInput.click({ clickCount: 3 }); // Виділяємо текст якщо є
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.evaluate((houseVal) => {
      const input = document.getElementById('house_num');
      if (input) {
        input.value = houseVal;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, house);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Клікаємо автокомпліт
    const houseAutocomplete = await page.$('#house_numautocomplete-list');
    if (houseAutocomplete) {
      const firstOption = await houseAutocomplete.$('li:first-child');
      if (firstOption) {
        await firstOption.click();
        console.log('✓ Будинок вибрано');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('✓ Форма заповнена');
    return true;
  } catch (error) {
    console.error('❌ Помилка заповнення форми:', error.message);
    return false;
  }
}

/**
 * Отримати cookies та headers зі сторінки
 */
async function getCookiesAndHeaders(page) {
  const cookies = await page.cookies();
  const headers = await page.evaluate(() => ({ userAgent: navigator.userAgent }));
  console.log(`Отримано cookies: ${cookies.length}`);
  return { cookies, headers };
}

module.exports = {
  launchBrowser,
  createPage,
  loadPage,
  waitForIncapsula,
  fillAddressForm,
  getCookiesAndHeaders,
};

