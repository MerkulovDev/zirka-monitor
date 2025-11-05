const path = require('path');

// Конфігурація
const CONFIG = {
  URL: 'https://www.dtek-krem.com.ua/ua/shutdowns',
  ADDRESS_CITY: process.env.ADDRESS_CITY || '',
  ADDRESS_STREET: process.env.ADDRESS_STREET || '',
  ADDRESS_HOUSE: process.env.ADDRESS_HOUSE || '',
  STATE_FILE: path.join(__dirname, '..', 'data', 'last_known_schedule.json'),
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

