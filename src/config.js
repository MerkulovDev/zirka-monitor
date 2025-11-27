const path = require('path');

// Перевірка чи це TEST режим (якщо запущено monitor-test.js)
const isTestMode = process.argv[1] && process.argv[1].includes('monitor-test.js');

// Конфігурація
const CONFIG = {
  URL: 'https://www.dtek-krem.com.ua/ua/shutdowns',
  ADDRESS_CITY: process.env.ADDRESS_CITY || '',
  ADDRESS_STREET: process.env.ADDRESS_STREET || '',
  ADDRESS_HOUSE: process.env.ADDRESS_HOUSE || '',
  STATE_FILE: isTestMode 
    ? path.join(__dirname, '..', 'data', 'last_known_schedule_test.json')
    : path.join(__dirname, '..', 'data', 'last_known_schedule.json'),
};

// Перевірка наявності адреси
function validateConfig() {
  if (!CONFIG.ADDRESS_CITY || !CONFIG.ADDRESS_STREET || !CONFIG.ADDRESS_HOUSE) {
    console.error('❌ Помилка: Адреса не налаштована!');
    console.error('Встановіть змінні середовища: ADDRESS_CITY, ADDRESS_STREET, ADDRESS_HOUSE');
    process.exit(1);
  }
}

module.exports = {
  CONFIG,
  validateConfig,
};

