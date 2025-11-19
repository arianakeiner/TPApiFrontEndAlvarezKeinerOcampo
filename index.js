import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DOG_API_KEY = process.env.DOG_API_KEY;

app.use(cors());
app.use(express.json());

// ---------- Helpers ----------

function parseTemperament(temperament) {
    if (!temperament) return [];
    return temperament.split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
}

function getWeightKg(breed) {
    const metric = breed.weight?.metric || '';
    const parts = metric.split('-').map(p => parseFloat(p));
    const nums = parts.filter(n => !isNaN(n));
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function energyFromTemperamentAndBredFor(temperaments, bredFor) {
    const highEnergyWords = [
        'energetic', 'active', 'agile', 'alert',
        'high-spirited', 'playful', 'spirited', 'athletic'
    ];
    const lowEnergyWords = ['calm', 'laid-back', 'relaxed'];

    let score = 0;

    for (const t of temperaments) {
        if (highEnergyWords.includes(t)) score += 2;
        if (lowEnergyWords.includes(t)) score -= 1;
    }

    if (bredFor) {
        const bf = bredFor.toLowerCase();
        if (bf.includes('hunting') || bf.includes('herding') || bf.includes('working')) score += 2;
    }

    if (score <= 0) return 'baja';
    if (score <= 2) return 'media';
    return 'alta';
}

function isAffectionate(temperaments) {
    const loveWords = [
        'affectionate', 'loving', 'friendly', 'gentle',
        'companion', 'loyal', 'sweet'
    ];
    return temperaments.some(t => loveWords.includes(t));
}

function isDifficultForBeginners(temperaments) {
    const hardWords = [
        'independent', 'stubborn', 'dominant', 'aggressive',
        'strong willed', 'headstrong'
    ];
    return temperaments.some(t => hardWords.includes(t));
}

function barkinessFromTemperament(temperaments) {
    const barkyWords = ['alert', 'watchful', 'vocal'];
    let score = 0;
    for (const t of temperaments) {
        if (barkyWords.includes(t)) score++;
    }
    if (score === 0) return 'bajo';
    if (score === 1) return 'medio';
    return 'alto';
}

function suitableForSmallApartment(breed) {
    const weight = getWeightKg(breed);
    const temps = parseTemperament(breed.temperament);
    const energy = energyFromTemperamentAndBredFor(temps, breed.bred_for);

    if (weight !== null && weight > 20) return false;
    if (energy === 'alta') return false;
    return true;
}

function scoreBreedForUser(breed, userProfile) {
    const temps = parseTemperament(breed.temperament);
    const weight = getWeightKg(breed);
    const energy = energyFromTemperamentAndBredFor(temps, breed.bred_for);
    const affectionate = isAffectionate(temps);
    const difficult = isDifficultForBeginners(temps);
    const barkiness = barkinessFromTemperament(temps);

    let score = 0;

    // Tiempo libre
    if (userProfile.tiempoLibre === 'poco') {
        if (energy === 'baja') score += 3;
        if (energy === 'media') score += 1;
        if (energy === 'alta') score -= 3;
    } else if (userProfile.tiempoLibre === 'medio') {
        if (energy === 'media') score += 3;
        if (energy === 'baja') score += 1;
    } else if (userProfile.tiempoLibre === 'mucho') {
        if (energy === 'alta') score += 3;
    }

    // Actividad
    if (userProfile.actividad === 'sedentario' && energy === 'alta') score -= 2;
    if (userProfile.actividad === 'alto' && energy === 'alta') score += 2;

    // Vivienda
    if (userProfile.vivienda === 'departamento_chico') {
        if (suitableForSmallApartment(breed)) score += 3;
        else score -= 2;
    } else if (userProfile.vivienda === 'departamento_grande') {
        score += 1;
    } else if (userProfile.vivienda === 'casa_con_patio') {
        if (weight !== null && weight > 20) score += 2;
        if (energy === 'alta') score += 1;
    }

    // Experiencia
    if (userProfile.experiencia === 'principiante') {
        if (difficult) score -= 3;
        else score += 1;
    } else if (userProfile.experiencia === 'avanzado') {
        if (difficult) score += 1;
    }

    // Cariño
    if (userProfile.carino === 'alto' && affectionate) score += 3;
    if (userProfile.carino === 'bajo' && affectionate) score -= 1;

    // Ruido
    if (userProfile.ruido === 'baja' && barkiness === 'alto') score -= 3;
    if (userProfile.ruido === 'media' && barkiness === 'alto') score -= 1;

    return score;
}

// ---------- RUTA FRONT: GET / ----------

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Dog Matcher</title>
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: 20px auto; }
        label { display: block; margin-top: 10px; }
        select { width: 100%; padding: 5px; margin-top: 5px; }
        button { margin-top: 15px; padding: 8px 16px; }
        .card { border: 1px solid #ccc; padding: 10px; margin-top: 10px; border-radius: 4px; }
        .score { font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Match de razas de perros 🐶</h1>
      <form id="perfilForm">
        <label>
          Tiempo libre diario
          <select name="tiempoLibre" required>
            <option value="poco">Poco (0–1 h)</option>
            <option value="medio">Medio (1–3 h)</option>
            <option value="mucho">Mucho (3+ h)</option>
          </select>
        </label>

        <label>
          Nivel de actividad física
          <select name="actividad" required>
            <option value="sedentario">Sedentario</option>
            <option value="moderado">Moderado</option>
            <option value="alto">Alto</option>
          </select>
        </label>

        <label>
          Tolerancia al ruido
          <select name="ruido" required>
            <option value="baja">Baja</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </label>

        <label>
          Tamaño de vivienda
          <select name="vivienda" required>
            <option value="departamento_chico">Departamento chico</option>
            <option value="departamento_grande">Departamento grande</option>
            <option value="casa_con_patio">Casa con patio</option>
          </select>
        </label>

        <label>
          Experiencia con perros
          <select name="experiencia" required>
            <option value="principiante">Principiante</option>
            <option value="intermedio">Intermedio</option>
            <option value="avanzado">Avanzado</option>
          </select>
        </label>

        <label>
          Cariño / contacto físico
          <select name="carino" required>
            <option value="bajo">Bajo</option>
            <option value="medio">Medio</option>
            <option value="alto">Alto</option>
          </select>
        </label>

        <button type="submit">Buscar razas compatibles</button>
      </form>

      <h2>Resultados</h2>
      <div id="resultados"></div>

      <script>
        const form = document.getElementById('perfilForm');
        const resultadosDiv = document.getElementById('resultados');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          resultadosDiv.innerHTML = 'Buscando...';

          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());

          try {
            const res = await fetch('/match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });

            const json = await res.json();

            if (!res.ok) {
              resultadosDiv.innerHTML = '<p>Error: ' + (json.error || 'Desconocido') + '</p>';
              return;
            }

            if (!json.results || json.results.length === 0) {
              resultadosDiv.innerHTML = '<p>No se encontraron razas compatibles con ese perfil.</p>';
              return;
            }

            resultadosDiv.innerHTML = '';
            json.results.forEach(r => {
              const div = document.createElement('div');
              div.className = 'card';
              div.innerHTML = \`
                <div class="score">Score: \${r.score}</div>
                <h3>\${r.name}</h3>
                <p><strong>Temperamento:</strong> \${r.temperament || 'N/D'}</p>
                <p><strong>Peso:</strong> \${r.weight?.metric || 'N/D'} kg</p>
                <p><strong>Esperanza de vida:</strong> \${r.life_span || 'N/D'}</p>
                <p><strong>Criado para:</strong> \${r.bred_for || 'N/D'}</p>
              \`;
              resultadosDiv.appendChild(div);
            });

          } catch (err) {
            console.error(err);
            resultadosDiv.innerHTML = '<p>Error al conectar con el servidor.</p>';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ---------- API: POST /match ----------

app.post('/match', async (req, res) => {
    const {
        tiempoLibre,
        actividad,
        ruido,
        vivienda,
        experiencia,
        carino
    } = req.body || {};

    if (!tiempoLibre || !actividad || !ruido || !vivienda || !experiencia || !carino) {
        return res.status(400).json({ error: 'Faltan campos en el perfil del usuario' });
    }

    try {
        const response = await fetch('https://api.thedogapi.com/v1/breeds', {
            headers: { 'x-api-key': DOG_API_KEY }
        });

        if (!response.ok) {
            return res.status(500).json({ error: 'Error al obtener razas de TheDogAPI' });
        }

        const breeds = await response.json();

        const scored = breeds.map(b => ({
            breed: b,
            score: scoreBreedForUser(b, { tiempoLibre, actividad, ruido, vivienda, experiencia, carino })
        }));

        const filtered = scored
            .filter(b => b.score >= 2)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        res.json({
            results: filtered.map(item => ({
                id: item.breed.id,
                name: item.breed.name,
                temperament: item.breed.temperament,
                score: item.score,
                weight: item.breed.weight,
                life_span: item.breed.life_span,
                bred_for: item.breed.bred_for,
                image: item.breed.image
            }))
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al procesar la solicitud', details: error.message });
    }
});

// ---------- Arranque del servidor ----------

app.listen(PORT, () => {
    console.log("Servidor escuchando en http://localhost:"+PORT);
});
