const fs = require('fs');
const path = require('path');

async function fetchMarvelCDBData() {
  console.log('Descargando datos de MarvelCDB...');
  
  try {
    const response = await fetch('https://marvelcdb.com/api/public/cards/');
    const cards = await response.json();

    const db = {};

    // Filtrar solo villanos y planes principales
    cards.forEach(card => {
      // Filtrar cartas que sean de tipo villano o plan
      if (card.type_code === 'villain' || card.type_code === 'main_scheme') {
        const key = card.code; // Usar el código único de la carta (ej: "01072") o su nombre sanitizado
        
        if (!db[card.name.toLowerCase()]) {
          db[card.name.toLowerCase()] = {
            code: card.code,
            name: card.name,
            type: card.type_code,
            packCode: card.pack_code,
            // Datos del Villano
            baseHp: card.health || 0,
            hpPerHero: card.health_per_hero || false,
            // Datos del Plan Principal
            schemeName: card.type_code === 'main_scheme' ? card.name : '',
            baseThreat: card.base_threat || 0,
            targetBase: card.threat || 0
          };
        }
      }
    });

    const outputPath = path.join(__dirname, '../data/database.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(db, null, 2));

    console.log(`¡Base de datos generada con éxito en ${outputPath}!`);
  } catch (error) {
    console.error('Error al descargar los datos de MarvelCDB:', error);
  }
}

fetchMarvelCDBData();
