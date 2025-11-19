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

/*app.get('/', (req, res) => {
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
});*/

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Dog Matcher</title>
      <style>
            <style>
      * {
        box-sizing: border-box;
      }
    
      body {
          margin: 0;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        
          /* Fondo crema con manchitas orgánicas */
          background-color: #fff7eb;
          background-image:
            radial-gradient(circle at 8% 12%, rgba(202, 138, 101, 0.22) 0 42px, transparent 43px),
            radial-gradient(circle at 78% 18%, rgba(251, 146, 60, 0.20) 0 55px, transparent 56px),
            radial-gradient(circle at 16% 78%, rgba(148, 91, 59, 0.18) 0 55px, transparent 56px),
            radial-gradient(circle at 88% 82%, rgba(120, 53, 15, 0.16) 0 60px, transparent 61px),
            radial-gradient(circle at 50% 50%, rgba(249, 115, 22, 0.12) 0 70px, transparent 71px);
          background-attachment: fixed;
        }

    
      .app {
        background: #fffaf3;
        border-radius: 16px;
        box-shadow:
          0 10px 24px rgba(120, 75, 44, 0.25),
          0 0 0 1px rgba(249, 224, 187, 0.8);
        max-width: 960px;
        width: 100%;
        padding: 24px 28px 28px;
        border: 1px solid #facc9b;
      }
    
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }
    
      .title {
        display: flex;
        align-items: center;
        gap: 10px;
      }
    
      .badge-dog {
        width: 40px;
        height: 40px;
        border-radius: 999px;
        background: linear-gradient(135deg, #fbbf24, #ea580c);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        box-shadow: 0 10px 20px rgba(234, 88, 12, 0.4);
      }
    
      h1 {
        font-size: 1.6rem;
        margin: 0;
        color: #78350f;
      }
    
      .subtitle {
        margin: 3px 0 0;
        font-size: 0.9rem;
        color: #92400e;
      }
    
      .chip {
        padding: 5px 10px;
        border-radius: 999px;
        background: #fef3c7;
        color: #92400e;
        font-size: 0.8rem;
        font-weight: 500;
        border: 1px solid #facc15;
      }
    
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.6fr);
        gap: 20px;
      }
    
      form {
        padding: 16px;
        border-radius: 12px;
        background: #fff7ed;
        border: 1px solid #fed7aa;
      }
    
      label {
        display: block;
        margin-bottom: 10px;
        font-size: 0.85rem;
        color: #7c2d12;
        font-weight: 500;
      }
    
      label span {
        display: block;
        margin-bottom: 4px;
      }
    
      select {
        width: 100%;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid #e5b98b;
        font-size: 0.9rem;
        background: #fff;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
    
      select:focus {
        border-color: #ea580c;
        box-shadow: 0 0 0 2px rgba(248, 153, 92, 0.45);
      }
    
      button {
        margin-top: 8px;
        width: 100%;
        padding: 9px 14px;
        border-radius: 999px;
        border: none;
        background: linear-gradient(135deg, #f97316, #ea580c);
        color: #fff7ed;
        font-weight: 600;
        letter-spacing: 0.02em;
        cursor: pointer;
        font-size: 0.95rem;
        box-shadow: 0 10px 20px rgba(194, 65, 12, 0.5);
        transition: transform 0.1s ease, box-shadow 0.1s ease, filter 0.1s ease;
      }
    
      button:hover {
        transform: translateY(-1px);
        filter: brightness(1.03);
        box-shadow: 0 14px 24px rgba(194, 65, 12, 0.58);
      }
    
      button:active {
        transform: translateY(0);
        box-shadow: 0 8px 16px rgba(194, 65, 12, 0.45);
      }
    
      .hint {
        margin-top: 8px;
        font-size: 0.78rem;
        color: #9a6b3a;
      }
    
      .result-panel {
        padding: 16px;
        border-radius: 12px;
        background: #fffbeb;
        border: 1px solid #facc15;
        display: flex;
        flex-direction: column;
        max-height: 550px;
      }
    
      .result-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
    
      .result-header h2 {
        margin: 0;
        font-size: 1.1rem;
        color: #854d0e;
      }
    
      .result-count {
        font-size: 0.8rem;
        color: #a16207;
      }
    
      #resultados {
        flex: 1;
        overflow-y: auto;
        padding: 4px 4px 10px;
      }
    
      .card {
        border-radius: 12px;
        background: #fffaf3;
        padding: 10px 12px;
        margin-top: 8px;
        box-shadow: 0 4px 8px rgba(120, 75, 44, 0.18);
        border: 1px solid #fed7aa;
        display: flex;
        gap: 10px;
      }
    
      .card-main {
        flex: 1;
      }
    
      .card h3 {
        margin: 0 0 4px;
        font-size: 1rem;
        color: #451a03;
      }
    
      .score-pill {
        align-self: flex-start;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
        background: #fef9c3;
        color: #854d0e;
      }
    
      .meta {
        font-size: 0.8rem;
        color: #78350f;
        margin: 2px 0;
      }
    
      .meta strong {
        color: #451a03;
      }
    
      .empty {
        font-size: 0.85rem;
        color: #9a6b3a;
      }
    
      .card-photo {
        width: 110px;
        flex-shrink: 0;
        border-radius: 10px;
        overflow: hidden;
        background: #f3e0c7;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    
      .card-photo img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    
      .no-photo {
        font-size: 0.75rem;
        color: #a16207;
        padding: 4px;
        text-align: center;
      }
    
      footer {
        margin-top: 10px;
        text-align: center;
        font-size: 0.75rem;
        color: #9a6b3a;
      }
    
      @media (max-width: 768px) {
        .app {
          padding: 18px 16px 22px;
        }
    
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>

      </style>
    </head>
    <body>
      <div class="app">
        <header>
          <div class="title">
            <div class="badge-dog">🐶</div>
            <div>
              <h1>Dog Matcher</h1>
              <p class="subtitle">Elegí tu estilo de vida y te sugerimos razas compatibles.</p>
            </div>
          </div>
          
        </header>

        <div class="layout">
          <form id="perfilForm">
            <label>
              <span>Tiempo libre diario</span>
              <select name="tiempoLibre" required>
                <option value="poco">Poco (0–1 h)</option>
                <option value="medio">Medio (1–3 h)</option>
                <option value="mucho">Mucho (3+ h)</option>
              </select>
            </label>

            <label>
              <span>Nivel de actividad física</span>
              <select name="actividad" required>
                <option value="sedentario">Sedentario</option>
                <option value="moderado">Moderado</option>
                <option value="alto">Alto</option>
              </select>
            </label>

            <label>
              <span>Tolerancia al ruido</span>
              <select name="ruido" required>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
            </label>

            <label>
              <span>Tamaño de vivienda</span>
              <select name="vivienda" required>
                <option value="departamento_chico">Departamento chico</option>
                <option value="departamento_grande">Departamento grande</option>
                <option value="casa_con_patio">Casa con patio</option>
              </select>
            </label>

            <label>
              <span>Experiencia con perros</span>
              <select name="experiencia" required>
                <option value="principiante">Principiante</option>
                <option value="intermedio">Intermedio</option>
                <option value="avanzado">Avanzado</option>
              </select>
            </label>

            <label>
              <span>Cariño / contacto físico</span>
              <select name="carino" required>
                <option value="bajo">Bajo</option>
                <option value="medio">Medio</option>
                <option value="alto">Alto</option>
              </select>
            </label>

            <button type="submit">Buscar razas compatibles</button>
            <p class="hint">Tip: probá cambiar los valores para ver cómo afecta a las razas recomendadas.</p>
          </form>

          <div class="result-panel">
            <div class="result-header">
              <h2>Resultados</h2>
              <span class="result-count" id="resultCount">Sin resultados aún</span>
            </div>
            <div id="resultados" class="empty">
              Completá el formulario y hacé clic en “Buscar razas compatibles”.
            </div>
          </div>
        </div>
      </div>

      <script>
        const form = document.getElementById('perfilForm');
        const resultadosDiv = document.getElementById('resultados');
        const resultCount = document.getElementById('resultCount');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          resultadosDiv.classList.remove('empty');
          resultadosDiv.innerHTML = '<p>Cargando resultados...</p>';
          resultCount.textContent = 'Buscando...';

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
              resultadosDiv.innerHTML = '<p class="empty">Error: ' + (json.error || 'Desconocido') + '</p>';
              resultCount.textContent = 'Error';
              return;
            }

            if (!json.results || json.results.length === 0) {
              resultadosDiv.innerHTML = '<p class="empty">No se encontraron razas compatibles con ese perfil.</p>';
              resultCount.textContent = '0 resultados';
              return;
            }

            resultCount.textContent = json.results.length + ' resultado(s)';
            resultadosDiv.innerHTML = '';

            json.results.forEach(r => {
              const div = document.createElement('div');
              div.className = 'card';
            
              const photoHtml =
                r.image && r.image.url
                  ? '<img src="' + r.image.url + '" alt="' + r.name + '" />'
                  : '<div class="no-photo">Sin foto 😢</div>';
            
              div.innerHTML =
                '<div class="card-main">' +
                  '<div class="score-pill">Score: ' + r.score + '</div>' +
                  '<h3>' + r.name + '</h3>' +
                  '<p class="meta"><strong>Temperamento:</strong> ' + (r.temperament || 'N/D') + '</p>' +
                  '<p class="meta"><strong>Peso:</strong> ' + ((r.weight && r.weight.metric) || 'N/D') + ' kg</p>' +
                  '<p class="meta"><strong>Esperanza de vida:</strong> ' + (r.life_span || 'N/D') + '</p>' +
                  '<p class="meta"><strong>Criado para:</strong> ' + (r.bred_for || 'N/D') + '</p>' +
                '</div>' +
                '<div class="card-photo">' +
                  photoHtml +
                '</div>';
            
              resultadosDiv.appendChild(div);
            });


          } catch (err) {
            console.error(err);
            resultadosDiv.innerHTML = '<p class="empty">Error al conectar con el servidor.</p>';
            resultCount.textContent = 'Error de conexión';
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
