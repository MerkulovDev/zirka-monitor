// Скопіюй і встав цей код в Console браузера
// на сторінці https://www.dtek-krem.com.ua/ua/shutdowns

(async function testDTEK() {
  console.log('🚀 Початок тесту...');
  
  try {
    // Заповнюємо місто
    const cityInput = document.getElementById('city');
    if (!cityInput) {
      console.error('❌ Поле міста не знайдено');
      return;
    }
    
    cityInput.click();
    await new Promise(r => setTimeout(r, 500));
    cityInput.value = 'м. Вишгород';
    cityInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2000));
    
    // Клікаємо автокомпліт
    const cityAutocomplete = document.getElementById('cityautocomplete-list');
    if (cityAutocomplete && cityAutocomplete.children.length > 0) {
      cityAutocomplete.children[0].click();
      console.log('✅ Місто вибрано');
    }
    await new Promise(r => setTimeout(r, 1500));
    
    // Заповнюємо вулицю
    const streetInput = document.getElementById('street');
    if (!streetInput || streetInput.disabled) {
      console.error('❌ Поле вулиці не доступне');
      return;
    }
    
    streetInput.click();
    await new Promise(r => setTimeout(r, 500));
    streetInput.value = 'вул. Шолуденка';
    streetInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2000));
    
    // Клікаємо автокомпліт
    const streetAutocomplete = document.getElementById('streetautocomplete-list');
    if (streetAutocomplete && streetAutocomplete.children.length > 0) {
      streetAutocomplete.children[0].click();
      console.log('✅ Вулиця вибрано');
    }
    await new Promise(r => setTimeout(r, 1500));
    
    // Заповнюємо будинок
    const houseInput = document.getElementById('house_num');
    if (!houseInput || houseInput.disabled) {
      console.error('❌ Поле будинку не доступне');
      return;
    }
    
    houseInput.click();
    await new Promise(r => setTimeout(r, 500));
    houseInput.value = '18А';
    houseInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2000));
    
    // Клікаємо автокомпліт
    const houseAutocomplete = document.getElementById('house_numautocomplete-list');
    if (houseAutocomplete && houseAutocomplete.children.length > 0) {
      houseAutocomplete.children[0].click();
      console.log('✅ Будинок вибрано');
    }
    await new Promise(r => setTimeout(r, 2000));
    
    // Отримуємо дані
    const groupDiv = document.getElementById('group-name');
    const group = groupDiv ? groupDiv.textContent.trim() : null;
    
    const table = document.querySelector('table');
    const scheduledCells = table ? table.querySelectorAll('.cell-scheduled, .cell-first-half, .cell-second-half') : [];
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 РЕЗУЛЬТАТ:');
    console.log('Група:', group);
    console.log('Комірок з розкладом:', scheduledCells.length);
    
    if (scheduledCells.length > 0) {
      const headers = Array.from(table.querySelectorAll('th[scope="col"] div'));
      const timeSlots = [];
      
      scheduledCells.forEach((cell) => {
        const row = cell.closest('tr');
        const cellIndex = Array.from(row.cells).indexOf(cell);
        const headerIndex = cellIndex - 2;
        
        if (headerIndex >= 0 && headerIndex < headers.length) {
          const timeText = headers[headerIndex].textContent.trim();
          const cellType = cell.classList.contains('cell-first-half') ? '30' :
                          cell.classList.contains('cell-second-half') ? '30' : '00';
          timeSlots.push({ time: timeText, type: cellType });
        }
      });
      
      console.log('Періоди відключення:', timeSlots);
    } else {
      console.log('⚠️ Таблиця порожня');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('❌ Помилка:', error);
  }
})();

