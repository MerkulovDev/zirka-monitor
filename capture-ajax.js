// Скрипт для захоплення AJAX запиту з Network tab
// 1. Відкрий https://www.dtek-krem.com.ua/ua/shutdowns
// 2. Відкрий DevTools -> Network
// 3. Заповни форму (місто, вулиця, будинок) вручну
// 4. В Network знайди запит на /ua/ajax
// 5. Клікни правою кнопкою -> Copy -> Copy as fetch
// 6. Встав сюди і запусти

fetch('https://www.dtek-krem.com.ua/ua/ajax', {
  'headers': {
    // Встав сюди headers з Copy as fetch
  },
  'body': // Встав сюди body з Copy as fetch
  'method': 'POST',
}).then(r => r.text()).then(console.log);

