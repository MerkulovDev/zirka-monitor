/**
 * Створити скріншот елемента
 */
async function takeScreenshot(page, selector, options = {}) {
  try {
    const element = await page.$(selector);
    if (!element) {
      console.log(`✗ Елемент ${selector} не знайдено для скріншоту`);
      return null;
    }
    
    const screenshot = await element.screenshot({
      type: 'png',
      ...options
    });
    
    console.log(`✓ Скріншот створено: ${selector}`);
    return screenshot;
  } catch (error) {
    console.error(`Помилка створення скріншоту для ${selector}:`, error.message);
    return null;
  }
}

/**
 * Створити скріншоти всіх таблиць
 */
async function takeTableScreenshots(page) {
  const screenshots = {
    factInfo: null,
    factTables: null,
    scheduleTable: null,
  };
  
  if (await page.$('.discon-fact-info')) {
    screenshots.factInfo = await takeScreenshot(page, '.discon-fact-info');
  }
  
  if (await page.$('.discon-fact-tables')) {
    screenshots.factTables = await takeScreenshot(page, '.discon-fact-tables');
  }
  
  if (await page.$('.discon-schedule-table.active')) {
    screenshots.scheduleTable = await takeScreenshot(page, '.discon-schedule-table.active');
  }
  
  return screenshots;
}

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
 * Парсити HTML таблицю в структурований текст
 */
function parseTable(html) {
  // Видаляємо скрипти та стилі
  let cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '');
  
  // Витягуємо текст з клітинок таблиці
  const rows = [];
  const rowMatches = cleanHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  
  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];
    const cells = [];
    
    // Отримуємо всі клітинки (th або td)
    const cellMatches = rowHtml.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi);
    
    for (const cellMatch of cellMatches) {
      let cellText = cellMatch[1]
        .replace(/<[^>]+>/g, '') // Видаляємо всі HTML теги
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      
      cells.push(cellText);
    }
    
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  
  if (rows.length === 0) return '';
  
  // Знаходимо максимальну ширину кожної колонки
  const colWidths = [];
  rows.forEach(row => {
    row.forEach((cell, colIndex) => {
      const width = cell.length;
      if (!colWidths[colIndex] || colWidths[colIndex] < width) {
        colWidths[colIndex] = Math.min(width, 40); // Обмежуємо до 40 символів
      }
    });
  });
  
  // Формуємо таблицю
  let tableText = '';
  rows.forEach((row, rowIndex) => {
    const formattedRow = row.map((cell, colIndex) => {
      const width = colWidths[colIndex] || 10;
      // Обрізаємо довгі клітинки
      const cellValue = cell.length > width ? cell.substring(0, width - 3) + '...' : cell;
      return cellValue.padEnd(width);
    }).join(' │ ');
    
    tableText += '│ ' + formattedRow + ' │\n';
    
    // Додаємо роздільник після заголовку
    if (rowIndex === 0 && rows.length > 1) {
      const separator = colWidths.map(width => '─'.repeat(width)).join('─┼─');
      tableText += '├─' + separator + '─┤\n';
    }
  });
  
  return tableText;
}

/**
 * Конвертувати HTML в текстовий формат для Telegram
 */
function htmlToText(html) {
  if (!html) return '';
  
  // Спочатку обробляємо таблиці
  let text = html;
  
  // Замінюємо таблиці на відформатований текст
  const tableMatches = text.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
  for (const match of tableMatches) {
    const tableHtml = match[0];
    const formattedTable = parseTable(tableHtml);
    text = text.replace(tableHtml, formattedTable ? '\n' + formattedTable + '\n' : '');
  }
  
  // Видаляємо всі інші HTML теги, але зберігаємо текст
  text = text
    .replace(/<[^>]+>/g, '') // Видаляємо всі HTML теги
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Видаляємо зайві порожні рядки
    .trim();
  
  return text;
}

/**
 * Форматувати HTML для Telegram
 */
function formatTablesForTelegram(tables) {
  if (!tables) return null;
  
  let message = '';
  
  if (tables.factInfo) {
    message += '<b>📋 Інформація про відключення:</b>\n\n';
    const factInfoText = htmlToText(tables.factInfo);
    message += '<pre>' + factInfoText + '</pre>\n\n';
  }
  
  if (tables.factTables) {
    message += '<b>📊 Таблиця відключень:</b>\n\n';
    const factTablesText = htmlToText(tables.factTables);
    message += '<pre>' + factTablesText + '</pre>\n\n';
  }
  
  if (tables.scheduleTable) {
    message += '<b>📅 Графік можливих відключень:</b>\n\n';
    const scheduleText = htmlToText(tables.scheduleTable);
    // Якщо текст занадто довгий, обмежуємо його
    const maxLength = 3500; // Залишаємо місце для заголовків
    if (scheduleText.length > maxLength) {
      message += '<pre>' + scheduleText.substring(0, maxLength) + '...\n\n(повідомлення обрізано)</pre>';
    } else {
      message += '<pre>' + scheduleText + '</pre>';
    }
  }
  
  return message.trim() || null;
}

module.exports = {
  parsePageTables,
  formatTablesForTelegram,
  takeScreenshot,
  takeTableScreenshots,
};

