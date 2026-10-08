const fs = require('fs');
const path = require('path');

async function fetchMarvelCDBData() {
  console.log('Descargando Villanos, Planes Principales y Secundarios en ESPAÑOL desde es.marvelcdb.com...');

  try {
    // Petición a los endpoints de la versión en español
    const [villainsRes, mainSchemesRes, sideSchemesRes] = await Promise.all([
      fetch('https://es.marvelcdb.com/api/public/cards/type/villain'),
      fetch('https://es.marvelcdb.com/api/public/cards/type/main_scheme'),
      fetch('https://es.marvelcdb.com/api/public/cards/type/side_scheme')
    ]);

    if (!villainsRes.ok || !mainSchemesRes.ok || !sideSchemesRes.ok) {
      throw new Error('Error al conectar con la API de es.marvelcdb.com');
    }

    const villains = await villainsRes.json();
    const mainSchemes = await mainSchemesRes.json();
    const sideSchemes = await sideSchemesRes.json();

    console.log(`Recibidos: ${villains.length} villanos, ${mainSchemes.length} planes principales y ${sideSchemes.length} planes secundarios.`);

    // 1. Indexar Planes Principales por conjunto de encuentro (Stage 1 / 1A / A)
    const schemeByEncounter = {};
    mainSchemes.forEach(s => {
      if (s.encounter_code) {
        if (!schemeByEncounter[s.encounter_code] || s.stage === 1 || s.stage === '1A' || s.stage === 'A') {
          schemeByEncounter[s.encounter_code] = s;
        }
      }
    });

    // 2. Agrupar Planes Secundarios por conjunto de encuentro
    const sideSchemesByEncounter = {};
    sideSchemes.forEach(ss => {
      if (ss.encounter_code) {
        if (!sideSchemesByEncounter[ss.encounter_code]) {
          sideSchemesByEncounter[ss.encounter_code] = [];
        }
        sideSchemesByEncounter[ss.encounter_code].push({
          code: ss.code,
          name: ss.name,
          baseThreat: ss.base_threat !== undefined ? ss.base_threat : (ss.threat || 0),
          threatFixed: ss.threat_fixed || false // Si es valor fijo o escala por jugador
        });
      }
    });

    // 3. Agrupar Villanos por conjunto de encuentro (Stage 1 / I)
    const encounters = {};
    villains.forEach(v => {
      if (v.encounter_code) {
        if (!encounters[v.encounter_code] || v.stage === 1 || v.stage === 'I') {
          encounters[v.encounter_code] = v;
        }
      }
    });

    const database = {};

    // 4. Estructurar base de datos final
    Object.keys(encounters).forEach(encounterCode => {
      const villain = encounters[encounterCode];
      const mainScheme = schemeByEncounter[encounterCode] || {};
      const sideList = sideSchemesByEncounter[encounterCode] || [];

      const key = `${encounterCode}_${villain.name}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, '_');

      database[key] = {
        key: key,
        encounterCode: encounterCode,
        villainName: villain.name,
        encounterName: villain.encounter_name || villain.name,
        baseHp: villain.health || 10,
        mainScheme: {
          name: mainScheme.name || 'Plan Principal',
          baseThreat: mainScheme.base_threat !== undefined ? mainScheme.base_threat : 1,
          targetBase: mainScheme.threat !== undefined ? mainScheme.threat : 7
        },
        sideSchemes: sideList
      };
    });

    // Guardar resultado
    const outputDir = path.join(__dirname, '../data');
    const outputPath = path.join(outputDir, 'database.json');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(database, null, 2), 'utf8');

    console.log(`\n¡BBDD actualizada con éxito! (${Object.keys(database).length} conjuntos de encuentros en español).`);

  } catch (error) {
    console.error('Error al procesar los datos:', error.message);
  }
}

fetchMarvelCDBData();
