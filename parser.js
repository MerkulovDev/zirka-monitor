/**
 * Парсинг HTML таблиць зі сторінки
 */
async function parsePageTables(page) {
  try {
    console.log('\n📄 Парсинг таблиць зі сторінки...');
    
    const tables = await page.evaluate(() => {
      const result = {
        factInfo: null,
        factTables: null,
        scheduleTable: null,
        debug: {
          factInfoFound: false,
          factTablesFound: false,
          scheduleTableFound: false,
          allScheduleTables: [],
          pageTitle: document.title,
          url: window.location.href,
        }
      };
      
      // Інформація про відключення (discon-fact-info)
      const factInfoEl = document.querySelector('.discon-fact-info');
      if (factInfoEl) {
        result.debug.factInfoFound = true;
        result.factInfo = factInfoEl.outerHTML;
        console.log('Знайдено .discon-fact-info');
      } else {
        // Шукаємо всі елементи з подібними класами
        const similar = document.querySelectorAll('[class*="discon"][class*="fact"]');
        if (similar.length > 0) {
          console.log(`Знайдено ${similar.length} подібних елементів`);
        }
      }
      
      // Таблиця відключень (discon-fact-tables)
      const factTablesEl = document.querySelector('.discon-fact-tables');
      if (factTablesEl) {
        result.debug.factTablesFound = true;
        result.factTables = factTablesEl.outerHTML;
        console.log('Знайдено .discon-fact-tables');
      } else {
        // Шукаємо всі елементи з подібними класами
        const similar = document.querySelectorAll('[class*="discon"][class*="table"]');
        if (similar.length > 0) {
          console.log(`Знайдено ${similar.length} подібних таблиць`);
        }
      }
      
      // Таблиця можливих відключень (discon-schedule-table active)
      const scheduleTableEl = document.querySelector('.discon-schedule-table.active');
      if (scheduleTableEl) {
        result.debug.scheduleTableFound = true;
        result.scheduleTable = scheduleTableEl.outerHTML;
        console.log('Знайдено .discon-schedule-table.active');
      }
      
      // Шукаємо всі таблиці розкладу для діагностики
      const allScheduleTables = document.querySelectorAll('.discon-schedule-table');
      result.debug.allScheduleTables = Array.from(allScheduleTables).map(el => ({
        classes: el.className,
        hasActive: el.classList.contains('active'),
        innerHTMLLength: el.innerHTML.length,
      }));
      
      return result;
    });
    
    // Детальне логування
    console.log('\n🔍 Діагностика парсингу:');
    console.log(`  URL сторінки: ${tables.debug.url}`);
    console.log(`  Заголовок: ${tables.debug.pageTitle}`);
    console.log(`  .discon-fact-info: ${tables.debug.factInfoFound ? '✓' : '✗'}`);
    console.log(`  .discon-fact-tables: ${tables.debug.factTablesFound ? '✓' : '✗'}`);
    console.log(`  .discon-schedule-table.active: ${tables.debug.scheduleTableFound ? '✓' : '✗'}`);
    console.log(`  Всього .discon-schedule-table знайдено: ${tables.debug.allScheduleTables.length}`);
    
    if (tables.debug.allScheduleTables.length > 0) {
      console.log('\n📋 Всі таблиці розкладу:');
      tables.debug.allScheduleTables.forEach((table, idx) => {
        console.log(`  ${idx + 1}. Класи: ${table.classes}`);
        console.log(`     Активна: ${table.hasActive ? '✓' : '✗'}, Розмір: ${table.innerHTMLLength} символів`);
      });
    }
    
    // Шукаємо альтернативні селектори якщо основні не знайдені
    if (!tables.factInfo && !tables.factTables && !tables.scheduleTable) {
      console.log('\n⚠️ Основні таблиці не знайдено, шукаємо альтернативи...');
      
      const alternatives = await page.evaluate(() => {
        const alt = {
          anyDisconTable: null,
          anyFactTable: null,
          anyScheduleTable: null,
        };
        
        // Шукаємо будь-яку таблицю з "discon"
        const anyDiscon = document.querySelector('[class*="discon"]');
        if (anyDiscon) {
          alt.anyDisconTable = {
            classes: anyDiscon.className,
            tagName: anyDiscon.tagName,
            htmlLength: anyDiscon.outerHTML.length,
          };
        }
        
        // Шукаємо будь-яку таблицю з "fact"
        const anyFact = document.querySelector('[class*="fact"]');
        if (anyFact) {
          alt.anyFactTable = {
            classes: anyFact.className,
            tagName: anyFact.tagName,
            htmlLength: anyFact.outerHTML.length,
          };
        }
        
        // Шукаємо будь-яку таблицю з "schedule"
        const anySchedule = document.querySelector('[class*="schedule"]');
        if (anySchedule) {
          alt.anyScheduleTable = {
            classes: anySchedule.className,
            tagName: anySchedule.tagName,
            htmlLength: anySchedule.outerHTML.length,
          };
        }
        
        return alt;
      });
      
      if (alternatives.anyDisconTable) {
        console.log(`  ✓ Знайдено елемент з "discon": ${alternatives.anyDisconTable.classes} (${alternatives.anyDisconTable.htmlLength} символів)`);
      }
      if (alternatives.anyFactTable) {
        console.log(`  ✓ Знайдено елемент з "fact": ${alternatives.anyFactTable.classes} (${alternatives.anyFactTable.htmlLength} символів)`);
      }
      if (alternatives.anyScheduleTable) {
        console.log(`  ✓ Знайдено елемент з "schedule": ${alternatives.anyScheduleTable.classes} (${alternatives.anyScheduleTable.htmlLength} символів)`);
      }
    }
    
    if (tables.factInfo || tables.factTables || tables.scheduleTable) {
      console.log('\n✓ Таблиці знайдено:');
      console.log(`  - factInfo: ${tables.factInfo ? `✓ (${tables.factInfo.length} символів)` : '✗'}`);
      console.log(`  - factTables: ${tables.factTables ? `✓ (${tables.factTables.length} символів)` : '✗'}`);
      console.log(`  - scheduleTable: ${tables.scheduleTable ? `✓ (${tables.scheduleTable.length} символів)` : '✗'}`);
      return tables;
    } else {
      console.log('\n✗ Таблиці не знайдено');
      return null;
    }
  } catch (error) {
    console.error('Помилка парсингу таблиць:', error.message);
    console.error(error.stack);
    return null;
  }
}

/**
 * Очистити HTML від небезпечних тегів та атрибутів для Telegram
 */
function sanitizeHtml(html) {
  if (!html) return '';
  
  // Telegram підтримує тільки обмежений набір HTML тегів
  // Видаляємо скрипти та стилі, залишаємо базову структуру
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, ''); // Видаляємо event handlers
}

/**
 * Форматувати HTML для Telegram
 */
function formatTablesForTelegram(tables) {
  if (!tables) return null;
  
  let message = '';
  
  if (tables.factInfo) {
    message += '<b>📋 Інформація про відключення:</b>\n\n';
    message += sanitizeHtml(tables.factInfo) + '\n\n';
  }
  
  if (tables.factTables) {
    message += '<b>📊 Таблиця відключень:</b>\n\n';
    message += sanitizeHtml(tables.factTables) + '\n\n';
  }
  
  if (tables.scheduleTable) {
    message += '<b>📅 Графік можливих відключень:</b>\n\n';
    message += sanitizeHtml(tables.scheduleTable);
  }
  
  return message.trim() || null;
}

module.exports = {
  parsePageTables,
  formatTablesForTelegram,
};

