const fetch = require('node-fetch');
const cheerio = require('cheerio');

exports.handler = async function(event, context) {
  try {
    // Usar fetch em vez de axios para simplicidade
    const response = await fetch('https://crazy-time.cc/statistics/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64 ) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];
    
    // Encontrar a tabela de resultados
    const rows = $('table tr').slice(1); // Pular o cabeçalho
    
    rows.each((index, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 3) {
        // A coluna "Spin Result" é a terceira
        const spinResultCell = cells.eq(2);
        let resultText = spinResultCell.text().trim();
        
        // Normalizar o resultado
        let normalizedResult;
        if (resultText.includes('1') || resultText === '1') normalizedResult = '1';
        else if (resultText.includes('2') || resultText === '2') normalizedResult = '2';
        else if (resultText.includes('5') || resultText === '5') normalizedResult = '5';
        else if (resultText.includes('10') || resultText === '10') normalizedResult = '10';
        else if (resultText.toLowerCase().includes('cash hunt')) normalizedResult = 'H';
        else if (resultText.toLowerCase().includes('pachinko')) normalizedResult = 'P';
        else if (resultText.toLowerCase().includes('coin flip')) normalizedResult = 'C';
        else if (resultText.toLowerCase().includes('crazy time')) normalizedResult = 'CT';
        
        if (normalizedResult) {
          results.push(normalizedResult);
        }
      }
    });
    
    // Limitar a 100 resultados
    const limitedResults = results.slice(0, 100);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: `Encontrados ${limitedResults.length} resultados`,
        results: limitedResults,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.log('Erro:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        message: `Erro ao buscar dados: ${error.message}`,
        results: []
      })
    };
  }
};
